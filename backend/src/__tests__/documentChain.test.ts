import {
  deriveRequisitionStatus,
  aggregateRfqStatus,
  rfqStatusRank,
  RFQ_STATUS_RANK,
  REQUISITION_STATUS,
  SALES_SOURCE_DOCUMENT,
  PURCHASE_SOURCE_DOCUMENT,
  LEAD_STATUS,
} from '../shared/services/documentChain';

/**
 * The two aggregation rules in the document chain are the parts most likely to
 * be wrong in a way nobody notices: they decide what a user SEES as the state of
 * a requisition or an RFQ, and a wrong answer looks like a UI quirk rather than
 * a bug. Both come from published Microsoft behaviour, so both are tested
 * against that behaviour rather than against my own restatement of it.
 */

describe('deriveRequisitionStatus — header status follows the lines', () => {
  const { DRAFT, IN_REVIEW, APPROVED, REJECTED, CANCELLED, CLOSED } = REQUISITION_STATUS;

  it('is DRAFT when there are no lines at all', () => {
    expect(deriveRequisitionStatus([])).toBe(DRAFT);
  });

  it('is DRAFT while any line is still a draft', () => {
    expect(deriveRequisitionStatus([APPROVED, DRAFT])).toBe(DRAFT);
  });

  it('stays IN_REVIEW until every line has finished review', () => {
    // [OFFICIAL] "you must complete the review process for all purchase
    // requisition lines before you can complete the review process for the whole
    // purchase requisition."
    expect(deriveRequisitionStatus([APPROVED, IN_REVIEW])).toBe(IN_REVIEW);
    expect(deriveRequisitionStatus([REJECTED, IN_REVIEW])).toBe(IN_REVIEW);
    expect(deriveRequisitionStatus([IN_REVIEW, IN_REVIEW])).toBe(IN_REVIEW);
  });

  it('is APPROVED once review is finished and nothing is pending', () => {
    expect(deriveRequisitionStatus([APPROVED, APPROVED])).toBe(APPROVED);
  });

  it('is APPROVED for a partly rejected requisition — the approved part still stands', () => {
    // This is the case a header-only status cannot express, and the reason the
    // line status exists at all.
    expect(deriveRequisitionStatus([APPROVED, REJECTED])).toBe(APPROVED);
  });

  it('is REJECTED only when every line was rejected', () => {
    expect(deriveRequisitionStatus([REJECTED, REJECTED])).toBe(REJECTED);
  });

  it('is CANCELLED only when every line was cancelled', () => {
    expect(deriveRequisitionStatus([CANCELLED, CANCELLED])).toBe(CANCELLED);
  });

  it('is CLOSED when every live line has a document behind it', () => {
    expect(deriveRequisitionStatus([CLOSED, CLOSED])).toBe(CLOSED);
  });

  it('ignores cancelled lines when judging whether the rest is closed', () => {
    // "Approve four, cancel the fifth, order the four" must end CLOSED, not
    // hang forever because one line was dropped.
    expect(deriveRequisitionStatus([CLOSED, CANCELLED])).toBe(CLOSED);
    expect(deriveRequisitionStatus([CLOSED, CLOSED, CANCELLED])).toBe(CLOSED);
  });

  it('does not report CLOSED while part of the requisition is still only approved', () => {
    expect(deriveRequisitionStatus([CLOSED, APPROVED])).toBe(APPROVED);
  });
});

describe('aggregateRfqStatus — the official lowest/highest ranking', () => {
  it('ranks the statuses exactly as Microsoft documents them', () => {
    // [OFFICIAL] "Created, Sent, Received, Rejected, Accepted, Declined, Canceled"
    expect([...RFQ_STATUS_RANK]).toEqual([
      'CREATED', 'SENT', 'RECEIVED', 'REJECTED', 'ACCEPTED', 'DECLINED', 'CANCELLED',
    ]);
    expect(rfqStatusRank('CREATED')).toBeLessThan(rfqStatusRank('SENT'));
    expect(rfqStatusRank('SENT')).toBeLessThan(rfqStatusRank('RECEIVED'));
    expect(rfqStatusRank('RECEIVED')).toBeLessThan(rfqStatusRank('ACCEPTED'));
  });

  it('has no aggregate for a case with nobody invited', () => {
    expect(aggregateRfqStatus([])).toEqual({ lowest: null, highest: null });
  });

  it('reproduces the documented worked example', () => {
    // "an RFQ case with three lines is sent to two vendors… Now a bid is entered
    //  from one of the vendors… The lowest status will then be Sent, and the
    //  highest status is Received."
    expect(aggregateRfqStatus(['SENT', 'RECEIVED'])).toEqual({
      lowest: 'SENT',
      highest: 'RECEIVED',
    });
  });

  it('drops the lowest back to CREATED when a vendor is added after sending', () => {
    // "If you add a new vendor to the case, the lowest status will change to Created"
    expect(aggregateRfqStatus(['SENT', 'SENT', 'CREATED']).lowest).toBe('CREATED');
  });

  it('shows a part-awarded case as REJECTED..ACCEPTED', () => {
    expect(aggregateRfqStatus(['REJECTED', 'ACCEPTED'])).toEqual({
      lowest: 'REJECTED',
      highest: 'ACCEPTED',
    });
  });

  it('treats an unknown status as lowest rather than throwing', () => {
    // A status display must never be the thing that takes a page down.
    expect(() => aggregateRfqStatus(['NOT_A_STATUS'])).not.toThrow();
    expect(aggregateRfqStatus(['NOT_A_STATUS']).lowest).toBe('CREATED');
  });
});

describe('provenance vocabulary', () => {
  it('defaults both order types to DIRECT, so existing rows keep their meaning', () => {
    expect(SALES_SOURCE_DOCUMENT.DIRECT).toBe('DIRECT');
    expect(PURCHASE_SOURCE_DOCUMENT.DIRECT).toBe('DIRECT');
  });

  it('carries hooks for the deferred upstream documents', () => {
    // SCOPE_AND_HOOKS.md §2 requires the enum VALUE to exist today so the
    // capability attaches later without a data migration.
    expect(PURCHASE_SOURCE_DOCUMENT.PURCHASE_AGREEMENT).toBeDefined();
    expect(SALES_SOURCE_DOCUMENT.SALES_AGREEMENT).toBeDefined();
  });

  it('has exactly the three official lead states', () => {
    expect(Object.values(LEAD_STATUS)).toEqual(['OPEN', 'QUALIFIED', 'DISQUALIFIED']);
  });
});

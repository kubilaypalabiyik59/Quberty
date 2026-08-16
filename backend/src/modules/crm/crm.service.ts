import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import {
  LEAD_STATUS,
  OPPORTUNITY_STATUS,
  QUOTATION_STATUS,
} from '../../shared/services/documentChain';

/**
 * Prospect to Quote (catalog 85), the first half: leads and opportunities.
 *
 * These are the two documents in front of the quotation, and neither of them
 * touches money or the ledger. That is not an omission — a lead is a person who
 * might buy something, and an opportunity is a guess about a deal. The first
 * financial fact in the chain is the quotation's price, and the first accounting
 * fact is still the order's invoice.
 *
 * ── Why `Lead` is not a flag on `Customer` ─────────────────────────────────
 * **[OFFICIAL]** "keep a lead separate from customer and opportunity data until
 * the lead is qualified."
 * learn.microsoft.com/dynamics365/sales/developer/lead-entity
 *
 * Practically: an unqualified lead must not appear in customer lists, AR aging,
 * lifetime-value totals or the storefront's account lookup. A boolean on
 * `Customer` leaks into every one of those.
 */

/* ───────────────────────────────── leads ─────────────────────────────────── */

export interface CreateLeadInput {
  company_name?: string | null;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  source?: string;
  rating?: string;
  estimated_amount?: number | null;
  currency?: string;
  owner_user_id?: string | null;
  notes?: string | null;
}

export async function createLead(tenantId: string, input: CreateLeadInput, createdBy: string) {
  const lead_number = await allocateNumber({ tenantId, reference: 'LEAD' });

  return db.lead.create({
    data: {
      tenant_id: tenantId,
      lead_number,
      company_name: input.company_name ?? null,
      first_name: input.first_name,
      last_name: input.last_name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      source: input.source ?? 'MANUAL',
      rating: input.rating ?? 'WARM',
      estimated_amount: input.estimated_amount ?? null,
      currency: input.currency ?? 'BOB',
      owner_user_id: input.owner_user_id ?? null,
      notes: input.notes ?? null,
      created_by: createdBy,
    },
  });
}

/**
 * Next customer code.
 *
 * The existing `POST /customers` derives this from `count() + 1`, which is the
 * same shape as the journal-number bug D-5: it collides under concurrency and it
 * reuses codes after a deletion. Reading MAX of the numeric suffix is strictly
 * better, and the caller retries once on a unique violation, which closes the
 * remaining race without introducing another counter table.
 */
async function nextCustomerCode(tenantId: string, client: Prisma.TransactionClient): Promise<string> {
  const rows = await client.$queryRaw<{ max: bigint | null }[]>`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '^\\D*', ''), '')::bigint), 0) AS max
      FROM customers
     WHERE tenant_id = ${tenantId}::uuid AND code ~ '^CUST-[0-9]+$'
  `;
  return `CUST-${String(Number(rows[0]?.max ?? 0) + 1).padStart(5, '0')}`;
}

/**
 * Turn a lead into a customer record.
 *
 * **[OFFICIAL]** D365 Supply Chain calls this "Convert to customer" and does it
 * before a quotation can be confirmed; the prospect is then "retired" rather
 * than deleted. We keep the lead row too, and for the documented reason: it is
 * what makes "which lead source actually converts" answerable later.
 *
 * Idempotent — converting an already-converted lead returns the existing
 * customer rather than creating a second one.
 */
export async function convertLeadToCustomer(
  tenantId: string,
  leadId: string,
  client: Prisma.TransactionClient | typeof db = db,
) {
  const lead = await client.lead.findFirst({ where: { id: leadId, tenant_id: tenantId } });
  if (!lead) throw new AppError('Lead not found', 404);

  if (lead.converted_customer_id) {
    const existing = await client.customer.findFirst({
      where: { id: lead.converted_customer_id, tenant_id: tenantId },
    });
    if (existing) return existing;
  }

  const run = async (tx: Prisma.TransactionClient) => {
    const customer = await tx.customer.create({
      data: {
        tenant_id: tenantId,
        code: await nextCustomerCode(tenantId, tx),
        // A lead may be a company with no named contact. `Customer.first_name`
        // is NOT NULL, so the company name stands in rather than an empty
        // string, which would render as a blank row everywhere.
        first_name: lead.first_name || lead.company_name || 'Cliente',
        last_name: lead.last_name ?? (lead.company_name && lead.first_name ? lead.company_name : ''),
        email: lead.email,
        phone: lead.phone,
        city: lead.city,
        country: lead.country,
        notes: lead.notes,
      },
    });

    await tx.lead.update({
      where: { id: lead.id },
      data: { converted_customer_id: customer.id },
    });

    return customer;
  };

  // Already inside a caller's transaction → join it. Otherwise open one, because
  // creating the customer and stamping the lead must not half-happen.
  if (client !== db) return run(client as Prisma.TransactionClient);
  return db.$transaction(run);
}

export interface QualifyLeadInput {
  /** Link to an existing customer instead of creating one. */
  customer_id?: string | null;
  /** Skip opportunity creation. Default is to create one. */
  create_opportunity?: boolean;
  opportunity_name?: string;
  estimated_amount?: number;
  stage_id?: string | null;
  expected_close_date?: string | null;
}

/**
 * Qualify a lead.
 *
 * **[OFFICIAL]** "When you qualify a lead, you validate that it's a genuine
 * sales opportunity and associate an account and contact, and create the
 * corresponding opportunity record to track the deal."
 * learn.microsoft.com/dynamics365/sales/qualify-lead-convert-opportunity-sales
 *
 * D365's newer experience lets the seller choose which records get created, so
 * `create_opportunity` and `customer_id` are exposed rather than assumed.
 */
export async function qualifyLead(
  tenantId: string,
  leadId: string,
  input: QualifyLeadInput,
  userId: string,
) {
  const lead = await db.lead.findFirst({ where: { id: leadId, tenant_id: tenantId } });
  if (!lead) throw new AppError('Lead not found', 404);
  if (lead.status === LEAD_STATUS.QUALIFIED) {
    throw new AppError(`Lead ${lead.lead_number} is already qualified.`, 409);
  }
  if (lead.status === LEAD_STATUS.DISQUALIFIED) {
    throw new AppError(
      `Lead ${lead.lead_number} was disqualified. Reopen it before qualifying.`,
      409,
    );
  }

  const wantsOpportunity = input.create_opportunity !== false;

  // Both numbers are allocated OUTSIDE the transaction on purpose: the sequences
  // are non-continuous, so allocating them inside would hold their row locks for
  // the whole transaction and serialise unrelated qualifications.
  const opportunityNumber = wantsOpportunity
    ? await allocateNumber({ tenantId, reference: 'OPPORTUNITY' })
    : null;

  return db.$transaction(async (tx) => {
    let customerId = input.customer_id ?? null;

    if (customerId) {
      const exists = await tx.customer.findFirst({
        where: { id: customerId, tenant_id: tenantId },
        select: { id: true },
      });
      if (!exists) throw new AppError('Customer not found', 404);
      await tx.lead.update({ where: { id: lead.id }, data: { converted_customer_id: customerId } });
    } else {
      const customer = await convertLeadToCustomer(tenantId, lead.id, tx);
      customerId = customer.id;
    }

    const updatedLead = await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: LEAD_STATUS.QUALIFIED,
        qualified_at: new Date(),
        converted_customer_id: customerId,
      },
    });

    let opportunity = null;
    if (wantsOpportunity) {
      // The stage seeds the probability — that is what the stage's
      // `default_probability` is for, and it is why a weighted pipeline value is
      // computable without asking the user for a percentage on every deal.
      const stage = input.stage_id
        ? await tx.salesPipelineStage.findFirst({
            where: { id: input.stage_id, tenant_id: tenantId },
            select: { id: true, default_probability: true },
          })
        : await tx.salesPipelineStage.findFirst({
            where: { tenant_id: tenantId, is_active: true },
            orderBy: { sort_order: 'asc' },
            select: { id: true, default_probability: true },
          });

      opportunity = await tx.opportunity.create({
        data: {
          tenant_id: tenantId,
          opportunity_number: opportunityNumber!,
          name:
            input.opportunity_name ??
            `${lead.company_name ?? `${lead.first_name} ${lead.last_name ?? ''}`.trim()}`,
          // The opportunity is ADDRESSED to the customer — the CHECK constraint
          // permits exactly one party, and a qualified lead by definition has
          // one. The lead it CAME FROM is recorded separately, because
          // overwriting the party would otherwise destroy the origin at the
          // exact moment it becomes worth reporting on.
          customer_id: customerId,
          lead_id: null,
          originating_lead_id: lead.id,
          stage_id: stage?.id ?? null,
          probability: stage?.default_probability ?? 50,
          estimated_amount: input.estimated_amount ?? Number(lead.estimated_amount ?? 0),
          currency: lead.currency,
          expected_close_date: input.expected_close_date ? new Date(input.expected_close_date) : null,
          owner_user_id: lead.owner_user_id ?? userId,
          created_by: userId,
        },
      });
    }

    return { lead: updatedLead, customer_id: customerId, opportunity };
  });
}

/**
 * **[OFFICIAL]** "You can disqualify a lead only if no opportunity is associated
 * with it." Enforced here rather than assumed, because the alternative is an
 * opportunity in the pipeline whose lead says it went nowhere.
 */
export async function disqualifyLead(tenantId: string, leadId: string, reason: string) {
  const lead = await db.lead.findFirst({ where: { id: leadId, tenant_id: tenantId } });
  if (!lead) throw new AppError('Lead not found', 404);
  if (lead.status === LEAD_STATUS.DISQUALIFIED) return lead;

  // Counts opportunities attached EITHER as party or by origin. Checking only
  // `lead_id` would let a qualified lead be disqualified afterwards, leaving a
  // live opportunity whose origin says the deal went nowhere.
  const opportunities = await db.opportunity.count({
    where: {
      tenant_id: tenantId,
      OR: [{ lead_id: leadId }, { originating_lead_id: leadId }],
    },
  });
  if (opportunities > 0) {
    throw new AppError(
      `Lead ${lead.lead_number} has ${opportunities} opportunit${opportunities === 1 ? 'y' : 'ies'} ` +
        `attached and cannot be disqualified. Close the opportunit${opportunities === 1 ? 'y' : 'ies'} as lost instead.`,
      409,
    );
  }

  return db.lead.update({
    where: { id: lead.id },
    data: {
      status: LEAD_STATUS.DISQUALIFIED,
      disqualified_at: new Date(),
      disqualify_reason: reason || null,
    },
  });
}

/** Reactivating a closed lead is explicitly supported by D365 and costs nothing. */
export async function reopenLead(tenantId: string, leadId: string) {
  const lead = await db.lead.findFirst({ where: { id: leadId, tenant_id: tenantId } });
  if (!lead) throw new AppError('Lead not found', 404);
  if (lead.status === LEAD_STATUS.OPEN) return lead;

  return db.lead.update({
    where: { id: lead.id },
    data: {
      status: LEAD_STATUS.OPEN,
      disqualified_at: null,
      disqualify_reason: null,
      qualified_at: null,
    },
  });
}

/* ────────────────────────────── opportunities ────────────────────────────── */

export interface CreateOpportunityInput {
  name: string;
  customer_id?: string | null;
  lead_id?: string | null;
  stage_id?: string | null;
  estimated_amount?: number;
  probability?: number;
  currency?: string;
  expected_close_date?: string | null;
  owner_user_id?: string | null;
  notes?: string | null;
}

export async function createOpportunity(
  tenantId: string,
  input: CreateOpportunityInput,
  createdBy: string,
) {
  // The CHECK constraint enforces this at the database, but a 400 with a
  // sentence beats a 500 with a constraint name.
  const parties = [input.customer_id, input.lead_id].filter(Boolean).length;
  if (parties !== 1) {
    throw new AppError(
      'An opportunity needs exactly one party: either customer_id or lead_id, not both and not neither.',
      400,
    );
  }

  const stage = input.stage_id
    ? await db.salesPipelineStage.findFirst({
        where: { id: input.stage_id, tenant_id: tenantId },
        select: { id: true, default_probability: true },
      })
    : null;
  if (input.stage_id && !stage) throw new AppError('Pipeline stage not found', 404);

  const opportunity_number = await allocateNumber({ tenantId, reference: 'OPPORTUNITY' });

  return db.opportunity.create({
    data: {
      tenant_id: tenantId,
      opportunity_number,
      name: input.name,
      customer_id: input.customer_id ?? null,
      lead_id: input.lead_id ?? null,
      // An opportunity raised directly against a lead originates from it too.
      originating_lead_id: input.lead_id ?? null,
      stage_id: stage?.id ?? null,
      probability: input.probability ?? stage?.default_probability ?? 50,
      estimated_amount: input.estimated_amount ?? 0,
      currency: input.currency ?? 'BOB',
      expected_close_date: input.expected_close_date ? new Date(input.expected_close_date) : null,
      owner_user_id: input.owner_user_id ?? createdBy,
      notes: input.notes ?? null,
      created_by: createdBy,
    },
  });
}

/**
 * Move an opportunity to another stage.
 *
 * The probability follows the stage unless the caller overrides it, which is the
 * behaviour that keeps a weighted pipeline meaningful without manual upkeep.
 */
export async function moveOpportunityStage(
  tenantId: string,
  opportunityId: string,
  stageId: string,
  probability?: number,
) {
  const [opp, stage] = [
    await db.opportunity.findFirst({ where: { id: opportunityId, tenant_id: tenantId } }),
    await db.salesPipelineStage.findFirst({ where: { id: stageId, tenant_id: tenantId } }),
  ];
  if (!opp) throw new AppError('Opportunity not found', 404);
  if (!stage) throw new AppError('Pipeline stage not found', 404);
  if (opp.status !== OPPORTUNITY_STATUS.OPEN) {
    throw new AppError(`Opportunity ${opp.opportunity_number} is ${opp.status} and cannot be moved.`, 409);
  }

  return db.opportunity.update({
    where: { id: opp.id },
    data: {
      stage_id: stage.id,
      probability: probability ?? stage.default_probability,
    },
  });
}

/**
 * Close an opportunity WON or LOST.
 *
 * Winning does NOT create a sales order here. In D365 the order comes from
 * confirming the quotation, and short-circuiting that would mean an order with
 * no agreed price behind it. If a tenant wants to skip quoting entirely they
 * create the order directly — which is the `DIRECT` provenance that already
 * exists.
 */
export async function closeOpportunity(
  tenantId: string,
  opportunityId: string,
  outcome: 'WON' | 'LOST' | 'CANCELLED',
  reason?: string,
) {
  const opp = await db.opportunity.findFirst({ where: { id: opportunityId, tenant_id: tenantId } });
  if (!opp) throw new AppError('Opportunity not found', 404);
  if (opp.status !== OPPORTUNITY_STATUS.OPEN) {
    throw new AppError(`Opportunity ${opp.opportunity_number} is already ${opp.status}.`, 409);
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.opportunity.update({
      where: { id: opp.id },
      data: {
        status: outcome,
        outcome_reason: reason ?? null,
        closed_at: new Date(),
        probability: outcome === OPPORTUNITY_STATUS.WON ? 100 : 0,
      },
    });

    // Losing the deal loses its open quotations with it. Leaving a live offer
    // attached to a dead opportunity is how a customer ends up accepting a quote
    // the seller believes is gone.
    if (outcome !== OPPORTUNITY_STATUS.WON) {
      await tx.salesQuotation.updateMany({
        where: {
          tenant_id: tenantId,
          opportunity_id: opp.id,
          status: { in: [QUOTATION_STATUS.DRAFT, QUOTATION_STATUS.SENT] },
        },
        data: {
          status: QUOTATION_STATUS.LOST,
          closed_at: new Date(),
          outcome_reason: reason ?? `Opportunity ${opp.opportunity_number} closed as ${outcome}`,
        },
      });
    }

    return updated;
  });
}

/**
 * Weighted pipeline: Σ(estimated_amount × probability) over OPEN opportunities,
 * grouped by stage. This is the one number a sales pipeline exists to produce,
 * and it is only computable because probability is carried on the row rather
 * than inferred from a stage name.
 */
export async function pipelineSummary(tenantId: string) {
  const stages = await db.salesPipelineStage.findMany({
    where: { tenant_id: tenantId },
    orderBy: { sort_order: 'asc' },
  });

  const open = await db.opportunity.findMany({
    where: { tenant_id: tenantId, status: OPPORTUNITY_STATUS.OPEN },
    select: { stage_id: true, estimated_amount: true, probability: true },
  });

  const byStage = stages.map((s) => {
    const rows = open.filter((o) => o.stage_id === s.id);
    const total = rows.reduce((sum, o) => sum + Number(o.estimated_amount), 0);
    const weighted = rows.reduce((sum, o) => sum + (Number(o.estimated_amount) * o.probability) / 100, 0);
    return {
      stage_id: s.id,
      code: s.code,
      name: s.name,
      sort_order: s.sort_order,
      count: rows.length,
      total: Number(total.toFixed(2)),
      weighted: Number(weighted.toFixed(2)),
    };
  });

  const unstaged = open.filter((o) => !o.stage_id);

  return {
    stages: byStage,
    unstaged: {
      count: unstaged.length,
      total: Number(unstaged.reduce((s, o) => s + Number(o.estimated_amount), 0).toFixed(2)),
    },
    total: Number(byStage.reduce((s, x) => s + x.total, 0).toFixed(2)),
    weighted: Number(byStage.reduce((s, x) => s + x.weighted, 0).toFixed(2)),
  };
}

import { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError';
import { postJournal } from '../../shared/services/journal.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { hasPermission } from '../../shared/middleware/permissions';

/**
 * POS tenders and shift declarations (WORK-047).
 *
 * **[OFFICIAL]** Commerce calculates the statement per payment method and compares it
 * with the tender declarations counted at close; differences above the store's
 * maximum need a decision and are posted to a difference account:
 *   learn.microsoft.com/dynamics365/commerce/retail-statements
 *   learn.microsoft.com/dynamics365/commerce/shift-drawer-management
 *
 * A sale's tenders each debit their method's account (cash, card clearing, bank) —
 * never accounts receivable. `CUSTOMER_ACCOUNT` is refused until AR open items exist
 * (WORK-034): the enum value is the hook.
 */

type Tx = Prisma.TransactionClient;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Lock the register session row for the rest of the transaction and return its
 * status (WORK-047 review 1). A sale, a void and a close of the same register take
 * this lock first, so they serialise: a close cannot compute its declarations while
 * a sale or void is committing into the register, and neither can land after the
 * close. Lock order everywhere: register session → FACTURA sequence → stock/layers.
 */
export async function lockRegisterSession(tx: Tx, tenantId: string, sessionId: string): Promise<{ id: string; status: string } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>(
    Prisma.sql`SELECT id, status FROM register_sessions WHERE id = ${sessionId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`,
  );
  return rows[0] ?? null;
}

/** Tender types a sale may not use yet; the enum values stay as schema hooks. */
const NOT_IMPLEMENTED_TENDERS: Record<string, string> = {
  CUSTOMER_ACCOUNT: 'Selling on customer account is not available until receivables are itemised.',
  VOUCHER: 'Gift vouchers are not available until voucher numbers and balances are tracked.',
};

export interface TenderInput {
  payment_method_id: string;
  amount: number;
  tendered?: number;
}

export interface PlannedTender {
  method: { id: string; code: string; tender_type: string; account_id: string; allow_change: boolean };
  amount: number;
  tendered: number | null;
  change: number | null;
}

/**
 * Turn what the till sent into validated tenders for a sale of `total`.
 * The older single `payment_method` + `cash_tendered` maps to the tenant's active
 * method of that tender type.
 */
export async function planTenders(
  tx: Tx,
  tenantId: string,
  total: number,
  body: { tenders?: TenderInput[]; payment_method?: string; cash_tendered?: number },
): Promise<PlannedTender[]> {
  let inputs = body.tenders ?? [];
  if (inputs.length === 0 && body.payment_method) {
    const legacy = await tx.salesPaymentMethod.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: null, warehouse_id: null, tender_type: body.payment_method, is_active: true },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    if (!legacy) {
      throw new AppError(
        `No active ${body.payment_method} payment method is set up. Add one under Sales → Payment methods.`,
        422,
        'PAYMENT_METHOD_NOT_CONFIGURED',
      );
    }
    inputs = [{ payment_method_id: legacy.id, amount: round2(total), tendered: body.cash_tendered }];
  }
  if (inputs.length === 0) throw new AppError('State how the sale was paid', 400, 'TENDER_REQUIRED');

  const ids = [...new Set(inputs.map((t) => t.payment_method_id))];
  if (ids.length !== inputs.length) throw new AppError('Each payment method may appear once per sale', 400, 'TENDER_DUPLICATE_METHOD');
  const methods = await tx.salesPaymentMethod.findMany({
    // Tenant-wide methods only: a legal-entity or per-store override has no
    // resolution rule yet, and the close counts the same set (review 4).
    where: { tenant_id: tenantId, id: { in: ids }, is_active: true, legal_entity_id: null, warehouse_id: null },
    select: { id: true, code: true, tender_type: true, account_id: true, allow_change: true },
  });
  const byId = new Map(methods.map((m) => [m.id, m]));

  const planned = inputs.map((t, i) => {
    const method = byId.get(t.payment_method_id);
    if (!method) throw new AppError(`tenders[${i}]: unknown or inactive payment method`, 422, 'FOREIGN_REFERENCE');
    if (NOT_IMPLEMENTED_TENDERS[method.tender_type]) {
      throw new AppError(NOT_IMPLEMENTED_TENDERS[method.tender_type], 422, 'TENDER_NOT_IMPLEMENTED');
    }
    const amount = round2(t.amount);
    const tendered = t.tendered === undefined ? null : round2(t.tendered);
    if (tendered !== null && tendered < amount) {
      throw new AppError(`tenders[${i}]: ${method.code} received ${tendered}, less than the ${amount} it pays`, 400, 'TENDER_SHORT');
    }
    if (tendered !== null && tendered > amount && !method.allow_change) {
      throw new AppError(`tenders[${i}]: ${method.code} gives no change, so it cannot receive more than it pays`, 400, 'TENDER_NO_CHANGE');
    }
    return { method, amount, tendered, change: tendered !== null ? round2(tendered - amount) : null };
  });

  const paid = round2(planned.reduce((s, t) => s + t.amount, 0));
  if (paid !== round2(total)) {
    throw new AppError(`The tenders add up to ${paid}, but the sale totals ${round2(total)}.`, 400, 'TENDER_TOTAL_MISMATCH');
  }
  return planned;
}

/** One debit per tender account. */
export function tenderDebitLines(tenders: PlannedTender[], orderNumber: string) {
  const byAccount = new Map<string, { amount: number; codes: string[] }>();
  for (const t of tenders) {
    const row = byAccount.get(t.method.account_id) ?? { amount: 0, codes: [] };
    row.amount = round2(row.amount + t.amount);
    row.codes.push(t.method.code);
    byAccount.set(t.method.account_id, row);
  }
  return [...byAccount].map(([accountId, r]) => ({
    accountId, debit: r.amount, description: `${r.codes.join(' + ')} — ${orderNumber}`,
  }));
}

export interface DeclarationInput { payment_method_id: string; counted: number }

/**
 * What a closing shift expected per method, what was counted, and the difference.
 * Cash starts from the opening float. A method with policy COUNT must be declared;
 * a NONE method is taken as counted = expected.
 */
export async function closeSessionDeclarations(
  tx: Tx,
  opts: {
    tenantId: string;
    session: { id: string; terminal_name: string; opening_float: any; site_id: string | null; warehouse_id: string | null };
    declarations: DeclarationInput[];
    closingFloat?: number;
    userRole: string;
    userId: string;
  },
) {
  const { tenantId, session } = opts;
  const tenders = await tx.posTender.findMany({
    where: { tenant_id: tenantId, register_session_id: session.id, reversed_at: null },
    select: { payment_method_id: true, amount: true },
  });
  const methods = await tx.salesPaymentMethod.findMany({
    // Every method the register's tenders used, whatever its scope or status, plus the
    // active tenant-wide methods that are counted at close.
    where: {
      tenant_id: tenantId,
      OR: [
        { is_active: true, legal_entity_id: null, warehouse_id: null },
        { id: { in: tenders.map((t) => t.payment_method_id) } },
      ],
    },
    select: { id: true, code: true, name: true, tender_type: true, account_id: true, declaration_policy: true, max_difference_amount: true },
  });

  const sold = new Map<string, number>();
  for (const t of tenders) sold.set(t.payment_method_id, round2((sold.get(t.payment_method_id) ?? 0) + Number(t.amount)));

  const cash = methods
    .filter((m) => m.tender_type === 'CASH' && (sold.has(m.id) || m.declaration_policy === 'COUNT'))
    .sort((a, b) => a.code.localeCompare(b.code))[0]
    ?? methods.filter((m) => m.tender_type === 'CASH').sort((a, b) => a.code.localeCompare(b.code))[0];
  const declared = new Map(opts.declarations.map((d) => [d.payment_method_id, round2(d.counted)]));
  if (opts.closingFloat !== undefined && cash && !declared.has(cash.id)) declared.set(cash.id, round2(opts.closingFloat));


  const rows = methods
    .filter((m) => sold.has(m.id) || m.declaration_policy === 'COUNT' || m.id === cash?.id)
    .map((m) => {
      const expected = round2((sold.get(m.id) ?? 0) + (m.id === cash?.id ? Number(session.opening_float) : 0));
      if (m.declaration_policy === 'COUNT' && !declared.has(m.id)) {
        throw new AppError(`Count and declare ${m.name} (${m.code}) before closing the register.`, 400, 'DECLARATION_REQUIRED');
      }
      const counted = declared.has(m.id) ? declared.get(m.id)! : expected;
      return { method: m, expected, counted, difference: round2(counted - expected) };
    });

  // A count for a method this register does not expect is a mistake, not something
  // to drop silently (review 4).
  const known = new Set(rows.map((r) => r.method.id));
  const unknown = [...declared.keys()].filter((id) => !known.has(id));
  if (unknown.length) {
    throw new AppError('A declaration names a payment method this register does not count.', 400, 'DECLARATION_UNKNOWN_METHOD');
  }

  for (const r of rows) {
    // No tolerance set means none is allowed: any difference needs a manager. A blank
    // tolerance that silently let a cashier close any amount short was the WORK-047
    // acceptance run's finding.
    const limit = r.method.max_difference_amount === null ? 0 : Number(r.method.max_difference_amount);
    if (Math.abs(r.difference) > limit && !hasPermission(opts.userRole, 'pos.session.close_with_difference')) {
      throw new AppError(
        `${r.method.code} is ${r.difference > 0 ? 'over' : 'short'} by ${Math.abs(r.difference)}, above the ${limit} allowed. ` +
          'A store manager must close this register.',
        403,
        'DECLARATION_DIFFERENCE_TOO_LARGE',
      );
    }
  }

  const withDifference = rows.filter((r) => r.difference !== 0);
  let journalEntryId: string | null = null;
  if (withDifference.length) {
    const acc = await resolvePostingAccounts_orExplain(tenantId, ['CASH_DIFFERENCE'] as const, {
      document: `Register close ${session.terminal_name}`, client: tx,
    });
    if (acc) {
      const lines = withDifference.flatMap((r) => r.difference < 0
        ? [
            { accountId: acc.CASH_DIFFERENCE, debit: -r.difference, description: `Short ${r.method.code} — ${session.terminal_name}` },
            { accountId: r.method.account_id, credit: -r.difference, description: `Short ${r.method.code} — ${session.terminal_name}` },
          ]
        : [
            { accountId: r.method.account_id, debit: r.difference, description: `Over ${r.method.code} — ${session.terminal_name}` },
            { accountId: acc.CASH_DIFFERENCE, credit: r.difference, description: `Over ${r.method.code} — ${session.terminal_name}` },
          ]);
      const entry = await postJournal({
        tenantId, tx,
        description: `Register close difference: ${session.terminal_name}`,
        source: { module: 'POS_SESSION_CLOSE', id: session.id },
        userId: opts.userId,
        dimensions: { siteId: session.site_id, warehouseId: session.warehouse_id },
        lines,
      });
      journalEntryId = entry.id;
    }
  }

  for (const r of rows) {
    await tx.registerSessionDeclaration.create({
      data: {
        tenant_id: tenantId, register_session_id: session.id, payment_method_id: r.method.id,
        expected: r.expected, counted: r.counted, difference: r.difference,
        journal_entry_id: r.difference !== 0 ? journalEntryId : null,
      },
    });
  }

  return {
    rows: rows.map((r) => ({
      payment_method_id: r.method.id, code: r.method.code, name: r.method.name, tender_type: r.method.tender_type,
      expected: r.expected, counted: r.counted, difference: r.difference,
    })),
    cashCounted: cash ? rows.find((r) => r.method.id === cash.id)?.counted ?? null : null,
    journalEntryId,
  };
}

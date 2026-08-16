import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../errors/AppError';

/**
 * Posting profile resolution — which GL account a posting type maps to.
 *
 * Replaces the hardcoded account-code literals ('1103', '2103', '2105', '1201'…)
 * that are spread across six route files and are the root cause of defects
 * D-1 … D-7 (docs/process/GAP_ANALYSIS.md).
 *
 * Design: docs/architecture/PARAMETERS_AND_CONFIG.md
 *
 * Two behaviours are deliberate and must not be "simplified" later:
 *
 *  1. Most-specific-first resolution, the way D365 posting profiles and price
 *     tolerances resolve (Table → Group → All).
 *  2. **Unresolved is an exception, never a skip.** The old code guarded posting
 *     blocks with `if (accountA && accountB)`, so a missing account silently
 *     produced a document with no journal entry — that is D-4, and it is how
 *     Bs 3 250 of COGS came to be posted against no revenue at all. A financial
 *     document that cannot post its journal must fail the whole operation.
 */

export type PostingType =
  | 'AR'
  | 'AP'
  | 'REVENUE'
  | 'VAT_OUTPUT'
  | 'VAT_INPUT'
  | 'COGS'
  | 'INVENTORY'
  /// Goods received not invoiced — the clearing liability a product receipt
  /// credits and a vendor invoice debits back. **[OFFICIAL]** *Purchase, accrual*.
  | 'PURCHASE_ACCRUAL'
  /// Not-stocked purchases. **[OFFICIAL]** *Purchase expenditure for expense*.
  | 'PURCHASE_EXPENSE'
  /// Receipt price vs invoice price. **[OFFICIAL]** *Stock variation*.
  | 'PRICE_VARIANCE'
  | 'TAX_TURNOVER_EXPENSE'
  | 'TAX_TURNOVER_PAYABLE'
  | 'CASH'
  | 'BANK'
  | 'PAYROLL_EXPENSE'
  | 'PAYROLL_PAYABLE'
  | 'ROUNDING';

/** Specificity axis, least specific last. Order here IS the resolution order. */
const SCOPE_PRECEDENCE = ['ITEM', 'ITEM_GROUP', 'PARTY', 'PARTY_GROUP', 'ALL'] as const;
export type ScopeKind = (typeof SCOPE_PRECEDENCE)[number];

export interface ResolveContext {
  tenantId: string;
  legalEntityId?: string | null;
  /** Product id, when the posting derives from a line. */
  itemId?: string | null;
  /** Product category id. */
  itemGroupId?: string | null;
  /** Customer or supplier id. */
  partyId?: string | null;
  partyGroupId?: string | null;
  /** Posting date — profiles are date-effective. Defaults to today. */
  on?: Date;
}

type Client = Prisma.TransactionClient | typeof db;

const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Resolve one posting type to an account id.
 * Throws AppError(500) when nothing matches — see note 2 above.
 */
export async function resolvePostingAccount(
  postingType: PostingType,
  ctx: ResolveContext,
  client: Client = db,
): Promise<string> {
  const on = dateOnly(ctx.on ?? new Date());

  const candidateFor = (kind: ScopeKind): string | null | undefined => {
    switch (kind) {
      case 'ITEM':        return ctx.itemId;
      case 'ITEM_GROUP':  return ctx.itemGroupId;
      case 'PARTY':       return ctx.partyId;
      case 'PARTY_GROUP': return ctx.partyGroupId;
      case 'ALL':         return null;
    }
  };

  const rows = await client.postingProfile.findMany({
    where: {
      tenant_id:    ctx.tenantId,
      // A legal-entity-specific profile wins over the tenant default; both are
      // fetched here and ranked below rather than in two round trips.
      legal_entity_id: ctx.legalEntityId ? { in: [ctx.legalEntityId, null] } : null,
      posting_type: postingType,
      valid_from:   { lte: on },
      OR: [{ valid_to: null }, { valid_to: { gte: on } }],
    },
    select: { account_id: true, scope_kind: true, scope_id: true, legal_entity_id: true },
  });

  for (const kind of SCOPE_PRECEDENCE) {
    const wanted = candidateFor(kind);
    if (kind !== 'ALL' && !wanted) continue;

    const matches = rows.filter(
      r => r.scope_kind === kind && (kind === 'ALL' ? r.scope_id === null : r.scope_id === wanted),
    );
    if (matches.length === 0) continue;

    // Legal-entity-specific beats the tenant default at the same specificity.
    const best = matches.find(m => m.legal_entity_id !== null) ?? matches[0];
    return best.account_id;
  }

  throw new AppError(
    `No posting profile resolves '${postingType}'. A document cannot post without it. ` +
      `Configure it under Finance → Posting profiles.`,
    500,
    'POSTING_PROFILE_UNRESOLVED',
  );
}

/**
 * Resolve several posting types at once. Fails on the first unresolved type and
 * names every missing one, so configuring a tenant is not a guess-and-retry loop.
 */
export async function resolvePostingAccounts<T extends PostingType>(
  postingTypes: readonly T[],
  ctx: ResolveContext,
  client: Client = db,
): Promise<Record<T, string>> {
  const settled = await Promise.allSettled(
    postingTypes.map(t => resolvePostingAccount(t, ctx, client)),
  );

  const missing = postingTypes.filter((_, i) => settled[i].status === 'rejected');
  if (missing.length > 0) {
    throw new AppError(
      `Cannot post: no posting profile for ${missing.join(', ')}. ` +
        `Configure these under Finance → Posting profiles before posting this document.`,
      500,
      'POSTING_PROFILE_UNRESOLVED',
    );
  }

  const out = {} as Record<T, string>;
  postingTypes.forEach((t, i) => {
    out[t] = (settled[i] as PromiseFulfilledResult<string>).value;
  });
  return out;
}

/**
 * Configuration health check. Returns the posting types that have no ALL-scope
 * fallback, which is the condition that makes posting fail at transaction time.
 * Intended for a setup screen and for a startup warning — the whole point is that
 * a tenant discovers this before a sale, not during one.
 */
export async function findUnconfiguredPostingTypes(
  tenantId: string,
  required: readonly PostingType[],
  legalEntityId: string | null = null,
): Promise<PostingType[]> {
  const configured = await db.postingProfile.findMany({
    where: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      scope_kind: 'ALL',
      posting_type: { in: required as unknown as string[] },
    },
    select: { posting_type: true },
  });
  const have = new Set(configured.map(r => r.posting_type));
  return required.filter(t => !have.has(t));
}

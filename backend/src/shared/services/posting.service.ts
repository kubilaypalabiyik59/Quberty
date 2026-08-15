import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';
import { AppError } from '../errors/AppError';
import {
  PostingType,
  ResolveContext,
  resolvePostingAccounts,
} from './postingProfile.service';

/**
 * The single entry point posting routes use to obtain GL accounts.
 *
 * It replaces the pattern that caused D-1 … D-7:
 *
 *     const a = await db.account.findFirst({ where: { code: '2103' } });
 *     const b = await db.account.findFirst({ where: { code: '1103' } });
 *     if (a && b) { ...post... }          // ← silently skipped when either is null
 *
 * Two things were wrong with that. The account codes were literals, so the same
 * concept resolved to different accounts in different modules (POS used '2105'
 * and '1201' while Sales used '2103' and '1103'). And the truthiness guard turned
 * a configuration error into a missing journal entry that nobody saw — which is
 * how Bs 3 250 of COGS came to be posted against no revenue at all.
 *
 * ── Migration behaviour ────────────────────────────────────────────────────
 * `FinanceParameters.require_balanced_posting` decides what happens when the
 * accounts cannot be resolved:
 *
 *   true  → throw. A financial document that cannot post its journal must fail
 *           the whole operation. This is the correct behaviour and the fix for
 *           D-4. It is the default for new tenants.
 *
 *   false → log an error at ERROR level and return null, so the caller skips the
 *           journal exactly as before. This exists ONLY so an existing tenant can
 *           be migrated deliberately instead of abruptly. It is still a strict
 *           improvement on the old code, because the failure is now loud.
 *
 * Flip a tenant to `true` once its posting profiles are complete. That flip is
 * what finally closes D-4.
 */

export interface PostingAccountsOptions extends Omit<Partial<ResolveContext>, 'tenantId'> {
  /** For the error message and the log line — e.g. "Sales invoice SO-2026-00042". */
  document: string;
  client?: Prisma.TransactionClient | typeof db;
}

export async function resolvePostingAccounts_orExplain<T extends PostingType>(
  tenantId: string,
  types: readonly T[],
  opts: PostingAccountsOptions,
): Promise<Record<T, string> | null> {
  const client = opts.client ?? db;

  try {
    return await resolvePostingAccounts(types, { tenantId, ...opts }, client);
  } catch (err) {
    const params = await db.financeParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: null },
      select: { require_balanced_posting: true },
    });
    // Absent parameters mean the tenant was never provisioned. Default to strict:
    // an unconfigured tenant posting silently is the whole problem.
    const strict = params?.require_balanced_posting ?? true;
    const detail = err instanceof AppError ? err.message : String(err);

    if (strict) {
      logger.error({ tenantId, document: opts.document, types, detail }, 'Posting blocked: unresolved posting profile');
      throw new AppError(
        `${opts.document} cannot be posted: ${detail}`,
        500,
        'POSTING_PROFILE_UNRESOLVED',
      );
    }

    logger.error(
      { tenantId, document: opts.document, types, detail },
      'GL JOURNAL SKIPPED — posting profiles unresolved and require_balanced_posting is false. ' +
        'The document was created WITHOUT a journal entry. Configure posting profiles and enable ' +
        'require_balanced_posting for this tenant.',
    );
    return null;
  }
}

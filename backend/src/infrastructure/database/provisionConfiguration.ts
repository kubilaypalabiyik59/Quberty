/**
 * Provision the configuration foundation for a tenant, from a country template.
 *
 *   npx tsx src/infrastructure/database/provisionConfiguration.ts                      # dry run, all tenants
 *   npx tsx src/infrastructure/database/provisionConfiguration.ts --apply
 *   npx tsx src/infrastructure/database/provisionConfiguration.ts --apply --tenant <slug> --template bolivia-pcg
 *
 * ── COUNTRY INDEPENDENCE IS THE DESIGN GOAL ────────────────────────────────
 * This file contains NO account codes. Not one. It resolves everything through
 * `Account.category`, the country-independent classification, because the codes
 * themselves are jurisdiction-specific:
 *
 *   ACCOUNTS_RECEIVABLE = 1103 (Bolivia PCG) · 120 Alıcılar (Turkey TDHP) · 1200 (SKR04)
 *   VAT_PAYABLE         = 2103/2105 (Bolivia) · 391 Hesaplanan KDV (Turkey)
 *
 * This is D365's main account category, whose documented purpose is to let the
 * default financial reports work "without making any modifications":
 * learn.microsoft.com/dynamics365/finance/general-ledger/plan-chart-of-accounts
 *
 * Onboarding a new country therefore means adding a JSON template. It does not
 * mean touching this file, the services, or the routes.
 *
 * ── THE RULE ON AMBIGUITY ──────────────────────────────────────────────────
 * Exactly one account in a category → configure it.
 * Several                          → STOP and report. Do not guess.
 * None                             → STOP and report.
 *
 * Guessing would silently repoint the general ledger, which is the failure this
 * whole workstream exists to eliminate.
 */

import { PrismaClient } from '@prisma/client';
import { COA_TEMPLATES, getTemplate, CoaTemplate } from '../../data/coa-templates/index';
import {
  POSTING_TYPE_BY_CATEGORY,
  POSTING_TYPES_REQUIRED_TO_TRADE,
} from '../../shared/services/accountCategory';
import { PostingType } from '../../shared/services/postingProfile.service';

const db = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const argAfter = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
};
const TENANT = argAfter('--tenant');
const TEMPLATE_ID = argAfter('--template');

/**
 * Explicit, auditable decisions for a tenant whose chart of accounts has forked
 * and that no template can therefore describe.
 *
 *   --account AR=1103 --account VAT_OUTPUT=2103
 *
 * Each pin does two things: it creates the posting profile against that account,
 * and it stamps the matching category on the account so reporting agrees with
 * posting. Pins bypass category resolution — they ARE the resolution — and are
 * recorded in the profile description so the decision is traceable later.
 *
 * This exists because "which of these two accounts is the real one" is a question
 * about a specific company's books. It is not something a template, a heuristic,
 * or this script can answer.
 */
const PINS = new Map<string, string>(
  process.argv
    .map((a, i) => (a === '--account' ? process.argv[i + 1] : null))
    .filter((v): v is string => !!v && v.includes('='))
    .map(v => {
      const [type, code] = v.split('=');
      return [type.trim().toUpperCase(), code.trim()] as [string, string];
    }),
);

type Tenant = { id: string; name: string; slug: string; currency_code: string };

/* ────────────────────────── template selection ────────────────────────── */

/**
 * Pick the template for a tenant. Explicit flag wins; otherwise match on the
 * tenant's currency, then fall back to the generic IFRS chart. Never assume
 * Bolivia — that assumption is what this refactor removes.
 */
function templateFor(tenant: Tenant): CoaTemplate | undefined {
  if (TEMPLATE_ID) return getTemplate(TEMPLATE_ID);
  return (
    COA_TEMPLATES.find(t => t.currency === tenant.currency_code) ??
    getTemplate('generic-ifrs')
  );
}

/* ────────────────────────── category backfill ─────────────────────────── */

/** Lowercase, strip diacritics and punctuation, keep tokens of 4+ characters. */
function nameTokens(s: string): Set<string> {
  return new Set(
    s.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/).filter(w => w.length >= 4),
  );
}

/**
 * Existing tenants have accounts created before `category` existed. Backfill by
 * matching the tenant's account CODES against the template's — the only place in
 * this flow that touches codes at all, and only to migrate old data forward.
 *
 * ── WHY THE NAME CHECK IS NOT OPTIONAL ─────────────────────────────────────
 * Backfilling on code alone is actively dangerous when a tenant's chart has
 * forked. In the live tenant, the bolivia-pcg template maps code `1201` to
 * ACCOUNTS_RECEIVABLE, but that tenant's `1201` is named *Activo Fijo* — it is a
 * fixed-asset account. A code-only backfill would have labelled Fixed Assets as
 * Accounts Receivable and then generated a posting profile from it: defect D-6,
 * recreated by the very script meant to eliminate it.
 *
 * So a code match must ALSO agree by name. Where they disagree, the account is
 * left uncategorised and reported. A human resolves it; the script does not.
 */
async function backfillCategories(tenant: Tenant, template: CoaTemplate): Promise<Map<string, string>> {
  const accounts = await db.account.findMany({
    where: { tenant_id: tenant.id, category: null },
    select: { id: true, code: true, name: true },
  });
  if (accounts.length === 0) return new Map();

  const byCode = new Map(template.accounts.map(a => [a.code, a]));

  const updates: { id: string; code: string; name: string; category: string }[] = [];
  const conflicts: { code: string; tenantName: string; templateName: string; category: string }[] = [];
  const unknown: { code: string; name: string }[] = [];

  for (const a of accounts) {
    const tpl = byCode.get(a.code);
    if (!tpl) { unknown.push({ code: a.code, name: a.name }); continue; }

    // Stem-prefix comparison, not exact tokens: "Bancos" and "Banco Cuenta
    // Corriente" are the same account, "Activo Fijo" and "Cuentas por Cobrar"
    // are not.
    const mine = [...nameTokens(a.name)];
    const theirs = [...nameTokens(tpl.name)];
    const agrees =
      a.name.toLowerCase() === tpl.name.toLowerCase() ||
      mine.some(m => theirs.some(t => m.startsWith(t.slice(0, 4)) || t.startsWith(m.slice(0, 4))));

    if (!agrees) {
      conflicts.push({ code: a.code, tenantName: a.name, templateName: tpl.name, category: tpl.category });
      continue;
    }
    updates.push({ id: a.id, code: a.code, name: a.name, category: tpl.category });
  }

  if (conflicts.length > 0) {
    console.log(`  CONFLICT ${conflicts.length} account(s) share a code with the template but not a meaning — NOT categorised:`);
    for (const c of conflicts) {
      console.log(`             ${c.code}: this tenant has "${c.tenantName}", template says "${c.templateName}" (${c.category})`);
    }
    console.log(`             Left uncategorised on purpose. Assigning the template's meaning here would`);
    console.log(`             recreate D-6 (posting receivables to Fixed Assets).`);
  }
  if (unknown.length > 0) {
    console.log(`  NOTE     ${unknown.length} account(s) are not in template "${template.id}" and stay uncategorised:`);
    for (const u of unknown) console.log(`             ${u.code} "${u.name}"`);
  }

  // Hand the categories to the next step. In a dry run nothing is written, so
  // without this overlay every posting type would read as MISSING purely because
  // the column is still null — a useless preview.
  const pending = new Map(updates.map(u => [u.id, u.category]));

  if (!APPLY) {
    console.log(`  DRY RUN  would categorise ${updates.length} account(s) from template "${template.id}"`);
    return pending;
  }

  for (const u of updates) {
    await db.account.update({ where: { id: u.id }, data: { category: u.category } });
  }
  console.log(`  OK       categorised ${updates.length} account(s) from template "${template.id}"`);
  return pending;
}

/* ────────────────────────── posting profiles ──────────────────────────── */

async function provisionPostingProfiles(tenant: Tenant, pendingCategories: Map<string, string>): Promise<void> {
  const all = await db.account.findMany({
    where: { tenant_id: tenant.id },
    select: { id: true, code: true, name: true, category: true },
  });
  const accounts = all
    .map(a => ({ ...a, category: a.category ?? pendingCategories.get(a.id) ?? null }))
    .filter(a => a.category !== null);

  const activity = await db.$queryRaw<{ code: string; lines: bigint }[]>`
    SELECT a.code, COUNT(*) AS lines
      FROM journal_lines l
      JOIN accounts a ON a.id = l.account_id
     WHERE a.tenant_id = ${tenant.id}::uuid
     GROUP BY a.code
  `;
  const linesByCode = new Map(activity.map(r => [r.code, Number(r.lines)]));

  const configured = new Set(
    (
      await db.postingProfile.findMany({
        where: { tenant_id: tenant.id, legal_entity_id: null, scope_kind: 'ALL' },
        select: { posting_type: true },
      })
    ).map(p => p.posting_type),
  );

  const toCreate: { posting_type: string; account_id: string; pinned: boolean }[] = [];
  const pinCategoryUpdates: { id: string; category: string }[] = [];
  const blocked: string[] = [];

  for (const [postingType, category] of Object.entries(POSTING_TYPE_BY_CATEGORY) as [PostingType, string][]) {
    if (configured.has(postingType)) {
      console.log(`  SKIP     ${postingType.padEnd(22)} already configured`);
      continue;
    }

    // An explicit --account pin overrides category resolution entirely.
    const pinnedCode = PINS.get(postingType);
    if (pinnedCode) {
      const pinned = all.find(a => a.code === pinnedCode);
      if (!pinned) {
        const msg = `pinned to account ${pinnedCode}, which this tenant does not have`;
        console.log(`  ERROR    ${postingType.padEnd(22)} ${msg}`);
        blocked.push(`${postingType}: ${msg}`);
        continue;
      }
      console.log(`  PINNED   ${postingType.padEnd(22)} ${pinned.code} "${pinned.name}" (${linesByCode.get(pinned.code) ?? 0} posted lines) — explicit decision`);
      toCreate.push({ posting_type: postingType, account_id: pinned.id, pinned: true });
      if (pinned.category !== category) {
        pinCategoryUpdates.push({ id: pinned.id, category });
      }
      continue;
    }

    const candidates = accounts.filter(a => a.category === category);

    if (candidates.length === 0) {
      const msg = `no account categorised ${category}`;
      console.log(`  MISSING  ${postingType.padEnd(22)} ${msg}`);
      if (POSTING_TYPES_REQUIRED_TO_TRADE.includes(postingType)) blocked.push(`${postingType}: ${msg}`);
      continue;
    }

    if (candidates.length > 1) {
      const described = candidates
        .map(a => `${a.code} "${a.name}" (${linesByCode.get(a.code) ?? 0} posted lines)`)
        .join('  ·  ');
      console.log(`  AMBIG    ${postingType.padEnd(22)} ${candidates.length} accounts share category ${category} — ${described}`);
      if (POSTING_TYPES_REQUIRED_TO_TRADE.includes(postingType)) {
        blocked.push(`${postingType}: ${candidates.length} accounts share category ${category} — ${described}`);
      }
      continue;
    }

    const a = candidates[0];
    // A single candidate is only trustworthy if every account is classified. An
    // uncategorised rival is invisible to this check — that is how VAT_OUTPUT
    // first resolved to 2105 while 2103 (11 posted lines) sat unclassified.
    // TWO shared stems, not one. One is far too loose in a Spanish chart:
    // "Cuentas por Cobrar" vs "Cuentas por Pagar" share *cuentas*, and
    // "IVA Débito Fiscal" vs "IVA Crédito Fiscal" share *fiscal* — neither is a
    // rival. Two stems isolates the case that actually matters: 2103 and 2105,
    // both literally "IVA Débito Fiscal".
    const aStems = [...nameTokens(a.name)];
    const uncategorisedRivals = all.filter(x => {
      if (x.id === a.id || x.category || pendingCategories.has(x.id)) return false;
      const shared = [...nameTokens(x.name)].filter(w =>
        aStems.some(y => w.startsWith(y.slice(0, 4)) || y.startsWith(w.slice(0, 4))),
      );
      return shared.length >= 2;
    });
    if (uncategorisedRivals.length > 0) {
      console.log(
        `  WARN     ${postingType.padEnd(22)} resolved to ${a.code} "${a.name}", but ` +
          uncategorisedRivals.map(r => `${r.code} "${r.name}" (${linesByCode.get(r.code) ?? 0} lines)`).join(', ') +
          ` is uncategorised and similarly named — confirm with --account ${postingType}=<code>`,
      );
    } else {
      console.log(`  OK       ${postingType.padEnd(22)} ${a.code} "${a.name}" (${linesByCode.get(a.code) ?? 0} posted lines)`);
    }
    toCreate.push({ posting_type: postingType, account_id: a.id, pinned: false });
  }

  if (blocked.length > 0) {
    console.log(
      `\n  ${blocked.length} posting type(s) required for trading cannot be resolved automatically:\n` +
        blocked.map(b => `    - ${b}`).join('\n') +
        `\n  Nothing was written for them. Two accounts sharing one category means the chart` +
        `\n  itself has forked — resolve that first (GAP_ANALYSIS.md D-1).`,
    );
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN  would create ${toCreate.length} posting profile(s).`);
    return;
  }
  if (toCreate.length === 0) return;

  // Stamp categories implied by pins, so reporting and posting agree.
  for (const u of pinCategoryUpdates) {
    await db.account.update({ where: { id: u.id }, data: { category: u.category } });
  }
  if (pinCategoryUpdates.length > 0) {
    console.log(`  OK       stamped ${pinCategoryUpdates.length} category/categories implied by --account pins`);
  }

  const validFrom = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  await db.postingProfile.createMany({
    data: toCreate.map(t => ({
      tenant_id: tenant.id,
      legal_entity_id: null,
      posting_type: t.posting_type,
      scope_kind: 'ALL',
      scope_id: null,
      account_id: t.account_id,
      valid_from: validFrom,
      description: t.pinned
        ? 'Explicit decision via --account pin (forked chart of accounts)'
        : 'Provisioned by category',
    })),
    skipDuplicates: true,
  });
  console.log(`\n  OK       created ${toCreate.length} posting profile(s).`);
}

/* ────────────────────────── number sequences ──────────────────────────── */

async function provisionSequences(tenant: Tenant): Promise<void> {
  const rows = await db.$queryRaw<{ max: number | null }[]>`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(entry_number, '^.*[-]', ''), '')::bigint), 0) AS max
      FROM journal_entries
     WHERE tenant_id = ${tenant.id}::uuid
  `;
  const startAt = Number(rows[0]?.max ?? 0) + 1;

  const seqs = [
    {
      reference: 'JOURNAL_VOUCHER',
      name: 'Journal voucher',
      format: 'JE-{YYYY}-{#####}',
      continuous: false,
      scope: 'FISCAL_YEAR',
      next_number: startAt,
      current_year: new Date().getFullYear(),
    },
    {
      reference: 'FACTURA',
      name: 'Legal invoice series',
      format: '{######}',
      // Gaplessness is a legal question per jurisdiction and is still open for
      // Bolivia (HANDOVER.md §7). Left false so this script does not assert a
      // legal position it cannot support.
      continuous: false,
      scope: 'LEGAL_ENTITY',
      next_number: 1,
      current_year: null,
    },

    // ── Process front ends (migration 005) ────────────────────────────────
    // Every one of these is an internal or commercial document with no legal
    // numbering requirement in any jurisdiction we have researched, so all are
    // non-continuous. A gap in a quotation series is invisible to everyone; the
    // row lock a continuous series holds is not.
    {
      reference: 'LEAD',
      name: 'Lead',
      format: 'LD-{YYYY}-{#####}',
      continuous: false,
      scope: 'FISCAL_YEAR',
      next_number: 1,
      current_year: new Date().getFullYear(),
    },
    {
      reference: 'OPPORTUNITY',
      name: 'Opportunity',
      format: 'OPP-{YYYY}-{#####}',
      continuous: false,
      scope: 'FISCAL_YEAR',
      next_number: 1,
      current_year: new Date().getFullYear(),
    },
    {
      reference: 'SALES_QUOTATION',
      name: 'Sales quotation',
      format: 'QT-{YYYY}-{#####}',
      continuous: false,
      scope: 'FISCAL_YEAR',
      next_number: 1,
      current_year: new Date().getFullYear(),
    },
    {
      reference: 'PURCHASE_REQUISITION',
      name: 'Purchase requisition',
      format: 'PR-{YYYY}-{#####}',
      continuous: false,
      scope: 'FISCAL_YEAR',
      next_number: 1,
      current_year: new Date().getFullYear(),
    },
    {
      reference: 'RFQ',
      name: 'Request for quotation',
      format: 'RFQ-{YYYY}-{#####}',
      continuous: false,
      scope: 'FISCAL_YEAR',
      next_number: 1,
      current_year: new Date().getFullYear(),
    },

    // ── Purchase documents (migration 010) ────────────────────────────────
    // Both are internal handles. The product receipt's legal anchor is the
    // supplier's packing slip, and the vendor invoice's is the supplier's own
    // factura number — neither of which we allocate, so neither series carries a
    // legal gaplessness requirement and both are non-continuous.
    {
      reference: 'PRODUCT_RECEIPT',
      name: 'Product receipt',
      format: 'GRN-{YYYY}-{#####}',
      continuous: false,
      scope: 'FISCAL_YEAR',
      next_number: 1,
      current_year: new Date().getFullYear(),
    },
    {
      reference: 'VENDOR_INVOICE',
      name: 'Vendor invoice',
      format: 'VI-{YYYY}-{#####}',
      continuous: false,
      scope: 'FISCAL_YEAR',
      next_number: 1,
      current_year: new Date().getFullYear(),
    },
  ];

  for (const s of seqs) {
    const exists = await db.numberSequence.findFirst({
      where: { tenant_id: tenant.id, legal_entity_id: null, reference: s.reference },
      select: { id: true },
    });
    if (exists) {
      console.log(`  SKIP     sequence ${s.reference} — already configured`);
      continue;
    }
    if (!APPLY) {
      console.log(`  DRY RUN  sequence ${s.reference} would start at ${s.next_number} (format ${s.format})`);
      continue;
    }
    await db.numberSequence.create({ data: { tenant_id: tenant.id, legal_entity_id: null, ...s } });
    console.log(`  OK       sequence ${s.reference} starting at ${s.next_number} (format ${s.format})`);
  }
  console.log(`  NOTE     FACTURA sequence exists but is not yet used — factura_counters still owns the legal series.`);
}

/* ────────────────────────────── tax setup ─────────────────────────────── */

/**
 * Tax codes and groups, straight from the template. Nothing here is
 * Bolivia-specific: the same code path provisions Turkish KDV with tevkifat or a
 * generic EU reverse-charge setup.
 */
async function provisionTax(
  tenant: Tenant,
  template: CoaTemplate,
): Promise<{ taxGroupId: string | null; itemTaxGroupId: string | null }> {
  const t = template.tax;

  const existing = await db.taxCode.findFirst({ where: { tenant_id: tenant.id }, select: { id: true } });
  if (existing) {
    const [tg, itg] = await Promise.all([
      db.taxGroup.findFirst({ where: { tenant_id: tenant.id, code: t.default_tax_group }, select: { id: true } }),
      db.itemTaxGroup.findFirst({ where: { tenant_id: tenant.id, code: t.default_item_tax_group }, select: { id: true } }),
    ]);
    console.log(`  SKIP     tax setup — already configured`);
    return { taxGroupId: tg?.id ?? null, itemTaxGroupId: itg?.id ?? null };
  }

  const needsValidation = t.tax_codes.filter(c => c.note);

  if (!APPLY) {
    console.log(`  DRY RUN  tax setup from "${template.id}" (${template.country}):`);
    for (const c of t.tax_codes) {
      const bits = [
        `${(c.rate * 100).toFixed(c.rate * 100 % 1 === 0 ? 0 : 1)}%`,
        c.tax_type,
        c.is_inclusive ? 'inclusive' : 'exclusive',
        `rate on ${(c.base_kind ?? 'NET').toLowerCase()}`,
        c.is_recoverable ? 'recoverable' : 'NOT recoverable',
        c.reverse_charge ? 'reverse charge' : null,
        c.is_exempt ? 'exempt' : null,
        c.withholding_share ? `withholding ${c.withholding_share * 100}% over ${c.withholding_threshold}` : null,
      ].filter(Boolean);
      console.log(`             ${c.code.padEnd(10)} ${bits.join(', ')}`);
    }
    console.log(`             party groups: ${t.tax_groups.map(g => g.code).join(', ')}`);
    console.log(`             item groups:  ${t.item_tax_groups.map(g => g.code).join(', ')}`);
    console.log(`             defaults:     ${t.default_tax_group} ∩ ${t.default_item_tax_group}`);
    for (const c of needsValidation) console.log(`  VALIDATE ${c.code}: ${c.note}`);
    return { taxGroupId: null, itemTaxGroupId: null };
  }

  const validFrom = new Date(Date.UTC(2000, 0, 1));
  const codeIds = new Map<string, string>();

  for (const c of t.tax_codes) {
    const created = await db.taxCode.create({
      data: {
        tenant_id: tenant.id,
        code: c.code,
        name: c.name,
        tax_type: c.tax_type,
        rate: c.rate,
        is_inclusive: c.is_inclusive,
        base_kind: c.base_kind ?? 'NET',
        is_recoverable: c.is_recoverable,
        region_type: c.region_type,
        reverse_charge: c.reverse_charge ?? false,
        is_exempt: c.is_exempt ?? false,
        exempt_reason: c.exempt_reason ?? null,
        withholding_share: c.withholding_share ?? null,
        withholding_threshold: c.withholding_threshold ?? null,
        posting_type_payable: c.posting_type_payable,
        posting_type_receivable: c.posting_type_receivable ?? null,
        valid_from: validFrom,
      },
    });
    codeIds.set(c.code, created.id);
  }

  for (const g of t.tax_groups) {
    const created = await db.taxGroup.create({
      data: { tenant_id: tenant.id, code: g.code, name: g.name },
    });
    await db.taxGroupCode.createMany({
      data: g.codes.map(code => ({ tax_group_id: created.id, tax_code_id: codeIds.get(code)! })),
      skipDuplicates: true,
    });
  }
  for (const g of t.item_tax_groups) {
    const created = await db.itemTaxGroup.create({
      data: { tenant_id: tenant.id, code: g.code, name: g.name },
    });
    await db.itemTaxGroupCode.createMany({
      data: g.codes.map(code => ({ item_tax_group_id: created.id, tax_code_id: codeIds.get(code)! })),
      skipDuplicates: true,
    });
  }

  const [tg, itg] = await Promise.all([
    db.taxGroup.findFirst({ where: { tenant_id: tenant.id, code: t.default_tax_group }, select: { id: true } }),
    db.itemTaxGroup.findFirst({ where: { tenant_id: tenant.id, code: t.default_item_tax_group }, select: { id: true } }),
  ]);

  console.log(`  OK       tax setup: ${t.tax_codes.length} codes, ${t.tax_groups.length} party groups, ${t.item_tax_groups.length} item groups`);
  for (const c of needsValidation) console.log(`  VALIDATE ${c.code}: ${c.note}`);
  return { taxGroupId: tg?.id ?? null, itemTaxGroupId: itg?.id ?? null };
}

/* ─────────────────────────── module parameters ────────────────────────── */

async function provisionParameters(
  tenant: Tenant,
  template: CoaTemplate,
  taxDefaults: { taxGroupId: string | null; itemTaxGroupId: string | null },
): Promise<void> {
  const salesParams = {
    invoice_label: template.tax.invoice_label,
    default_tax_group_id: taxDefaults.taxGroupId,
    default_item_tax_group_id: taxDefaults.itemTaxGroupId,
  };

  if (!APPLY) {
    console.log(
      `  DRY RUN  parameters: invoice label "${salesParams.invoice_label}", ` +
        `defaults → ${template.tax.default_tax_group} ∩ ${template.tax.default_item_tax_group}`,
    );
    return;
  }

  const scope = { tenant_id: tenant.id, legal_entity_id: null };
  await Promise.all([
    db.salesParameters.createMany({ data: [{ ...scope, ...salesParams }], skipDuplicates: true }),
    db.purchaseParameters.createMany({ data: [{ ...scope }], skipDuplicates: true }),
    db.inventoryParameters.createMany({ data: [{ ...scope }], skipDuplicates: true }),
    db.financeParameters.createMany({
      data: [
        {
          ...scope,
          functional_currency: template.currency,
          // Starts FALSE for existing tenants deliberately. Flipping it makes an
          // unpostable document fail the whole operation — the correct behaviour
          // and the fix for D-4 — but doing that in the same step that introduces
          // the tables would turn configuration into an outage risk.
          require_balanced_posting: false,
        },
      ],
      skipDuplicates: true,
    }),
  ]);
  console.log(`  OK       parameters created (require_balanced_posting = false — flip per tenant once profiles are complete)`);
}

/* ────────────────────────── sales pipeline stages ─────────────────────── */

/**
 * A starting pipeline, not THE pipeline.
 *
 * These five stages exist so a tenant has something usable on day one. They are
 * ordinary data rows: renaming them, reordering them, adding "Demo booked" or
 * deleting "Proposal" is a user action, not a code change. That is the whole
 * reason `Opportunity.stage_id` points at a table instead of holding an enum —
 * pipeline vocabulary is the single most customer-specific thing in CRM, and
 * the next customer will not use these words.
 *
 * The probabilities are conventional (20/40/60/80) and carry no claim to
 * accuracy; they seed a weighted pipeline figure until the tenant has enough
 * closed opportunities to set its own.
 */
const DEFAULT_PIPELINE_STAGES = [
  { code: 'QUALIFY', name: 'Qualification', sort_order: 10, default_probability: 20 },
  { code: 'NEEDS', name: 'Needs analysis', sort_order: 20, default_probability: 40 },
  { code: 'PROPOSAL', name: 'Proposal', sort_order: 30, default_probability: 60 },
  { code: 'NEGOTIATION', name: 'Negotiation', sort_order: 40, default_probability: 80 },
  { code: 'CLOSING', name: 'Closing', sort_order: 50, default_probability: 90 },
];

async function provisionPipelineStages(tenant: Tenant): Promise<void> {
  const existing = await db.salesPipelineStage.count({ where: { tenant_id: tenant.id } });
  if (existing > 0) {
    console.log(`  SKIP     pipeline stages — ${existing} already configured`);
    return;
  }
  if (!APPLY) {
    console.log(
      `  DRY RUN  pipeline stages: ${DEFAULT_PIPELINE_STAGES.map((s) => s.code).join(' → ')}`,
    );
    return;
  }
  await db.salesPipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s, tenant_id: tenant.id, legal_entity_id: null })),
    skipDuplicates: true,
  });
  console.log(`  OK       ${DEFAULT_PIPELINE_STAGES.length} pipeline stages created (rename freely — they are data)`);
}

/* ─────────────────────── item groups and model groups ─────────────────── */

/**
 * The two mandatory financial fields on a released product.
 *
 * **[OFFICIAL]** creating a released product requires an ITEM MODEL GROUP (how
 * the item is valued and controlled) and an ITEM GROUP (which GL accounts it
 * posts to), among others.
 * learn.microsoft.com/dynamics365/supply-chain/pim/tasks/create-released-product-single-company
 *
 * These defaults are the smallest set that is actually meaningful for a shoe
 * retailer, and they are DATA — rename them, add "Packaging", split "Footwear"
 * into leather and synthetic. What matters is that every product has one, so the
 * posting matrix has an item axis to resolve on.
 *
 * Products are NOT auto-assigned here. Assigning an item group changes which GL
 * account a product posts to, and **[OFFICIAL]** Microsoft warns that changing
 * a group after transactions exist breaks ledger-to-subledger reconciliation:
 * "revenue on new transactions posts to the updated account. However, any
 * revenue that you posted before the change remains in the original account."
 * So the assignment is a deliberate act, reported by the setup audit.
 */
/**
 * THREE groups, chosen to make the two axes visibly INDEPENDENT.
 *
 * An earlier version shipped only `FIFO` (stocked) and `SERVICE` (standard cost,
 * not stocked), which read as "standard cost means it is a service". That is
 * wrong, and the documentation contradicts it directly: *"Yes, you can use
 * different costing models for each item. It's common for manufacturers to use a
 * periodic costing model for raw materials and standard cost for semi-finished
 * and finished goods."*
 *
 * `STOCKED-STD` exists specifically to occupy the cell the old seed excluded —
 * a tangible, inventory-tracked item valued at standard cost. Delete it if the
 * tenant has no use for it; what matters is that the combination is reachable.
 *
 * Note also that a NOT-stocked group is not the same thing as "a service".
 * **[OFFICIAL]** a service item that appears on a BOM must be *stocked*. The
 * axis is "does this item have an inventory subledger", nothing more.
 */
const DEFAULT_ITEM_MODEL_GROUPS = [
  {
    code: 'STOCKED-FIFO',
    name: 'Stocked · FIFO',
    description: 'Tangible item, tracked in inventory, valued first-in-first-out. The default for trading stock.',
    costing_method: 'FIFO',
    stocked: true,
    post_physical_inventory: true,
    post_financial_inventory: true,
  },
  {
    code: 'STOCKED-STD',
    name: 'Stocked · Standard cost',
    description:
      'Tangible item, tracked in inventory, valued at a standard cost with variances posted. ' +
      'Costing method is independent of whether an item is stocked — this group exists to make that plain.',
    costing_method: 'STANDARD',
    stocked: true,
    post_physical_inventory: true,
    post_financial_inventory: true,
  },
  {
    code: 'NON-STOCKED',
    name: 'Not stocked · expensed',
    description:
      'No inventory subledger; the cost is expensed to the ledger directly. For shop supplies and ' +
      'charges. NOTE: a service that appears on a BOM must be STOCKED instead.',
    costing_method: 'STANDARD',
    stocked: false,
    // No inventory means no physical inventory voucher to post.
    post_physical_inventory: false,
    post_financial_inventory: true,
  },
];

const DEFAULT_ITEM_GROUPS = [
  { code: 'FOOTWEAR', name: 'Footwear', description: 'Shoes, boots, sandals — the trading stock' },
  { code: 'ACCESSORY', name: 'Accessories', description: 'Laces, care products, insoles' },
  { code: 'SERVICE', name: 'Services', description: 'Repairs and non-stock services' },
];

async function provisionItemGroups(tenant: Tenant): Promise<void> {
  const models = await db.itemModelGroup.count({ where: { tenant_id: tenant.id } });
  const groups = await db.itemGroup.count({ where: { tenant_id: tenant.id } });

  if (models > 0 && groups > 0) {
    console.log(`  SKIP     item groups — ${models} model group(s), ${groups} item group(s) already configured`);
  } else if (!APPLY) {
    console.log(
      `  DRY RUN  item model groups: ${DEFAULT_ITEM_MODEL_GROUPS.map(g => g.code).join(', ')}\n` +
      `           item groups:       ${DEFAULT_ITEM_GROUPS.map(g => g.code).join(', ')}`,
    );
  } else {
    if (models === 0) {
      await db.itemModelGroup.createMany({
        data: DEFAULT_ITEM_MODEL_GROUPS.map(g => ({ ...g, tenant_id: tenant.id, legal_entity_id: null })),
        skipDuplicates: true,
      });
      console.log(`  OK       ${DEFAULT_ITEM_MODEL_GROUPS.length} item model groups created`);
    }
    if (groups === 0) {
      await db.itemGroup.createMany({
        data: DEFAULT_ITEM_GROUPS.map(g => ({ ...g, tenant_id: tenant.id, legal_entity_id: null })),
        skipDuplicates: true,
      });
      console.log(`  OK       ${DEFAULT_ITEM_GROUPS.length} item groups created`);
    }
  }

  // The setup gap that matters: a product with no item group can only ever
  // resolve the ALL-scope posting profile, so per-group accounts are unreachable
  // for it. Report it rather than guessing an assignment.
  const unassigned = await db.product.count({
    where: { tenant_id: tenant.id, OR: [{ item_group_id: null }, { item_model_group_id: null }] },
  });
  if (unassigned > 0) {
    const total = await db.product.count({ where: { tenant_id: tenant.id } });
    console.log(
      `  ACTION   ${unassigned}/${total} product(s) have no item group and/or item model group.\n` +
      `           They fall back to the ALL-scope posting profile and to\n` +
      `           InventoryParameters.costing_method — which is exactly today's behaviour,\n` +
      `           so nothing is broken. But per-group GL accounts and per-item costing\n` +
      `           stay unreachable until they are assigned. Assign under Products, or via\n` +
      `           PUT /api/v1/products/:id. NOT auto-assigned: changing an item group after\n` +
      `           transactions exist splits the ledger from the subledger.`,
    );
  }
}

/* ──────────────────────────────── driver ──────────────────────────────── */

async function provisionTenant(tenant: Tenant) {
  const template = templateFor(tenant);
  console.log(`\n${'='.repeat(78)}\nTenant: ${tenant.name} (${tenant.slug})`);

  if (!template) {
    console.log(`  ERROR    no template resolved${TEMPLATE_ID ? ` for id "${TEMPLATE_ID}"` : ''} — skipping`);
    return;
  }
  console.log(`Template: ${template.name} — ${template.country} / ${template.currency}\n${'='.repeat(78)}`);

  const pendingCategories = await backfillCategories(tenant, template);
  await provisionPostingProfiles(tenant, pendingCategories);
  await provisionSequences(tenant);
  const taxDefaults = await provisionTax(tenant, template);
  await provisionParameters(tenant, template, taxDefaults);
  await provisionPipelineStages(tenant);
  await provisionItemGroups(tenant);
}

async function main() {
  console.log(APPLY ? 'MODE: APPLY (writes to the database)' : 'MODE: DRY RUN (no writes)');

  const tenants = await db.tenant.findMany({
    where: TENANT ? { slug: TENANT } : {},
    select: { id: true, name: true, slug: true, currency_code: true },
    orderBy: { name: 'asc' },
  });

  if (tenants.length === 0) {
    console.log(TENANT ? `No tenant with slug '${TENANT}'.` : 'No tenants found.');
    return;
  }

  for (const tenant of tenants) await provisionTenant(tenant);

  console.log(`\n${'='.repeat(78)}`);
  console.log(APPLY ? 'Done.' : 'Dry run complete — nothing was written.');
}

main()
  .catch(e => { console.error('\nFAILED:', e.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());

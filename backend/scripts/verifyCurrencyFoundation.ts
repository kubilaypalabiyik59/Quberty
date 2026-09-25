import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { db } from '../src/infrastructure/database/client';
import { resolveRate, translate } from '../src/shared/services/currency/exchangeRate.service';
import { assertDocumentCurrencySupported } from '../src/shared/services/currency/documentCurrency';
import { hasLedgerActivity } from '../src/shared/services/currency/ledgerCurrency.service';
import { postJournal, reverseJournal } from '../src/shared/services/journal.service';
import { allocateNumber } from '../src/shared/services/numberSequence.service';

/**
 * WORK-024a acceptance on Supabase TEST: currency master and ledger currencies.
 *
 *   ALLOW_TEST_DATABASE_WRITE=WORK024_ACCEPTANCE npm run verify:currency-foundation [-- --tenant <slug>]
 *
 * Persists no business data. The structural checks are reads. The rate scenarios
 * run inside one interactive transaction that is always rolled back, and the
 * segregation-of-duties probes are requests the routes must refuse (or pure
 * reads). The only rows it leaves are audit rows: the global audit middleware
 * records every write request, including the refused ones (measured on TEST,
 * 2026-09-12: a 403 from the permission guard is audited exactly like a 400).
 * The harness asserts that the audit table grew by exactly the number of write
 * probes and by nothing else. It makes no sale and consumes no FACTURA number,
 * which it proves by comparing the FACTURA sequences before and after.
 *
 * Without --tenant it checks the oldest tenant (the TEST tenant); every tenant's
 * ledger structure is checked regardless.
 */

const argAfter = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

class Rollback extends Error {}

async function main() {
  // Either token: this harness now covers WORK-024 and WORK-025, and an operator
  // should be able to name the item whose writes they are sanctioning.
  const guards = ['WORK024_ACCEPTANCE', 'WORK025_ACCEPTANCE'];
  if (!guards.includes(process.env.ALLOW_TEST_DATABASE_WRITE ?? '')) {
    throw new Error(`Set ALLOW_TEST_DATABASE_WRITE to one of ${guards.join(' | ')} to confirm the TEST-only acceptance run.`);
  }
  const marker = `WORK024-${Date.now()}`;

  const facturaBefore = await db.numberSequence.findMany({
    where: { reference: 'FACTURA' }, select: { tenant_id: true, next_number: true },
  });

  // ── Structure ──────────────────────────────────────────────────────────────
  console.log('Structure');
  const ordinal = await db.$queryRaw<Array<{ max: number }>>`SELECT max(ordinal)::int AS max FROM skarpine_schema_migrations`;
  // The currency foundation needs migrations through 035; later migrations do not
  // invalidate it, so this is a floor rather than an exact ordinal.
  check('migration ledger includes ordinal 35', (ordinal[0]?.max ?? 0) >= 35, `${ordinal[0]?.max}`);

  // WORK-024b: every existing voucher is an identity — transaction, accounting and
  // reporting amounts equal, both rates 1 — because reporting is the accounting
  // currency and nothing has been posted in another currency.
  const drifted = await db.$queryRaw<Array<{ c: bigint }>>`
    SELECT count(*) AS c FROM journal_lines
     WHERE transaction_debit_amount <> debit_amount
        OR transaction_credit_amount <> credit_amount
        OR reporting_debit_amount <> debit_amount
        OR reporting_credit_amount <> credit_amount
        OR accounting_exchange_rate <> 1
        OR reporting_exchange_rate <> 1`;
  check('every posted line carries one amount three times at rate 1', Number(drifted[0].c) === 0, `${drifted[0].c}`);

  const entryCurrencies = await db.$queryRaw<Array<{ c: bigint }>>`
    SELECT count(*) AS c FROM journal_entries je
     JOIN finance_parameters fp ON fp.tenant_id = je.tenant_id AND fp.legal_entity_id IS NULL
     WHERE je.accounting_currency_code <> fp.accounting_currency_code
        OR je.reporting_currency_code <> fp.reporting_currency_code
        OR je.exchange_rate_date IS NULL`;
  check("every voucher names its tenant's ledger currencies", Number(entryCurrencies[0].c) === 0, `${entryCurrencies[0].c}`);

  const subledger = await db.$queryRaw<Array<{ vot: bigint; vs: bigint }>>`
    SELECT (SELECT count(*) FROM vendor_open_transactions
             WHERE amount_reporting <> amount_functional OR exchange_rate_reporting <> exchange_rate) AS vot,
           (SELECT count(*) FROM vendor_settlements
             WHERE amount_reporting <> amount_functional OR exchange_rate_reporting <> exchange_rate) AS vs`;
  check('the AP subledger reports on the same basis as it accounts',
    Number(subledger[0].vot) === 0 && Number(subledger[0].vs) === 0, `${subledger[0].vot}/${subledger[0].vs}`);

  const iso = await db.currency.findMany({ where: { code: { in: ['BOB', 'TRY', 'EUR', 'USD'] } } });
  check('ISO reference contains BOB, TRY, EUR, USD with 2 decimals',
    iso.length === 4 && iso.every((c) => c.minor_unit === 2), iso.map((c) => c.code).join(','));
  check('ISO reference is populated', (await db.currency.count()) >= 150);

  const tenants = await db.tenant.findMany({
    select: { id: true, slug: true },
    orderBy: { created_at: 'asc' },
  });
  for (const t of tenants) {
    const fp = await db.financeParameters.findFirst({
      where: { tenant_id: t.id, legal_entity_id: null },
      include: { accounting_rate_type: true },
    });
    check(`${t.slug}: has a tenant ledger`, !!fp);
    if (!fp) continue;
    check(`${t.slug}: reporting currency equals accounting (024a)`, fp.reporting_currency_code === fp.accounting_currency_code);
    // Sales-side only. Purchasing deliberately lets a foreign-currency requisition,
    // RFQ or order exist and refuses it at receipt and invoice instead (WORK-024a),
    // so asserting the same rule over those tables would claim something no code
    // path enforces.
    const salesSide = await db.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT count(*) AS c FROM (
         SELECT currency FROM sales_orders WHERE tenant_id = $1::uuid UNION ALL
         SELECT currency FROM leads WHERE tenant_id = $1::uuid UNION ALL
         SELECT currency FROM opportunities WHERE tenant_id = $1::uuid UNION ALL
         SELECT currency FROM sales_quotations WHERE tenant_id = $1::uuid) r
        WHERE r.currency <> $2`,
      t.id, fp.accounting_currency_code,
    );
    check(`${t.slug}: every sales-side document is in the ledger currency`, Number(salesSide[0].c) === 0, `${salesSide[0].c}`);
    check(`${t.slug}: accounting rate type belongs to the tenant`, fp.accounting_rate_type.tenant_id === t.id);
    const active = await db.tenantCurrency.findFirst({ where: { tenant_id: t.id, currency_code: fp.accounting_currency_code, is_active: true } });
    check(`${t.slug}: ledger currency is active`, !!active);
    const foreignLayers = await db.inventoryCostLayer.count({
      where: { tenant_id: t.id, NOT: { cost_currency_code: fp.accounting_currency_code } },
    });
    check(`${t.slug}: every cost layer is stated in the accounting currency`, foreignLayers === 0, `${foreignLayers}`);
  }

  const constraints = await db.$queryRaw<Array<{ conname: string }>>`
    SELECT conname FROM pg_constraint
     WHERE conname IN ('supplier_credits_bob_exchange_rate_chk', 'supplier_credits_exchange_rate_positive_chk',
                       'exchange_rates_rate_positive_chk', 'tenant_currencies_rounding_precision_chk')`;
  const names = new Set(constraints.map((c) => c.conname));
  check('the literal BOB CHECK on supplier credits is gone', !names.has('supplier_credits_bob_exchange_rate_chk'));
  check('generic positive-rate CHECKs exist',
    names.has('supplier_credits_exchange_rate_positive_chk') && names.has('exchange_rates_rate_positive_chk') &&
    names.has('tenant_currencies_rounding_precision_chk'));

  const defaults = await db.$queryRaw<Array<{ table_name: string; column_name: string; column_default: string | null }>>`
    SELECT table_name, column_name, column_default FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND ((table_name IN ('suppliers', 'purchase_orders', 'vendor_invoices', 'vendor_payments', 'supplier_credits',
                            'sales_orders', 'leads', 'opportunities', 'sales_quotations',
                            'purchase_requisitions', 'rfq_cases', 'rfq_requests') AND column_name = 'currency')
         OR (table_name = 'finance_parameters' AND column_name = 'accounting_currency_code'))`;
  const withDefault = defaults.filter((d) => d.column_default !== null);
  check('no country default remains on any document or ledger currency column',
    defaults.length === 13 && withDefault.length === 0,
    `${defaults.length} columns, defaults on: ${withDefault.map((d) => `${d.table_name}.${d.column_name}`).join(',') || 'none'}`);

  const mirror = await db.$queryRaw<Array<{ c: bigint }>>`
    SELECT count(*) AS c FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'tenants' AND column_name = 'currency_code'`;
  check('the tenant currency mirror is gone; the ledger is the only source', Number(mirror[0].c) === 0);

  // ── Rates, inside a transaction that is always rolled back ─────────────────
  console.log('Rates (rolled back)');
  const slug = argAfter('--tenant');
  const tenant = slug ? tenants.find((t) => t.slug === slug) : tenants[0];
  if (!tenant) throw new Error(slug ? `Tenant "${slug}" not found.` : 'No tenant.');
  console.log(`  (scenario tenant: ${tenant.slug})`);
  const ledger = await db.financeParameters.findFirstOrThrow({ where: { tenant_id: tenant.id, legal_entity_id: null } });
  const home = ledger.accounting_currency_code;
  const foreign = home === 'USD' ? 'EUR' : 'USD';
  const day = (offset: number) => {
    const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d;
  };

  try {
    await db.$transaction(async (tx) => {
      const type = await tx.exchangeRateType.create({ data: { tenant_id: tenant.id, code: marker.slice(0, 20), name: marker } });
      const hasForeign = await tx.tenantCurrency.findFirst({ where: { tenant_id: tenant.id, currency_code: foreign } });
      if (!hasForeign) {
        await tx.tenantCurrency.create({ data: { tenant_id: tenant.id, currency_code: foreign, rounding_precision: new Prisma.Decimal('0.01') } });
      } else if (!hasForeign.is_active) {
        await tx.tenantCurrency.update({ where: { id: hasForeign.id }, data: { is_active: true } });
      }
      // The rates go under the LEDGER's rate type: that is the one a real voucher
      // resolves against. `type` exists only to prove the rollback leaves nothing.
      const pair = await tx.exchangeRateCurrencyPair.create({
        data: { tenant_id: tenant.id, rate_type_id: ledger.accounting_rate_type_id, from_currency_code: foreign, to_currency_code: home },
      });
      for (const [offset, rate] of [[-1, '6.90'], [0, '6.96'], [1, '7.00']] as const) {
        await tx.exchangeRate.create({
          data: { tenant_id: tenant.id, currency_pair_id: pair.id, valid_from: day(offset), rate: new Prisma.Decimal(rate) },
        });
      }

      const resolve = (from: string, to: string, date: Date) =>
        resolveRate({ tenantId: tenant.id, rateTypeId: ledger.accounting_rate_type_id, from, to, date, client: tx });

      const today = await resolve(foreign, home, day(0));
      check(`${foreign}→${home} today uses today's rate (6.96)`, today.rate.toString() === '6.96', today.rate.toString());
      const yesterday = await resolve(foreign, home, day(-1));
      check('yesterday uses yesterday\'s rate, not a later one', yesterday.rate.toString() === '6.9', yesterday.rate.toString());
      const reciprocal = await resolve(home, foreign, day(0));
      check(`${home}→${foreign} is derived by division (69.60 → 10)`,
        reciprocal.kind === 'RECIPROCAL' && translate('69.60', reciprocal).toString() === '10', translate('69.60', reciprocal).toString());
      const missing = await resolve(foreign, home, day(-30)).then(() => 'resolved', (e) => e.code);
      check('a date before every rate fails closed', missing === 'EXCHANGE_RATE_MISSING', missing);

      const refusedDoc = await assertDocumentCurrencySupported(tenant.id, foreign, {
        errorCode: 'RECEIPT_FX_NOT_IMPLEMENTED', capability: 'Product receipts', client: tx,
      }).then(() => 'accepted', (e) => e.code);
      check(`a ${foreign} document is refused in a ${home} ledger`, refusedDoc === 'RECEIPT_FX_NOT_IMPLEMENTED', refusedDoc);
      const acceptedDoc = await assertDocumentCurrencySupported(tenant.id, home, {
        errorCode: 'RECEIPT_FX_NOT_IMPLEMENTED', capability: 'Product receipts', client: tx,
      }).then(() => 'accepted', (e) => e.code);
      check(`a ${home} document is accepted`, acceptedDoc === 'accepted', acceptedDoc);

      // ── WORK-024b: a real foreign-currency voucher, posted and reversed ─────
      // Balance the accounts so no ROUNDING profile is needed (TEST has none), and
      // use balance-sheet accounts so no dimension rule can refuse the posting.
      const accounts = await tx.account.findMany({
        where: { tenant_id: tenant.id, is_active: true, type: 'ASSET' },
        orderBy: { code: 'asc' }, take: 2, select: { id: true, code: true },
      });
      if (accounts.length === 2) {
        const posted = await postJournal({
          tenantId: tenant.id, tx, date: day(0),
          description: `${marker} foreign-currency voucher`,
          source: { module: 'VERIFY_WORK024B' },
          currency: { code: foreign },
          lines: [
            { accountId: accounts[0].id, debit: 100 },
            { accountId: accounts[1].id, credit: 100 },
          ],
        });
        const line = posted.lines[0];
        check(`the voucher records ${foreign} 100 as ${home} 696`,
          Number(line.transaction_debit_amount) === 100 && Number(line.debit_amount) === 696,
          `${line.transaction_debit_amount} / ${line.debit_amount}`);
        check('the voucher names the rate it used', line.accounting_exchange_rate.toString() === '6.96',
          line.accounting_exchange_rate.toString());
        check('the reporting amount follows the accounting currency', Number(line.reporting_debit_amount) === 696);

        // A rate move after posting must not change what the reversal is worth.
        await tx.exchangeRate.create({
          data: { tenant_id: tenant.id, currency_pair_id: pair.id, valid_from: day(2), rate: new Prisma.Decimal('9.99') },
        });
        const reversal = await reverseJournal({
          tenantId: tenant.id, tx, entryId: posted.id, reason: `${marker} reversal`, date: day(3),
        });
        const net = (rows: Array<{ debit_amount: unknown; credit_amount: unknown }>, d: string, c: string) =>
          rows.reduce((s, r: any) => s + Number(r[d]) - Number(r[c]), 0);
        const both = [...posted.lines, ...reversal.lines] as any[];
        check('posting and reversal net to zero in all three currencies',
          net(both, 'debit_amount', 'credit_amount') === 0 &&
          net(both, 'transaction_debit_amount', 'transaction_credit_amount') === 0 &&
          net(both, 'reporting_debit_amount', 'reporting_credit_amount') === 0);
        check('the reversal keeps the original rate date and rate',
          reversal.lines[0].accounting_exchange_rate.toString() === '6.96',
          reversal.lines[0].accounting_exchange_rate.toString());
      } else {
        check('two asset accounts exist for the voucher scenario', false, `${accounts.length}`);
      }

      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  const leftovers = await db.exchangeRateType.count({ where: { code: marker.slice(0, 20) } });
  check('the rate scenario left nothing behind', leftovers === 0, `${leftovers}`);

  // The CHECK probe gets its own transaction: a constraint violation aborts the
  // one it happens in, and Prisma closes an interactive transaction that fails —
  // a savepoint does not save the rest of the scenario from that.
  let zeroRate = 'not attempted';
  try {
    await db.$transaction(async (tx) => {
      const type = await tx.exchangeRateType.create({ data: { tenant_id: tenant.id, code: `${marker.slice(0, 16)}Z`, name: `${marker} zero` } });
      const hasForeign = await tx.tenantCurrency.findFirst({ where: { tenant_id: tenant.id, currency_code: foreign } });
      if (!hasForeign) {
        await tx.tenantCurrency.create({ data: { tenant_id: tenant.id, currency_code: foreign, rounding_precision: new Prisma.Decimal('0.01') } });
      }
      const pair = await tx.exchangeRateCurrencyPair.create({
        data: { tenant_id: tenant.id, rate_type_id: type.id, from_currency_code: foreign, to_currency_code: home },
      });
      zeroRate = await tx.exchangeRate.create({
        data: { tenant_id: tenant.id, currency_pair_id: pair.id, valid_from: day(-5), rate: new Prisma.Decimal(0) },
      }).then(() => 'inserted', () => 'refused');
      throw new Rollback();
    });
  } catch (err) {
    // Only a CHECK violation counts as a refusal. Any other failure — a duplicate
    // marker, an inactive currency — would otherwise report a green on the one
    // assertion that guards `exchange_rates_rate_positive_chk`.
    if (!(err instanceof Rollback)) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('23514') || message.includes('exchange_rates_rate_positive_chk')) zeroRate = 'refused';
      else throw err;
    }
  }
  check('the database refuses a zero rate', zeroRate === 'refused', zeroRate);

  // Bolivia's continuous series must not gap when a document fails after the
  // number was drawn: the allocation lives in the caller's transaction.
  const facturaSequence = await db.numberSequence.findFirst({
    where: { tenant_id: tenant.id, legal_entity_id: null, reference: 'FACTURA' },
    select: { next_number: true },
  });
  if (facturaSequence) {
    let allocated = '';
    try {
      await db.$transaction(async (tx) => {
        allocated = await allocateNumber({ tenantId: tenant.id, reference: 'FACTURA', legalEntityId: null, tx });
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    const after = await db.numberSequence.findFirst({
      where: { tenant_id: tenant.id, legal_entity_id: null, reference: 'FACTURA' },
      select: { next_number: true },
    });
    check(`a failed document gives ${allocated} back to the FACTURA series`,
      after?.next_number === facturaSequence.next_number,
      `${facturaSequence.next_number} → ${after?.next_number}`);
  }

  // ── Segregation of duties through the real app ──────────────────────────────
  console.log('Segregation of duties (live routes)');
  const app = (await import('../src/app')).default;
  const user = await db.user.findFirstOrThrow({ where: { tenant_id: tenant.id }, select: { id: true, email: true } });
  const token = (role: string) => jwt.sign({ sub: user.id, email: user.email, role, tenantId: tenant.id }, process.env.JWT_SECRET!, { expiresIn: '5m' });
  const auditBefore = await db.auditLog.count({ where: { tenant_id: tenant.id } });
  let writeProbes = 0;
  const call = async (role: string, method: string, path: string, body?: unknown) => {
    if (method !== 'GET') writeProbes++;
    return app.request(`/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token(role)}`, 'x-tenant-id': tenant.id },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  const ledgerRes = await call('admin', 'GET', '/finance/ledger-currencies');
  const ledgerBody = (await ledgerRes.json()) as any;
  check('admin reads the ledger currencies', ledgerRes.status === 200 && ledgerBody.data?.accountingCurrency === home, `${ledgerRes.status}`);
  const activity = await hasLedgerActivity(tenant.id);
  check('the ledger reports itself locked exactly when something is valued in it', ledgerBody.data?.locked === activity);

  const body = { accounting_currency_code: home, reporting_currency_code: home, accounting_rate_type_id: ledger.accounting_rate_type_id };
  check('a store manager cannot change the ledger currencies', (await call('store_manager', 'PUT', '/finance/ledger-currencies', body)).status === 403);
  check('a finance approver cannot correct an exchange rate',
    (await call('finance_approver', 'PUT', '/finance/exchange-rates/00000000-0000-4000-8000-000000000000', { rate: 7 })).status === 403);
  check('a cashier cannot read the finance currency setup', (await call('cashier', 'GET', '/finance/currencies')).status === 403);

  // …but every screen that renders money must know which currency it is in, and
  // the POS is a cashier's whole day. That comes from its own route, which needs
  // authentication and no permission — so the cashier still cannot read the
  // tenant's plan, modules or branding (WORK-025b).
  const currencyRes = await call('cashier', 'GET', '/tenant/currency');
  const currencyBody = (await currencyRes.json()) as any;
  check('a cashier reads the ledger currency from /tenant/currency',
    currencyRes.status === 200 && currencyBody.data?.code === home,
    `${currencyRes.status} ${currencyBody.data?.code ?? 'none'}`);
  check('a cashier still cannot read the tenant config',
    (await call('cashier', 'GET', '/tenant/config')).status === 403);
  check('the tenant setup route refuses a currency',
    (await call('admin', 'PUT', '/tenant/setup', { currency_code: foreign, tax_config: { vat_rate: 0.13, vat_inclusive: true } })).status === 400);
  if (activity) {
    const other = await db.tenantCurrency.findFirst({ where: { tenant_id: tenant.id, is_active: true, NOT: { currency_code: home } } });
    if (other) {
      const locked = await call('admin', 'PUT', '/finance/ledger-currencies', {
        ...body, accounting_currency_code: other.currency_code, reporting_currency_code: other.currency_code,
      });
      const code = ((await locked.json()) as any)?.error?.code;
      check('changing the accounting currency after posting is refused (CURRENCY_LOCKED)', locked.status === 409 && code === 'CURRENCY_LOCKED', `${locked.status} ${code}`);
    }
  }

  // The audit middleware writes fire-and-forget; give it a moment to land.
  let auditDelta = 0;
  for (let i = 0; i < 10; i++) {
    auditDelta = (await db.auditLog.count({ where: { tenant_id: tenant.id } })) - auditBefore;
    if (auditDelta >= writeProbes) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  check(`the run left exactly ${writeProbes} audit row(s) for its ${writeProbes} refused write probes, and no business data`,
    auditDelta === writeProbes, `${auditDelta}`);

  // ── Nothing consumed ─────────────────────────────────────────────────────────
  const facturaAfter = await db.numberSequence.findMany({
    where: { reference: 'FACTURA' }, select: { tenant_id: true, next_number: true },
  });
  check('FACTURA sequences unchanged', JSON.stringify(facturaAfter) === JSON.stringify(facturaBefore));

  console.log(`\nMarker ${marker} · ${passed} passed, ${failed} failed`);
  await db.$disconnect();
  // Importing the app opens handles (Redis, rate limiters) that keep the event
  // loop alive, so exit explicitly rather than hanging on a clean run.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('verifyCurrencyFoundation failed:', err instanceof Error ? err.message : err);
  await db.$disconnect();
  process.exit(1);
});

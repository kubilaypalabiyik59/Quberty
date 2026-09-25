import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Name the rate type a tenant ledger values documents with.
 *
 * Migration 032 gave every existing tenant one rate type, code DEFAULT, because a
 * migration must not name a jurisdiction. The operator renames it to what the
 * tenant's accounting actually uses — for Bolivia, the Banco Central de Bolivia
 * official rate:
 *
 *   npx tsx scripts/configureLedgerCurrencies.ts --tenant skarpine-demo \
 *     --rate-type-code BCB --rate-type-name "Banco Central de Bolivia — official" [--apply]
 *
 * Dry run unless --apply. Renaming is safe at any time: documents reference the
 * rate type by id, and a posted voucher keeps the rate it was valued at.
 */

const argAfter = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

function fail(message: string): never {
  console.error(`configureLedgerCurrencies: ${message}`);
  process.exit(1);
}

(async () => {
  const apply = process.argv.includes('--apply');
  const slug = argAfter('--tenant');
  const code = argAfter('--rate-type-code');
  const name = argAfter('--rate-type-name');
  if (!slug || !code || !name) fail('required: --tenant <slug> --rate-type-code <CODE> --rate-type-name <name>');
  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) fail('rate-type-code must be 1-20 uppercase letters, digits, _ or -');

  const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!tenant) fail(`tenant "${slug}" not found`);

  const ledger = await db.financeParameters.findFirst({
    where: { tenant_id: tenant.id, legal_entity_id: null },
    select: {
      accounting_currency_code: true, reporting_currency_code: true,
      accounting_rate_type: { select: { id: true, code: true, name: true } },
    },
  });
  if (!ledger) fail(`tenant "${slug}" has no ledger row`);

  const clash = await db.exchangeRateType.findFirst({
    where: { tenant_id: tenant.id, code, NOT: { id: ledger.accounting_rate_type.id } },
    select: { id: true },
  });
  if (clash) fail(`rate type code ${code} is already used by another rate type of this tenant`);

  console.log(`Tenant    : ${tenant.slug}`);
  console.log(`Ledger    : accounting ${ledger.accounting_currency_code}, reporting ${ledger.reporting_currency_code}`);
  console.log(`Rate type : ${ledger.accounting_rate_type.code} (${ledger.accounting_rate_type.name}) → ${code} (${name})`);

  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply.');
    await db.$disconnect();
    return;
  }

  await db.exchangeRateType.update({ where: { id: ledger.accounting_rate_type.id }, data: { code, name } });
  console.log('Renamed.');
  await db.$disconnect();
})().catch(async (err) => {
  console.error('configureLedgerCurrencies failed:', err instanceof Error ? err.message : err);
  await db.$disconnect();
  process.exit(1);
});

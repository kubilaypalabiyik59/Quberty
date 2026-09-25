import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from '../src/infrastructure/database/client';
import { bootstrapTenantLedger } from '../src/shared/services/currency/ledgerCurrency.service';

/**
 * Platform-operator tenant creation. Tenants are created by us after an
 * implementation decision — never over HTTP and never by self-service signup.
 *
 *   npx tsx scripts/createTenant.ts --name "Acme" --slug acme \
 *     --currency BOB --reporting-currency BOB \
 *     --rate-type-code BCB --rate-type-name "Banco Central de Bolivia" \
 *     --language es --timezone America/La_Paz \
 *     --admin-email owner@acme.com --admin-first Ana --admin-last Pérez [--apply]
 *
 * The first admin's password is read from CREATE_TENANT_ADMIN_PASSWORD and is
 * never printed. Without --apply this is a dry run that only validates input.
 *
 * The tenant, its ledger (accounting and reporting currency, accounting rate
 * type) and its first admin are created in one transaction, so there is no
 * window in which the tenant exists without an owner or without a ledger.
 *
 * Currency, reporting currency, rate type, language and timezone are required:
 * nothing is defaulted to a country. Until vouchers carry reporting amounts
 * (WORK-024b) the reporting currency must equal the accounting currency.
 * Configuration (chart of accounts, tax codes, number sequences) is a separate,
 * deliberate step — run provisionConfiguration afterwards.
 */

const argAfter = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

// Module entitlement is set by the operator per plan; tenants cannot edit it.
const ALL_MODULES = { sales: true, purchase: true, inventory: true, warehouse: true, hr: true, reporting: true, import: true };

function fail(message: string): never {
  console.error(`createTenant: ${message}`);
  process.exit(1);
}

(async () => {
  const apply = process.argv.includes('--apply');
  const input = {
    name:              argAfter('--name'),
    slug:              argAfter('--slug'),
    plan:              argAfter('--plan') ?? 'starter',
    currency:          argAfter('--currency'),
    reportingCurrency: argAfter('--reporting-currency'),
    country:           argAfter('--country'),
    rateTypeCode:      argAfter('--rate-type-code'),
    rateTypeName:      argAfter('--rate-type-name'),
    language:          argAfter('--language'),
    timezone:          argAfter('--timezone'),
    adminEmail:        argAfter('--admin-email'),
    adminFirst:        argAfter('--admin-first'),
    adminLast:         argAfter('--admin-last'),
  };

  const missing = Object.entries(input).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) fail(`missing required arguments: ${missing.join(', ')}`);
  if (!/^[a-z0-9-]{3,40}$/.test(input.slug!)) fail('slug must be 3-40 chars of a-z, 0-9, -');
  if (!/^[A-Z]{3}$/.test(input.currency!)) fail('currency must be a 3-letter uppercase code');
  if (input.reportingCurrency !== input.currency) {
    fail('reporting-currency must equal currency until vouchers carry reporting amounts (WORK-024b)');
  }
  if (!/^[A-Z0-9_-]{1,20}$/.test(input.rateTypeCode!)) fail('rate-type-code must be 1-20 uppercase letters, digits, _ or -');
  // The jurisdiction decides the chart of accounts and the localization rules; it
  // is never inferred from the currency (WORK-025).
  if (!/^[A-Z]{2}$/.test(input.country!)) fail('country must be a 2-letter ISO 3166-1 alpha-2 code, e.g. BO or TR');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.adminEmail!)) fail('admin-email is not a valid email');

  const password = process.env.CREATE_TENANT_ADMIN_PASSWORD;
  if (!password || password.length < 12) fail('set CREATE_TENANT_ADMIN_PASSWORD (at least 12 characters)');

  const iso = await db.currency.findUnique({ where: { code: input.currency! } });
  if (!iso) fail(`${input.currency} is not an ISO 4217 currency code`);
  if (iso.minor_unit > 2) fail(`${iso.code} has ${iso.minor_unit} decimals; amounts are stored with two`);

  const existing = await db.tenant.findUnique({ where: { slug: input.slug! }, select: { id: true } });
  if (existing) fail(`slug "${input.slug}" is already taken`);

  console.log(`Tenant  : ${input.name} (${input.slug}), plan ${input.plan}`);
  console.log(`Ledger  : accounting ${input.currency}, reporting ${input.reportingCurrency}, rate type ${input.rateTypeCode} (${input.rateTypeName})`);
  console.log(`Locale  : ${input.country}, ${input.language}, ${input.timezone}`);
  console.log(`Admin   : ${input.adminEmail}`);

  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to create the tenant.');
    await db.$disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password!, 12);
  const tenant = await db.$transaction(async (tx) => {
    const created = await tx.tenant.create({
      data: {
        name:          input.name!,
        slug:          input.slug!,
        plan:          input.plan,
        country:       input.country!,
        language:      input.language!,
        timezone:      input.timezone!,
        modules:       ALL_MODULES,
      },
    });
    await bootstrapTenantLedger(tx, {
      tenantId:           created.id,
      accountingCurrency: input.currency!,
      rateTypeCode:       input.rateTypeCode!,
      rateTypeName:       input.rateTypeName!,
    });
    await tx.user.create({
      data: {
        tenant_id:     created.id,
        email:         input.adminEmail!,
        password_hash: passwordHash,
        first_name:    input.adminFirst!,
        last_name:     input.adminLast!,
        role:          'admin',
      },
    });
    return created;
  });

  console.log(`Created tenant ${tenant.id} with its ledger and first admin.`);
  console.log('Next: provision configuration for this tenant with the provisionConfiguration script (--apply).');
  await db.$disconnect();
})().catch(async (err) => {
  console.error('createTenant failed:', err instanceof Error ? err.message : err);
  await db.$disconnect();
  process.exit(1);
});

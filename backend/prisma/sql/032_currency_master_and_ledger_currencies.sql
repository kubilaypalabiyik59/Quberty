-- =============================================================================
-- 032  Currency master and ledger currencies
--
-- Replaces hard-coded currency defaults with data. Each tenant ledger
-- (finance_parameters) now names its accounting currency, its reporting currency
-- and the exchange-rate type for each, as D365 does per legal entity:
--   learn.microsoft.com/dynamics365/finance/general-ledger/configure-ledger
--
-- Adds the ISO 4217 reference table, tenant-activated currencies with their own
-- rounding rule, exchange-rate types, currency pairs and dated rates. Stamps every
-- FIFO cost layer with the currency its unit cost is stated in. Drops the country
-- defaults on tenant and purchase-to-pay currency columns, and the literal 'BOB'
-- CHECK that migration 029 put on supplier credits.
--
-- The backfill derives every value from existing columns; nothing is guessed:
--   - every referenced currency becomes an active tenant currency;
--   - each tenant gets one rate type, code DEFAULT (the operator renames it, e.g.
--     to BCB for Bolivia, with scripts/configureLedgerCurrencies.ts);
--   - reporting currency = accounting currency. D365 cannot add or change a
--     reporting currency after posting, and translating posted history at an
--     invented rate would be worse than not translating it.
--
-- Design reference: WORK-024a, docs/process/WORK-024_CURRENCY_FOUNDATION.md.
--
-- Manual rollback (for reference only; not executed):
--   ALTER TABLE finance_parameters DROP CONSTRAINT finance_parameters_tenant_id_accounting_currency_code_fkey,
--     DROP CONSTRAINT finance_parameters_tenant_id_reporting_currency_code_fkey,
--     DROP CONSTRAINT finance_parameters_tenant_id_accounting_rate_type_id_fkey,
--     DROP CONSTRAINT finance_parameters_tenant_id_reporting_rate_type_id_fkey,
--     DROP CONSTRAINT finance_parameters_exchange_rate_date_basis_chk,
--     DROP COLUMN reporting_currency_code, DROP COLUMN accounting_rate_type_id,
--     DROP COLUMN reporting_rate_type_id, DROP COLUMN exchange_rate_date_basis,
--     DROP COLUMN reporting_rounding_tolerance;
--   ALTER TABLE finance_parameters RENAME COLUMN accounting_currency_code TO functional_currency;
--   ALTER TABLE finance_parameters ALTER COLUMN functional_currency SET DEFAULT 'BOB';
--   ALTER TABLE inventory_cost_layers DROP COLUMN cost_currency_code;
--   DROP TABLE exchange_rates, exchange_rate_currency_pairs, exchange_rate_types, tenant_currencies, currencies;
--   ALTER TABLE tenants ALTER COLUMN currency_code SET DEFAULT 'USD';
--   ALTER TABLE suppliers ALTER COLUMN currency SET DEFAULT 'BOB';  (likewise vendor_invoices,
--     vendor_payments, supplier_credits; purchase_orders was 'TRY')
--   ALTER TABLE supplier_credits DROP CONSTRAINT supplier_credits_exchange_rate_positive_chk,
--     ADD CONSTRAINT supplier_credits_bob_exchange_rate_chk CHECK (currency <> 'BOB' OR exchange_rate = 1);
-- =============================================================================

-- ── Pre-checks: stop rather than guess ───────────────────────────────────────

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(t.slug, ', ') INTO bad
    FROM tenants t
   WHERE NOT EXISTS (
     SELECT 1 FROM finance_parameters fp
      WHERE fp.tenant_id = t.id AND fp.legal_entity_id IS NULL
   );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '032: tenants without a tenant-level finance_parameters row: %. Provision them first.', bad;
  END IF;

  SELECT string_agg(t.slug || ' (' || t.currency_code || ' vs ' || fp.functional_currency || ')', ', ') INTO bad
    FROM tenants t
    JOIN finance_parameters fp ON fp.tenant_id = t.id AND fp.legal_entity_id IS NULL
   WHERE t.currency_code <> fp.functional_currency;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '032: tenant currency and ledger functional currency disagree: %. The operator must resolve which is the accounting currency.', bad;
  END IF;

  SELECT string_agg(po.po_number, ', ') INTO bad
    FROM purchase_orders po
    JOIN tenants t ON t.id = po.tenant_id
   WHERE po.currency <> t.currency_code
     AND (EXISTS (SELECT 1 FROM product_receipts pr WHERE pr.purchase_order_id = po.id AND pr.status = 'POSTED')
       OR EXISTS (SELECT 1 FROM vendor_invoices vi WHERE vi.purchase_order_id = po.id AND vi.status = 'POSTED'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '032: purchase orders in a foreign currency already posted at face value: %. They need a reviewed correction first.', bad;
  END IF;
END $$;

-- ── ISO 4217 reference data ──────────────────────────────────────────────────

CREATE TABLE "currencies" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minor_unit" INTEGER NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

ALTER TABLE currencies
  ADD CONSTRAINT currencies_code_format_chk CHECK (code ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT currencies_minor_unit_chk CHECK (minor_unit BETWEEN 0 AND 4);

-- Codes, English names and minor units from the Unicode CLDR currency data.
INSERT INTO currencies (code, name, minor_unit) VALUES
  ('AED', 'United Arab Emirates Dirham', 2),
  ('AFN', 'Afghan Afghani', 0),
  ('ALL', 'Albanian Lek', 0),
  ('AMD', 'Armenian Dram', 2),
  ('ANG', 'Netherlands Antillean Guilder', 2),
  ('AOA', 'Angolan Kwanza', 2),
  ('ARS', 'Argentine Peso', 2),
  ('AUD', 'Australian Dollar', 2),
  ('AWG', 'Aruban Florin', 2),
  ('AZN', 'Azerbaijani Manat', 2),
  ('BAM', 'Bosnia-Herzegovina Convertible Mark', 2),
  ('BBD', 'Barbadian Dollar', 2),
  ('BDT', 'Bangladeshi Taka', 2),
  ('BGN', 'Bulgarian Lev', 2),
  ('BHD', 'Bahraini Dinar', 3),
  ('BIF', 'Burundian Franc', 0),
  ('BMD', 'Bermudan Dollar', 2),
  ('BND', 'Brunei Dollar', 2),
  ('BOB', 'Bolivian Boliviano', 2),
  ('BRL', 'Brazilian Real', 2),
  ('BSD', 'Bahamian Dollar', 2),
  ('BTN', 'Bhutanese Ngultrum', 2),
  ('BWP', 'Botswanan Pula', 2),
  ('BYN', 'Belarusian Ruble', 2),
  ('BZD', 'Belize Dollar', 2),
  ('CAD', 'Canadian Dollar', 2),
  ('CDF', 'Congolese Franc', 2),
  ('CHF', 'Swiss Franc', 2),
  ('CLP', 'Chilean Peso', 0),
  ('CNY', 'Chinese Yuan', 2),
  ('COP', 'Colombian Peso', 2),
  ('CRC', 'Costa Rican Colón', 2),
  ('CUC', 'Cuban Convertible Peso', 2),
  ('CUP', 'Cuban Peso', 2),
  ('CVE', 'Cape Verdean Escudo', 2),
  ('CZK', 'Czech Koruna', 2),
  ('DJF', 'Djiboutian Franc', 0),
  ('DKK', 'Danish Krone', 2),
  ('DOP', 'Dominican Peso', 2),
  ('DZD', 'Algerian Dinar', 2),
  ('EGP', 'Egyptian Pound', 2),
  ('ERN', 'Eritrean Nakfa', 2),
  ('ETB', 'Ethiopian Birr', 2),
  ('EUR', 'Euro', 2),
  ('FJD', 'Fijian Dollar', 2),
  ('FKP', 'Falkland Islands Pound', 2),
  ('GBP', 'British Pound', 2),
  ('GEL', 'Georgian Lari', 2),
  ('GHS', 'Ghanaian Cedi', 2),
  ('GIP', 'Gibraltar Pound', 2),
  ('GMD', 'Gambian Dalasi', 2),
  ('GNF', 'Guinean Franc', 0),
  ('GTQ', 'Guatemalan Quetzal', 2),
  ('GYD', 'Guyanaese Dollar', 2),
  ('HKD', 'Hong Kong Dollar', 2),
  ('HNL', 'Honduran Lempira', 2),
  ('HRK', 'Croatian Kuna', 2),
  ('HTG', 'Haitian Gourde', 2),
  ('HUF', 'Hungarian Forint', 2),
  ('IDR', 'Indonesian Rupiah', 2),
  ('ILS', 'Israeli New Shekel', 2),
  ('INR', 'Indian Rupee', 2),
  ('IQD', 'Iraqi Dinar', 0),
  ('IRR', 'Iranian Rial', 0),
  ('ISK', 'Icelandic Króna', 0),
  ('JMD', 'Jamaican Dollar', 2),
  ('JOD', 'Jordanian Dinar', 3),
  ('JPY', 'Japanese Yen', 0),
  ('KES', 'Kenyan Shilling', 2),
  ('KGS', 'Kyrgystani Som', 2),
  ('KHR', 'Cambodian Riel', 2),
  ('KMF', 'Comorian Franc', 0),
  ('KPW', 'North Korean Won', 0),
  ('KRW', 'South Korean Won', 0),
  ('KWD', 'Kuwaiti Dinar', 3),
  ('KYD', 'Cayman Islands Dollar', 2),
  ('KZT', 'Kazakhstani Tenge', 2),
  ('LAK', 'Laotian Kip', 0),
  ('LBP', 'Lebanese Pound', 0),
  ('LKR', 'Sri Lankan Rupee', 2),
  ('LRD', 'Liberian Dollar', 2),
  ('LSL', 'Lesotho Loti', 2),
  ('LYD', 'Libyan Dinar', 3),
  ('MAD', 'Moroccan Dirham', 2),
  ('MDL', 'Moldovan Leu', 2),
  ('MGA', 'Malagasy Ariary', 0),
  ('MKD', 'Macedonian Denar', 2),
  ('MMK', 'Myanmar Kyat', 0),
  ('MNT', 'Mongolian Tugrik', 2),
  ('MOP', 'Macanese Pataca', 2),
  ('MRU', 'Mauritanian Ouguiya', 2),
  ('MUR', 'Mauritian Rupee', 2),
  ('MVR', 'Maldivian Rufiyaa', 2),
  ('MWK', 'Malawian Kwacha', 2),
  ('MXN', 'Mexican Peso', 2),
  ('MYR', 'Malaysian Ringgit', 2),
  ('MZN', 'Mozambican Metical', 2),
  ('NAD', 'Namibian Dollar', 2),
  ('NGN', 'Nigerian Naira', 2),
  ('NIO', 'Nicaraguan Córdoba', 2),
  ('NOK', 'Norwegian Krone', 2),
  ('NPR', 'Nepalese Rupee', 2),
  ('NZD', 'New Zealand Dollar', 2),
  ('OMR', 'Omani Rial', 3),
  ('PAB', 'Panamanian Balboa', 2),
  ('PEN', 'Peruvian Sol', 2),
  ('PGK', 'Papua New Guinean Kina', 2),
  ('PHP', 'Philippine Peso', 2),
  ('PKR', 'Pakistani Rupee', 2),
  ('PLN', 'Polish Zloty', 2),
  ('PYG', 'Paraguayan Guarani', 0),
  ('QAR', 'Qatari Riyal', 2),
  ('RON', 'Romanian Leu', 2),
  ('RSD', 'Serbian Dinar', 0),
  ('RUB', 'Russian Ruble', 2),
  ('RWF', 'Rwandan Franc', 0),
  ('SAR', 'Saudi Riyal', 2),
  ('SBD', 'Solomon Islands Dollar', 2),
  ('SCR', 'Seychellois Rupee', 2),
  ('SDG', 'Sudanese Pound', 2),
  ('SEK', 'Swedish Krona', 2),
  ('SGD', 'Singapore Dollar', 2),
  ('SHP', 'St. Helena Pound', 2),
  ('SLE', 'Sierra Leonean Leone', 2),
  ('SLL', 'Sierra Leonean Leone (1964—2022)', 0),
  ('SOS', 'Somali Shilling', 0),
  ('SRD', 'Surinamese Dollar', 2),
  ('SSP', 'South Sudanese Pound', 2),
  ('STN', 'São Tomé & Príncipe Dobra', 2),
  ('SVC', 'Salvadoran Colón', 2),
  ('SYP', 'Syrian Pound', 0),
  ('SZL', 'Swazi Lilangeni', 2),
  ('THB', 'Thai Baht', 2),
  ('TJS', 'Tajikistani Somoni', 2),
  ('TMT', 'Turkmenistani Manat', 2),
  ('TND', 'Tunisian Dinar', 3),
  ('TOP', 'Tongan Paʻanga', 2),
  ('TRY', 'Turkish Lira', 2),
  ('TTD', 'Trinidad & Tobago Dollar', 2),
  ('TWD', 'New Taiwan Dollar', 2),
  ('TZS', 'Tanzanian Shilling', 2),
  ('UAH', 'Ukrainian Hryvnia', 2),
  ('UGX', 'Ugandan Shilling', 0),
  ('USD', 'US Dollar', 2),
  ('UYU', 'Uruguayan Peso', 2),
  ('UZS', 'Uzbekistani Som', 2),
  ('VES', 'Venezuelan Bolívar', 2),
  ('VND', 'Vietnamese Dong', 0),
  ('VUV', 'Vanuatu Vatu', 0),
  ('WST', 'Samoan Tala', 2),
  ('XAF', 'Central African CFA Franc', 0),
  ('XCD', 'East Caribbean Dollar', 2),
  ('XCG', 'Caribbean guilder', 2),
  ('XDR', 'Special Drawing Rights', 2),
  ('XOF', 'West African CFA Franc', 0),
  ('XPF', 'CFP Franc', 0),
  ('XSU', 'Sucre', 2),
  ('YER', 'Yemeni Rial', 0),
  ('ZAR', 'South African Rand', 2),
  ('ZMW', 'Zambian Kwacha', 2),
  ('ZWG', 'Zimbabwean Gold', 2),
  ('ZWL', 'Zimbabwean Dollar (2009–2024)', 2);

-- ── Tenant currencies, rate types, pairs and rates ───────────────────────────

CREATE TABLE "tenant_currencies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "currency_code" TEXT NOT NULL,
    "symbol" TEXT,
    "rounding_precision" DECIMAL(6,4) NOT NULL,
    "rounding_method" TEXT NOT NULL DEFAULT 'NEAREST',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_currencies_pkey" PRIMARY KEY ("id")
);

-- Amount columns are (14,2): a precision finer than 0.01 cannot be stored.
ALTER TABLE tenant_currencies
  ADD CONSTRAINT tenant_currencies_rounding_precision_chk CHECK (rounding_precision >= 0.01),
  ADD CONSTRAINT tenant_currencies_rounding_method_chk CHECK (rounding_method IN ('NEAREST', 'UP', 'DOWN'));

CREATE TABLE "exchange_rate_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rate_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_rate_currency_pairs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rate_type_id" UUID NOT NULL,
    "from_currency_code" TEXT NOT NULL,
    "to_currency_code" TEXT NOT NULL,
    "conversion_factor" DECIMAL(10,0) NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_currency_pairs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE exchange_rate_currency_pairs
  ADD CONSTRAINT exchange_rate_currency_pairs_distinct_chk CHECK (from_currency_code <> to_currency_code),
  ADD CONSTRAINT exchange_rate_currency_pairs_factor_chk CHECK (conversion_factor > 0);

CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "currency_pair_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE exchange_rates
  ADD CONSTRAINT exchange_rates_rate_positive_chk CHECK (rate > 0),
  ADD CONSTRAINT exchange_rates_source_chk CHECK (source IN ('MANUAL', 'IMPORTED'));

CREATE UNIQUE INDEX "tenant_currencies_tenant_id_currency_code_key" ON "tenant_currencies"("tenant_id", "currency_code");
CREATE UNIQUE INDEX "exchange_rate_types_tenant_id_code_key" ON "exchange_rate_types"("tenant_id", "code");
-- (tenant_id, id) uniques are the targets of tenant-composite foreign keys: the
-- database itself refuses a reference to another tenant's rate type or pair.
CREATE UNIQUE INDEX "exchange_rate_types_tenant_id_id_key" ON "exchange_rate_types"("tenant_id", "id");
CREATE UNIQUE INDEX "exchange_rate_currency_pairs_tenant_id_rate_type_id_from_cu_key" ON "exchange_rate_currency_pairs"("tenant_id", "rate_type_id", "from_currency_code", "to_currency_code");
CREATE UNIQUE INDEX "exchange_rate_currency_pairs_tenant_id_id_key" ON "exchange_rate_currency_pairs"("tenant_id", "id");
CREATE UNIQUE INDEX "exchange_rates_tenant_id_currency_pair_id_valid_from_key" ON "exchange_rates"("tenant_id", "currency_pair_id", "valid_from");

-- ── Backfill: activate every currency a tenant already uses ──────────────────

DO $$
DECLARE
  bad text;
BEGIN
  WITH used AS (
    SELECT id AS tenant_id, currency_code AS code FROM tenants
    UNION SELECT tenant_id, functional_currency FROM finance_parameters
    UNION SELECT tenant_id, currency FROM suppliers
    UNION SELECT tenant_id, currency FROM purchase_orders
    UNION SELECT tenant_id, currency FROM vendor_invoices
    UNION SELECT tenant_id, currency FROM vendor_payments
    UNION SELECT tenant_id, currency FROM vendor_open_transactions
    UNION SELECT tenant_id, currency FROM vendor_settlements
    UNION SELECT tenant_id, currency FROM supplier_credits
    UNION SELECT tenant_id, currency FROM sales_orders
  )
  SELECT string_agg(DISTINCT u.code, ', ') INTO bad
    FROM used u
    LEFT JOIN currencies c ON c.code = u.code
   WHERE c.code IS NULL OR c.minor_unit > 2;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '032: currencies in use that are not ISO codes or have more than two decimals: %', bad;
  END IF;
END $$;

INSERT INTO tenant_currencies (id, tenant_id, currency_code, rounding_precision, rounding_method, is_active, created_at, updated_at)
SELECT gen_random_uuid(), u.tenant_id, u.code, power(10::numeric, -c.minor_unit), 'NEAREST', true, NOW(), NOW()
  FROM (
    SELECT id AS tenant_id, currency_code AS code FROM tenants
    UNION SELECT tenant_id, functional_currency FROM finance_parameters
    UNION SELECT tenant_id, currency FROM suppliers
    UNION SELECT tenant_id, currency FROM purchase_orders
    UNION SELECT tenant_id, currency FROM vendor_invoices
    UNION SELECT tenant_id, currency FROM vendor_payments
    UNION SELECT tenant_id, currency FROM vendor_open_transactions
    UNION SELECT tenant_id, currency FROM vendor_settlements
    UNION SELECT tenant_id, currency FROM supplier_credits
    UNION SELECT tenant_id, currency FROM sales_orders
  ) u
  JOIN currencies c ON c.code = u.code
 WHERE NOT EXISTS (
   SELECT 1 FROM tenant_currencies tc WHERE tc.tenant_id = u.tenant_id AND tc.currency_code = u.code
 );

INSERT INTO exchange_rate_types (id, tenant_id, code, name, description, is_active, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'DEFAULT', 'Default',
       'Created by migration 032. Rename it to the rate type your accounting uses.', true, NOW(), NOW()
  FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM exchange_rate_types rt WHERE rt.tenant_id = t.id AND rt.code = 'DEFAULT');

-- ── Ledger currencies on finance_parameters ──────────────────────────────────

ALTER TABLE finance_parameters RENAME COLUMN functional_currency TO accounting_currency_code;
ALTER TABLE finance_parameters ALTER COLUMN accounting_currency_code DROP DEFAULT;

ALTER TABLE "finance_parameters"
  ADD COLUMN "reporting_currency_code" TEXT,
  ADD COLUMN "accounting_rate_type_id" UUID,
  ADD COLUMN "reporting_rate_type_id" UUID,
  ADD COLUMN "exchange_rate_date_basis" TEXT NOT NULL DEFAULT 'POSTING_DATE',
  ADD COLUMN "reporting_rounding_tolerance" DECIMAL(14,2) NOT NULL DEFAULT 0.02;

UPDATE finance_parameters fp
   SET reporting_currency_code = fp.accounting_currency_code,
       accounting_rate_type_id = rt.id
  FROM exchange_rate_types rt
 WHERE rt.tenant_id = fp.tenant_id AND rt.code = 'DEFAULT';

ALTER TABLE finance_parameters
  ALTER COLUMN reporting_currency_code SET NOT NULL,
  ALTER COLUMN accounting_rate_type_id SET NOT NULL;

ALTER TABLE finance_parameters
  ADD CONSTRAINT finance_parameters_exchange_rate_date_basis_chk
    CHECK (exchange_rate_date_basis IN ('POSTING_DATE', 'DOCUMENT_DATE'));

-- ── Cost layers state their currency ─────────────────────────────────────────

ALTER TABLE "inventory_cost_layers" ADD COLUMN "cost_currency_code" TEXT;

UPDATE inventory_cost_layers cl
   SET cost_currency_code = fp.accounting_currency_code
  FROM finance_parameters fp
 WHERE fp.tenant_id = cl.tenant_id AND fp.legal_entity_id IS NULL;

ALTER TABLE inventory_cost_layers ALTER COLUMN cost_currency_code SET NOT NULL;

-- ── No country defaults ──────────────────────────────────────────────────────

ALTER TABLE "tenants" ALTER COLUMN "currency_code" DROP DEFAULT;
ALTER TABLE "suppliers" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "purchase_orders" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "vendor_invoices" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "vendor_payments" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "supplier_credits" ALTER COLUMN "currency" DROP DEFAULT;

-- A Turkish tenant booking a BOB credit at a real rate must not be refused by a
-- Bolivian literal. The generic rule is that a rate is positive.
ALTER TABLE supplier_credits DROP CONSTRAINT supplier_credits_bob_exchange_rate_chk;
ALTER TABLE supplier_credits
  ADD CONSTRAINT supplier_credits_exchange_rate_positive_chk CHECK (exchange_rate > 0);

-- ── Foreign keys ─────────────────────────────────────────────────────────────

ALTER TABLE "finance_parameters" ADD CONSTRAINT "finance_parameters_tenant_id_accounting_currency_code_fkey" FOREIGN KEY ("tenant_id", "accounting_currency_code") REFERENCES "tenant_currencies"("tenant_id", "currency_code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "finance_parameters" ADD CONSTRAINT "finance_parameters_tenant_id_reporting_currency_code_fkey" FOREIGN KEY ("tenant_id", "reporting_currency_code") REFERENCES "tenant_currencies"("tenant_id", "currency_code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "finance_parameters" ADD CONSTRAINT "finance_parameters_tenant_id_accounting_rate_type_id_fkey" FOREIGN KEY ("tenant_id", "accounting_rate_type_id") REFERENCES "exchange_rate_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "finance_parameters" ADD CONSTRAINT "finance_parameters_tenant_id_reporting_rate_type_id_fkey" FOREIGN KEY ("tenant_id", "reporting_rate_type_id") REFERENCES "exchange_rate_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "tenant_currencies" ADD CONSTRAINT "tenant_currencies_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exchange_rate_currency_pairs" ADD CONSTRAINT "exchange_rate_currency_pairs_tenant_id_rate_type_id_fkey" FOREIGN KEY ("tenant_id", "rate_type_id") REFERENCES "exchange_rate_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "exchange_rate_currency_pairs" ADD CONSTRAINT "exchange_rate_currency_pairs_tenant_id_from_currency_code_fkey" FOREIGN KEY ("tenant_id", "from_currency_code") REFERENCES "tenant_currencies"("tenant_id", "currency_code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "exchange_rate_currency_pairs" ADD CONSTRAINT "exchange_rate_currency_pairs_tenant_id_to_currency_code_fkey" FOREIGN KEY ("tenant_id", "to_currency_code") REFERENCES "tenant_currencies"("tenant_id", "currency_code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_currency_pair_id_fkey" FOREIGN KEY ("tenant_id", "currency_pair_id") REFERENCES "exchange_rate_currency_pairs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

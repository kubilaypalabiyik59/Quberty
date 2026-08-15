import { PostingType } from './postingProfile.service';

/**
 * Country-independent account classification.
 *
 * THE PROBLEM THIS SOLVES
 * Account NUMBERS are jurisdiction-specific and mandated by local regulation:
 *
 *   Accounts receivable   Bolivia PCG 1103 · Turkey (Tekdüzen) 120 Alıcılar · Germany SKR04 1200
 *   VAT payable           Bolivia 2103/2105 · Turkey 391 Hesaplanan KDV · Germany SKR04 3800
 *
 * Any code that asks "what is account 1103" is a customisation that has to be
 * redone for every country. Code that asks "what is the ACCOUNTS_RECEIVABLE
 * account" ports without modification. That is the entire point.
 *
 * This mirrors D365's main account category, whose stated purpose is to let the
 * default financial reports work "without making any modifications":
 * learn.microsoft.com/dynamics365/finance/general-ledger/plan-chart-of-accounts
 *
 * Note the D365 distinction we keep: `Account.type` (ASSET / LIABILITY / …) is the
 * broad classification; `Account.category` is the finer semantic one. Reports and
 * posting provisioning bind to the category. Neither binds to the code.
 */

export const ACCOUNT_CATEGORIES = [
  // Assets
  'CASH',
  'BANK',
  'ACCOUNTS_RECEIVABLE',
  'INVENTORY',
  'VAT_RECEIVABLE', // recoverable input VAT — IVA crédito fiscal, Vorsteuer, indirilecek KDV
  'PREPAID_EXPENSE',
  'FIXED_ASSET',
  'OTHER_ASSET',
  // Liabilities
  'ACCOUNTS_PAYABLE',
  'VAT_PAYABLE', // output VAT — IVA débito fiscal, Umsatzsteuer, hesaplanan KDV
  'TURNOVER_TAX_PAYABLE', // Bolivia IT; no equivalent in TR/DE, which is fine
  'WITHHOLDING_TAX_PAYABLE', // Turkish tevkifat, and reverse-charge liabilities
  'PAYROLL_PAYABLE',
  'OTHER_LIABILITY',
  // Equity
  'SHARE_CAPITAL',
  'RETAINED_EARNINGS',
  'CURRENT_YEAR_RESULT',
  'OTHER_EQUITY',
  // P&L
  'REVENUE',
  'SALES_DISCOUNT',
  'COGS',
  'TURNOVER_TAX_EXPENSE', // Bolivia IT is an expense, not a receivable
  'OPERATING_EXPENSE',
  'PAYROLL_EXPENSE',
  'FINANCIAL_EXPENSE',
  'OTHER_INCOME',
  // Structural
  'HEADING', // non-posting roll-up account (ACTIVO, PASIVO…)
] as const;

export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number];

export function isAccountCategory(v: string): v is AccountCategory {
  return (ACCOUNT_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Which category satisfies which posting type.
 *
 * This map is the country-independent part of provisioning. It contains no
 * account numbers, so onboarding a Turkish or German tenant needs a new chart
 * template — not a new branch in this file.
 */
export const POSTING_TYPE_BY_CATEGORY: Record<PostingType, AccountCategory> = {
  AR:                   'ACCOUNTS_RECEIVABLE',
  AP:                   'ACCOUNTS_PAYABLE',
  REVENUE:              'REVENUE',
  VAT_OUTPUT:           'VAT_PAYABLE',
  VAT_INPUT:            'VAT_RECEIVABLE',
  COGS:                 'COGS',
  INVENTORY:            'INVENTORY',
  TAX_TURNOVER_EXPENSE: 'TURNOVER_TAX_EXPENSE',
  TAX_TURNOVER_PAYABLE: 'TURNOVER_TAX_PAYABLE',
  CASH:                 'CASH',
  BANK:                 'BANK',
  PAYROLL_EXPENSE:      'PAYROLL_EXPENSE',
  PAYROLL_PAYABLE:      'PAYROLL_PAYABLE',
  ROUNDING:             'OTHER_INCOME',
};

/**
 * Posting types a tenant must have configured before it can trade.
 * TURNOVER_* are absent on purpose: Bolivia's IT has no counterpart in Turkey or
 * Germany, so requiring it would block onboarding in those markets.
 */
export const POSTING_TYPES_REQUIRED_TO_TRADE: PostingType[] = [
  'AR', 'AP', 'REVENUE', 'VAT_OUTPUT', 'VAT_INPUT', 'COGS', 'INVENTORY',
];

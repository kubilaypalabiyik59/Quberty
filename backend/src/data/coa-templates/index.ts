import boliviaPcg from './bolivia-pcg.json';
import turkeyTdhp from './turkey-tdhp.json';
import genericIfrs from './generic-ifrs.json';

/**
 * Country templates.
 *
 * A template declares three things TOGETHER, and that togetherness is the point:
 * the chart of accounts, what each account MEANS (`category`), and the tax codes
 * with the groups they belong to.
 *
 * Why together: defects D-1 … D-7 all trace to a chart and a posting mapping that
 * were maintained in two different places and drifted apart — `1201` meant
 * *Cuentas por Cobrar* in one and *Activo Fijo* in the other. When one file
 * declares both, that drift is not expressible.
 *
 * Onboarding a new country is a new JSON file. It is not a code change, and it is
 * not a customisation — nothing in the services references a country or an account
 * code.
 */

export interface CoaAccount {
  code: string;
  name: string;
  type: string;
  /** Country-independent meaning — see shared/services/accountCategory.ts. */
  category: string;
  normal_balance: string;
  parent_code: string | null;
}

export interface CoaTaxCode {
  code: string;
  name: string;
  tax_type: string;
  rate: number;
  is_inclusive: boolean;
  /**
   * NET | GROSS — what the rate multiplies. Optional so existing templates keep
   * working; the schema default is NET, which is right everywhere except a
   * jurisdiction that taxes the tax-inclusive price. Bolivia does: see
   * TaxCode.base_kind and docs/process/BOLIVIA_TAX_BASIS.md.
   */
  base_kind?: string;
  is_recoverable: boolean;
  region_type: string;
  reverse_charge?: boolean;
  is_exempt?: boolean;
  exempt_reason?: string;
  withholding_share?: number;
  withholding_threshold?: number;
  /** PostingProfile.posting_type — never a GL account code. */
  posting_type_payable: string;
  posting_type_receivable?: string;
  /** Free text for anything that still needs legal validation. */
  note?: string;
}

export interface CoaTaxGroup {
  code: string;
  name: string;
  codes: string[];
}

export interface CoaTaxSetup {
  invoice_label: string;
  tax_codes: CoaTaxCode[];
  /** Party side — attached to customers and suppliers. */
  tax_groups: CoaTaxGroup[];
  /** Product side. */
  item_tax_groups: CoaTaxGroup[];
  default_tax_group: string;
  default_item_tax_group: string;
}

export interface CoaTemplate {
  id: string;
  name: string;
  country: string;
  currency: string;
  tax: CoaTaxSetup;
  accounts: CoaAccount[];
}

export const COA_TEMPLATES: CoaTemplate[] = [boliviaPcg, turkeyTdhp, genericIfrs] as CoaTemplate[];

export function getTemplate(id: string): CoaTemplate | undefined {
  return COA_TEMPLATES.find(t => t.id === id);
}

/** The account in a template that carries a given category, if any. */
export function accountForCategory(template: CoaTemplate, category: string): CoaAccount | undefined {
  return template.accounts.find(a => a.category === category);
}

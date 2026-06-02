import boliviaPcg    from './bolivia-pcg.json';
import turkeyTdhp    from './turkey-tdhp.json';
import genericIfrs   from './generic-ifrs.json';

export interface CoaAccount {
  code:           string;
  name:           string;
  type:           string;
  normal_balance: string;
  parent_code:    string | null;
}

export interface CoaTemplate {
  id:          string;
  name:        string;
  country:     string;
  currency:    string;
  tax_config:  Record<string, any>;
  accounts:    CoaAccount[];
}

export const COA_TEMPLATES: CoaTemplate[] = [boliviaPcg, turkeyTdhp, genericIfrs] as CoaTemplate[];

export function getTemplate(id: string): CoaTemplate | undefined {
  return COA_TEMPLATES.find(t => t.id === id);
}

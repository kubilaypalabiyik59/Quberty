import type { Context, Next } from 'hono';

/**
 * Type-safe Hono context variables — populated by auth + tenant middleware.
 * Access via c.get('user'), c.get('tenantId'), etc.
 */
export type AppUser = {
  id:       string;
  email:    string;
  role:     string;
  tenantId: string;
};

export type AppVariables = {
  tenantId:     string;
  tenantSlug:   string;
  taxConfig:    any;
  // No currency here. It belongs to the ledger (FinanceParameters), and a posting
  // path reads it through getLedgerCurrencies so a tenant without one fails there
  // rather than on every request, including auth (WORK-025).
  user:         AppUser;
  requestId:    string;
  body:         Record<string, any>;
};

export type AppEnv = { Variables: AppVariables };

// Convenience aliases
export type AppContext = Context<AppEnv>;
export type AppNext    = Next;

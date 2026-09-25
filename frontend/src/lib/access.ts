/**
 * What the signed-in user may do, as the server reported it on sign-in and on
 * /auth/me. Used only to shape the UI — hide a link or a button that would be
 * answered 403. Every call is still checked by the server.
 */

export type Permissions = readonly string[] | undefined;

export function can(permissions: Permissions, permission: string): boolean {
  if (!permissions) return false;
  return permissions.includes('admin:all') || permissions.includes(permission);
}

/** The workforce roles an administrator can give, in the order they are offered. */
export const ROLE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'warehouse_worker', label: 'Warehouse Worker' },
  { value: 'receiver', label: 'Receiver' },
  { value: 'store_manager', label: 'Store Manager' },
  { value: 'purchasing_requester', label: 'Purchasing Requester' },
  { value: 'buyer', label: 'Buyer' },
  { value: 'ap_clerk', label: 'Accounts Payable Clerk' },
  { value: 'finance_approver', label: 'Finance Approver' },
  { value: 'finance_manager', label: 'Finance Manager' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'admin', label: 'Administrator' },
] as const;

export function roleLabel(role: string): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
}

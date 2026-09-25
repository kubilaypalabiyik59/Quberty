'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { can, ROLE_OPTIONS, roleLabel } from '@/lib/access';
import { Button } from '@/components/ui/Button';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows, ErrorNote } from '@/components/erp/PageHeader';

interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
}

/**
 * Users and roles.
 *
 * An administrator creates sign-in accounts and decides what each person may
 * do by giving them a role. The server guards the dangerous cases — the last
 * active administrator cannot be demoted or deactivated, and nobody can
 * change their own role or lock themselves out — and this page shows its
 * sentence when it refuses.
 *
 * Storefront shoppers are not listed: they sign themselves up and are not
 * staff. Staff on the payroll can also be added from HR → Employees, which
 * creates the same kind of account.
 */
export default function UsersPage() {
  const permissions = useAuthStore((s) => s.user?.permissions);
  if (!can(permissions, 'admin:all')) {
    return (
      <div>
        <PageHeader title="Users & roles" />
        <ErrorNote message="Only an administrator can manage users and roles." />
      </div>
    );
  }
  return <Users />;
}

function Users() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user?.id);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data, isLoading } = useQuery<UserRow[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/hr/users').then((r) => r.data.data),
  });
  const users = useMemo(
    () => (data ?? []).filter((u) => u.role !== 'customer' && (showInactive || u.is_active)),
    [data, showInactive],
  );
  const inactiveCount = (data ?? []).filter((u) => u.role !== 'customer' && !u.is_active).length;

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const onError = (fallback: string) => (e: any) => setError(apiErrorMessage(e, fallback));

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.put(`/hr/users/${id}/role`, { role }),
    onSuccess: () => { setError(''); refresh(); },
    onError: onError('Could not change the role.'),
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.put(`/hr/users/${id}/${active ? 'reactivate' : 'deactivate'}`),
    onSuccess: () => { setError(''); refresh(); },
    onError: onError('Could not change the account status.'),
  });

  return (
    <div>
      <PageHeader
        title="Users & roles"
        subtitle="Who can sign in, and what each person may do."
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="h-4 w-4" aria-hidden /> New user
          </Button>
        }
      />
      <ErrorNote message={error} />

      <TableShell>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th className="w-60">Role</Th>
            <Th>Last sign-in</Th>
            <Th>Status</Th>
            <Th className="w-32" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={6} />}
          {!isLoading && users.length === 0 && <EmptyRow colSpan={6}>No users.</EmptyRow>}
          {users.map((u) => {
            const self = u.id === me;
            return (
              <tr key={u.id} className={u.is_active ? 'hover:bg-surface-sunken' : 'opacity-60'}>
                <Td className="font-medium">
                  {u.first_name} {u.last_name}
                  {self && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-micro text-accent-onSoft">you</span>}
                </Td>
                <Td className="text-caption text-fg-muted">{u.email}</Td>
                <Td>
                  <select
                    className={dialogField}
                    aria-label={`Role of ${u.email}`}
                    value={u.role}
                    disabled={self || !u.is_active || changeRole.isPending}
                    title={self ? 'Another administrator must change your role' : undefined}
                    onChange={(e) => changeRole.mutate({ id: u.id, role: e.target.value })}
                  >
                    {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    {!ROLE_OPTIONS.some((r) => r.value === u.role) && <option value={u.role}>{roleLabel(u.role)}</option>}
                  </select>
                </Td>
                <Td className="text-caption text-fg-muted">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                </Td>
                <Td>
                  <span className={`rounded px-1.5 py-0.5 text-micro font-semibold ${u.is_active ? 'bg-success-soft text-success' : 'bg-surface-sunken text-fg-muted'}`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </Td>
                <Td className="text-right">
                  {!self && (
                    <Button
                      size="sm"
                      variant={u.is_active ? 'ghost' : 'secondary'}
                      disabled={setActive.isPending}
                      onClick={() => {
                        if (u.is_active && !window.confirm(`Deactivate ${u.email}? They will no longer be able to sign in.`)) return;
                        setActive.mutate({ id: u.id, active: !u.is_active });
                      }}
                    >
                      {u.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>

      {inactiveCount > 0 && (
        <label className="mt-3 flex items-center gap-2 text-caption text-fg-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show {inactiveCount} inactive user(s)
        </label>
      )}

      {creating && <NewUserDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refresh(); }} />}
    </div>
  );
}

function NewUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', role: 'employee', password: '' });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/hr/users', form),
    onSuccess: onCreated,
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not create the user.')),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const blocked =
    !form.first_name.trim() || !form.last_name.trim() ? 'Enter the first and last name.'
    : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) ? 'Enter a valid email.'
    : form.password.length < 8 ? 'The initial password needs at least 8 characters.'
    : null;

  return (
    <Dialog
      title="New user"
      description="Creates a sign-in account. Give the person their initial password in person."
      onClose={onClose}
      error={error}
      blockedReason={blocked}
      submitLabel="Create user"
      onSubmit={() => create.mutate()}
      submitting={create.isPending}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field id="nu-first" label="First name">
          <input id="nu-first" className={dialogField} value={form.first_name} onChange={set('first_name')} autoFocus />
        </Field>
        <Field id="nu-last" label="Last name">
          <input id="nu-last" className={dialogField} value={form.last_name} onChange={set('last_name')} />
        </Field>
        <Field id="nu-email" label="Email" wide>
          <input id="nu-email" className={dialogField} type="email" autoComplete="off" value={form.email} onChange={set('email')} />
        </Field>
        <Field id="nu-role" label="Role">
          <select id="nu-role" className={dialogField} value={form.role} onChange={set('role')}>
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>
        <Field id="nu-password" label="Initial password">
          <input id="nu-password" className={dialogField} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
      </div>
    </Dialog>
  );
}

/** A label tied to its control by id, so the control's accessible name is just the label. */
function Field({ id, label, wide, children }: { id: string; label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <label htmlFor={id} className="mb-1 block text-caption text-fg-muted">{label}</label>
      {children}
    </div>
  );
}

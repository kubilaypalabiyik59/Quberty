import { Hono }    from 'hono';
import * as bcrypt  from 'bcryptjs';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { postJournal } from '../../shared/services/journal.service';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';
import { EMPLOYEE_ROLE_VALUES } from '../../shared/schemas';

const app = new Hono<AppEnv>();

// ── Users ─────────────────────────────────────────────────────────────────────

app.get('/users', requireRole('admin', 'store_manager'), async (c) => {
  const users = await db.user.findMany({
    where:   { tenant_id: c.get('tenantId') },
    select:  { id: true, email: true, first_name: true, last_name: true, role: true, is_active: true, last_login_at: true, created_at: true },
    orderBy: { last_name: 'asc' },
  });
  return ok(c, users);
});

/**
 * Roles a store manager may hand out when adding staff: the store's own. Every
 * other role — finance, purchasing authority, audit, admin — is given by an
 * admin, or a store manager could mint the duties that are meant to check them.
 */
const STORE_MANAGER_GRANTABLE: readonly string[] = [
  'employee', 'cashier', 'warehouse_worker', 'receiver', 'purchasing_requester',
];

/**
 * An admin must never leave the company without an active admin — by demoting
 * or deactivating the last one, or by demoting or locking out themselves.
 */
async function guardAdminContinuity(c: any, targetId: string, change: { role?: string; deactivate?: boolean }) {
  const tenantId = c.get('tenantId');
  const target = await db.user.findFirst({
    where: { id: targetId, tenant_id: tenantId },
    select: { id: true, role: true, is_active: true },
  });
  if (!target) throw new AppError('User not found', 404);
  if (target.id === c.get('user').id) {
    if (change.deactivate) throw new AppError('You cannot deactivate your own account', 409, 'SELF_LOCKOUT');
    if (change.role && change.role !== target.role) {
      throw new AppError('You cannot change your own role; ask another administrator', 409, 'SELF_LOCKOUT');
    }
  }
  const losesAdmin = target.role === 'admin' && target.is_active && (change.deactivate || (change.role && change.role !== 'admin'));
  if (losesAdmin) {
    const admins = await db.user.count({ where: { tenant_id: tenantId, role: 'admin', is_active: true } });
    if (admins <= 1) throw new AppError('This is the last active administrator; appoint another first', 409, 'LAST_ADMIN');
  }
  return target;
}

/**
 * A sign-in account without an employee record — for someone who uses the
 * system but is not on the payroll here (an outside accountant, an auditor).
 * Staff who are employees are added through POST /employees.
 */
app.post('/users', requireRole('admin'), async (c) => {
  const { email, password, first_name, last_name, role = 'employee' } = await c.req.json().catch(() => ({}));
  if (!email || typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError('A valid email is required', 400, 'VALIDATION');
  if (!first_name || !last_name) throw new AppError('First and last name are required', 400, 'VALIDATION');
  if (!password || String(password).length < 8) throw new AppError('The password needs at least 8 characters', 400, 'VALIDATION');
  if (!(EMPLOYEE_ROLE_VALUES as readonly string[]).includes(role)) throw new AppError('Invalid role', 400, 'VALIDATION');
  const tenantId = c.get('tenantId');
  const exists = await db.user.findFirst({ where: { tenant_id: tenantId, email: email.trim() }, select: { id: true } });
  if (exists) throw new AppError('A user with this email already exists', 409, 'DUPLICATE_EMAIL');
  const user = await db.user.create({
    data: {
      email: email.trim(), first_name, last_name, role, tenant_id: tenantId,
      password_hash: await bcrypt.hash(String(password), 12),
    },
    select: { id: true, email: true, first_name: true, last_name: true, role: true, is_active: true, created_at: true },
  });
  return created(c, user);
});

app.put('/users/:id/role', requireRole('admin'), async (c) => {
  const { role } = await c.req.json();
  // Workforce roles only: a shopper account is created by storefront sign-up,
  // never by turning a colleague into a customer here.
  if (!(EMPLOYEE_ROLE_VALUES as readonly string[]).includes(role)) throw new AppError('Invalid role', 400);
  await guardAdminContinuity(c, c.req.param('id'), { role });
  await db.user.updateMany({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') }, data: { role } });
  return ok(c, null);
});

app.put('/users/:id/deactivate', requireRole('admin'), async (c) => {
  await guardAdminContinuity(c, c.req.param('id'), { deactivate: true });
  await db.user.updateMany({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') }, data: { is_active: false } });
  return ok(c, null);
});

app.put('/users/:id/reactivate', requireRole('admin'), async (c) => {
  const { count } = await db.user.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: { is_active: true },
  });
  if (count === 0) throw new AppError('User not found', 404);
  return ok(c, null);
});

// ── Employees ─────────────────────────────────────────────────────────────────

app.get('/employees', requireRole('admin', 'store_manager'), async (c) => {
  const employees = await db.employee.findMany({
    where:   { tenant_id: c.get('tenantId'), is_active: true },
    include: {
      user:          { select: { email: true, first_name: true, last_name: true } },
      assigned_site: { select: { name: true, city: true } },
    },
    orderBy: { employee_code: 'asc' },
  });
  const safe = employees.map(({ pos_pin_hash, ...e }: any) => ({ ...e, has_pos_pin: !!pos_pin_hash }));
  return ok(c, safe);
});

app.post('/employees', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json();
  const { email, password, first_name, last_name, role = 'employee', pos_pin, phone: _phone, ...employeeData } = body;
  if (!EMPLOYEE_ROLE_VALUES.includes(role)) throw new AppError('Invalid employee role', 400);
  // Only an admin may create an admin. Otherwise a store manager could mint an
  // admin account and bypass every admin-only control (segregation of duties).
  if (role === 'admin' && c.get('user')?.role !== 'admin') {
    throw new AppError('Only an admin can create an admin user', 403);
  }
  if (c.get('user')?.role !== 'admin' && !STORE_MANAGER_GRANTABLE.includes(role)) {
    throw new AppError(`A store manager can give only store roles (${STORE_MANAGER_GRANTABLE.join(', ')})`, 403, 'ROLE_ESCALATION');
  }
  if (email) {
    const exists = await db.user.findFirst({ where: { tenant_id: c.get('tenantId'), email }, select: { id: true } });
    if (exists) throw new AppError('A user with this email already exists', 409, 'DUPLICATE_EMAIL');
  }

  let userId: string | undefined;
  if (email && password) {
    const user = await db.user.create({
      data: { email, password_hash: await bcrypt.hash(password, 12), first_name, last_name, role, tenant_id: c.get('tenantId') },
    });
    userId = user.id;
  }

  const count = await db.employee.count({ where: { tenant_id: c.get('tenantId') } });
  const employee = await db.employee.create({
    data: {
      ...employeeData,
      tenant_id:     c.get('tenantId'),
      user_id:       userId,
      employee_code: `EMP-${String(count + 1).padStart(4, '0')}`,
      pos_pin_hash:  pos_pin ? await bcrypt.hash(String(pos_pin), 12) : undefined,
    },
  });

  const { pos_pin_hash, ...safeEmployee } = employee as any;
  return created(c, { ...safeEmployee, has_pos_pin: !!pos_pin_hash });
});

app.put('/employees/:id', requireRole('admin'), async (c) => {
  const body = await c.req.json();
  const { pos_pin_hash: _ignored, pos_pin, ...rest } = body;
  const updateData: any = { ...rest, updated_at: new Date() };
  if (pos_pin !== undefined) {
    updateData.pos_pin_hash = pos_pin ? await bcrypt.hash(String(pos_pin), 12) : null;
  }
  await db.employee.updateMany({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') }, data: updateData });
  return ok(c, null);
});

app.post('/employees/:id/pos-pin', requireRole('admin'), async (c) => {
  const { pin } = await c.req.json();
  if (!pin) throw new AppError('pin is required');
  const pinStr = String(pin);
  if (!/^\d{4,6}$/.test(pinStr)) throw new AppError('PIN must be 4–6 digits');
  await db.employee.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data:  { pos_pin_hash: await bcrypt.hash(pinStr, 12), updated_at: new Date() },
  });
  return ok(c, { message: 'POS PIN updated' });
});

app.delete('/employees/:id/pos-credentials', requireRole('admin'), async (c) => {
  await db.employee.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data:  { pos_device_id: null, pos_pin_hash: null, updated_at: new Date() },
  });
  return ok(c, { message: 'POS credentials cleared' });
});

// ── Payroll ───────────────────────────────────────────────────────────────────

app.get('/payroll', requireRole('admin'), async (c) => {
  const runs = await db.journalEntry.findMany({
    where:   { tenant_id: c.get('tenantId'), source_module: 'PAYROLL' },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    orderBy: { entry_date: 'desc' },
  });
  return ok(c, runs);
});

app.post('/payroll', requireRole('admin'), async (c) => {
  const { year, month, lines } = await c.req.json();
  if (!year || !month || !Array.isArray(lines) || lines.length === 0) throw new AppError('year, month, and lines[] are required');

  const tenantId  = c.get('tenantId');
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;

  const existing = await db.journalEntry.findFirst({
    where: { tenant_id: tenantId, source_module: 'PAYROLL', description: { contains: periodKey } },
  });
  if (existing) throw new AppError(`Payroll for ${periodKey} already processed (JE ${existing.entry_number}).`, 409);

  const totalGross      = lines.reduce((s: number, l: any) => s + Number(l.gross_salary), 0);
  const totalDeductions = lines.reduce((s: number, l: any) => s + Number(l.deductions ?? 0), 0);
  const totalNet        = totalGross - totalDeductions;

  // Payroll already failed loudly on a missing account rather than skipping, which
  // was correct — it just named Bolivian codes. The posting types carry the same
  // strictness without hardcoding a chart.
  //
  // PAYROLL_DEDUCTION_PAYABLE is resolved only when something was actually
  // withheld. The entry used to debit gross and credit NET, which does not
  // balance: the deductions were credited to nothing. They are owed to the state
  // or the pension fund, not to the employee, so they cannot share the employee
  // payable. A payroll with no deductions posts exactly the two lines it always did.
  const types = totalDeductions > 0
    ? (['PAYROLL_EXPENSE', 'PAYROLL_PAYABLE', 'PAYROLL_DEDUCTION_PAYABLE'] as const)
    : (['PAYROLL_EXPENSE', 'PAYROLL_PAYABLE'] as const);

  const acc = await resolvePostingAccounts_orExplain(
    tenantId, types,
    { document: `Payroll ${periodKey}` },
  );
  if (!acc) throw new AppError(`Payroll for ${periodKey} cannot be posted: payroll posting profiles are not configured.`, 500);

  // ── Salary expense, split by department ──────────────────────────────────
  //
  // This is what the department axis exists for. **[OFFICIAL]** a department is an
  // operating unit that "might have profit and loss responsibility" and is "used to
  // report on functional areas" — a single aggregated salary debit cannot answer
  // that question, and no report can recover the split afterwards.
  //
  // Deliberately only the EXPENSE leg is split. The two credits are liabilities:
  // one net sum owed to employees on payday, one to the state on a filing deadline.
  // Neither is a functional-area cost and splitting them would imply a per-department
  // liability the business does not actually settle separately.
  //
  // An employee with no department produces an uncoded bucket, which is the honest
  // answer — the alternative is attributing their salary to whichever department
  // happens to be first.
  const employeeIds = [
    ...new Set(lines.map((l: any) => l.employee_id).filter((id: any): id is string => !!id)),
  ];
  const employees = employeeIds.length
    ? await db.employee.findMany({
        where: { id: { in: employeeIds }, tenant_id: tenantId },
        select: { id: true, department_id: true, assigned_site_id: true, employee_code: true },
      })
    : [];
  const empById = new Map(employees.map(e => [e.id, e]));

  interface Bucket {
    amount: number;
    departmentId: string | null;
    siteId: string | null;
    label: string;
  }
  const buckets = new Map<string, Bucket>();

  for (const l of lines as any[]) {
    const emp = l.employee_id ? empById.get(l.employee_id) : undefined;
    const departmentId = emp?.department_id ?? null;
    const siteId = emp?.assigned_site_id ?? null;
    const key = `${departmentId ?? '-'}|${siteId ?? '-'}`;

    const existing = buckets.get(key);
    if (existing) {
      existing.amount = Number((existing.amount + Number(l.gross_salary)).toFixed(2));
    } else {
      buckets.set(key, {
        amount: Number(Number(l.gross_salary).toFixed(2)),
        departmentId,
        siteId,
        label: departmentId ? '' : ' (sin departamento)',
      });
    }
  }

  const expenseLines = [...buckets.values()].map(b => ({
    accountId:   acc.PAYROLL_EXPENSE,
    debit:       b.amount,
    description: `Sueldos brutos ${periodKey}${b.label}`,
    // Per-line context, because one payroll voucher legitimately spans several
    // departments. The voucher-level context could not express that.
    dimensions:  { operatingUnitId: b.departmentId, siteId: b.siteId },
  }));

  const je = await postJournal({
    tenantId,
    date:        new Date(Number(year), Number(month) - 1, 28),
    description: `Planilla de Sueldos ${periodKey}`,
    source:      { module: 'PAYROLL' },
    userId:      c.get('user').id,
    lines: [
      ...expenseLines,
      { accountId: acc.PAYROLL_PAYABLE, credit: totalNet,   description: `Sueldos netos por pagar ${periodKey}` },
      ...(totalDeductions > 0
        ? [{
            accountId: (acc as Record<string, string>).PAYROLL_DEDUCTION_PAYABLE,
            credit: totalDeductions,
            description: `Retenciones y aportes ${periodKey}`,
          }]
        : []),
    ],
  });

  return created(c, {
    journal_entry: je,
    summary: { period: periodKey, employees: lines.length, total_gross: totalGross, total_deductions: totalDeductions, total_net: totalNet },
  });
});

export default app;

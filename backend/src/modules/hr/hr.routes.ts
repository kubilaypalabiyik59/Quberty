import { Hono }    from 'hono';
import * as bcrypt  from 'bcryptjs';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

// ── Users ─────────────────────────────────────────────────────────────────────

app.get('/users', requireRole('admin'), async (c) => {
  const users = await db.user.findMany({
    where:   { tenant_id: c.get('tenantId') },
    select:  { id: true, email: true, first_name: true, last_name: true, role: true, is_active: true, last_login_at: true, created_at: true },
    orderBy: { last_name: 'asc' },
  });
  return ok(c, users);
});

app.put('/users/:id/role', requireRole('admin'), async (c) => {
  const { role } = await c.req.json();
  const validRoles = ['admin', 'store_manager', 'warehouse_worker', 'employee', 'customer'];
  if (!validRoles.includes(role)) throw new AppError('Invalid role', 400);
  await db.user.updateMany({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') }, data: { role } });
  return ok(c, null);
});

app.put('/users/:id/deactivate', requireRole('admin'), async (c) => {
  await db.user.updateMany({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') }, data: { is_active: false } });
  return ok(c, null);
});

// ── Employees ─────────────────────────────────────────────────────────────────

app.get('/employees', requireRole('admin'), async (c) => {
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

app.post('/employees', requireRole('admin'), async (c) => {
  const body = await c.req.json();
  const { email, password, first_name, last_name, role = 'employee', pos_pin, phone: _phone, ...employeeData } = body;

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

  const [salaryExpense, salariesPayable] = await Promise.all([
    db.account.findFirst({ where: { tenant_id: tenantId, code: '5201' } }),
    db.account.findFirst({ where: { tenant_id: tenantId, code: '2201' } }),
  ]);
  if (!salaryExpense)  throw new AppError('Account 5201 (Gastos de Personal) not found.');
  if (!salariesPayable) throw new AppError('Account 2201 (Sueldos por Pagar) not found.');

  const totalGross      = lines.reduce((s: number, l: any) => s + Number(l.gross_salary), 0);
  const totalDeductions = lines.reduce((s: number, l: any) => s + Number(l.deductions ?? 0), 0);
  const totalNet        = totalGross - totalDeductions;
  const count           = await db.journalEntry.count({ where: { tenant_id: tenantId } });

  const je = await db.journalEntry.create({
    data: {
      tenant_id:    tenantId,
      entry_number: `JE-${String(count + 1).padStart(6, '0')}`,
      entry_date:   new Date(Number(year), Number(month) - 1, 28),
      description:  `Planilla de Sueldos ${periodKey}`,
      source_module: 'PAYROLL',
      status:       'POSTED',
      posted_at:    new Date(),
      created_by:   c.get('user').id,
      lines: {
        create: [
          { account_id: salaryExpense.id,   debit_amount: totalGross, credit_amount: 0,        description: `Sueldos brutos ${periodKey}` },
          { account_id: salariesPayable.id, debit_amount: 0,          credit_amount: totalNet, description: `Sueldos netos por pagar ${periodKey}` },
        ],
      },
    },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
  });

  return created(c, {
    journal_entry: je,
    summary: { period: periodKey, employees: lines.length, total_gross: totalGross, total_deductions: totalDeductions, total_net: totalNet },
  });
});

export default app;

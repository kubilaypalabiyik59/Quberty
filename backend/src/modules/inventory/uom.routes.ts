import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

// List all UoMs for tenant
app.get('/', async (c) => {
  const units = await db.unitOfMeasure.findMany({
    where:   { tenant_id: c.get('tenantId'), is_active: true },
    orderBy: { name: 'asc' },
  });
  return ok(c, units);
});

// Create UoM
app.post('/', async (c) => {
  const { code, name, symbol } = await c.req.json();
  if (!code || !name || !symbol) throw new AppError('code, name, symbol are required');

  const existing = await db.unitOfMeasure.findFirst({
    where: { tenant_id: c.get('tenantId'), code: code.toUpperCase() },
  });
  if (existing) throw new AppError(`UoM code "${code}" already exists`, 409);

  const uom = await db.unitOfMeasure.create({
    data: {
      tenant_id: c.get('tenantId'),
      code:      code.toUpperCase(),
      name,
      symbol,
    },
  });
  return created(c, uom);
});

// Update UoM
app.put('/:id', async (c) => {
  const { name, symbol, is_active } = await c.req.json();
  const uom = await db.unitOfMeasure.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!uom) throw new AppError('Unit of measure not found', 404);

  const updated = await db.unitOfMeasure.update({
    where: { id: uom.id },
    data:  { name, symbol, is_active },
  });
  return ok(c, updated);
});

// Seed defaults for tenant (call once on setup)
app.post('/seed-defaults', async (c) => {
  const tenantId = c.get('tenantId');
  const defaults = [
    { code: 'PCS',  name: 'Pieces',     symbol: 'pcs'  },
    { code: 'PAIR', name: 'Pairs',      symbol: 'pair' },
    { code: 'KG',   name: 'Kilograms',  symbol: 'kg'   },
    { code: 'LTR',  name: 'Liters',     symbol: 'L'    },
    { code: 'MTR',  name: 'Meters',     symbol: 'm'    },
    { code: 'BOX',  name: 'Boxes',      symbol: 'box'  },
    { code: 'SET',  name: 'Sets',       symbol: 'set'  },
    { code: 'HR',   name: 'Hours',      symbol: 'hr'   },
  ];

  let createdCount = 0;
  for (const d of defaults) {
    const exists = await db.unitOfMeasure.findFirst({
      where: { tenant_id: tenantId, code: d.code },
    });
    if (!exists) {
      await db.unitOfMeasure.create({ data: { tenant_id: tenantId, ...d } });
      createdCount++;
    }
  }
  return ok(c, { message: `Seeded ${createdCount} units of measure`, created: createdCount });
});

export default app;

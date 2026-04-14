/**
 * Seed script — creates demo data for Skarpine
 * Run: npm run db:seed
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

async function main() {
  console.log('Seeding Skarpine demo data...');

  // 1. Create tenant
  const tenant = await db.tenant.upsert({
    where: { slug: 'skarpine-demo' },
    update: {},
    create: {
      slug: 'skarpine-demo',
      name: 'Skarpine Shoes',
      plan: 'professional',
      language: 'tr',
      timezone: 'Europe/Istanbul',
      modules: { sales: true, purchase: true, inventory: true, warehouse: true, hr: true, reporting: true, import: true },
    },
  });
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  // 2. Create admin user
  const admin = await db.user.upsert({
    where: { tenant_id_email: { tenant_id: tenant.id, email: 'admin@skarpine.com' } },
    update: {},
    create: {
      tenant_id: tenant.id,
      email: 'admin@skarpine.com',
      password_hash: await bcrypt.hash('Admin1234!', 12),
      first_name: 'Admin',
      last_name: 'User',
      role: 'admin',
    },
  });
  console.log(`Admin: ${admin.email}`);

  // 3. Create sites (cities)
  const istanbulSite = await db.site.upsert({
    where: { tenant_id_code: { tenant_id: tenant.id, code: 'SITE-IST' } },
    update: {},
    create: { tenant_id: tenant.id, code: 'SITE-IST', name: 'Istanbul', city: 'Istanbul', country: 'TR' },
  });

  const ankaraSite = await db.site.upsert({
    where: { tenant_id_code: { tenant_id: tenant.id, code: 'SITE-ANK' } },
    update: {},
    create: { tenant_id: tenant.id, code: 'SITE-ANK', name: 'Ankara', city: 'Ankara', country: 'TR' },
  });

  // 4. Create warehouses
  const mainWarehouse = await db.warehouse.upsert({
    where: { tenant_id_code: { tenant_id: tenant.id, code: 'WH-IST-01' } },
    update: {},
    create: { tenant_id: tenant.id, site_id: istanbulSite.id, code: 'WH-IST-01', name: 'Istanbul Main Store' },
  });

  // 5. Create zones
  const zones = await Promise.all([
    db.warehouseZone.upsert({
      where: { warehouse_id_code: { warehouse_id: mainWarehouse.id, code: 'RECV' } },
      update: {},
      create: { tenant_id: tenant.id, warehouse_id: mainWarehouse.id, code: 'RECV', name: 'Receiving', zone_type: 'receive' },
    }),
    db.warehouseZone.upsert({
      where: { warehouse_id_code: { warehouse_id: mainWarehouse.id, code: 'STOR' } },
      update: {},
      create: { tenant_id: tenant.id, warehouse_id: mainWarehouse.id, code: 'STOR', name: 'Storage', zone_type: 'storage' },
    }),
    db.warehouseZone.upsert({
      where: { warehouse_id_code: { warehouse_id: mainWarehouse.id, code: 'SHIP' } },
      update: {},
      create: { tenant_id: tenant.id, warehouse_id: mainWarehouse.id, code: 'SHIP', name: 'Shipping', zone_type: 'shipping' },
    }),
  ]);

  const [recvZone, storageZone, shippingZone] = zones;

  // 6. Create locations (bins)
  const binCodes = ['A-01-01', 'A-01-02', 'A-02-01', 'A-02-02', 'B-01-01', 'B-01-02'];
  for (const code of binCodes) {
    const [aisle, rack, shelf] = code.split('-');
    await db.warehouseLocation.upsert({
      where: { zone_id_code: { zone_id: storageZone.id, code } },
      update: {},
      create: {
        tenant_id: tenant.id,
        zone_id: storageZone.id,
        code,
        aisle,
        rack,
        shelf,
        location_type: 'shelf',
        is_pick_location: true,
      },
    });
  }

  // Receive dock
  await db.warehouseLocation.upsert({
    where: { zone_id_code: { zone_id: recvZone.id, code: 'DOCK-01' } },
    update: {},
    create: {
      tenant_id: tenant.id,
      zone_id: recvZone.id,
      code: 'DOCK-01',
      location_type: 'dock',
      is_receive_location: true,
    },
  });

  // Shipping staging
  await db.warehouseLocation.upsert({
    where: { zone_id_code: { zone_id: shippingZone.id, code: 'STAGE-01' } },
    update: {},
    create: {
      tenant_id: tenant.id,
      zone_id: shippingZone.id,
      code: 'STAGE-01',
      location_type: 'floor',
    },
  });

  // 7. Create product categories
  const cat = await db.productCategory.upsert({
    where: { tenant_id_code: { tenant_id: tenant.id, code: 'SNEAKERS' } },
    update: {},
    create: { tenant_id: tenant.id, code: 'SNEAKERS', name: 'Sneakers' },
  });

  // 8. Create sample products
  const products = [
    { sku: 'AIR-MAX-001', name: 'Air Max Runner', selling_price: 1299, cost_price: 650 },
    { sku: 'BOOT-CLASSIC-001', name: 'Classic Boot', selling_price: 1799, cost_price: 900 },
    { sku: 'SLIPPER-SUMMER-001', name: 'Summer Slipper', selling_price: 399, cost_price: 150 },
  ];

  for (const p of products) {
    await db.product.upsert({
      where: { tenant_id_sku: { tenant_id: tenant.id, sku: p.sku } },
      update: {},
      create: {
        tenant_id: tenant.id,
        ...p,
        category_id: cat.id,
        brand: 'Skarpine',
        is_active: true,
        is_published: true,
      },
    });
  }

  // 9. Create wave template
  await db.waveTemplate.upsert({
    where: { tenant_id_code: { tenant_id: tenant.id, code: 'WAVE-SHIP-DEFAULT' } },
    update: {},
    create: {
      tenant_id: tenant.id,
      code: 'WAVE-SHIP-DEFAULT',
      name: 'Default Shipping Wave',
      warehouse_id: mainWarehouse.id,
      wave_type: 'SHIPPING',
      auto_process: false,
    },
  });

  console.log('\nSeed completed successfully!');
  console.log(`\nLogin credentials:`);
  console.log(`  Tenant ID: ${tenant.id}`);
  console.log(`  Email:     admin@skarpine.com`);
  console.log(`  Password:  Admin1234!`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());

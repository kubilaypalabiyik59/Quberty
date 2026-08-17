import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Provision the financial dimension setup for a tenant.
 *
 *   npx tsx scripts/provisionFinancialDimensions.ts            # dry run, reports only
 *   npx tsx scripts/provisionFinancialDimensions.ts --apply
 *   npx tsx scripts/provisionFinancialDimensions.ts --apply --require-store
 *
 * Dry run by default, on the same reasoning as provisionSalesDimensions.ts: this
 * writes master data that every future voucher is coded against, and a wrong value
 * here is not visible in any single document — only in a report, months later.
 *
 * `--require-store` is separate from `--apply` deliberately. Creating the axes
 * changes nothing; making the store REQUIRED on revenue and COGS can REFUSE A SALE.
 * Kubi's decision was required-from-day-one, but the switch is still its own
 * deliberate step so it can be verified first and reversed in one statement.
 */

const APPLY = process.argv.includes('--apply');
const REQUIRE_STORE = process.argv.includes('--require-store');

/** A dimension value code: **[OFFICIAL]** 30 characters, and no whitespace. */
const toCode = (s: string) =>
  s.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_-]/g, '').slice(0, 30);

let planned = 0;
const plan = (what: string) => {
  planned++;
  console.log(`  ${APPLY ? 'APPLY ' : 'WOULD '} ${what}`);
};

(async () => {
  const tenants = await db.tenant.findMany({ select: { id: true, name: true } });

  for (const tenant of tenants) {
    console.log(`\n═══ ${tenant.name} (${tenant.id}) ═══`);
    const tenantId = tenant.id;

    // ── 1. The axes ────────────────────────────────────────────────────────
    // STORE is entity-backed on Site. **[OFFICIAL]** entity-backed values come from
    // an existing table chosen in "Use values from", and are not created until
    // first use — so nothing is seeded here beyond the attribute itself.
    //
    // Site, not Warehouse: `Warehouse.site_id` is NOT NULL, so the site is the
    // warehouse's site and the two would be the same axis counted twice. That was
    // Kubi's own correction during migration 011.
    const axes = [
      { code: 'STORE', name: 'Store', slot: 1, value_source: 'SITE' },
      { code: 'DEPT', name: 'Department', slot: 2, value_source: 'OPERATING_UNIT' },
    ];

    console.log('\n── Axes');
    for (const axis of axes) {
      const existing = await db.dimensionAttribute.findFirst({
        where: { tenant_id: tenantId, legal_entity_id: null, code: axis.code },
        select: { id: true, slot: true, value_source: true },
      });

      if (existing) {
        if (existing.slot !== axis.slot || existing.value_source !== axis.value_source) {
          console.log(
            `  CONFLICT ${axis.code} exists on slot ${existing.slot} / ${existing.value_source}, ` +
              `expected slot ${axis.slot} / ${axis.value_source}. NOT changed — moving an axis ` +
              `between slots would silently re-interpret every voucher already coded.`,
          );
        } else {
          console.log(`  OK       ${axis.code} already on slot ${axis.slot} (${axis.value_source})`);
        }
        continue;
      }

      plan(`create axis ${axis.code} "${axis.name}" on slot ${axis.slot} from ${axis.value_source}`);
      if (APPLY) {
        await db.dimensionAttribute.create({
          data: { tenant_id: tenantId, ...axis },
        });
      }
    }

    // ── 2. Departments, from the free text that is there today ─────────────
    console.log('\n── Departments (operating units)');
    const grouped = await db.employee.groupBy({
      by: ['department'],
      where: { tenant_id: tenantId },
      _count: { _all: true },
    });

    const realNames = grouped
      .map(g => (g.department ?? '').trim())
      .filter(name => name.length > 0);

    const blank = grouped
      .filter(g => !(g.department ?? '').trim())
      .reduce((s, g) => s + g._count._all, 0);

    if (realNames.length === 0) {
      console.log('  (no department names in employees.department — nothing to derive)');
    }

    for (const name of realNames) {
      const code = toCode(name);
      const count = grouped.find(g => (g.department ?? '').trim() === name)?._count._all ?? 0;

      const existing = await db.operatingUnit.findFirst({
        where: { tenant_id: tenantId, code },
        select: { id: true, name: true, unit_type: true },
      });

      if (existing) {
        console.log(`  OK       ${code} "${existing.name}" [${existing.unit_type}] already exists`);
      } else {
        plan(`create operating unit ${code} "${name}" [DEPARTMENT] — ${count} employee(s)`);
        if (APPLY) {
          await db.operatingUnit.create({
            data: {
              tenant_id: tenantId,
              code,
              name,
              unit_type: 'DEPARTMENT',
              memo: 'Derived from employees.department by provisionFinancialDimensions.ts',
            },
          });
        }
      }

      // Link the employees. Only where `department_id` is still null — never
      // overwrite a link somebody set by hand.
      const unit = await db.operatingUnit.findFirst({
        where: { tenant_id: tenantId, code },
        select: { id: true },
      });
      if (unit) {
        const toLink = await db.employee.count({
          where: { tenant_id: tenantId, department: name, department_id: null },
        });
        if (toLink > 0) {
          plan(`link ${toLink} employee(s) with department "${name}" → ${code}`);
          if (APPLY) {
            await db.employee.updateMany({
              where: { tenant_id: tenantId, department: name, department_id: null },
              data: { department_id: unit.id },
            });
          }
        }
      }
    }

    if (blank > 0) {
      console.log(
        `  LEFT     ${blank} employee(s) have no department name. NOT assigned — ` +
          `inventing one would put their salary in a functional area they do not work in.`,
      );
    }

    // ── 3. Requirement rule ────────────────────────────────────────────────
    console.log('\n── Requirement rules');
    const store = await db.dimensionAttribute.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: null, code: 'STORE' },
      select: { id: true },
    });

    if (!store) {
      console.log('  SKIP     STORE axis does not exist yet (dry run?) — rules not evaluated');
    } else {
      // REVENUE and COGS only. Kubi's decision, and it is also the narrowest rule
      // that answers "what did each store earn": the balance-sheet legs of the same
      // voucher are coded anyway by the resolver, they are simply not *required*.
      for (const category of ['REVENUE', 'COGS'] as const) {
        const existing = await db.dimensionRule.findFirst({
          where: {
            tenant_id: tenantId,
            legal_entity_id: null,
            attribute_id: store.id,
            account_category: category,
          },
          select: { id: true, requirement: true },
        });

        const target = REQUIRE_STORE ? 'REQUIRED' : 'OPTIONAL';

        if (existing?.requirement === target) {
          console.log(`  OK       STORE on ${category} is already ${target}`);
          continue;
        }

        plan(`set STORE ${target} on ${category} accounts`);
        if (APPLY) {
          if (existing) {
            await db.dimensionRule.update({
              where: { id: existing.id },
              data: { requirement: target },
            });
          } else {
            await db.dimensionRule.create({
              data: {
                tenant_id: tenantId,
                attribute_id: store.id,
                account_category: category,
                requirement: target,
              },
            });
          }
        }
      }

      if (!REQUIRE_STORE) {
        console.log(
          '  NOTE     pass --require-store to make it REQUIRED. Until then an uncoded ' +
            'revenue line posts and shows as "(unassigned)".',
        );
      }
    }

    // ── 4. What the axes can actually reach ────────────────────────────────
    console.log('\n── Coverage the axes will have');
    const sites = await db.site.count({ where: { tenant_id: tenantId } });
    const units = await db.operatingUnit.count({ where: { tenant_id: tenantId } });
    const soTotal = await db.salesOrder.count({ where: { tenant_id: tenantId } });
    const soWithSite = await db.salesOrder.count({
      where: { tenant_id: tenantId, site_id: { not: null } },
    });
    const empTotal = await db.employee.count({ where: { tenant_id: tenantId } });
    const empWithDept = await db.employee.count({
      where: { tenant_id: tenantId, department_id: { not: null } },
    });

    console.log(`  sites ${sites} · operating units ${units}`);
    console.log(`  sales orders with a site: ${soWithSite}/${soTotal}`);
    console.log(`  employees with a department: ${empWithDept}/${empTotal}`);
    if (soWithSite < soTotal) {
      console.log(
        `  ⚠ ${soTotal - soWithSite} sales order(s) have no site. Their vouchers are already ` +
          `posted and stay "(unassigned)". New orders resolve a site because ` +
          `require_warehouse_on_sales_order is on.`,
      );
    }
  }

  console.log(
    `\n${APPLY ? 'Applied' : 'Planned'} ${planned} change(s).` +
      (APPLY ? '' : '  Re-run with --apply to write them.'),
  );
  await db.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});

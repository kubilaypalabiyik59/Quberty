# Skarpine WMS — Dynamics 365 Alignment Notes
> Based on deep study of D365 Supply Chain Warehouse Management documentation

---

## How Skarpine Mirrors D365 WMS Concepts

### Location Hierarchy
| D365 Concept | Skarpine Implementation |
|---|---|
| Site | `sites` table |
| Warehouse | `warehouses` table |
| Zone Group | `warehouse_zones.zone_type` (group label) |
| Zone | `warehouse_zones` table |
| Location Type | `warehouse_locations.location_type` |
| Location (bin) | `warehouse_locations` table — lowest level |

### Core WMS Tables
| D365 Concept | Skarpine Table |
|---|---|
| Wave Templates | `wave_templates` |
| Waves | `waves` |
| Work Templates | `work_templates` + `work_template_lines` |
| Location Directives | `location_directives` + `location_directive_lines` |
| Warehouse Work | `warehouse_work` + `warehouse_work_lines` |
| Arrival Journal | `arrival_journals` + `arrival_journal_lines` |
| Inventory Transactions | `inventory_transactions` — full ledger |
| Inventory Stock | `inventory_stock` — bin-level quantity |

### Wave Template Types
D365 supports: Shipping · Production order · Kanban
Skarpine MVP: Shipping (extendable to others via `wave_type` field)

### Location Directive Strategies Implemented
| Strategy | D365 | Skarpine |
|---|---|---|
| Empty location | Yes | `EMPTY_LOCATION` |
| Consolidate | Yes | `CONSOLIDATE` |
| FIFO | Yes | `FIFO` (by `updated_at asc`) |
| FEFO | Yes | `FEFO` (extend with expiry date on product_variants) |

### Work Types
D365: PICK · PUT · COUNT · STATUS CHANGE
Skarpine: `PICK` · `PUT` · `PACK` · `VERIFY` · `PUTAWAY`

---

## D365 Features for v2 Roadmap

These D365 concepts are NOT in MVP but are architected for future addition:

| Feature | MVP | v2 | Schema Ready? |
|---|---|---|---|
| Location Profiles (capacity policies) | No | Yes | Add `location_profile_id` FK |
| Location Stocking Limits | Partial (max_weight/max_volume fields exist) | Full | Yes |
| Work Pools (classify work by group) | No | Yes | Add `work_pool_id` to warehouse_work |
| Cluster Picking (multi-order pick) | No | v2 | New cluster_picks table |
| Cross-docking | No | v2 | Add cross_dock flag to sales_order_lines |
| Containerization / Packing Stations | No | v2 | Add containers table |
| Mobile Device Menu Items | No | v3 | Mobile app |
| Cycle Counting Plans | No | v2 | Add cycle_count_plans table |
| FEFO (expiry-based picking) | No | v2 | Add expiry_date to inventory_stock |
| Replenishment Templates | No | v2 | Add replenishment_rules table |

---

## D365 ALM → Skarpine ALM Mapping

| D365 ALM Stage | Skarpine Equivalent |
|---|---|
| Initiate | Project kickoff + architecture decisions |
| Implement | Feature branches + dev environment |
| Prepare | UAT environment + client sign-off |
| Operate | Production + monitoring + support |

D365 uses Azure DevOps for work item tracking, build automation, and CI/CD.
Skarpine uses GitHub + GitHub Actions (same principles, different tools).

The D365 docs emphasize: **build automation is mandatory** (never manual builds).
Skarpine enforces this: all deploys must go through GitHub Actions pipeline — no manual production deploys.

---

## Key D365 Principle Reflected in Skarpine

> "ALM applies to ALL solutions regardless of size or complexity.
> Even simple, configuration-only solutions benefit from version control,
> build automation, and test management."

This is why Skarpine includes:
- Prisma migrations (schema version control)
- Seed scripts (reproducible environments)
- CI/CD from day 1 (not added later)
- Audit logs on all mutations
- Three-tier environments (DEV/UAT/PROD)

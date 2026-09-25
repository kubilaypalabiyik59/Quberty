-- =============================================================================
-- 038  One inbound movement can reverse several settlements
--
-- Migration 037 made `inventory_cost_settlements.reversed_by_id` unique so a
-- settlement could not be reversed twice. But the value is the inbound
-- transaction that did the reversing, and one inbound transaction legitimately
-- reverses every settlement of the issue it undoes: a shipment of three units that
-- consumed a 100 layer and a 120 layer has two settlements and comes back as one
-- return movement. The unique index refused exactly that return (found by
-- `verify:stock-ledger` on TEST, 2026-09-14).
--
-- "Reversed at most once" is a property of the settlement row, and the service
-- enforces it where it belongs: it only restores settlements whose
-- `reversed_by_id` is still null, claiming each with a guarded update. The unique
-- index becomes a plain index for the lookup.
--
-- Design reference: WORK-043/044 acceptance finding.
-- =============================================================================

DROP INDEX "inventory_cost_settlements_reversed_by_id_key";
CREATE INDEX "inventory_cost_settlements_reversed_by_id_idx" ON "inventory_cost_settlements"("reversed_by_id");

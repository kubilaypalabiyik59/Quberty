# WORK-051A — Receipt location containment

2026-09-17. Kubi authorized concurrent bounded fixes; Codex owns design/review, Claude the patch.
This is an independent security containment slice of approved WORK-051 / DEF-088, not full acceptance of WORK-051.

Catalog: 75 Source to pay / 75.40 procurement and 60.30 receiving. Exact lower-level IDs for this local refusal scenario are unverified; preserve six-level taxonomy without inventing workbook entries. Scope CORE_NOW. Parameter owner Purchase + Inventory. Schema hook NONE_REQUIRED: existing WarehouseLocation -> WarehouseZone -> Warehouse relations suffice. Localization: no tax, number format, posting or currency change.

[REPO-VERIFIED] productReceipt.service.ts resolves input/default and per-line locations but does not validate tenant or warehouse before receipt/stock writes.
[OFFICIAL, Microsoft Learn MCP 2026-09-17] https://learn.microsoft.com/dynamics365/business-central/warehouse-how-receive-items#receive-items-with-a-warehouse-receipt describes receipt at a selected location/bin against source documents. Our row-tenant containment is an architectural implementation requirement, not a claim about Microsoft's SQL design.

Branch codex/rebuild-2026-09-07, HEAD 1aa6d83. You are not alone: another Claude job owns sales routes/tests and Codex owns documentation. Do not revert or touch their changes.
Allowed files: backend/src/modules/purchase/productReceipt.service.ts; new backend/src/__tests__/productReceiptLocation.test.ts ONLY.

Validate the resolved header location (explicit or PO default) AND every effective requested line location in the same transaction before any receipt number, receipt, stock, cost layer or journal mutation. Each must be active, belong to caller tenant, and its zone must belong to the same tenant and PO warehouse; the warehouse must belong to caller tenant. Do not require is_receive_location=true: that would introduce an unrelated functional policy. Refuse invalid/missing/foreign/inactive locations with a stable 422 RECEIVE_LOCATION_INVALID; preserve existing missing-location error. Deduplicate IDs for efficient lookup. Do not change receiving quantities, accounting, or API shape. Do not add a new configuration/UI structure; this validates existing inputs, whose API errors are already exposed by receiving UI.

Tests must exercise the public createAndPostReceipt function with fully mocked DB/services: bad explicit header, bad PO default, valid header + wrong line warehouse, inactive location, foreign zone/warehouse tenant, and valid same-warehouse locations getting past the guard. Verify scoped query and zero allocateNumber/mutation calls on refusal. Mocks must not connect to DB or load environment secrets. Acceptance: focused Jest, full Jest regression, backend tsc. No real DB test required for this input containment patch.

Return ONE unified diff and short assumptions/unexecuted-checks report. You have zero tools; NEEDS_CONTEXT if required source is missing. No command execution, schema/migrations, commits/push, frontend or unrelated edits.

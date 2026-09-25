# Prospect to Quote: products on an opportunity, and document attachments (2026-09-18)

Catalog: 85 Prospect to Quote (lead, opportunity, quotation); 99 Administer to Operate (document
management). Requested by Kubi: "on a lead or opportunity I cannot say which items it is for, and I
cannot attach files — the quotation I sent has to be kept in the system (PDF, Word, TXT)".

## 1. Which products an opportunity is for — built

*repo-verified* — the schema already answers it the D365 finance-and-operations way: an opportunity
carries the estimate (`estimated_amount`, stage, probability) and its **quotations** carry the
product lines (`SalesQuotation` → lines with product, quantity, price, discount). Confirming a
quotation creates the sales order. What was missing was the screen: no page could create a
quotation, so an opportunity could never name a product.

*official documentation* — the quotation lifecycle Created → Sent → (Revised | Lost | Cancelled |
Confirmed), confirmation creating the sales order:
<https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/data-entities/add-efficiency-in-quote-to-cash-concept>.

Built: **New quotation** on an open opportunity — products, quantities, prices (defaulted from the
product's selling price), line discounts, validity date — on the existing `POST /sales/quotations`,
linked to the opportunity and its customer or lead. It opens the quotation, where sending,
revising and confirming already work.

*architectural recommendation* — no product lines on the opportunity itself. D365 Sales (the CE
app) has "opportunity products", but the F&O model this product follows keeps lines on the
quotation, and two places for the same lines would drift. A lead stays line-free, as in D365.

## 2. Document attachments — built 2026-09-18 (Kubi approved the bucket; migration 041)

*official documentation* — D365 document management attaches files to any record: **DocuRef** holds
the link from the record to the attachment, **DocuValue** points at the file, and files live in
**private** Azure Blob storage by default. Document types categorise attachments; parameters set
the allowed file types and the maximum file size; an attachment on a posted invoice cannot be
deleted: <https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/organization-administration/configure-document-management>.

### Decisions (Kubi, 2026-09-18)

1. A private bucket `attachments` was created on the TEST Supabase project (10 MB limit, the nine
   MIME types below). Verified: an object is reachable neither by its public URL nor without a
   signature (both 400).
2. Migration number: **041**, chosen by Claude. The migration chain must be gap-free and TEST's
   ledger ended at 040, so the next file could only be 041; WORK-050 and WORK-052 in the remediation
   plan move to 042 and 043 (noted there). Applied to TEST as `claude-2026-09-18-attachments`.

### Design as built

- Storage: private bucket `attachments`; object path `<tenant_id>/<entity_type>/<entity_id>/<uuid>`;
  downloads only through short-lived signed URLs issued by the API after a tenant and permission
  check. The file name the user uploaded is kept as metadata, never as the path.
- Migration `041_document_attachments.sql` (DocuRef equivalent, one polymorphic table so every
  document type gets attachments without its own table):

  | Column | Notes |
  |---|---|
  | `id`, `tenant_id` | `tenant_id` in every index |
  | `entity_type` | `LEAD`, `OPPORTUNITY`, `SALES_QUOTATION`, `SALES_ORDER`, `PURCHASE_ORDER`, `VENDOR_INVOICE`, `CUSTOMER`, `SUPPLIER` — CHECK constraint, extended by migration |
  | `entity_id` | uuid; referential check in the service (polymorphic, no FK) |
  | `document_type` | `FILE` (default) — hook for D365 document types |
  | `file_name`, `mime_type`, `size_bytes`, `storage_path` | |
  | `uploaded_by`, `uploaded_at` | |
  | `deleted_at`, `deleted_by` | soft delete; refused once the parent document is posted, as D365 does for invoices |

  Index `(tenant_id, entity_type, entity_id)`.
- Parameters (hook, defaults in code until a parameters row exists): allowed extensions
  `pdf, doc, docx, xls, xlsx, txt, csv, png, jpg, jpeg`; maximum size 10 MB.
- API: `GET/POST /attachments?entity_type=&entity_id=`, `GET /attachments/:id/download` (signed URL),
  `DELETE /attachments/:id`. Permission: read = the parent document's read permission; write =
  its maintain permission.
- UI: one `AttachmentsPanel` component with the count in its header (D365 shows 0–9 then "9+");
  placed on the lead, opportunity and quotation pages today.

### Verification

- `documentAttachments.test.ts` (7): permission follows the parent document, tenant check,
  type and size limits, ids-only storage path, signed download, posted-invoice lock, soft delete.
- e2e `18-attachments`: a text file is attached to an opportunity on screen, downloaded through its
  signed link with identical content, and removed — against the real bucket.
- Panels are on the lead, opportunity and quotation pages; the API accepts the other five entity
  types for the next screens.

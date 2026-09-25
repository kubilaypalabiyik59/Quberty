-- =============================================================================
-- 041  Document attachments
--
-- Files attached to business documents — a quotation as sent, a supplier's
-- contract, a signed delivery note. Nothing could be attached anywhere.
--
-- **[OFFICIAL]** D365 document management: DocuRef holds the link from a record
-- to its attachment and DocuValue points at the file, which lives outside the
-- database in private blob storage; parameters set the allowed file types and
-- the maximum size; an attachment on a posted invoice cannot be deleted:
--   learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/organization-administration/configure-document-management
--
-- document_attachments   the DocuRef equivalent, one polymorphic table so every
--                        document type gets attachments without a table of its
--                        own. The file is in the PRIVATE storage bucket
--                        `attachments` under <tenant>/<entity_type>/<entity_id>/<id>;
--                        it is served only through short-lived signed URLs.
--                        `entity_id` is checked in the service (polymorphic, no
--                        FK). Deletion is soft, so what was attached stays
--                        answerable.
--
-- Numbering: 041 was proposed for WORK-050 in REMEDIATION_PLAN_WORK-042_054.md;
-- the chain must be gap-free, so the next migration takes 042.
--
-- Design: docs/design/PROSPECT_TO_QUOTE_AND_ATTACHMENTS_2026-09-18.md
-- =============================================================================

CREATE TABLE "document_attachments" (
    "id"            UUID NOT NULL,
    "tenant_id"     UUID NOT NULL,
    "entity_type"   TEXT NOT NULL,
    "entity_id"     UUID NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'FILE',
    "file_name"     TEXT NOT NULL,
    "mime_type"     TEXT NOT NULL,
    "size_bytes"    INTEGER NOT NULL,
    "storage_path"  TEXT NOT NULL,
    "uploaded_by"   UUID,
    "uploaded_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"    TIMESTAMP(3),
    "deleted_by"    UUID,
    CONSTRAINT "document_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_attachments_entity_type_check" CHECK ("entity_type" IN (
      'LEAD', 'OPPORTUNITY', 'SALES_QUOTATION', 'SALES_ORDER',
      'PURCHASE_ORDER', 'VENDOR_INVOICE', 'CUSTOMER', 'SUPPLIER'
    )),
    CONSTRAINT "document_attachments_document_type_check" CHECK ("document_type" IN ('FILE')),
    CONSTRAINT "document_attachments_size_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "document_attachments_file_name_check" CHECK (length("file_name") BETWEEN 1 AND 255),
    CONSTRAINT "document_attachments_deleted_check" CHECK (("deleted_at" IS NULL) = ("deleted_by" IS NULL))
);

CREATE INDEX "document_attachments_entity_idx"
  ON "document_attachments"("tenant_id", "entity_type", "entity_id");
CREATE UNIQUE INDEX "document_attachments_storage_path_key"
  ON "document_attachments"("storage_path");

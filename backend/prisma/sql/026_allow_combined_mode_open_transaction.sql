-- In the legacy combined receipt/invoice mode, accounts payable is posted by
-- one or more product-receipt vouchers. The later vendor invoice intentionally
-- has no single journal entry. Its AP open transaction therefore keeps the
-- invoice as its source document and leaves this one-to-one voucher FK NULL.
ALTER TABLE "vendor_open_transactions"
  ALTER COLUMN "journal_entry_id" DROP NOT NULL;

-- Recording money that arrived offline.
--
-- The PHP admin's payments page exists because Sendy has no online gateway on
-- the website: ops marks an order paid once cash is handed over or a transfer
-- lands, and that page is the only record of what the business has collected.
-- Nothing in this schema could express it — every Payment row assumed a gateway
-- created it.
--
-- Additive only. The new enum value extends PaymentProvider, the two new
-- columns are nullable, and existing payments keep reading exactly as before
-- (a NULL recordedByAdminId is how a gateway payment is told apart from a
-- hand-entered one).

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'BANK_TRANSFER';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "recordedByAdminId" TEXT,
                       ADD COLUMN "note" TEXT;

-- CreateIndex
-- The ledger reads newest-first, optionally filtered by status.
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- AddForeignKey
-- SET NULL: a staff member leaving must not delete the record of money the
-- company took.
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedByAdminId_fkey" FOREIGN KEY ("recordedByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Lets the website's booking endpoint be retried safely.
--
-- A client that times out waiting for a reply cannot know whether the order was
-- created — the request may well have succeeded after it gave up. The customer
-- then books again, and one errand becomes two orders. Keying the create on a
-- value the caller can reproduce makes the retry return the original instead.
--
-- Additive only. The column is nullable, and Postgres permits any number of
-- NULLs in a unique index, so every existing order and every order the app
-- creates is unaffected.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

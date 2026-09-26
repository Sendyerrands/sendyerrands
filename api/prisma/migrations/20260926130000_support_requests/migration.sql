-- Support requests from the website.
--
-- Deliberately not a ticket thread. The PHP site had threaded tickets with
-- replies and used them twice; support actually happens on WhatsApp and in the
-- Zoho inbox that holds the root MX for the domain. This records what came in
-- and lets ops track whether it has been dealt with, instead of rebuilding a
-- messaging product nobody used.
--
-- Entirely new. Nothing existing is altered.

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('ORDER_ISSUE', 'MISSING_ITEM', 'DELIVERY_PROBLEM', 'REFUND_REQUEST', 'PAYMENT_ISSUE', 'GENERAL');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "support_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "subject" TEXT NOT NULL,
    "category" "SupportCategory" NOT NULL DEFAULT 'GENERAL',
    "message" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "readAt" TIMESTAMP(3),
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_requests_reference_key" ON "support_requests"("reference");

-- CreateIndex
CREATE INDEX "support_requests_status_createdAt_idx" ON "support_requests"("status", "createdAt");

-- AddForeignKey
-- SET NULL on both: someone can ask for help without an account, and a request
-- should outlive the order it happened to be about.
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

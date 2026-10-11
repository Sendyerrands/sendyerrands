-- Services grow three charges, optional packages, and their own payouts.
--
-- Additive only: one new enum, three new tables, and new columns that are
-- either nullable or carry a DEFAULT. Nothing existing is altered or dropped,
-- so the database can run ahead of the deployed code.
--
-- Note what is NOT here: service_details."arrivalFeeKobo" is left exactly as it
-- is. The flat bike/car arrival fee stops being charged, but orders taken under
-- that model must keep saying what they actually charged, so the column stays
-- and new rows simply write 0 into it.

-- CreateEnum
-- Fixed rungs so a customer comparing two providers compares like with like.
-- What sits inside a tier is the provider's own words.
CREATE TYPE "PackageTier" AS ENUM ('BASIC', 'STANDARD', 'VIP');

-- AlterTable
-- A payout destination, same shape as riders'. Needed now because Sendy
-- collects the customer's money and owes the provider theirs; under the old
-- direct-to-provider model there was nothing to pay out.
ALTER TABLE "service_providers"
  ADD COLUMN "bankCode"              TEXT,
  ADD COLUMN "bankAccountNo"         TEXT,
  ADD COLUMN "bankName"              TEXT,
  ADD COLUMN "bankAccountName"       TEXT,
  ADD COLUMN "paystackRecipientCode" TEXT;

-- AlterTable
-- The three charges, snapshotted per booking. Stored apart rather than as one
-- total so a receipt can show which charge a number came from.
ALTER TABLE "service_details"
  ADD COLUMN "serviceFeeKobo"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "serviceChargeKobo" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transportKobo"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "packageId"         TEXT;

-- AlterTable
-- Proposed tiers travel on the application as JSON. They become rows only when
-- ops approve, so a rejected application leaves no bookable packages behind.
ALTER TABLE "provider_applications"
  ADD COLUMN "packages" JSONB;

-- CreateTable
CREATE TABLE "service_packages" (
    "id"          TEXT NOT NULL,
    "providerId"  TEXT NOT NULL,
    "tier"        "PackageTier" NOT NULL,
    "name"        TEXT,
    "description" TEXT NOT NULL,
    "priceKobo"   INTEGER NOT NULL,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id")
);

-- One row per tier per provider: two "VIP"s would be a pricing bug.
CREATE UNIQUE INDEX "service_packages_providerId_tier_key"
  ON "service_packages"("providerId", "tier");
CREATE INDEX "service_packages_providerId_isActive_idx"
  ON "service_packages"("providerId", "isActive");

-- CreateTable
CREATE TABLE "provider_earnings" (
    "id"         TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "orderId"    TEXT NOT NULL,
    "grossKobo"  INTEGER NOT NULL,
    "feesKobo"   INTEGER NOT NULL,
    "netKobo"    INTEGER NOT NULL,
    "isPaidOut"  BOOLEAN NOT NULL DEFAULT false,
    "paidOutAt"  TIMESTAMP(3),
    "payoutId"   TEXT,
    "voidedAt"   TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_earnings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_earnings_orderId_key" ON "provider_earnings"("orderId");
CREATE INDEX "provider_earnings_providerId_createdAt_idx" ON "provider_earnings"("providerId", "createdAt");
CREATE INDEX "provider_earnings_providerId_isPaidOut_idx" ON "provider_earnings"("providerId", "isPaidOut");
CREATE INDEX "provider_earnings_payoutId_idx" ON "provider_earnings"("payoutId");

-- CreateTable
CREATE TABLE "provider_payouts" (
    "id"              TEXT NOT NULL,
    "providerId"      TEXT NOT NULL,
    "amountKobo"      INTEGER NOT NULL,
    "status"          "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "reference"       TEXT NOT NULL,
    "transferCode"    TEXT,
    "recipientCode"   TEXT,
    "bankName"        TEXT,
    "bankAccountNo"   TEXT,
    "failureReason"   TEXT,
    "providerPayload" JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt"       TIMESTAMP(3),

    CONSTRAINT "provider_payouts_pkey" PRIMARY KEY ("id")
);

-- The idempotency key. Unique so the database refuses a duplicate transfer
-- even if the application logic slips.
CREATE UNIQUE INDEX "provider_payouts_reference_key" ON "provider_payouts"("reference");
CREATE INDEX "provider_payouts_providerId_createdAt_idx" ON "provider_payouts"("providerId", "createdAt");
CREATE INDEX "provider_payouts_status_idx" ON "provider_payouts"("status");

-- AddForeignKey
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: retiring a package must not delete the bookings made
-- against it.
ALTER TABLE "service_details" ADD CONSTRAINT "service_details_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "service_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "service_details_packageId_idx" ON "service_details"("packageId");

ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL so a failed transfer returns the earning to the payable pool rather
-- than losing it inside a payout that never happened.
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "provider_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_payouts" ADD CONSTRAINT "provider_payouts_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Services: someone comes to you and does the job.
--
-- A fifth pillar alongside food, marketplace, errands and packages. It borrows
-- the errand's negotiation machinery wholesale — the provider names a price
-- once they can see what the job is, the customer accepts or walks away, and
-- the money for the work goes to the provider directly. Sendy charges only for
-- getting them to the door.
--
-- Additive only. One new enum value, one new enum, two new tables. Nothing
-- existing is altered, so every current row and query reads exactly as before.
--
-- ServiceProvider is deliberately not a flag on vendors. A vendor sells stock
-- from a shopfront with a menu, a delivery fee and opening hours; a provider
-- sells an hour of their time, holds no inventory, and cannot quote until they
-- know what the job is. Sharing one table would leave half its columns
-- meaningless on every row of the other kind.

-- AlterEnum
-- Safe inside the migration's transaction on PG 12+: the value is added here
-- and first *used* by application code afterwards, never in this statement.
ALTER TYPE "OrderType" ADD VALUE 'SERVICE';

-- AlterEnum
-- Providers claim an ops-created account through the password-reset flow, the
-- same way vendors do, so that flow needs a purpose of its own. Without it a
-- provider's reset code would be indistinguishable from a vendor's.
ALTER TYPE "OtpPurpose" ADD VALUE 'PROVIDER_PASSWORD_RESET';

-- CreateEnum
-- How the provider travels. Not cosmetic — it is the one thing Sendy actually
-- charges for on a service booking.
CREATE TYPE "ArrivalMode" AS ENUM ('BIKE', 'CAR');

-- CreateTable
CREATE TABLE "service_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "bio" TEXT,
    "tags" TEXT[],
    "area" TEXT,
    "state" TEXT NOT NULL DEFAULT 'Lagos',
    "phone" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "avatarUrl" TEXT,
    -- Per provider, not global: one two streets away and one across the lagoon
    -- do not cost the same to send.
    "bikeFeeKobo" INTEGER NOT NULL DEFAULT 100000,
    "carFeeKobo" INTEGER NOT NULL DEFAULT 250000,
    -- False for anyone whose kit will not fit on a bike.
    "canTravelByBike" BOOLEAN NOT NULL DEFAULT true,
    "typicalMinMinutes" INTEGER NOT NULL DEFAULT 30,
    "typicalMaxMinutes" INTEGER NOT NULL DEFAULT 60,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_details" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "details" TEXT,
    "address" TEXT NOT NULL,
    "landmark" TEXT,
    "arrivalMode" "ArrivalMode" NOT NULL,
    -- Copied at booking rather than read back from the provider, so a later
    -- price change cannot rewrite what someone was already charged.
    "arrivalFeeKobo" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "budgetKobo" INTEGER,
    "quotedKobo" INTEGER,
    "paidProviderAt" TIMESTAMP(3),
    "paymentProofUrl" TEXT,
    "enRouteAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_providers_slug_key" ON "service_providers"("slug");
CREATE UNIQUE INDEX "service_providers_phone_key" ON "service_providers"("phone");
CREATE UNIQUE INDEX "service_providers_email_key" ON "service_providers"("email");
-- Browse is always "barbers near me": category first, then category by state.
CREATE INDEX "service_providers_category_idx" ON "service_providers"("category");
CREATE INDEX "service_providers_state_category_idx" ON "service_providers"("state", "category");

-- CreateIndex
CREATE UNIQUE INDEX "service_details_orderId_key" ON "service_details"("orderId");
CREATE INDEX "service_details_providerId_idx" ON "service_details"("providerId");

-- AddForeignKey
-- CASCADE from the order, like errand_details: the detail has no meaning
-- without the order it describes.
ALTER TABLE "service_details" ADD CONSTRAINT "service_details_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT from the provider: deleting someone who has done work would erase
-- the record of jobs that were actually performed and paid for.
ALTER TABLE "service_details" ADD CONSTRAINT "service_details_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "service_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

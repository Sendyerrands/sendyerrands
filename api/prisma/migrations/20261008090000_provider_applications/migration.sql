-- Applying to become a service provider.
--
-- Mirrors vendor_applications: nobody self-registers as a provider either.
-- They apply, ops reviews, and approving the application is what creates the
-- service_providers row — which is why providerId is nullable and unique here
-- rather than required.
--
-- Additive only: one new table, two new foreign keys, nothing altered.
--
-- Reuses "VendorApplicationStatus" rather than creating a second enum with the
-- same three values. Renaming that type to something neutral would mean a
-- migration touching live columns purely for a naming improvement.

-- CreateTable
CREATE TABLE "provider_applications" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Lagos',
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "bio" TEXT,
    "tags" TEXT[],
    -- Asked at application time: it decides which arrival options a customer
    -- is ever shown for this provider.
    "canTravelByBike" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "status" "VendorApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "applicantId" TEXT,
    "providerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One application per provider: approving twice would be a second listing.
CREATE UNIQUE INDEX "provider_applications_providerId_key" ON "provider_applications"("providerId");
-- The onboarding queue reads pending-first, oldest-first.
CREATE INDEX "provider_applications_status_createdAt_idx" ON "provider_applications"("status", "createdAt");

-- AddForeignKey
-- SET NULL on the applicant: a customer deleting their account must not erase
-- the record of an application ops may already have acted on.
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SET NULL on the provider too: removing a provider leaves the application
-- history intact rather than cascading it away.
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "service_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Account suspension, for every kind of account a human signs into.
--
-- Additive only: four tables gain two nullable columns each. Nothing is
-- rewritten, no default is backfilled, and every existing row reads as
-- "not suspended" because NULL is exactly that.
--
-- Why a timestamp rather than a boolean: "when" answers the question ops
-- actually asks when a partner rings up complaining, and a boolean would have
-- needed a second column to carry it anyway.
--
-- Riders already had a SUSPENDED status and customers an isActive flag. Those
-- stay, and the suspend endpoint keeps them in step, because dispatch and the
-- login path already read them. suspendedAt is what the auth layer checks, so
-- there is one answer to "may this account be used" rather than four.

ALTER TABLE "users" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "suspendedReason" TEXT;

ALTER TABLE "riders" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "riders" ADD COLUMN "suspendedReason" TEXT;

ALTER TABLE "vendors" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "vendors" ADD COLUMN "suspendedReason" TEXT;

ALTER TABLE "service_providers" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "service_providers" ADD COLUMN "suspendedReason" TEXT;

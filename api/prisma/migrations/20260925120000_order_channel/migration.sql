-- Adds the channel an order arrived through, so website bookings and app
-- orders can be told apart in the admin dashboard.
--
-- Deliberately additive only: the column carries a default, so every existing
-- row reads APP without a backfill and every current create path keeps working
-- untouched. Nothing is altered or dropped.

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('APP', 'WEB');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'APP';

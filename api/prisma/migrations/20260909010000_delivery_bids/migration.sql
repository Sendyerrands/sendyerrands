-- CreateEnum
CREATE TYPE "DeliveryBidStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "delivery_bids" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "priceKobo" INTEGER NOT NULL,
    "note" TEXT,
    "status" "DeliveryBidStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_bids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_bids_orderId_priceKobo_idx" ON "delivery_bids"("orderId", "priceKobo");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_bids_orderId_riderId_key" ON "delivery_bids"("orderId", "riderId");

-- AddForeignKey
ALTER TABLE "delivery_bids" ADD CONSTRAINT "delivery_bids_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_bids" ADD CONSTRAINT "delivery_bids_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


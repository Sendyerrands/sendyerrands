import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

/**
 * Removes accounts left behind by an interrupted test run.
 *
 * The test scripts clean up in a `finally`, but that block needs the database
 * too — when the connection is what failed, the cleanup fails with it and the
 * rows stay. This is the broom for that case.
 *
 * Scoped to the `.invalid` TLD, which RFC 2606 reserves precisely so it can
 * never belong to anyone. A real customer cannot match this filter.
 */
const prisma = new PrismaClient();

const TEST_PATTERN = { contains: '@example.invalid' };

async function main() {
  const users = await prisma.user.findMany({
    where: { email: TEST_PATTERN },
    select: { id: true, email: true },
  });
  const riders = await prisma.rider.findMany({
    where: { email: TEST_PATTERN },
    select: { id: true, email: true },
  });

  if (!users.length && !riders.length) {
    console.log('\n  Nothing to clean up.\n');
    return;
  }

  console.log(`\n  ${users.length} test customer(s), ${riders.length} test rider(s)\n`);

  for (const u of users) {
    const orders = await prisma.order.findMany({ where: { customerId: u.id }, select: { id: true } });
    for (const o of orders) {
      await prisma.deliveryBid.deleteMany({ where: { orderId: o.id } });
      await prisma.notification.deleteMany({ where: { orderId: o.id } });
      await prisma.orderEvent.deleteMany({ where: { orderId: o.id } });
      await prisma.riderEarning.deleteMany({ where: { orderId: o.id } });
      await prisma.packageDetail.deleteMany({ where: { orderId: o.id } });
      await prisma.errandDetail.deleteMany({ where: { orderId: o.id } });
      await prisma.payment.deleteMany({ where: { orderId: o.id } });
      await prisma.order.delete({ where: { id: o.id } }).catch(() => {});
    }
    await prisma.notification.deleteMany({ where: { userId: u.id } });
    await prisma.address.deleteMany({ where: { userId: u.id } });
    await prisma.walletTransaction.deleteMany({ where: { userId: u.id } });
    await prisma.favourite.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    console.log(`  removed customer ${u.email} (${orders.length} order(s))`);
  }

  for (const r of riders) {
    await prisma.deliveryBid.deleteMany({ where: { riderId: r.id } });
    await prisma.riderEarning.deleteMany({ where: { riderId: r.id } });
    await prisma.payout.deleteMany({ where: { riderId: r.id } });
    await prisma.riderDocument.deleteMany({ where: { riderId: r.id } });
    await prisma.rider.delete({ where: { id: r.id } }).catch(() => {});
    console.log(`  removed rider ${r.email}`);
  }

  console.log();
}

main()
  .catch((e) => console.error('\n  ✗', e instanceof Error ? e.message : e, '\n'))
  .finally(() => prisma.$disconnect());

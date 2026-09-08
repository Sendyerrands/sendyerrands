import { randomBytes } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { conflict, notFound, unauthorized } from '@/lib/errors';
import { formatNaira } from '@/lib/money';
import { hashPassword, verifyPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';
import { asyncHandler, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';

export const meRouter = Router();

meRouter.use(requireAuth('customer'));

const profileSchema = z.object({
  firstName: z.string().min(2).max(40).optional(),
  lastName: z.string().min(2).max(40).optional(),
  email: z.string().email().optional(),
});

const addressSchema = z.object({
  label: z.string().min(1).max(30),
  line1: z.string().min(4).max(160),
  line2: z.string().max(160).optional(),
  city: z.string().max(60).default('Lagos'),
  landmark: z.string().max(160).optional(),
  contact: z.string().min(2).max(80),
  phone: z.string().min(10).max(20),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isDefault: z.boolean().default(false),
});

/** GET /me */
meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.id },
      select: {
        id: true, phone: true, firstName: true, lastName: true, email: true,
        walletBalanceKobo: true, referralCode: true, createdAt: true,
      },
    });
    if (!user) throw notFound('Account');
    res.json({ data: user });
  })
);

/** PATCH /me */
meRouter.patch(
  '/',
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.auth!.id },
      data: req.body,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });
    res.json({ data: user });
  })
);

/** GET /me/addresses */
meRouter.get(
  '/addresses',
  asyncHandler(async (req, res) => {
    const addresses = await prisma.address.findMany({
      where: { userId: req.auth!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ data: addresses });
  })
);

/** POST /me/addresses */
meRouter.post(
  '/addresses',
  validate(addressSchema),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.id;
    const body = req.body as z.infer<typeof addressSchema>;

    const address = await prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      // First address is always the default, whatever the client sent.
      const isDefault = count === 0 ? true : body.isDefault;

      if (isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.create({ data: { ...body, isDefault, userId } });
    });

    res.status(201).json({ data: address });
  })
);

/** PATCH /me/addresses/:id */
meRouter.patch(
  '/addresses/:id',
  validate(addressSchema.partial()),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.id;
    const id = req.params.id!;

    const existing = await prisma.address.findFirst({ where: { id, userId } });
    if (!existing) throw notFound('Address');

    const body = req.body as Partial<z.infer<typeof addressSchema>>;

    const address = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.update({ where: { id }, data: body });
    });

    res.json({ data: address });
  })
);

/** DELETE /me/addresses/:id */
meRouter.delete(
  '/addresses/:id',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.id;
    const id = req.params.id!;

    const existing = await prisma.address.findFirst({ where: { id, userId } });
    if (!existing) throw notFound('Address');

    await prisma.address.delete({ where: { id } });

    // Never leave the account without a default.
    if (existing.isDefault) {
      const next = await prisma.address.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
      if (next) await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }

    res.status(204).send();
  })
);

/** GET /me/wallet — balance plus a paginated statement. */
meRouter.get(
  '/wallet',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.id;
    const take = Math.min(Number(req.query.limit ?? 30), 100);

    const [user, transactions] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { walletBalanceKobo: true } }),
      prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ]);

    if (!user) throw notFound('Account');
    res.json({ data: { balanceKobo: user.walletBalanceKobo, transactions } });
  })
);

/**
 * Accepts either a cuid or a slug, like GET /vendors/:slug already does.
 *
 * The app identifies a vendor by its slug — `toVendor` maps `id: slug || id`,
 * so every screen holds "mama-nkechi" rather than a cuid. Requiring the
 * database id here meant the heart on a vendor card always 404'd, while a test
 * that passed real ids straight from Prisma passed happily. Taking either is
 * both the fix and the consistent behaviour.
 */
async function resolveVendor(idOrSlug: string) {
  const vendor = await prisma.vendor.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: { id: true, slug: true },
  });
  if (!vendor) throw notFound('Vendor');
  return vendor;
}

/**
 * GET /me/favourites — vendors this customer saved.
 *
 * Returns whole vendor rows rather than ids: the Favourites screen renders the
 * same VendorCard as Home, and a list of ids would mean a second round trip
 * per card on a connection where that is exactly what to avoid.
 */
meRouter.get(
  '/favourites',
  asyncHandler(async (req, res) => {
    const favourites = await prisma.favourite.findMany({
      where: { userId: req.auth!.id },
      orderBy: { createdAt: 'desc' },
      include: { vendor: true },
    });

    res.json({ data: favourites.map((f) => f.vendor) });
  })
);

/**
 * PUT /me/favourites/:vendorId — save a vendor. Idempotent.
 *
 * A double tap on the heart, or a retry after a flaky request, must not be an
 * error: the unique constraint on (userId, vendorId) makes the second write a
 * no-op rather than a 409 the UI would have to explain.
 */
meRouter.put(
  '/favourites/:vendorId',
  asyncHandler(async (req, res) => {
    const vendor = await resolveVendor(req.params.vendorId!);

    await prisma.favourite.upsert({
      where: { userId_vendorId: { userId: req.auth!.id, vendorId: vendor.id } },
      create: { userId: req.auth!.id, vendorId: vendor.id },
      update: {},
    });

    res.json({ data: { vendorId: vendor.id, slug: vendor.slug, saved: true } });
  })
);

/** DELETE /me/favourites/:vendorId — unsave. Also idempotent. */
meRouter.delete(
  '/favourites/:vendorId',
  asyncHandler(async (req, res) => {
    const vendor = await resolveVendor(req.params.vendorId!);

    // deleteMany, not delete: removing something already gone is success here,
    // not a 404 the heart would have to render as a failure.
    await prisma.favourite.deleteMany({ where: { userId: req.auth!.id, vendorId: vendor.id } });

    res.json({ data: { vendorId: vendor.id, slug: vendor.slug, saved: false } });
  })
);

/**
 * POST /me/delete — close the account.
 *
 * Required by Google Play's User Data policy, which wants deletion reachable
 * from inside the app as well as from a web page. The web half lives at
 * sendyerrands.com/delete-account.html.
 *
 * Anonymises rather than deletes the row. Every order, payment and wallet entry
 * carries userId, and a real DELETE either cascades away the ledger — losing
 * records we are required to keep for accounting and chargebacks — or fails on
 * a foreign key. Blanking the personal columns removes the person while leaving
 * the transactions, which is what the privacy policy promises and what the
 * accountant needs.
 */
meRouter.post(
  '/delete',
  validate(z.object({ password: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const { password } = req.body as { password: string };

    const user = await prisma.user.findUnique({ where: { id: req.auth!.id } });
    if (!user) throw notFound('Account not found.');

    // Re-authenticate. A stolen unlocked phone should not be able to close
    // someone's account and take the audit trail with it.
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw unauthorized('That password is not correct.');
    }

    /**
     * Refuse for a stated reason rather than deleting into a mess.
     *
     * An order still running has a rider attached to it and money in flight;
     * a positive balance is the customer's money. Both are cases where silently
     * proceeding would be worse than saying no.
     */
    const activeOrders = await prisma.order.count({
      where: { customerId: user.id, status: { notIn: ['DELIVERED', 'CANCELLED', 'REFUNDED'] } },
    });

    if (activeOrders > 0) {
      throw conflict(
        activeOrders === 1
          ? 'You have an order still in progress. It has to finish or be cancelled first.'
          : `You have ${activeOrders} orders still in progress. They have to finish or be cancelled first.`
      );
    }

    if (user.walletBalanceKobo > 0) {
      throw conflict(
        `Your wallet still holds ${formatNaira(user.walletBalanceKobo)}. Spend it or contact support to withdraw it before closing your account.`
      );
    }

    // Unique columns need unique replacements, or the second person to delete
    // an account collides with the first. The cuid is already unique per row.
    const tag = user.id;

    await prisma.$transaction(async (tx) => {
      // Saved addresses and favourites are purely personal — nothing downstream
      // references them, so these are real deletes rather than anonymisation.
      await tx.address.deleteMany({ where: { userId: user.id } });
      await tx.favourite.deleteMany({ where: { userId: user.id } });

      await tx.user.update({
        where: { id: user.id },
        data: {
          email: `deleted-${tag}@deleted.invalid`,
          phone: `deleted-${tag}`,
          firstName: 'Deleted',
          lastName: 'account',
          // A hash of a value nobody holds. Not an empty string: bcrypt.compare
          // against '' is a cheap true for some inputs, and a blank hash would
          // sit in the column looking like a bug rather than a decision.
          passwordHash: await hashPassword(randomBytes(32).toString('hex')),
          referralCode: `DELETED-${tag}`,
          referredByCode: null,
          isActive: false,
        },
      });
    });

    // 200 with a body rather than 204: the app needs to tell someone it worked
    // before it signs them out, and an empty response gives it nothing to say.
    res.json({ data: { deleted: true } });
  })
);

/**
 * GET /me/notifications — the bell.
 *
 * Returns the list and the unread count together. The badge and the screen are
 * the same question asked twice, and splitting them into two endpoints means a
 * badge that disagrees with the list someone is looking at.
 */
meRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.id;

    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        // A cap, not pagination. Nobody scrolls a year of delivery updates, and
        // an unbounded query on a busy account is a slow screen.
        take: 50,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    res.json({ data: { items, unread } });
  })
);

/**
 * POST /me/notifications/read — mark one, or all.
 *
 * updateMany scoped to this user: passing someone else's id marks nothing
 * rather than failing, which is the right shape for an endpoint whose only
 * effect is clearing a badge.
 */
meRouter.post(
  '/notifications/read',
  validate(z.object({ id: z.string().min(1).optional() })),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.id;
    const { id } = req.body as { id?: string };

    const { count } = await prisma.notification.updateMany({
      where: { userId, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });

    const unread = await prisma.notification.count({ where: { userId, readAt: null } });

    res.json({ data: { marked: count, unread } });
  })
);

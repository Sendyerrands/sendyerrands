import { Router } from 'express';
import { z } from 'zod';

import { conflict, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { asyncHandler, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';
import { isOwnCloudinaryUrl } from '@/services/cloudinary';
import { transitionOrder } from '@/services/orders';

export const vendorRouter = Router();

vendorRouter.use(requireAuth('vendor'));

/**
 * Everything a vendor may change about a listing.
 *
 * `vendorId` is deliberately absent: it comes from the token, never the body.
 * Accepting it would let any signed-in vendor write products into a competitor's
 * catalogue by changing one field.
 */
const productSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  // Naira never crosses this boundary. See lib/money.ts.
  priceKobo: z.number().int().min(100, 'Price must be at least ₦1.'),
  section: z.string().max(60).optional(),
  badge: z.string().max(30).optional(),
  /**
   * Nullable as well as optional, so a vendor can take a photo down.
   *
   * Optional alone means "leave it as it is" — there was no value that meant
   * "remove it": null failed the string check and "" failed the url check. A
   * listing whose photo was wrong, stale or simply bad could have its price and
   * name corrected and was stuck with the picture forever.
   */
  imageUrl: z.string().url().nullable().optional(),
  isMarketplace: z.boolean().default(false),
  inStock: z.boolean().default(true),
});

/** Fields may arrive one at a time from a toggle, so everything is optional. */
const productPatchSchema = productSchema.partial();

/** GET /vendor/me — who is signed in, plus the counts the dashboard shows. */
vendorRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.auth!.id },
      include: { _count: { select: { products: true, orders: true } } },
    });
    if (!vendor) throw notFound('Vendor');

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayOrders, awaiting] = await Promise.all([
      prisma.order.aggregate({
        where: {
          vendorId: vendor.id,
          createdAt: { gte: todayStart },
          status: { notIn: ['CANCELLED', 'REFUNDED', 'PENDING_PAYMENT'] },
        },
        _sum: { subtotalKobo: true },
        _count: true,
      }),
      prisma.order.count({ where: { vendorId: vendor.id, status: 'PLACED' } }),
    ]);

    res.json({
      data: {
        ...vendor,
        today: { salesKobo: todayOrders._sum.subtotalKobo ?? 0, orders: todayOrders._count },
        awaitingAcceptance: awaiting,
      },
    });
  })
);

/** PATCH /vendor/me — the open/closed switch. */
vendorRouter.patch(
  '/me',
  validate(z.object({ isOpen: z.boolean() })),
  asyncHandler(async (req, res) => {
    const { isOpen } = req.body as { isOpen: boolean };

    const vendor = await prisma.vendor.findUnique({
      where: { id: req.auth!.id },
      select: { isVerified: true },
    });
    if (!vendor) throw notFound('Vendor');

    /**
     * Opening requires verification, mirroring the rider availability rule.
     * An unverified vendor is invisible to customers anyway (see the isVerified
     * filter on GET /vendors), so letting them "open" would be a switch that
     * changes nothing and implies they are trading.
     */
    if (isOpen && !vendor.isVerified) {
      throw conflict('You can open for orders once Sendy Errands has verified your business.');
    }

    const updated = await prisma.vendor.update({
      where: { id: req.auth!.id },
      data: { isOpen },
      select: { id: true, isOpen: true },
    });

    res.json({ data: updated });
  })
);

/** GET /vendor/products — this vendor's catalogue. */
vendorRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const products = await prisma.product.findMany({
      where: { vendorId: req.auth!.id },
      orderBy: [{ section: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { orderItems: true } } },
    });

    res.json({ data: products });
  })
);

/** POST /vendor/products — add a listing. */
vendorRouter.post(
  '/products',
  validate(productSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productSchema>;

    /**
     * Only accept images we host.
     *
     * imageUrl is a free-text URL from the client, so without this a vendor
     * could point a listing at any address on the internet — hotlinking someone
     * else's bandwidth at best, and putting arbitrary remote content in front
     * of customers at worst.
     */
    if (body.imageUrl && !isOwnCloudinaryUrl(body.imageUrl)) {
      throw conflict('Upload the image through Sendy Errands rather than linking to one elsewhere.');
    }

    const product = await prisma.product.create({
      data: { ...body, vendorId: req.auth!.id },
    });

    res.status(201).json({ data: product });
  })
);

/** PATCH /vendor/products/:id — edit price, stock, anything. */
vendorRouter.patch(
  '/products/:id',
  validate(productPatchSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productPatchSchema>;

    if (body.imageUrl && !isOwnCloudinaryUrl(body.imageUrl)) {
      throw conflict('Upload the image through Sendy Errands rather than linking to one elsewhere.');
    }

    // Scoped by vendorId, not just id: without it a vendor could edit any
    // product in the database by guessing a cuid.
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id!, vendorId: req.auth!.id },
      select: { id: true },
    });
    if (!existing) throw notFound('Listing');

    const product = await prisma.product.update({ where: { id: existing.id }, data: body });

    res.json({ data: product });
  })
);

/**
 * DELETE /vendor/products/:id — remove a listing.
 *
 * Safe as a hard delete: OrderItem keeps the name and unit price charged at the
 * time and its productId is ON DELETE SET NULL, so a vendor deleting an old
 * item cannot rewrite what a customer already paid for.
 */
vendorRouter.delete(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id!, vendorId: req.auth!.id },
      select: { id: true, name: true },
    });
    if (!product) throw notFound('Listing');

    await prisma.product.delete({ where: { id: product.id } });

    res.json({ data: { id: product.id, name: product.name } });
  })
);

/** GET /vendor/orders?status=new|active|history */
vendorRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const filter = String(req.query.status ?? 'all');

    const ACTIVE = ['VENDOR_ACCEPTED', 'RIDER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] as const;
    const DONE = ['DELIVERED', 'CANCELLED', 'REFUNDED'] as const;

    const orders = await prisma.order.findMany({
      where: {
        vendorId: req.auth!.id,
        ...(filter === 'new'
          ? { status: 'PLACED' }
          : filter === 'active'
            ? { status: { in: [...ACTIVE] } }
            : filter === 'history'
              ? { status: { in: [...DONE] } }
              : // PENDING_PAYMENT is never shown: the customer has not paid, so
                // there is nothing for the vendor to act on yet.
                { status: { not: 'PENDING_PAYMENT' } }),
      },
      include: {
        items: { select: { id: true, name: true, quantity: true, unitPriceKobo: true, note: true } },
        customer: { select: { firstName: true, lastName: true, phone: true } },
        address: { select: { line1: true, city: true, landmark: true } },
        rider: { select: { firstName: true, lastName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ data: orders });
  })
);

/** POST /vendor/orders/:id/accept — confirm you can fulfil it. */
vendorRouter.post(
  '/orders/:id/accept',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, vendorId: req.auth!.id },
      select: { id: true, status: true },
    });
    if (!order) throw notFound('Order');
    if (order.status !== 'PLACED') {
      throw conflict(`This order is already ${order.status.toLowerCase().replace(/_/g, ' ')}.`);
    }

    const updated = await transitionOrder(order.id, 'VENDOR_ACCEPTED', {
      type: 'vendor',
      id: req.auth!.id,
    });

    res.json({ data: updated });
  })
);

/** POST /vendor/orders/:id/reject — cannot fulfil, with a reason. */
vendorRouter.post(
  '/orders/:id/reject',
  validate(z.object({ reason: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as { reason?: string };

    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, vendorId: req.auth!.id },
      select: { id: true, status: true },
    });
    if (!order) throw notFound('Order');

    // Only before a rider is involved: once someone is riding for this order,
    // cancelling it is an ops decision with a refund attached, not a tap.
    if (order.status !== 'PLACED') {
      throw conflict('This order has already moved on. Contact Sendy Errands support to cancel it.');
    }

    const updated = await transitionOrder(
      order.id,
      'CANCELLED',
      { type: 'vendor', id: req.auth!.id },
      // Who cancelled is already on the event as actorType: 'vendor' — the
      // order row only needs the reason.
      { note: reason, extra: { cancelReason: reason } }
    );

    res.json({ data: updated });
  })
);

import { Router } from 'express';
import { z } from 'zod';

import { notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { asyncHandler, validate } from '@/middleware';

export const vendorsRouter = Router();

const listQuery = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
  openOnly: z.coerce.boolean().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  sort: z.enum(['recommended', 'fastest', 'rating', 'fee']).default('recommended'),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

/** GET /vendors — the Home rails and the category listing both read from here. */
vendorsRouter.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;

    const orderBy =
      q.sort === 'fastest'
        ? { etaMinMinutes: 'asc' as const }
        : q.sort === 'rating'
          ? { rating: 'desc' as const }
          : q.sort === 'fee'
            ? { deliveryFeeKobo: 'asc' as const }
            : [{ isOpen: 'desc' as const }, { rating: 'desc' as const }];

    const vendors = await prisma.vendor.findMany({
      where: {
        /**
         * Customers only ever see verified vendors.
         *
         * Approving a vendor application creates the Vendor row before anyone
         * has added its catalogue or set its delivery fee, so without this an
         * approved applicant would appear in browse the same second — an empty
         * storefront a customer can tap into. Verification is the switch ops
         * flips when a vendor is genuinely ready to take orders.
         */
        isVerified: true,
        /* A suspended account is not shown to customers. `suspendedAt` is
           the only thing a suspension writes, so this filter is what makes it
           visible here - see src/lib/suspension.ts. */
        suspendedAt: null,
        ...(q.openOnly ? { isOpen: true } : {}),
        ...(q.minRating ? { rating: { gte: q.minRating } } : {}),
        ...(q.tag ? { tags: { has: q.tag } } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' as const } },
                { tags: { has: q.q } },
              ],
            }
          : {}),
      },
      orderBy,
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = vendors.length > q.limit;
    const page = hasMore ? vendors.slice(0, q.limit) : vendors;

    res.json({
      data: page,
      meta: { hasMore, nextCursor: hasMore ? page[page.length - 1]?.id : null },
    });
  })
);

/** GET /vendors/:slug — vendor detail with its catalogue, grouped by section. */
vendorsRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const slug = req.params.slug!;

    const vendor = await prisma.vendor.findFirst({
      // Suspended reads as gone, not as a storefront with an error on it:
      // the 404 below is the honest answer for a vendor ops has pulled.
      where: { suspendedAt: null, OR: [{ slug }, { id: slug }] },
      include: {
        products: {
          where: { inStock: true },
          orderBy: [{ section: 'asc' }, { name: 'asc' }],
        },
      },
    });

    if (!vendor) throw notFound('Vendor');

    const sections = [...new Set(vendor.products.map((p) => p.section ?? 'Menu'))];

    res.json({
      data: {
        ...vendor,
        sections,
      },
    });
  })
);

/** GET /vendors/:slug/products */
vendorsRouter.get(
  '/:slug/products',
  asyncHandler(async (req, res) => {
    const slug = req.params.slug!;
    const vendor = await prisma.vendor.findFirst({ where: { OR: [{ slug }, { id: slug }] }, select: { id: true } });
    if (!vendor) throw notFound('Vendor');

    const products = await prisma.product.findMany({
      where: { vendorId: vendor.id, inStock: true },
      orderBy: { name: 'asc' },
    });

    res.json({ data: products });
  })
);

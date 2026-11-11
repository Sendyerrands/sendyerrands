import { Router } from 'express';
import { z } from 'zod';

import { notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { PUBLIC_ACCOUNT_OMIT } from '@/lib/public-reads';
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

/**
 * The picture a shop is shown with.
 *
 * `Vendor.coverUrl` is read all over the app and is writable nowhere: no
 * endpoint accepts it, the vendor portal has no control for it, the app's
 * vendor screens have none and the ops dashboard only declares it in a type.
 * So it is null for every vendor that exists, and browse rendered every shop
 * as a flat coloured placeholder — a storefront with a real catalogue behind
 * it looked like an empty one.
 *
 * Until a vendor can actually upload a cover, one of their own product photos
 * is a truer picture of the shop than a grey box. The oldest is used rather
 * than the newest on purpose: a cover that silently changes every time a
 * vendor lists a new item is its own small bug, and this is a stopgap, not a
 * feature pretending to be one. A stored `coverUrl` always wins, so building
 * the real control later needs no change here.
 */
function coverFor(vendor: { coverUrl: string | null; products?: { imageUrl: string | null }[] }) {
  if (vendor.coverUrl) return vendor.coverUrl;
  return vendor.products?.find((p) => p.imageUrl)?.imageUrl ?? null;
}

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
      // Without this the whole row goes out, hash and sign-in address
      // included, to anyone who asks. See src/lib/public-reads.ts.
      omit: PUBLIC_ACCOUNT_OMIT,
      /* One row, one column, per vendor — enough to stand in for a cover
         without dragging whole catalogues into a browse query. Not filtered on
         `inStock`: a sold-out item's photo is still a fair picture of the
         shop, and filtering it out would hand a placeholder back to exactly
         the vendor who had sold everything. */
      include: {
        products: {
          where: { imageUrl: { not: null } },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { imageUrl: true },
        },
      },
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

    /* `products` was only ever a vehicle for the cover, and it is a single
       stub row rather than a catalogue. Dropping it keeps the browse payload
       the shape clients already expect — ApiVendor.products means "the whole
       catalogue" on the detail route, and handing back a one-item version of
       it here would be a quiet lie. */
    const withCovers = page.map(({ products, ...v }) => ({
      ...v,
      coverUrl: coverFor({ coverUrl: v.coverUrl, products }),
    }));

    res.json({
      data: withCovers,
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
      // As in the list above: a storefront is public, its owner's credentials
      // are not. See src/lib/public-reads.ts.
      omit: PUBLIC_ACCOUNT_OMIT,
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
        // Free here: the catalogue is already loaded for the page itself.
        coverUrl: coverFor(vendor),
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

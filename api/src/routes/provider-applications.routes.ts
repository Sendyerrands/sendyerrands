import { Router } from 'express';
import { z } from 'zod';

import { conflict } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { asyncHandler, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';

/**
 * Applying to offer a service on Sendy.
 *
 * Deliberately the same shape as vendor-applications: a provider is onboarded
 * exactly as a vendor is. They apply, ops reviews, and approval is what creates
 * the ServiceProvider row — nobody self-registers into a listing customers will
 * be asked to let into their home.
 */
export const providerApplicationsRouter = Router();

providerApplicationsRouter.use(requireAuth('customer'));

const applicationSchema = z.object({
  /** What they trade under — "Kay Cuts", not necessarily a person's name. */
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  area: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(40).default('Lagos'),
  phone: z.string().trim().min(10).max(20),
  email: z.string().trim().email().max(190).optional(),
  bio: z.string().trim().max(600).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  /**
   * Asked here rather than set by ops later, because it is the one thing only
   * the applicant knows and it decides which arrival options a customer is
   * ever offered. A cleaner with a vacuum cannot ride.
   */
  canTravelByBike: z.boolean().default(true),
  /**
   * The tiers they offer, if they offer any.
   *
   * Optional on purpose, and the empty case is the ordinary one: plenty of
   * providers just do the job and quote for it. Requiring three tiers would
   * make every applicant invent two they do not sell in order to be listed.
   *
   * The applicant writes what is inside each tier. A barber's VIP and a
   * cleaner's VIP have nothing in common, so the only thing fixed here is the
   * rung — the contents are theirs.
   */
  packages: z
    .array(
      z.object({
        tier: z.enum(['BASIC', 'STANDARD', 'VIP']),
        name: z.string().trim().max(60).optional(),
        description: z.string().trim().min(3).max(400),
        priceKobo: z.number().int().min(0).max(100_000_000),
      })
    )
    .max(3)
    /* One row per rung. Two "VIP"s is a pricing bug, and the unique index
       would refuse it at approval time — better to refuse it here, where the
       applicant can still fix it. */
    .refine(
      (ps) => new Set(ps.map((x) => x.tier)).size === ps.length,
      'Each package tier can only be offered once.'
    )
    .optional(),
});

/**
 * POST /provider-applications
 *
 * Only what a human needs to decide "should we call these people back". Fees,
 * availability and verification are set by ops on approval — an applicant
 * cannot meaningfully choose them yet, and asking would cost completions on a
 * form whose whole purpose is low friction.
 */
providerApplicationsRouter.post(
  '/',
  validate(applicationSchema),
  asyncHandler(async (req, res) => {
    const applicantId = req.auth!.id;
    const body = req.body as z.infer<typeof applicationSchema>;

    // One open application at a time, so ops do not review duplicates.
    const pending = await prisma.providerApplication.findFirst({
      where: { applicantId, status: 'PENDING' },
      select: { id: true, name: true },
    });
    if (pending) {
      throw conflict(
        `You already have an application in for ${pending.name}. We'll be in touch once it's reviewed.`
      );
    }

    const application = await prisma.providerApplication.create({
      data: { ...body, applicantId },
    });

    res.status(201).json({ data: application });
  })
);

/** GET /provider-applications/mine — so the app can show the current status. */
providerApplicationsRouter.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const applications = await prisma.providerApplication.findMany({
      where: { applicantId: req.auth!.id },
      orderBy: { createdAt: 'desc' },
      // `note` carries the rejection reason, which is the one thing a rejected
      // applicant most needs to see.
      select: {
        id: true,
        name: true,
        category: true,
        area: true,
        status: true,
        note: true,
        createdAt: true,
        reviewedAt: true,
      },
    });

    res.json({ data: applications });
  })
);

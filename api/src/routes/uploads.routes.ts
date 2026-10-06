import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';
import { UPLOAD_FOLDERS, createUploadSignature } from '@/services/cloudinary';

export const uploadsRouter = Router();

/**
 * POST /uploads/signature
 *
 * Mints a short-lived Cloudinary signature so the app can upload directly.
 * Auth is required: an open signature endpoint is free storage for the internet.
 */
uploadsRouter.post(
  '/signature',
  /**
   * Vendors and providers belong here too.
   *
   * `product-images` and `vendor-covers` are folders only a vendor ever writes
   * to, and `avatars` is how a service provider gets a face on their listing —
   * but neither actor was allowed to ask for a signature, so the website's
   * vendor dashboard got a 403 and fell back to "photo upload is unavailable
   * right now". Nothing was wrong with Cloudinary; the door was just shut.
   */
  requireAuth('customer', 'rider', 'admin', 'vendor', 'provider'),
  validate(
    z.object({
      folder: z.enum(UPLOAD_FOLDERS),
      publicId: z.string().max(120).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { folder, publicId } = req.body as {
      folder: (typeof UPLOAD_FOLDERS)[number];
      publicId?: string;
    };

    res.json({ data: createUploadSignature(folder, publicId) });
  })
);

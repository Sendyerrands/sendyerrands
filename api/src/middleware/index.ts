import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError, type ZodSchema } from 'zod';

import { env } from '@/config/env';
import { AppError } from '@/lib/errors';

/** Validates and REPLACES the given request part with the parsed result. */
export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        new AppError(400, 'VALIDATION_ERROR', 'Some fields need fixing.', fieldErrors(result.error))
      );
    }
    // Query/params are getter-only on Express 5; assign defensively.
    if (source === 'body') req.body = result.data;
    else Object.defineProperty(req, source, { value: result.data, writable: true });
    next();
  };
}

function fieldErrors(error: ZodError) {
  return error.issues.reduce<Record<string, string>>((acc, issue) => {
    const key = issue.path.join('.') || '_';
    if (!acc[key]) acc[key] = issue.message;
    return acc;
  }, {});
}

/**
 * Tight limit on password-reset endpoints — the email-cost and brute-force
 * surface.
 *
 * Scaled by environment rather than fixed. Five codes per quarter hour is the
 * right ceiling when each one costs money and an attacker is guessing at a real
 * account; it is the wrong ceiling when one person is signing in and out as a
 * customer, then a rider, then a customer again to test a flow, and gets locked
 * out of their own build for fifteen minutes. Production keeps the strict
 * number — this is a development allowance, not a relaxation of the rule.
 *
 * Override with OTP_RATE_LIMIT_MAX when a specific test needs something else.
 */
const otpMax = env.OTP_RATE_LIMIT_MAX ?? (env.isProd ? 5 : 100);

/**
 * Sign-in attempts.
 *
 * A password is guessable in a way a one-time code sent to an inbox is not, so
 * this endpoint needs its own ceiling rather than sharing the API's. Twenty per
 * quarter hour is generous for someone mistyping their own password and useless
 * to anyone working through a list.
 *
 * Keyed on IP, which is the honest limit of what this can do: it slows a single
 * source, and does nothing about a distributed attempt. The real defences are
 * the password policy and bcrypt's cost factor, both in lib/password.ts.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProd ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  // Counting only failures means a working session is never interrupted by
  // someone else on the same NAT, while a run of wrong guesses still trips.
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many sign-in attempts. Try again in a few minutes.',
    },
  },
});

export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: otpMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many code requests. Try again in a few minutes.' },
  },
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * The website's booking form is unauthenticated — anyone who can reach the page
 * can create an order, and each one mints a customer record behind it. That is
 * the point (no account needed to book), and also the exposure, so it gets a
 * tighter limit than the general API.
 *
 * Deliberately generous per hour rather than per minute: a real person booking
 * two errands back to back must not be blocked, while a script filling the
 * orders table is. Kept on the loose side because Nigerian mobile networks put
 * a lot of genuine users behind very few addresses, so an aggressive IP limit
 * would lock out real customers long before it inconvenienced anyone.
 */
export const webBookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.isProd ? 15 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many booking attempts from this connection. Try again shortly, or send us a message on WhatsApp.',
    },
  },
});

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Cannot ${req.method} ${req.path}` },
  });
}

// Must keep all four params — Express identifies error handlers by arity.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Some fields need fixing.', details: fieldErrors(err) },
    });
  }

  // Prisma's unique-constraint violation.
  if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'That record already exists.' },
    });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our end.',
      ...(env.isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
  });
}

/** Wraps an async handler so rejected promises reach the error handler. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  fn: T
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

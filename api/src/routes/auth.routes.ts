import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';

import { env, features } from '@/config/env';
import { badRequest, unauthorized } from '@/lib/errors';
import { signToken } from '@/lib/jwt';
import {
  assertPasswordAcceptable,
  burnTimingBudget,
  hashPassword,
  verifyPassword,
} from '@/lib/password';
import { prisma } from '@/lib/prisma';
import { normalisePhone, otpCode, referralCode } from '@/lib/reference';
import { asyncHandler, loginLimiter, otpLimiter, validate } from '@/middleware';
import { requireAuth } from '@/middleware/auth';
import { passwordResetEmail, sendEmail } from '@/services/email';

export const authRouter = Router();

const RESET_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

/**
 * Email and password, with codes reserved for proving control of an inbox.
 *
 * Sign-in used to be phone plus a one-time code, which made every login depend
 * on a messaging channel: no WhatsApp or SMS credentials meant either nobody
 * could sign in, or the fixed dev code was left on and everybody could sign in
 * as anybody. A password removes the delivery channel from the hot path
 * entirely — it is only needed by people who have forgotten one.
 */

/** Lowercased so one address cannot become two accounts with two wallets. */
const emailField = z
  .string()
  .email('Enter a valid email address.')
  .transform((v) => v.trim().toLowerCase());

const roleField = z.enum(['customer', 'rider', 'vendor']).default('customer');

const registerSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Choose a password.'),
  firstName: z.string().min(2).max(40),
  lastName: z.string().min(2).max(40),
  phone: z.string().min(10, 'Enter a valid phone number.'),
  // Vendors cannot self-register; see the guard in the handler.
  role: z.enum(['customer', 'rider']).default('customer'),
  referredByCode: z.string().optional(),
  /**
   * Riders only — what they ride and its plate. Collected at sign-up rather
   * than chased later: dispatch matches on vehicle, so a rider without one is
   * approved but unassignable, which looks like the job board being empty.
   */
  vehicleType: z.enum(['MOTORBIKE', 'BICYCLE', 'TRICYCLE', 'CAR', 'VAN', 'FOOT']).optional(),
  plateNumber: z.string().max(20).optional(),
});

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password.'),
  role: roleField,
});

const forgotSchema = z.object({ email: emailField, role: roleField });

const resetSchema = z.object({
  email: emailField,
  code: z.string().length(6, 'The code is 6 digits.'),
  password: z.string().min(1, 'Choose a new password.'),
  role: roleField,
});

const RESET_PURPOSE = {
  customer: 'CUSTOMER_PASSWORD_RESET',
  rider: 'RIDER_PASSWORD_RESET',
  vendor: 'VENDOR_PASSWORD_RESET',
} as const;

/**
 * POST /auth/register
 * Creates a customer or rider account and returns a token.
 */
authRouter.post(
  '/register',
  loginLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;

    const phone = normalisePhone(body.phone);
    if (!phone) throw badRequest('That does not look like a Nigerian phone number.');

    assertPasswordAcceptable(body.password);

    /**
     * Checked explicitly rather than left to the unique index, so the message
     * names the field. A bare 409 "that record already exists" for a duplicate
     * phone reads, on a form whose first field is an email, as though the email
     * were the problem.
     *
     * This does confirm to an unauthenticated caller whether an address is
     * registered. That is unavoidable on a signup form — it has to refuse
     * duplicates — and the honest trade is to be clear here and careful on
     * /login and /password/forgot, which do not have to say anything.
     */
    const table = body.role === 'rider' ? prisma.rider : prisma.user;
    const [emailTaken, phoneTaken] = await Promise.all([
      (table as typeof prisma.user).findUnique({ where: { email: body.email }, select: { id: true } }),
      (table as typeof prisma.user).findUnique({ where: { phone }, select: { id: true } }),
    ]);

    if (emailTaken) throw badRequest('An account already uses that email. Sign in instead.');

    /**
     * Almost always a returning website customer, not an impostor.
     *
     * A booking made on the website mints a User keyed on phone, with a random
     * unusable password. The person comes back weeks later, tries to register,
     * and is told an account already uses their number — one they never made
     * and cannot sign into. Without somewhere to go next, the customer who has
     * already ordered is the only one who cannot create an account.
     *
     * The reset flow is that somewhere: they have an email on file and no
     * usable password, so it sets the first one and their past bookings are
     * waiting for them. Exactly how a vendor claims an ops-created account.
     */
    if (phoneTaken) {
      throw badRequest(
        'An account already uses that phone number. If you have booked with us before, use "Forgot password" to set a password and pick up where you left off.'
      );
    }

    const passwordHash = await hashPassword(body.password);

    if (body.role === 'rider') {
      const rider = await prisma.rider.create({
        data: {
          email: body.email,
          passwordHash,
          phone,
          firstName: body.firstName.trim(),
          lastName: body.lastName.trim(),
          vehicleType: body.vehicleType,
          // Bicycles and riders on foot have no plate — store null, not ''.
          plateNumber: body.plateNumber?.trim().toUpperCase() || null,
        },
      });

      return res.status(201).json({
        data: {
          token: signToken({ sub: rider.id, actor: 'rider' }),
          isNewAccount: true,
          rider: {
            id: rider.id,
            phone: rider.phone,
            firstName: rider.firstName,
            lastName: rider.lastName,
            status: rider.status,
            isOnline: rider.isOnline,
          },
        },
      });
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        phone,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        referralCode: referralCode(body.firstName.trim()),
        referredByCode: body.referredByCode?.trim() || undefined,
      },
    });

    res.status(201).json({
      data: {
        token: signToken({ sub: user.id, actor: 'customer' }),
        isNewAccount: true,
        user: {
          id: user.id,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          walletBalanceKobo: user.walletBalanceKobo,
          referralCode: user.referralCode,
        },
      },
    });
  })
);

/**
 * POST /auth/login
 *
 * One message for every failure — wrong address, wrong password, vendor who has
 * not set one yet. Distinguishing them turns this into a free lookup for
 * whether a given person banks with Sendy Errands, and it helps a real user not
 * at all: someone who cannot get in needs the reset flow either way.
 */
authRouter.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password, role } = req.body as z.infer<typeof loginSchema>;
    const wrong = () => unauthorized('That email or password is not correct.');

    if (role === 'vendor') {
      const vendor = await prisma.vendor.findUnique({ where: { email } });
      // Burn the same bcrypt time whether or not the vendor exists, so the
      // response time does not reveal which.
      if (!vendor?.passwordHash) {
        await burnTimingBudget(password);
        throw wrong();
      }
      if (!(await verifyPassword(password, vendor.passwordHash))) throw wrong();

      return res.json({
        data: {
          token: signToken({ sub: vendor.id, actor: 'vendor' }),
          vendor: {
            id: vendor.id,
            name: vendor.name,
            slug: vendor.slug,
            phone: vendor.phone,
            isVerified: vendor.isVerified,
            isOpen: vendor.isOpen,
          },
        },
      });
    }

    if (role === 'rider') {
      const rider = await prisma.rider.findUnique({ where: { email } });
      if (!rider) {
        await burnTimingBudget(password);
        throw wrong();
      }
      if (!(await verifyPassword(password, rider.passwordHash))) throw wrong();

      return res.json({
        data: {
          token: signToken({ sub: rider.id, actor: 'rider' }),
          rider: {
            id: rider.id,
            phone: rider.phone,
            firstName: rider.firstName,
            lastName: rider.lastName,
            status: rider.status,
            isOnline: rider.isOnline,
          },
        },
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await burnTimingBudget(password);
      throw wrong();
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw wrong();
    if (!user.isActive) throw unauthorized('That account has been disabled. Contact support.');

    res.json({
      data: {
        token: signToken({ sub: user.id, actor: 'customer' }),
        user: {
          id: user.id,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          walletBalanceKobo: user.walletBalanceKobo,
          referralCode: user.referralCode,
        },
      },
    });
  })
);

/**
 * POST /auth/password/forgot
 *
 * Always 200, whether or not the address is registered — otherwise this becomes
 * a "does X have a Sendy Errands account?" oracle for anyone with a mailing
 * list. The work is done only when there is an account to do it for.
 *
 * This is also how a vendor claims an ops-created account: they have an email
 * on file and no password, so the reset flow sets the first one. No temporary
 * password is ever transmitted.
 */
authRouter.post(
  '/password/forgot',
  otpLimiter,
  validate(forgotSchema),
  asyncHandler(async (req, res) => {
    const { email, role } = req.body as z.infer<typeof forgotSchema>;
    const purpose = RESET_PURPOSE[role];

    const exists =
      role === 'vendor'
        ? await prisma.vendor.findUnique({ where: { email }, select: { id: true } })
        : role === 'rider'
          ? await prisma.rider.findUnique({ where: { email }, select: { id: true } })
          : await prisma.user.findUnique({ where: { email }, select: { id: true } });

    const respond = (devCode?: string) =>
      res.json({
        data: {
          email,
          expiresInSeconds: RESET_TTL_MINUTES * 60,
          // Present only in dev mode so the flow can be exercised without an
          // email provider. Never sent when OTP_DEV_MODE is off.
          ...(devCode ? { devCode } : {}),
        },
      });

    if (!exists) return respond();

    const code = env.OTP_DEV_MODE ? env.OTP_DEV_CODE : otpCode();

    // Retire outstanding codes so only the newest one works.
    await prisma.otpCode.updateMany({
      where: { email, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await prisma.otpCode.create({
      data: {
        email,
        purpose,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      },
    });

    if (env.OTP_DEV_MODE) return respond(code);

    const mail = passwordResetEmail(code, RESET_TTL_MINUTES);
    const sent = await sendEmail({ to: email, ...mail });

    /**
     * A failed send is logged, not surfaced. The response is identical either
     * way because it has to be — varying it would reintroduce the account
     * oracle this endpoint exists to avoid. Someone who does not receive a code
     * retries, and the server log says why.
     */
    if (!sent.ok) {
      console.error(
        `[auth] password reset email failed for ${role}: ${sent.reason}` +
          (features.email ? '' : ' (RESEND_API_KEY is not set)')
      );
    }

    respond();
  })
);

/**
 * POST /auth/password/reset
 * Consumes the code and sets the new password. Does not sign anyone in — the
 * app sends them to the sign-in screen, so the new password is used once
 * immediately and is more likely to be remembered.
 */
authRouter.post(
  '/password/reset',
  otpLimiter,
  validate(resetSchema),
  asyncHandler(async (req, res) => {
    const { email, code, password, role } = req.body as z.infer<typeof resetSchema>;
    const purpose = RESET_PURPOSE[role];

    assertPasswordAcceptable(password);

    const record = await prisma.otpCode.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw unauthorized('Request a new code.');
    if (record.expiresAt < new Date()) throw unauthorized('That code has expired. Request a new one.');
    if (record.attempts >= MAX_ATTEMPTS) throw unauthorized('Too many wrong attempts. Request a new code.');

    if (!(await bcrypt.compare(code, record.codeHash))) {
      await prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw unauthorized('That code is not correct.');
    }

    const passwordHash = await hashPassword(password);

    /**
     * Consume the code in the same transaction as the password change. Doing it
     * afterwards leaves a window where a crash between the two would set the
     * password and leave the code live for another attempt.
     */
    await prisma.$transaction(async (tx) => {
      if (role === 'vendor') {
        await tx.vendor.update({ where: { email }, data: { passwordHash } });
      } else if (role === 'rider') {
        await tx.rider.update({ where: { email }, data: { passwordHash } });
      } else {
        await tx.user.update({ where: { email }, data: { passwordHash } });
      }
      await tx.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    });

    res.json({ data: { ok: true } });
  })
);

/**
 * POST /auth/password/change — change your own password.
 *
 * Requires the current one, so a borrowed unlocked phone cannot be used to lock
 * the owner out of their own account.
 *
 * This matters more than usual while self-service reset is unavailable: support
 * generates a password over the phone, which means an operator briefly knows a
 * credential to an account they do not own. Without somewhere to change it, that
 * stays true forever.
 */
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(1, 'Choose a new password.'),
});

authRouter.post(
  '/password/change',
  requireAuth('customer', 'rider', 'vendor'),
  loginLimiter,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { id, actor } = req.auth!;
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;

    assertPasswordAcceptable(newPassword);

    const account =
      actor === 'vendor'
        ? await prisma.vendor.findUnique({ where: { id }, select: { passwordHash: true } })
        : actor === 'rider'
          ? await prisma.rider.findUnique({ where: { id }, select: { passwordHash: true } })
          : await prisma.user.findUnique({ where: { id }, select: { passwordHash: true } });

    if (!account?.passwordHash) throw unauthorized();
    if (!(await verifyPassword(currentPassword, account.passwordHash))) {
      throw badRequest('That is not your current password.');
    }

    const passwordHash = await hashPassword(newPassword);

    if (actor === 'vendor') await prisma.vendor.update({ where: { id }, data: { passwordHash } });
    else if (actor === 'rider') await prisma.rider.update({ where: { id }, data: { passwordHash } });
    else await prisma.user.update({ where: { id }, data: { passwordHash } });

    res.json({ data: { ok: true } });
  })
);

/** GET /auth/session — cheap token check on app launch. */
authRouter.get(
  '/session',
  requireAuth('customer', 'rider', 'vendor'),
  asyncHandler(async (req, res) => {
    const { id, actor } = req.auth!;

    // Omitting vendor here would 403 on launch, and the app treats an auth
    // error from this call as an expired token — so every vendor would be
    // silently signed out the moment they reopened the app.
    if (actor === 'vendor') {
      const vendor = await prisma.vendor.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, phone: true, isVerified: true, isOpen: true },
      });
      if (!vendor) throw unauthorized();
      return res.json({ data: { actor, vendor } });
    }

    if (actor === 'rider') {
      const rider = await prisma.rider.findUnique({
        where: { id },
        select: { id: true, phone: true, firstName: true, lastName: true, status: true, isOnline: true, rating: true },
      });
      if (!rider) throw unauthorized();
      return res.json({ data: { actor, rider } });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, phone: true, firstName: true, lastName: true,
        email: true, walletBalanceKobo: true, referralCode: true,
      },
    });
    if (!user) throw unauthorized();
    res.json({ data: { actor, user } });
  })
);

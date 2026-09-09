import 'dotenv/config';
import { z } from 'zod';

// Fail fast and loudly at boot rather than at 2am on a missing key.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(24, 'JWT_SECRET must be at least 24 characters'),
  JWT_EXPIRES_IN: z.string().default('30d'),

  /**
   * Use a fixed password-reset code instead of emailing one, and return it in
   * the API response.
   *
   * Since sign-in moved to email and password this no longer opens every
   * account by itself — but it does let anyone who knows an address take it
   * over, which is the same thing one step removed. Left as an optional string
   * rather than defaulting to 'true' so that a production deploy which simply
   * does not mention the variable comes up closed; it resolves against NODE_ENV
   * below.
   */
  OTP_DEV_MODE: z.string().optional(),
  OTP_DEV_CODE: z.string().default('123456'),

  /** Reset codes per 15 minutes. Unset means 5 in production, 100 in development. */
  OTP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).optional(),

  // Transactional email — password resets. See services/email.ts.
  RESEND_API_KEY: z.string().optional(),
  RESEND_BASE_URL: z.string().default('https://api.resend.com'),
  EMAIL_FROM: z.string().default('Sendy Errands <no-reply@sendyerrands.com>'),

  /**
   * Where a reply actually goes.
   *
   * Mail is sent from no-reply@ via Resend, which has no inbox behind it —
   * Resend's records are CNAMEs on the `send` and `rsend` subdomains and there
   * is no MX for the root pointing at it. Without a Reply-To, someone who hits
   * reply on a password-reset email writes into nothing and gets no bounce
   * explaining why. Some people always will, and the ones who do are usually
   * the ones something has gone wrong for.
   *
   * The root MX belongs to Zoho, so this must be a real Zoho mailbox or alias.
   * support@ is an alias on the one mailbox rather than a second account: an
   * inbox nobody opens is the same void with a friendlier name.
   */
  EMAIL_REPLY_TO: z.string().default('support@sendyerrands.com'),

  /*
   * WHATSAPP_* and TERMII_* used to live here, carrying the login OTP. Sign-in
   * is email and password now and the only code left goes to an inbox, so both
   * integrations and their services were removed rather than left configured,
   * unused, and looking like a working delivery channel. They are in the git
   * history if a phone channel is ever wanted for order notifications.
   */

  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  PAYSTACK_BASE_URL: z.string().default('https://api.paystack.co'),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default('sendy'),

  DEFAULT_DELIVERY_FEE_KOBO: z.coerce.number().default(130_000),

  /**
   * The floor on what a customer may offer for delivery.
   *
   * Riders name their own price now, so the fee is no longer ours to fix — but
   * an offer nobody will ever accept is not a cheap delivery, it is a job board
   * full of dead listings and a customer waiting on a rider who is never
   * coming. ₦500 is low enough to leave real room to haggle and high enough
   * that the offer is serious.
   */
  MIN_DELIVERY_FEE_KOBO: z.coerce.number().default(50_000),

  /**
   * How far above the customer's offer a rider may counter, as a multiple.
   *
   * A genuine counter is "this is across town, it is ₦4,000 not ₦1,300". Three
   * times covers that. Without a ceiling the field accepts ₦999,999, which is
   * not a negotiation — it is noise in a list the customer has to read, and on
   * a mis-tap it is a number they might accept by accident.
   */
  MAX_COUNTER_MULTIPLE: z.coerce.number().default(3),
  SERVICE_FEE_KOBO: z.coerce.number().default(30_000),
  PLATFORM_COMMISSION_BPS: z.coerce.number().default(1_500),
  BID_WINDOW_MINUTES: z.coerce.number().default(30),
  JOB_LOCK_SECONDS: z.coerce.number().default(120),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\n✗ Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

const isProd = parsed.data.NODE_ENV === 'production';

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  isProd,
  /**
   * Fails closed. Unset means ON in development and OFF in production, so a
   * deploy can only accept the fixed reset code if someone typed
   * OTP_DEV_MODE=true against a production environment on purpose.
   */
  OTP_DEV_MODE:
    parsed.data.OTP_DEV_MODE !== undefined ? parsed.data.OTP_DEV_MODE === 'true' : !isProd,
};

/** True when the integration has real credentials configured. */
export const features = {
  email: Boolean(env.RESEND_API_KEY),
  paystack: Boolean(env.PAYSTACK_SECRET_KEY),
  /**
   * Real money. Paystack prefixes live secrets `sk_live_` and test ones
   * `sk_test_`, which is the only reliable way to tell from configuration alone
   * which side of the line a deploy is on.
   */
  paystackLive: env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') ?? false,
  cloudinary: Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
  ),
};

/**
 * Live keys and a fixed reset code cannot run together. Ever.
 *
 * OTP_DEV_MODE makes every password reset in the system accept one hardcoded
 * code and hands it back in the API response, so anyone who knows an email
 * address can take that account over. That is a reasonable trade for a demo
 * against test keys, where the worst case is imaginary money. Against live keys
 * the same door empties real wallet balances and spends real cards, and the two
 * settings live in different places — one in Paystack's dashboard, one in
 * Render's — so nothing would otherwise catch the window between switching one
 * and remembering the other.
 *
 * Refusing to boot is the point. A warning here would scroll past in a deploy
 * log and the service would come up serving money to anybody.
 */
if (features.paystackLive && env.OTP_DEV_MODE) {
  console.error(
    '\n✗ Refusing to start: PAYSTACK_SECRET_KEY is a LIVE key while OTP_DEV_MODE is on.\n' +
      `  Every password reset would accept the fixed code ${env.OTP_DEV_CODE}, against real money.\n\n` +
      '  Set OTP_DEV_MODE=false — and set RESEND_API_KEY first, or nobody who\n' +
      '  forgets a password will be able to recover it.\n'
  );
  process.exit(1);
}

/**
 * Live keys with no way to send a reset code locks people out of their own
 * accounts rather than letting strangers in, so it warns instead of exiting —
 * but it is still a broken deploy, and only the person who set it up knows
 * which they meant.
 */
if (features.paystackLive && !features.email) {
  console.warn(
    '⚠  LIVE Paystack keys with no email provider. Password resets cannot be delivered.\n' +
      '   Set RESEND_API_KEY and EMAIL_FROM.'
  );
}

if (features.paystackLive && !isProd) {
  console.warn(`⚠  LIVE Paystack keys with NODE_ENV=${env.NODE_ENV}. Real money, non-production config.`);
}

// Loud warning rather than a hard failure: the API is meant to run end-to-end
// on stubs so the app can be demoed before the merchant accounts exist.
if (env.isProd) {
  if (!features.email)
    console.warn('⚠  No email provider configured — set RESEND_API_KEY. Password resets will not send.');
  if (!features.paystack) console.warn('⚠  PAYSTACK_SECRET_KEY missing — card payments are disabled.');
  if (env.OTP_DEV_MODE)
    console.warn('⚠  OTP_DEV_MODE is ON in production. Anyone who knows an email can reset its password.');
}

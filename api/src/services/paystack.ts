import { createHmac, timingSafeEqual } from 'node:crypto';

import { env, features } from '@/config/env';
import { AppError, badRequest, tooMany } from '@/lib/errors';

/**
 * Paystack (https://paystack.com) — cards, bank transfer and USSD in Naira.
 *
 * Amounts are already in kobo throughout this codebase, which is exactly what
 * Paystack expects, so nothing is converted here.
 *
 * To go live:
 *   1. Create a Paystack business and complete compliance.
 *   2. Copy the TEST keys into PAYSTACK_SECRET_KEY / PAYSTACK_PUBLIC_KEY.
 *   3. Add the webhook URL: POST {api-url}/api/v1/payments/webhook
 *   4. Swap to LIVE keys when you're ready to take real money.
 */

type InitResponse = {
  status: boolean;
  message: string;
  data: { authorization_url: string; access_code: string; reference: string };
};

type VerifyResponse = {
  status: boolean;
  message: string;
  data: {
    status: 'success' | 'failed' | 'abandoned';
    reference: string;
    amount: number;
    paid_at: string | null;
    channel: string;
    // Echoed back exactly as sent to /transaction/initialize. This is how a
    // top-up is told apart from an order payment, and how it is tied to the
    // customer who started it.
    metadata?: Record<string, unknown>;
  };
};

async function paystackFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!features.paystack) {
    throw new AppError(
      503,
      'PAYMENTS_UNAVAILABLE',
      'Card payments are not configured yet. Pay with your Sendy Errands Wallet, or add PAYSTACK_SECRET_KEY.'
    );
  }

  /**
   * PAYSTACK_ERROR and PAYSTACK_UNREACHABLE are deliberately different codes.
   *
   * For money coming in the distinction barely matters — the customer retries.
   * For money going out it is the whole game. A rejection means Paystack
   * answered and did not create the transfer, so the payout can safely be
   * unwound. A network failure means the request may well have been received
   * and acted on, and unwinding it risks paying the same earnings twice.
   * Callers must be able to tell those apart, so they cannot share a code.
   */
  /**
   * Reads retry, writes never.
   *
   * A GET can be repeated safely: asking twice who owns an account, or for the
   * bank list, costs a round trip and nothing else. A POST cannot — retrying
   * /transfer after a dropped connection risks sending the same money twice,
   * which is the entire reason PAYSTACK_UNREACHABLE exists as a separate code.
   *
   * Keying this off the HTTP method rather than a flag callers pass means a new
   * write endpoint is safe by default: it has to be a GET to be retried, and
   * nobody can opt a transfer in by mistake.
   *
   * One retry, not three. A rider standing at a stall waiting on a quote would
   * rather see an error at four seconds than a spinner at fifteen.
   */
  const isRead = !init?.method || init.method === 'GET';
  const attempts = isRead ? 2 : 1;

  let res: Response | undefined;
  let lastCause: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      res = await fetch(`${env.PAYSTACK_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      });
      break;
    } catch (cause) {
      lastCause = cause;
      if (attempt === attempts) break;
      console.warn(`[paystack] ${path} failed to connect, retrying once`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (!res) {
    throw new AppError(
      504,
      'PAYSTACK_UNREACHABLE',
      isRead
        ? 'We could not reach the payment provider. Try again in a moment.'
        : 'We could not reach the payment provider. The request may or may not have gone through.',
      { cause: lastCause instanceof Error ? lastCause.message : String(lastCause) }
    );
  }

  const payload = (await res.json().catch(() => null)) as (T & { message?: string }) | null;

  if (!res.ok) {
    // The upstream status travels with the error. Callers need it to tell a
    // genuine rejection from a rate limit or an outage, which read identically
    // once flattened into one message but mean completely different things to
    // whoever is staring at the screen.
    throw new AppError(
      502,
      'PAYSTACK_ERROR',
      payload?.message ?? 'The payment provider rejected that request.',
      { upstreamStatus: res.status }
    );
  }

  if (!payload) {
    throw new AppError(502, 'PAYSTACK_ERROR', 'The payment provider sent a response we could not read.');
  }

  return payload;
}

/** Starts a transaction and returns the checkout URL to open in the app. */
export async function initializeTransaction(params: {
  email: string;
  amountKobo: number;
  reference: string;
  metadata?: Record<string, unknown>;
  /**
   * Where Paystack sends the browser once the payment finishes. The app passes
   * its own deep link so the payment sheet closes itself instead of stranding
   * the customer on the dashboard's callback page. Omitted, Paystack falls back
   * to whatever is configured on the dashboard.
   */
  callbackUrl?: string;
}) {
  const body = await paystackFetch<InitResponse>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      metadata: params.metadata ?? {},
      currency: 'NGN',
      ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {}),
    }),
  });

  return body.data;
}

/**
 * Confirms a transaction with Paystack directly.
 *
 * Always verify server-side before granting value — a client saying "payment
 * succeeded" means nothing, and webhooks can be replayed or delayed.
 */
export async function verifyTransaction(reference: string) {
  const body = await paystackFetch<VerifyResponse>(`/transaction/verify/${encodeURIComponent(reference)}`);
  return body.data;
}

/**
 * Validates the `x-paystack-signature` header against the raw request body.
 * Requires the UNPARSED body, which is why the webhook route mounts its own
 * raw body parser.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !env.PAYSTACK_SECRET_KEY) return false;

  const expected = createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');

  // timingSafeEqual throws on length mismatch, so check that first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── payout destinations ─────────────────────────────────────────────

export type Bank = { name: string; code: string; slug: string };

type BankListResponse = { status: boolean; data: { name: string; code: string; slug: string }[] };
type ResolveResponse = { status: boolean; data: { account_number: string; account_name: string } };

/**
 * Nigerian bank list, cached in memory for a day.
 *
 * It runs to a couple of hundred entries and changes when a bank is licensed or
 * merges — not often enough to fetch on every rider who opens the form, and not
 * static enough to hardcode.
 */
let bankCache: { at: number; banks: Bank[] } | null = null;
const BANK_TTL_MS = 24 * 60 * 60 * 1000;

export async function listBanks(): Promise<Bank[]> {
  if (bankCache && Date.now() - bankCache.at < BANK_TTL_MS) return bankCache.banks;

  const body = await paystackFetch<BankListResponse>('/bank?currency=NGN&country=nigeria');

  /**
   * Paystack's live list has codes that appear more than once — four of them,
   * for two different reasons.
   *
   * Sometimes it is one institution under two names (BANKIT MFB and BANKIT
   * MICROFINANCE BANK LTD). Sometimes it is genuinely different banks sharing a
   * code (Stellas MFB and YCT MFB; Goodnews and Prospa). Either way a transfer
   * is addressed by CODE, so both entries behave identically — the name in a
   * picker decides nothing, and the resolved account holder is the real check.
   *
   * Collapsed to one entry per code, with the distinct names joined so a rider
   * searching for either still finds it. Shipping them separately made two
   * chips that do exactly the same thing, and React saw duplicate keys.
   */
  const byCode = new Map<string, { name: string; code: string; slug: string; names: Set<string> }>();

  for (const b of body.data) {
    const existing = byCode.get(b.code);
    if (existing) {
      existing.names.add(b.name);
    } else {
      byCode.set(b.code, { name: b.name, code: b.code, slug: b.slug, names: new Set([b.name]) });
    }
  }

  const banks = [...byCode.values()]
    .map(({ code, slug, names }) => ({
      // Shortest first so the chip leads with the name people actually use.
      name: [...names].sort((a, b) => a.length - b.length).join(' / '),
      code,
      slug,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  bankCache = { at: Date.now(), banks };
  return banks;
}

/**
 * Asks the bank who owns an account number.
 *
 * This is the only check that stands between a typo and money landing in a
 * stranger's account, and it is why the resolved name is stored rather than
 * anything the rider typed. A transfer to a valid-but-wrong account is not
 * recoverable by us — it is a bank dispute, and the money is gone in the
 * meantime.
 */
/**
 * Recently resolved accounts.
 *
 * Saving a payout account deliberately resolves a second time rather than
 * trusting a name posted alongside a number — but that put two lookups seconds
 * apart for one account, and Paystack rate-limits this endpoint. The result was
 * that confirming a correct account reliably failed with "too many checks",
 * immediately after showing the right name.
 *
 * Caching keeps the security property intact: the stored name still comes from
 * Paystack and never from the client. It just does not ask twice for an answer
 * it already has.
 */
const resolveCache = new Map<string, { at: number; value: { accountNumber: string; accountName: string } }>();
const RESOLVE_TTL_MS = 5 * 60 * 1000;
const RESOLVE_CACHE_MAX = 500;

export async function resolveAccount(accountNumber: string, bankCode: string) {
  const key = `${bankCode}:${accountNumber}`;
  const hit = resolveCache.get(key);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.value;

  try {
    const body = await paystackFetch<ResolveResponse>(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
    );
    const value = { accountNumber: body.data.account_number, accountName: body.data.account_name };

    // Oldest-first eviction, so a long-running process cannot grow this
    // without bound. Map preserves insertion order, which is all that is needed.
    if (resolveCache.size >= RESOLVE_CACHE_MAX) {
      const oldest = resolveCache.keys().next().value;
      if (oldest !== undefined) resolveCache.delete(oldest);
    }
    resolveCache.set(key, { at: Date.now(), value });

    return value;
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'PAYSTACK_ERROR') throw err;

    /**
     * Only blame the digits when the bank actually rejected them.
     *
     * This used to turn every upstream failure into "we could not find that
     * account" — including rate limits and outages. Someone typing their own
     * account number correctly was told it was wrong, which is the worst
     * possible answer: it is confidently incorrect, and it sends them checking
     * something that was never the problem.
     */
    const status = (err.details as { upstreamStatus?: number } | undefined)?.upstreamStatus;
    console.error(`[paystack] account resolve failed (upstream ${status}): ${err.message}`);

    /**
     * Development escape hatch, so the errand flow can be walked end to end on
     * a machine with no working Paystack credentials.
     *
     * The account name is the one thing a customer is asked to trust, so this
     * does NOT invent a plausible one. It returns a name that reads as broken
     * wherever it surfaces — on the tracking page, in the admin drawer, in a
     * dispute — because a dev-mode order that looks indistinguishable from a
     * verified one is worse than no bypass at all.
     *
     * env.BANK_RESOLVE_DEV_BYPASS is already false in production; this cannot
     * be switched on there by setting the variable.
     */
    if (env.BANK_RESOLVE_DEV_BYPASS) {
      console.warn(
        `[paystack] DEV BYPASS — accepting unverified account ${accountNumber} (bank ${bankCode}). ` +
          'This never happens in production.'
      );
      return { accountNumber, accountName: 'UNVERIFIED — DEV MODE' };
    }

    if (status === 429) {
      /**
       * Paystack's own wording, not ours.
       *
       * The limit here is not what "rate limited" usually means: test mode
       * allows three real bank resolves *per day*, and says so, pointing at
       * test bank code 001 for unlimited checks. A generic "wait a few seconds"
       * would have someone retrying for hours against a cap that resets at
       * midnight. When the provider's message is more specific than anything we
       * can infer, it is the better message.
       */
      throw tooMany(err.message || 'Too many account checks. Try again later.');
    }
    if (status !== undefined && status >= 500) {
      throw new AppError(
        503,
        'BANK_LOOKUP_UNAVAILABLE',
        "We couldn't reach your bank to check that account. Nothing is wrong with your details — try again in a moment."
      );
    }

    /**
     * 401/403 is OUR credential, never their digits.
     *
     * A missing, malformed, revoked or wrong-mode secret key makes Paystack
     * reject the request before it ever looks at the account number — and
     * falling through to "check the number" tells a rider holding their own
     * correct account details that they are wrong. They then retype a number
     * that was never the problem, and the real fault (a key that needs
     * rotating) stays invisible because nobody is looking at the server log.
     *
     * The rider is told plainly it is not them; the operator gets the detail.
     */
    if (status === 401 || status === 403) {
      throw new AppError(
        503,
        'BANK_LOOKUP_UNAVAILABLE',
        "We can't check bank accounts right now — this is on us, not your details. Please try again shortly."
      );
    }

    throw badRequest(
      'We could not find that account. Check the number and the bank, then try again.'
    );
  }
}

// ── transfers (money out) ───────────────────────────────────────────

type RecipientResponse = { status: boolean; data: { recipient_code: string; active: boolean } };
type TransferData = {
  transfer_code: string;
  reference: string;
  /** pending | otp | success | failed | reversed | abandoned */
  status: string;
  amount: number;
  reason?: string | null;
};
type TransferResponse = { status: boolean; data: TransferData };
type BalanceResponse = { status: boolean; data: { currency: string; balance: number }[] };

/**
 * Registers a payout destination with Paystack and returns its handle.
 *
 * Cached on the rider afterwards. Paystack deduplicates identical recipients,
 * but creating one per payout is a wasted round trip on the path where mistakes
 * are least recoverable.
 */
export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}) {
  const body = await paystackFetch<RecipientResponse>('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'nuban',
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: 'NGN',
    }),
  });

  return body.data.recipient_code;
}

/**
 * Sends money.
 *
 * `reference` is ours and must be the Payout's. Paystack rejects a duplicate,
 * which makes a retry of this call safe: the second attempt is refused by the
 * provider rather than paying twice.
 */
export async function initiateTransfer(params: {
  amountKobo: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<TransferData> {
  const body = await paystackFetch<TransferResponse>('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance',
      amount: params.amountKobo,
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason,
      currency: 'NGN',
    }),
  });

  return body.data;
}

/** Asks Paystack what became of a transfer. The fallback when a webhook is lost. */
export async function verifyTransfer(reference: string): Promise<TransferData> {
  const body = await paystackFetch<TransferResponse>(
    `/transfer/verify/${encodeURIComponent(reference)}`
  );
  return body.data;
}

/**
 * What is actually available to send, in kobo.
 *
 * Checked before initiating so an underfunded account produces "your Paystack
 * balance is ₦X, this payout needs ₦Y" instead of a provider error that reads
 * like the integration is broken.
 */
export async function fetchAvailableBalanceKobo(): Promise<number> {
  const body = await paystackFetch<BalanceResponse>('/balance');
  return body.data.find((b) => b.currency === 'NGN')?.balance ?? 0;
}

export function assertPaidInFull(paidKobo: number, expectedKobo: number) {
  if (paidKobo < expectedKobo) {
    throw badRequest('The amount paid is less than the order total.');
  }
}

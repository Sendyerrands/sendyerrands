import { AppError } from './errors';
import { prisma } from './prisma';
import type { Actor } from './jwt';

/**
 * Account suspension, in one place.
 *
 * Four kinds of account sign into this API and every one of them can be
 * suspended, so the rule lives here rather than being written out four times
 * in the login handler and forgotten in the middleware.
 *
 * WHY THIS IS CHECKED ON EVERY REQUEST and not only at login: tokens are
 * signed with a 30-day expiry (JWT_EXPIRES_IN=30d) and nothing revokes them.
 * A suspension enforced at the door alone would let an already-signed-in rider
 * keep accepting jobs, or a suspended vendor keep taking orders, for up to a
 * month after ops pressed the button — the button would look like it worked and
 * would not have. One primary-key lookup per authenticated request is the price
 * of the control being real.
 *
 * It raises 401, not 403, on purpose. The app signs the user out on 401 and
 * deliberately does NOT on 403 (see ApiError.isAuthError in the app's client:
 * treating 403 as grounds for signing out was a bug once and the comment there
 * asks for the two not to be collapsed again). A suspended account should be
 * put back on the sign-in screen, where trying again produces the reason.
 */

/** The code the app and dashboard can branch on, distinct from a dead token. */
export const SUSPENDED_CODE = 'ACCOUNT_SUSPENDED';

export function suspendedError(reason?: string | null): AppError {
  return new AppError(
    401,
    SUSPENDED_CODE,
    reason?.trim()
      ? `This account has been suspended: ${reason.trim()}`
      : 'This account has been suspended. Contact Sendy Errands support.'
  );
}

/** The account shape every suspendable table shares. */
type Suspendable = { suspendedAt: Date | null; suspendedReason: string | null };

const SELECT = { suspendedAt: true, suspendedReason: true } as const;

/**
 * Reads the suspension state for one account.
 *
 * Returns null when the row is gone — a deleted account, whose token is still
 * cryptographically valid. The caller treats that as signed out, which is the
 * only honest answer.
 */
async function readSuspension(actor: Actor, id: string): Promise<Suspendable | null> {
  switch (actor) {
    case 'customer':
      return prisma.user.findUnique({ where: { id }, select: SELECT });
    case 'rider':
      return prisma.rider.findUnique({ where: { id }, select: SELECT });
    case 'vendor':
      return prisma.vendor.findUnique({ where: { id }, select: SELECT });
    case 'provider':
      return prisma.serviceProvider.findUnique({ where: { id }, select: SELECT });
    /**
     * Admins are out of scope: they are checked against isActive at login, the
     * dashboard has no screen for managing other admins, and there is no path
     * by which ops suspends itself. Returning "fine" here is a statement that
     * admins are not suspendable, not an oversight.
     */
    case 'admin':
      return { suspendedAt: null, suspendedReason: null };
  }
}

/**
 * Throws if this account may no longer be used.
 *
 * Also throws when the row no longer exists, which is what makes a hard delete
 * take effect immediately instead of leaving a 30-day window in which a deleted
 * account's token still authorises requests against a missing row.
 */
export async function assertUsable(actor: Actor, id: string): Promise<void> {
  const account = await readSuspension(actor, id);
  if (!account) {
    throw new AppError(401, 'ACCOUNT_GONE', 'This account no longer exists. Please sign in again.');
  }
  if (account.suspendedAt) throw suspendedError(account.suspendedReason);
}

/** Thrown at the door, from the data the login handler already loaded. */
export function assertLoginAllowed(account: Suspendable): void {
  if (account.suspendedAt) throw suspendedError(account.suspendedReason);
}

/**
 * SENDY — WHAT A PUBLIC READ MUST NEVER RETURN
 * -----------------------------------------------------------------------
 * Prisma returns every column of a model when a query carries no `select`.
 * That makes the safe-looking shape — `findMany({ where })` — a publisher of
 * whatever happens to be on the row, including credentials, and it makes the
 * leak invisible at the call site because nothing in the code names the field
 * that escapes.
 *
 * Four unauthenticated endpoints were doing exactly that. `GET /vendors`,
 * `GET /vendors/:slug`, `GET /services/providers` and
 * `GET /services/providers/:slug` each served the owner's live bcrypt hash and
 * sign-in address to anyone who asked, with no token:
 *
 *   "email": "...@gmail.com",
 *   "passwordHash": "$2a$12$Afs6EeTO7Ev..."
 *
 * A fifth, the booking response, did the same to any signed-in customer
 * through a nested `provider: true`.
 *
 * This is a shared constant rather than five inline omits so that the rule has
 * one definition: a sixth public read is one import away from being correct,
 * and a column that later turns sensitive is changed in one place instead of
 * being hunted for. Reach for it on every read of an account-bearing model
 * (Vendor, ServiceProvider, Rider, User) whose result reaches a client that is
 * not that account's owner.
 *
 * It deliberately does NOT omit `phone`. A vendor's and a provider's phone
 * number is business contact detail — the services flow is "the provider comes
 * to you", and the customer is meant to be able to reach them. Removing it is
 * a product decision, not a security fix, so it is not smuggled in here.
 */
export const PUBLIC_ACCOUNT_OMIT = {
  /**
   * A bcrypt hash is a credential, not a harmless opaque string. Cost 12 makes
   * it slow to attack, which is a reason not to panic and not a reason to
   * publish it — paired with the email address it is an offline target that
   * never expires.
   */
  passwordHash: true,

  /**
   * The sign-in identifier for every way into the account: `/auth/login`,
   * `/auth/password/forgot` and the dashboard's own reset tool all key on it.
   * Browsing a shop is not a reason to be handed it.
   */
  email: true,
} as const;

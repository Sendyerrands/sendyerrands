/**
 * Outward links, in one place.
 *
 * These used to point at a static site in this repo, served from Render on the
 * apex domain. That collided with the real sendyerrands.com website, so the
 * site is gone and the legal pages are hosted wherever the website hosts them.
 *
 * They open in an in-app browser rather than handing off to Chrome — see
 * `openInApp` below.
 */

/**
 * The Zoho mailbox, in one place.
 *
 * Sending and receiving are different services on this domain: Resend sends
 * from no-reply@ through CNAMEs on the `send` and `rsend` subdomains, and the
 * root MX belongs to Zoho. This is the address a human reads, so it must be a
 * real Zoho mailbox or alias — pointing it at anything else makes every
 * "Email us" button in the app a dead control.
 *
 * The API keeps its own copy in EMAIL_REPLY_TO because a server cannot import
 * from the app; keep the two in step.
 */
const SUPPORT_EMAIL = 'support@sendyerrands.com';

/**
 * Legal pages, on their own Vercel deployment.
 *
 * Source: github.com/Sendyerrands/sendytermsandprivacy. Kept apart from the
 * marketing site on purpose — the Play Console listing and this app both point
 * at these URLs, and they have to stay up and stay accurate whatever happens
 * to sendyerrands.com. The .php pages there were briefly used and lacked the
 * deletion section Play requires.
 *
 * All three verified live (200, correct titles, deletion section present, no
 * placeholders) on 2026-09-18 before being set. An empty string hides the row
 * rather than opening a blank browser sheet — if a page is ever taken down,
 * blank it here rather than leave a dead link.
 */
const LEGAL_SITE = 'https://sendytermsandprivacy.vercel.app';

export const legal = {
  privacy: `${LEGAL_SITE}/privacy.html`,
  terms: `${LEGAL_SITE}/terms.html`,
  /** Reachable without the app — the second half of Play's deletion rule. */
  deleteAccount: `${LEGAL_SITE}/delete-account.html`,
} as const;

export const links = {
  supportEmail: SUPPORT_EMAIL,
  support: `mailto:${SUPPORT_EMAIL}`,
} as const;

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
 * Legal pages, hosted on the main website.
 *
 * Both verified live (200, real titles) on 2026-09-16 before being set here.
 * An empty string makes the row hide itself rather than open a blank browser
 * sheet, which is the one behaviour worse than not having the link at all —
 * so if a page is ever taken down, blank it here rather than leaving a dead
 * link in the app.
 *
 * `deleteAccount` is still empty: Google Play wants a deletion route reachable
 * WITHOUT installing the app, and the privacy page does not describe one yet.
 * The in-app screen at /delete-account is unaffected.
 */
export const legal = {
  privacy: 'https://sendyerrands.com/privacy.php',
  terms: 'https://sendyerrands.com/terms.php',
  deleteAccount: '',
} as const;

export const links = {
  supportEmail: SUPPORT_EMAIL,
  support: `mailto:${SUPPORT_EMAIL}`,
} as const;

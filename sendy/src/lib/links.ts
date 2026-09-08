/**
 * Public web pages, served from the same domain the app sends mail from.
 *
 * These live on the marketing site (repo root `web/`) rather than as in-app
 * screens for a specific reason: Google Play requires the privacy policy and
 * the account-deletion route to be reachable **without installing the app**,
 * and the Play Console listing takes URLs, not screens. One copy on the web,
 * linked from here, keeps the app and the listing from drifting apart.
 */
const SITE = 'https://sendyerrands.com';

/**
 * The Zoho mailbox, in one place.
 *
 * Sending and receiving are different services on this domain: Resend sends
 * from no-reply@ through CNAMEs on the `send` and `rsend` subdomains, and the
 * root MX belongs to Zoho. This is the address a human reads, so it must be a
 * real Zoho mailbox or alias — pointing it at anything else makes every
 * "Email us" button in the app a dead control.
 *
 * Change it here and the support screen, the legal pages' contact blocks and
 * the app's Reply-To all follow. The API keeps its own copy in EMAIL_REPLY_TO
 * because a server cannot import from the app; keep the two in step.
 */
const SUPPORT_EMAIL = 'support@sendyerrands.com';

export const links = {
  site: SITE,
  privacy: `${SITE}/privacy.html`,
  terms: `${SITE}/terms.html`,
  deleteAccount: `${SITE}/delete-account.html`,
  supportEmail: SUPPORT_EMAIL,
  support: `mailto:${SUPPORT_EMAIL}`,
} as const;

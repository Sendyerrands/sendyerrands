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

export const links = {
  site: SITE,
  privacy: `${SITE}/privacy.html`,
  terms: `${SITE}/terms.html`,
  deleteAccount: `${SITE}/delete-account.html`,
  support: 'mailto:sendyerrands@sendyerrands.com',
} as const;

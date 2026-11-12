/**
 * "Did you mean ...?" for mistyped email domains.
 *
 * A vendor registered as `estherogunleye113@gmial.com`. gmial.com is a real
 * registered domain rather than a bounce, so nothing failed and nothing warned
 * her: the address became her account identity, her approval email went to a
 * stranger's mail server, and a password-reset code would have gone there too —
 * which is an account takeover, not an inconvenience.
 *
 * This SUGGESTS and never rewrites. Someone whose address genuinely is unusual
 * has to be able to ignore it; silently replacing a correct address is the same
 * failure in the other direction and far harder to notice, because nothing on
 * screen ever admits it happened.
 *
 * This is the LAST line of defence rather than the first. By the time ops sees
 * the address it is about to become a vendor identity: the column every way
 * into the account is keyed on, and the one a reset code is sent to. A warning
 * here costs a glance; missing it costs an account.
 *
 * Three copies of this rule exist — here, in the app (sendy/src/lib) and in the
 * website (sendy-errands/assets/js/main.js). The three front ends share no
 * build, so the duplication is deliberate; if the lists are extended, extend
 * all three, or the gap simply moves to whichever one was forgotten.
 */

const PROVIDERS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'hotmail.co.uk', 'outlook.com', 'live.com', 'icloud.com', 'me.com',
  'aol.com', 'protonmail.com', 'proton.me', 'mail.com', 'yandex.com', 'zoho.com',
];

/** Transpositions too far for the distance check, or common enough to name. */
const EXPLICIT: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmali.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gmil.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.comm': 'gmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahou.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com', 'hotmai.com': 'hotmail.com', 'hotmial.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
  'outlook.con': 'outlook.com', 'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com',
};

/** Levenshtein, bailing early — only "is this small" matters. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** The corrected address, or null when there is nothing to say. */
export function suggestEmail(value: string): string | null {
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return null;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;

  const explicit = EXPLICIT[domain];
  if (explicit) return `${local}@${explicit}`;

  // An exact provider is correct by definition, and a company domain must
  // never be "corrected" into gmail.
  if (PROVIDERS.includes(domain)) return null;
  if (domain.length < 5) return null;

  const near = PROVIDERS.find((p) => distance(domain, p) <= 2);
  return near ? `${local}@${near}` : null;
}

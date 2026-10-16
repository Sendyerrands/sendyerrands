/**
 * A short, in-memory record of what happened to the session.
 *
 * Written because "the app randomly logged me out" is unfalsifiable from a
 * screen recording. Restoring a token, a background 401, a failed SecureStore
 * write and a tap on "Sign in" all look identical from the outside, and they
 * need completely different fixes. This makes the difference visible on the
 * Diagnostics screen, which a user can screenshot.
 *
 * Never record the token, the OTP, or anything else that would be a credential
 * if it were pasted into a chat. The events say what happened, not what with.
 */

export type AuthEvent =
  | 'restore.start'
  | 'restore.found'
  | 'restore.empty'
  | 'restore.read-failed'
  | 'restore.migrated'
  | 'verify.ok'
  | 'verify.401-signed-out'
  | 'verify.failed-kept-session'
  | 'signin.ok'
  | 'signin.persist-failed'
  | 'signout.manual'
  /** Ops suspended or deleted the account mid-session; the detail is the code. */
  | 'blocked.signed-out';

type Entry = { at: number; event: AuthEvent; detail?: string };

const MAX = 40;
const log: Entry[] = [];

export function recordAuth(event: AuthEvent, detail?: string) {
  log.push({ at: Date.now(), event, detail });
  if (log.length > MAX) log.shift();
  if (__DEV__) console.log(`[auth] ${event}${detail ? ` — ${detail}` : ''}`);
}

export function authLog(): readonly Entry[] {
  return log;
}

/**
 * Set when a token was accepted but could not be written to SecureStore.
 *
 * That user is signed in for exactly as long as the process lives, and lands on
 * onboarding at the next launch with no explanation — which is one of the ways
 * a "random logout" is actually produced. Surfacing it means the next report
 * can be diagnosed rather than guessed at.
 */
export let sessionPersistFailed = false;

export function markSessionPersistFailed() {
  sessionPersistFailed = true;
}

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { Actor } from '@/lib/api/endpoints';

/**
 * Remembered sign-ins, for development only.
 *
 * Testing this app means switching between a customer, a rider and sometimes a
 * vendor dozens of times an hour, retyping a full email and password at every
 * switch. This is the browser's "use saved login?" prompt, scoped to a debug
 * build.
 *
 * It is hard-gated on `__DEV__`, not on a flag: every function below is a no-op
 * in a release build, so a production binary neither writes a credential nor
 * has anything to read. That is deliberate — the thing that makes this
 * acceptable is that it cannot ship, and a runtime setting could be flipped.
 *
 * Stored in SecureStore (Keychain on iOS, Keystore-backed on Android) rather
 * than AsyncStorage, which is plain text on disk.
 *
 * SecureStore has no web implementation, and most of this app's testing happens
 * in the browser — so web falls back to sessionStorage. That is a real
 * downgrade and worth naming: it is readable by any script on the origin. It is
 * acceptable only because this whole module is dead in a release build, the
 * origin is a localhost dev server, and the credentials are test accounts.
 * sessionStorage rather than localStorage so it dies with the tab instead of
 * living on the machine indefinitely.
 */
export type SavedLogin = {
  email: string;
  password: string;
  actor: Actor;
  /** Last used, so the list is ordered by what you actually switch between. */
  at: number;
};

const KEY = 'sendy.dev.logins';
const MAX = 6;

/** SecureStore has no web implementation; availability is checked, not assumed. */
async function usable(): Promise<boolean> {
  if (!__DEV__) return false;
  if (Platform.OS === 'web') return typeof sessionStorage !== 'undefined';
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

/** One storage interface over the two backends, so the rest reads the same. */
async function read(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(KEY);
}

async function write(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      sessionStorage.setItem(KEY, value);
    } catch {
      /* private mode, quota, blocked site data */
    }
    return;
  }
  await SecureStore.setItemAsync(KEY, value);
}

export async function loadLogins(): Promise<SavedLogin[]> {
  if (!(await usable())) return [];
  try {
    const raw = await read();
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedLogin[])
      .filter((l) => l && typeof l.email === 'string' && typeof l.password === 'string')
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  } catch {
    // A corrupt blob should cost a convenience, never a sign-in screen.
    return [];
  }
}

/** Called after a sign-in that actually succeeded — never on a failed attempt. */
export async function rememberLogin(email: string, password: string, actor: Actor): Promise<void> {
  if (!(await usable())) return;
  try {
    const existing = await loadLogins();
    // One entry per email+role: the same address can be a customer and a rider,
    // and collapsing those would overwrite one set of credentials with another.
    const rest = existing.filter(
      (l) => !(l.email.toLowerCase() === email.toLowerCase() && l.actor === actor)
    );
    const next = [{ email, password, actor, at: Date.now() }, ...rest].slice(0, MAX);
    await write(JSON.stringify(next));
  } catch {
    /* Saving is a convenience; failing to save must not fail the sign-in. */
  }
}

export async function forgetLogin(email: string, actor: Actor): Promise<void> {
  if (!(await usable())) return;
  try {
    const rest = (await loadLogins()).filter(
      (l) => !(l.email.toLowerCase() === email.toLowerCase() && l.actor === actor)
    );
    await write(JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}

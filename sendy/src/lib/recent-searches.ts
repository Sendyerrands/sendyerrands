import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The searches this person actually ran.
 *
 * "Recent" was RECENT_SEARCHES from lib/mock — the same four strings for every
 * user on every device, presented under a clock icon as their own history.
 * Someone who had never searched saw "Jollof rice, iPhone charger, Pharmacy
 * near me, Dangote rice" and reasonably concluded the app was showing them
 * somebody else's activity.
 *
 * Stored with the same SecureStore/localStorage pair as the session, rather
 * than pulling in AsyncStorage for eight short strings. Search terms are not
 * secrets, but they are the user's, they stay on the device, and reusing the
 * existing helper means one storage story instead of two.
 */

const KEY = 'sendy.search.recent';

/** Enough to be useful, few enough to stay under SecureStore's ~2KB ceiling. */
const MAX = 8;
const MAX_TERM_LENGTH = 60;

const isWeb = Platform.OS === 'web';

async function read(): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

async function write(value: string) {
  try {
    if (isWeb) globalThis.localStorage?.setItem(KEY, value);
    else await SecureStore.setItemAsync(KEY, value);
  } catch {
    // A search that fails to persist is not worth interrupting anyone over.
    // The list is a convenience; losing it costs a retype.
  }
}

export async function loadRecentSearches(): Promise<string[]> {
  const raw = await read();
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filtered rather than trusted: this is parsed from storage that another
    // version of the app wrote, and a non-string here would crash the render.
    return parsed.filter((t): t is string => typeof t === 'string' && t.length > 0).slice(0, MAX);
  } catch {
    return [];
  }
}

/**
 * Records a term and returns the new list, so the caller can render the result
 * without a second read racing the write.
 */
export async function addRecentSearch(term: string): Promise<string[]> {
  const clean = term.trim().slice(0, MAX_TERM_LENGTH);
  if (!clean) return loadRecentSearches();

  const existing = await loadRecentSearches();

  // Case-insensitive dedupe, keeping the newest spelling: someone who searches
  // "Jollof" then "jollof" meant one thing, and two rows for it is clutter.
  const next = [clean, ...existing.filter((t) => t.toLowerCase() !== clean.toLowerCase())].slice(
    0,
    MAX
  );

  await write(JSON.stringify(next));
  return next;
}

export async function removeRecentSearch(term: string): Promise<string[]> {
  const next = (await loadRecentSearches()).filter(
    (t) => t.toLowerCase() !== term.trim().toLowerCase()
  );
  await write(JSON.stringify(next));
  return next;
}

export async function clearRecentSearches(): Promise<string[]> {
  try {
    if (isWeb) globalThis.localStorage?.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Same reasoning as write().
  }
  return [];
}

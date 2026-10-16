import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Resolves the API base URL.
 *
 * `localhost` only works on web and simulators. On a physical phone running
 * Expo Go, localhost is the PHONE — so we derive the dev machine's LAN IP from
 * the Expo host URI that already got the bundle to the device.
 *
 * Override with EXPO_PUBLIC_API_URL for staging/production builds.
 */
function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const port = 4000;

  // "192.168.1.20:8081" — the machine serving the bundle is the machine running the API.
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.experienceUrl?.replace(/^\w+:\/\//, '');
  const lanHost = hostUri?.split(':')[0];

  if (lanHost && lanHost !== 'localhost' && lanHost !== '127.0.0.1') {
    return `http://${lanHost}:${port}`;
  }

  // Android emulators reach the host machine through this alias, not localhost.
  if (Platform.OS === 'android') return `http://10.0.2.2:${port}`;

  return `http://localhost:${port}`;
}

export const API_BASE_URL = resolveBaseUrl();
const API_PREFIX = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * True when the token itself is dead and re-authenticating is the fix.
   *
   * Deliberately 401 only. There used to be a `needsSignIn` getter that also
   * counted 403, and every caller treated it as grounds for signing out — but
   * 403 means the token is valid and belongs to a different kind of account.
   * Discarding a working session over one is destructive, and it read to users
   * as the app logging them out at random. Retrying cannot fix a 403 either, so
   * screens handle it separately; nothing should collapse the two again.
   */
  get isAuthError() {
    return this.status === 401;
  }

  /**
   * True when the account itself is gone, not merely the token.
   *
   * Separate from isAuthError because the handling differs: an expired
   * token is worth retrying after a fresh sign-in, whereas a suspended or
   * deleted account will refuse every request until ops lifts it. Only
   * these two codes qualify - a bare 401 can be a token that merely aged
   * out, and tearing the session down for one of those is the overreach
   * the comment above warns about.
   */
  get isAccountBlocked() {
    return this.status === 401 && (this.code === 'ACCOUNT_SUSPENDED' || this.code === 'ACCOUNT_GONE');
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * How long to wait before assuming the network is gone.
 *
 * 30s, not 20s, because the API runs on Render's free tier: it sleeps after 15
 * minutes idle and the first request afterwards measured ~25s while the
 * instance woke. At 20s the client aborted a request that was about to
 * succeed, and reported it as "check your connection" — on a connection that
 * was fine.
 *
 * The real fix is a plan that does not sleep. Until then this is the floor.
 */
const TIMEOUT_MS = 30_000;

/**
 * Called when the API says the account is suspended or deleted.
 *
 * A callback rather than a direct import because the session store already
 * imports this module, and importing it back would be a cycle. The store
 * registers itself on mount.
 */
let onAccountBlocked: ((err: ApiError) => void) | null = null;

export function setAccountBlockedHandler(fn: ((err: ApiError) => void) | null) {
  onAccountBlocked = fn;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, signal, timeoutMs = TIMEOUT_MS } = options;

  // Compose the caller's signal with our own timeout.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort());

  try {
    const res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 204) return undefined as T;

    const payload = await res.json().catch(() => null);

    if (!res.ok) {
      const err = payload?.error;
      const apiError = new ApiError(
        res.status,
        err?.code ?? 'UNKNOWN',
        err?.message ?? 'Something went wrong. Please try again.',
        err?.details
      );
      /**
       * Tear the session down here rather than leaving it to whichever
       * screen happened to make the call. A suspended account otherwise
       * stays in the signed-in shell showing the same error on every tab
       * until the app is force-quit, because the only place that cleared a
       * session was the cold-start check in the store.
       */
      if (apiError.isAccountBlocked) onAccountBlocked?.(apiError);
      throw apiError;
    }

    // The API wraps every success in { data: … }.
    return (payload?.data ?? payload) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;

    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', "That took too long. Check your connection and try again.");
    }

    // fetch() rejects on DNS/connection failures. In development the usual
    // cause is the API not running, which is worth saying plainly; a customer
    // on a phone cannot act on a base URL, so they get the plain version.
    throw new ApiError(
      0,
      'NETWORK',
      __DEV__
        ? `Can't reach Sendy Errands. Is the API running at ${API_BASE_URL}?`
        : "Can't reach Sendy Errands. Check your connection and try again."
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: <T>(path: string, token?: string | null) => request<T>(path, { token }),
  post: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: 'POST', body, token }),
  patch: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: 'PATCH', body, token }),
  put: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: 'PUT', body, token }),
  del: <T>(path: string, token?: string | null) => request<T>(path, { method: 'DELETE', token }),
};

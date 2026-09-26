const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api/v1';

const TOKEN_KEY = 'sendy.admin.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Raised when the token is missing or rejected, so the shell can bounce to login. */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Your session has expired. Sign in again.') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Login is the one call that must not send (or require) a token. */
  auth?: boolean;
  signal?: AbortSignal;
};

/**
 * Single entry point for every admin API call.
 *
 * The API wraps success as `{ data }` and failure as `{ error: { code, message } }`,
 * so this unwraps `data` and turns anything else into a typed throw — react-query
 * then treats it as an error without every caller re-checking shapes.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;

  const token = getToken();
  if (auth && !token) throw new UnauthorizedError('You are not signed in.');

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  // A hung request should surface as an error rather than an endless spinner.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 20_000);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? timeout.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('The request timed out. Is the API running?', 0, 'TIMEOUT');
    }
    throw new ApiError(
      `Could not reach the API at ${BASE_URL}. Is it running?`,
      0,
      'NETWORK'
    );
  }
  clearTimeout(timer);

  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code?: string; message?: string } }
    | null;

  if (!res.ok) {
    const message = payload?.error?.message ?? `Request failed (${res.status}).`;
    if (res.status === 401 || res.status === 403) throw new UnauthorizedError(message);
    throw new ApiError(message, res.status, payload?.error?.code);
  }

  return payload?.data as T;
}

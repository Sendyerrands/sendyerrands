import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError } from '@/lib/api/client';
import { authApi, meApi, type ApiAddress, type ApiUser } from '@/lib/api/endpoints';
import { koboToNaira } from '@/lib/api/mappers';
import { markSessionPersistFailed, recordAuth } from '@/lib/diagnostics';
import {
  clearCartWeb,
  clearSession,
  loadCartWeb,
  loadSession,
  saveCartWeb,
  saveSession,
} from '@/lib/api/storage';
import type { Thumb } from '@/lib/mock';

/**
 * Session + cart.
 *
 * The cart deliberately stays on the device: the API creates an Order only at
 * checkout, from product IDs. Nothing is reserved or priced server-side until
 * the customer commits.
 */

export type CartLine = {
  id: string;
  name: string;
  note?: string;
  price: number; // naira — mappers converted at the API boundary
  qty: number;
  thumb: Thumb;
};

type AppState = {
  // session
  ready: boolean;
  token: string | null;
  signedIn: boolean;
  user: ApiUser | null;
  actor: 'customer' | 'rider' | 'vendor' | 'provider';
  signIn: (token: string, actor?: 'customer' | 'rider' | 'vendor' | 'provider') => Promise<void>;
  signOut: () => Promise<void>;
  email: string;
  setEmail: (v: string) => void;

  // addresses
  addresses: ApiAddress[];
  activeAddress: ApiAddress | null;
  setActiveAddress: (id: string) => void;

  // cart
  cart: CartLine[];
  vendorId: string | null;
  addToCart: (line: Omit<CartLine, 'qty'>, vendorId: string) => void;
  /**
   * True when adding from this vendor would empty the cart first.
   *
   * Exposed so a caller can ASK before it happens. The replacement itself is
   * deliberate — one rider goes to one pickup — but doing it silently is what
   * made the cart look broken: an item would go in and the previous one would
   * vanish with no explanation.
   */
  wouldReplaceCart: (vendorId: string) => boolean;
  setQty: (id: string, qty: number) => void;
  clearCart: () => void;
  cartCount: number;
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  discount: number;
  total: number;
  /** Fees for the vendor currently in the cart, so the preview matches checkout. */
  setVendorFees: (fees: { deliveryFee: number; freeOver?: number }) => void;
};

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [actor, setActor] = useState<'customer' | 'rider' | 'vendor' | 'provider'>('customer');
  const [email, setEmail] = useState('');

  /**
   * The cart is restored synchronously on web so it is already there for the
   * first render — a checkout screen that flashes empty and then fills in is
   * worse than one that is simply correct. `useState`'s initialiser runs once,
   * which is exactly the semantics wanted.
   */
  const [cart, setCart] = useState<CartLine[]>(() => restoreCart().lines);
  const [vendorId, setVendorId] = useState<string | null>(() => restoreCart().vendorId);
  const [vendorFees, setVendorFees] = useState<{ deliveryFee: number; freeOver?: number }>({
    deliveryFee: 1300,
  });
  const [activeAddressId, setActiveAddressId] = useState<string | null>(null);

  /**
   * Restore a stored token on launch.
   *
   * The stored token is trusted immediately and verified in the background,
   * rather than the other way round.
   *
   * Verifying first meant a single slow `/auth/session` call decided whether
   * the user was signed in, and *every* failure — timeout, DNS, 502 — looked
   * identical to an expired token: the app fell through to onboarding with a
   * perfectly good token still sitting in SecureStore. On Render's free tier
   * the API sleeps after 15 minutes and the first request takes ~25s to wake
   * it, past the client's abort. So anyone who opened the app less often than
   * every 15 minutes was signed out on roughly every launch, while whoever was
   * using it constantly never saw it once.
   *
   * A JWT is self-contained and lasts 30 days. There is nothing to ask the
   * server for at launch: if the token really is dead, the next authenticated
   * request returns 401 and QueryError offers signing in again.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      recordAuth('restore.start');

      // A SecureStore read can itself throw (keystore reset, restored backup).
      // That is a real signed-out state; anything else is not.
      const stored = await loadSession().catch((err) => {
        recordAuth('restore.read-failed', err instanceof Error ? err.message : String(err));
        return null;
      });
      if (cancelled) return;

      if (stored) {
        setToken(stored.token);
        setActor(stored.actor);
        recordAuth('restore.found', stored.actor);
      } else {
        recordAuth('restore.empty');
      }
      setReady(true);
      if (!stored) return;

      try {
        // Also the authoritative answer on actor, which matters when the stored
        // value is older than the app's understanding of the roles.
        const session = await authApi.session(stored.token);
        if (cancelled) return;
        setActor(session.actor);
        recordAuth('verify.ok', session.actor);
      } catch (err) {
        // ONLY 401 means the token is dead. A timeout or a 5xx means the API
        // was asleep or unreachable, which the user cannot fix by signing in.
        if (cancelled) return;
        if (!(err instanceof ApiError) || !err.isAuthError) {
          recordAuth(
            'verify.failed-kept-session',
            err instanceof ApiError ? `${err.status} ${err.code}` : 'unknown'
          );
          return;
        }
        recordAuth('verify.401-signed-out');
        await clearSession();
        setToken(null);
        setActor('customer');
        queryClient.clear();
      }
    })();
    return () => {
      cancelled = true;
    };
    // queryClient is stable for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: user } = useQuery({
    queryKey: ['me', token],
    queryFn: () => meApi.get(token!),
    enabled: Boolean(token) && actor === 'customer',
  });

  const { data: addresses } = useQuery({
    queryKey: ['addresses', token],
    queryFn: () => meApi.addresses(token!),
    enabled: Boolean(token) && actor === 'customer',
  });

  const signIn = useCallback(
    async (newToken: string, newActor: 'customer' | 'rider' | 'vendor' | 'provider' = 'customer') => {
      /**
       * State first, storage second.
       *
       * This used to `await saveSession(...)` before setting either piece of
       * state, so a SecureStore write that threw took the whole sign-in down
       * with it: the caller's await rejected, the navigation that follows it
       * never ran, and someone who had just typed a correct code was left
       * sitting on the OTP screen with no error. Letting them into the app on a
       * token the server already issued is strictly better, and the failure is
       * recorded rather than swallowed — it is why they will be signed out at
       * the next launch, and the Diagnostics screen can now say so.
       */
      setToken(newToken);
      setActor(newActor);

      try {
        await saveSession({ token: newToken, actor: newActor });
        recordAuth('signin.ok', newActor);
      } catch (err) {
        markSessionPersistFailed();
        recordAuth('signin.persist-failed', err instanceof Error ? err.message : String(err));
        console.warn('[auth] session could not be persisted; it will not survive a restart', err);
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    recordAuth('signout.manual');
    await clearSession();
    setToken(null);
    /*
      Reset the actor too. Without this it kept whatever it was — sign out of
      the rider app and `actor` stayed 'rider', which the splash reads to pick
      where to send a returning user. The 401 path below has always done this;
      a manual sign-out left more behind than an expired token did.
    */
    setActor('customer');
    setCart([]);
    /*
      And the cart's vendor. `setCart([])` alone left it set, so the mirror
      effect wrote `{lines: [], vendorId: 'someone'}` to web storage instead of
      clearing it — the next person to use that browser restored a stale
      vendor with an empty cart.
    */
    setVendorId(null);
    setActiveAddressId(null);
    queryClient.clear();
  }, [queryClient]);

  const addToCart = useCallback((line: Omit<CartLine, 'qty'>, vendor: string) => {
    setCart((prev) => {
      // Switching vendors replaces the cart — Sendy Errands dispatches one rider to one
      // pickup, so a mixed-vendor cart cannot be fulfilled.
      const base = vendor !== vendorIdRef.current && prev.length ? [] : prev;
      vendorIdRef.current = vendor;
      const found = base.find((l) => l.id === line.id);
      if (found) return base.map((l) => (l.id === line.id ? { ...l, qty: l.qty + 1 } : l));
      return [...base, { ...line, qty: 1 }];
    });
    setVendorId(vendor);
  }, []);

  // Kept in a ref so addToCart doesn't need vendorId in its dependency list.
  const vendorIdRef = useMemoRef(vendorId);

  const wouldReplaceCart = useCallback(
    (vendor: string) => cart.length > 0 && vendorId !== null && vendorId !== vendor,
    [cart.length, vendorId]
  );

  const setQty = useCallback((id: string, qty: number) => {
    setCart((prev) =>
      qty <= 0 ? prev.filter((l) => l.id !== id) : prev.map((l) => (l.id === id ? { ...l, qty } : l))
    );
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  // Mirror every cart change to storage so a reload — or the round trip through
  // Paystack, which is a full page load on web — picks up where it left off.
  useEffect(() => {
    if (cart.length === 0 && vendorId === null) clearCartWeb();
    else saveCartWeb(JSON.stringify({ lines: cart, vendorId }));
  }, [cart, vendorId]);

  const value = useMemo<AppState>(() => {
    const subtotal = cart.reduce((sum, l) => sum + l.price * l.qty, 0);
    const qualifiesFree = Boolean(vendorFees.freeOver && subtotal >= vendorFees.freeOver);
    const deliveryFee = cart.length ? (qualifiesFree ? 0 : vendorFees.deliveryFee) : 0;
    const serviceFee = cart.length ? 300 : 0;
    const discount = 0;

    const list = addresses ?? [];
    const active = list.find((a) => a.id === activeAddressId) ?? list.find((a) => a.isDefault) ?? list[0] ?? null;

    return {
      ready,
      token,
      signedIn: Boolean(token),
      user: user ?? null,
      actor,
      signIn,
      signOut,
      email,
      setEmail,
      addresses: list,
      activeAddress: active,
      setActiveAddress: setActiveAddressId,
      cart,
      vendorId,
      addToCart,
      wouldReplaceCart,
      setQty,
      clearCart,
      cartCount: cart.reduce((n, l) => n + l.qty, 0),
      subtotal,
      deliveryFee,
      serviceFee,
      discount,
      total: Math.max(0, subtotal + deliveryFee + serviceFee - discount),
      setVendorFees,
    };
  }, [
    ready, token, user, actor, signIn, signOut, email,
    addresses, activeAddressId, cart, vendorId, addToCart, wouldReplaceCart, setQty, clearCart,
    vendorFees,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * Reads the persisted cart. Returns an empty one on native, or on anything
 * unparseable — a corrupt cart is not worth a crash on launch.
 */
function restoreCart(): { lines: CartLine[]; vendorId: string | null } {
  const raw = loadCartWeb();
  if (!raw) return { lines: [], vendorId: null };
  try {
    const parsed = JSON.parse(raw) as { lines?: CartLine[]; vendorId?: string | null };
    return { lines: parsed.lines ?? [], vendorId: parsed.vendorId ?? null };
  } catch {
    clearCartWeb();
    return { lines: [], vendorId: null };
  }
}

/** Tiny helper: a ref that always mirrors the latest value. */
function useMemoRef<T>(value: T) {
  const ref = useMemo(() => ({ current: value }), []);
  ref.current = value;
  return ref;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

/** Wallet balance in naira, for display. */
export function useWalletBalance() {
  const { user } = useApp();
  return koboToNaira(user?.walletBalanceKobo);
}

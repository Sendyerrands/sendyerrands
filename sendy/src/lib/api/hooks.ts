import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { ImagePickerAsset } from 'expo-image-picker';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import type { Vendor } from '@/lib/mock';

import { useApp } from '@/store/app';

import { riderErrandApi } from './endpoints';
import { uploadImage, type UploadFolder } from './uploads';
import {
  clearPendingPayment,
  clearPendingTopup,
  getPendingPayment,
  getPendingTopup,
  savePendingPayment,
  savePendingTopup,
} from './storage';

import {
  marketplaceApi, meApi, ordersApi, paymentsApi, riderApi, vendorApi, vendorApplicationsApi, vendorsApi,
} from './endpoints';
import type { VendorProductBody } from './endpoints';
import type { VendorApplicationBody } from './endpoints';
import type { TopupResult } from './endpoints';
import {
  koboToNaira, toBid, toMenuItem, toOrder, toProduct, toRiderJob, toVendor,
} from './mappers';

/**
 * Screens use these, never the raw endpoints — every hook returns data already
 * mapped into the shapes the components render (naira, not kobo; `thumb`, not
 * `imageUrl`).
 */

// ── customer: discovery ─────────────────────────────────────

export function useVendors(params: { q?: string; openOnly?: boolean; sort?: string } = {}) {
  const { token } = useApp();
  return useQuery({
    queryKey: ['vendors', params],
    queryFn: async () => (await vendorsApi.list(params, token)).map(toVendor),
  });
}

export function useVendor(slug: string | undefined) {
  const { token } = useApp();
  return useQuery({
    queryKey: ['vendor', slug],
    queryFn: async () => {
      const v = await vendorsApi.detail(slug!, token);
      return {
        vendor: toVendor(v),
        menu: (v.products ?? []).map(toMenuItem),
        sections: v.sections ?? [],
        // The raw id is what POST /orders needs; the UI shows the slug.
        vendorId: v.id,
        freeOverKobo: v.freeOverKobo,
        deliveryFeeKobo: v.deliveryFeeKobo,
      };
    },
    enabled: Boolean(slug),
  });
}

export function useMarketplaceProducts(q?: string, state?: string) {
  const { token } = useApp();
  return useQuery({
    queryKey: ['marketplace-products', q ?? '', state ?? 'All'],
    queryFn: async () => (await marketplaceApi.products(q, state, token)).map(toProduct),
  });
}

/**
 * One product for the item screen.
 *
 * Returns the mapped product plus the bits the screen needs that `Product`
 * doesn't carry — the description, and the vendor's id/slug so "add to cart"
 * knows which vendor the order belongs to.
 */
export function useProduct(id: string | undefined) {
  const { token } = useApp();
  return useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const p = await marketplaceApi.product(id!, token);
      return {
        ...toProduct(p),
        description: p.description ?? '',
        section: p.section,
        badge: p.badge,
        vendorId: p.vendorId,
        vendorSlug: p.vendor?.slug ?? null,
        vendorVerified: p.vendor?.isVerified ?? false,
        vendorOpen: p.vendor?.isOpen ?? true,
        etaMin: p.vendor?.etaMinMinutes ?? null,
        etaMax: p.vendor?.etaMaxMinutes ?? null,
        deliveryFee: p.vendor?.deliveryFeeKobo != null ? koboToNaira(p.vendor.deliveryFeeKobo) : null,
        freeOver: p.vendor?.freeOverKobo ? koboToNaira(p.vendor.freeOverKobo) : undefined,
      };
    },
    enabled: Boolean(id),
  });
}

// ── customer: orders ────────────────────────────────────────

export function useOrders(status: 'active' | 'history' | 'all' = 'all') {
  const { token } = useApp();
  return useQuery({
    queryKey: ['orders', status],
    queryFn: async () => (await ordersApi.list(status, token!)).map(toOrder),
    enabled: Boolean(token),
  });
}

export function useOrder(id: string | undefined) {
  const { token } = useApp();
  return useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const o = await ordersApi.detail(id!, token!);
      return {
        order: toOrder(o),
        raw: o,
        stepper: o.stepper ?? [],
        rider: o.rider,
        deliveryCode: o.deliveryCode,
        totals: {
          subtotal: koboToNaira(o.subtotalKobo),
          deliveryFee: koboToNaira(o.deliveryFeeKobo),
          serviceFee: koboToNaira(o.serviceFeeKobo),
          discount: koboToNaira(o.discountKobo),
          total: koboToNaira(o.totalKobo),
        },
        items: (o.items ?? []).map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          price: koboToNaira(i.unitPriceKobo ?? 0),
          note: i.note ?? undefined,
        })),
      };
    },
    enabled: Boolean(id && token),
    // An in-flight delivery changes underneath the customer.
    refetchInterval: (query) =>
      query.state.data?.order.status === 'active' ? 15_000 : false,
  });
}

export function useCreateOrder() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { vendorId: string; addressId: string; items: { productId: string; quantity: number; note?: string }[] }) =>
      ordersApi.create(body, token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export type NewAddress = {
  label: string;
  line1: string;
  line2?: string;
  city?: string;
  landmark?: string;
  contact: string;
  phone: string;
  isDefault?: boolean;
};

/**
 * Adds a drop-off address. Invalidates `['addresses']`, which is the key the
 * app store loads from, so the new address appears everywhere at once.
 */
export function useAddAddress() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewAddress) =>
      meApi.addAddress(body as unknown as Parameters<typeof meApi.addAddress>[0], token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
}

/**
 * Closes the account.
 *
 * No cache invalidation on success — the caller signs out, which clears the
 * whole client. Invalidating first would refetch every query with a token whose
 * account no longer answers, turning a completed deletion into a screenful of
 * errors on the way to the sign-in screen.
 */
export function useDeleteAccount() {
  const { token } = useApp();
  return useMutation({
    mutationFn: (password: string) => meApi.deleteAccount(password, token!),
  });
}

/**
 * Notifications, plus the unread count the bell badge renders.
 *
 * Polled rather than pushed. There is no APNs/FCM setup yet, so the only way
 * an order update reaches a screen someone is already looking at is by asking.
 * A minute is the compromise: fast enough that "your rider has arrived" is not
 * stale by the time it matters, slow enough not to be a battery complaint.
 */
export function useNotifications() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => meApi.notifications(token!),
    enabled: Boolean(token),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationsRead() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => meApi.markNotificationsRead(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/**
 * Errand and package orders skip the cart entirely — they are described in one
 * form and priced by the server, so these post the whole thing in one call.
 * Money goes up as **kobo**, like everywhere else on the wire.
 */
export type ErrandBody = {
  addressId: string;
  task: string;
  details?: string;
  pickupName: string;
  pickupAddress: string;
  budgetKobo?: number;
  photoUrls?: string[];
};

export function useCreateErrand() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ErrandBody) => ordersApi.createErrand(body, token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export type PackageBody = {
  pickupName: string;
  pickupAddress: string;
  pickupPhone?: string;
  dropoffName: string;
  dropoffAddress: string;
  dropoffPhone: string;
  size: 'SMALL' | 'MEDIUM' | 'LARGE' | 'EXTRA_LARGE';
  contents?: string;
  isFragile?: boolean;
  notes?: string;
  addressId?: string;
  /**
   * Sent by the Logistics flow. The server recomputes the fee from these rather
   * than trusting a price or an "interstate" flag from the client, so omitting
   * them prices as a local delivery.
   */
  originState?: string;
  destinationState?: string;
};

export function useCreatePackage() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PackageBody) => ordersApi.createPackage(body, token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export function useCheckout() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, method }: { orderId: string; method: 'WALLET' | 'PAYSTACK' }) =>
      paymentsApi.checkout(orderId, method, Linking.createURL('/payment-success'), token!),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      // Paying moves the order off PENDING_PAYMENT — the tracking screen reads
      // this key and would otherwise keep offering the pay button.
      qc.invalidateQueries({ queryKey: ['order', v.orderId] });
      qc.invalidateQueries({ queryKey: ['me'] }); // wallet balance moved
      qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}

export function useCancelOrder() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => ordersApi.cancel(id, reason, token!),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', v.id] });
    },
  });
}

// ── customer: account ───────────────────────────────────────

export function useWallet() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['wallet', token],
    queryFn: async () => {
      const w = await meApi.wallet(token!);
      return {
        balance: koboToNaira(w.balanceKobo),
        transactions: w.transactions.map((t) => ({
          ...t,
          amount: koboToNaira(t.amountKobo),
          balance: koboToNaira(t.balanceKobo),
        })),
      };
    },
    enabled: Boolean(token),
  });
}

/**
 * Funds the wallet through Paystack's hosted checkout.
 *
 * `openAuthSessionAsync`, not `openBrowserAsync`: on Android the latter resolves
 * the moment the Custom Tab opens, so the mutation would "finish" while the
 * customer was still typing their card number. `openAuthSessionAsync` waits for
 * the redirect back to our deep link, or for the sheet to be dismissed.
 *
 * Then it verifies regardless of how the sheet closed. The browser cannot tell
 * us whether the card went through, and someone who paid and then hit Done
 * deserves the same answer as someone who waited for the redirect. The server
 * asks Paystack and credits idempotently, so calling this twice is harmless.
 */
export type TopupOutcome = TopupResult | { status: 'REDIRECTING' };

export function useTopUpWallet() {
  const { token } = useApp();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (amountKobo: number): Promise<TopupOutcome> => {
      const returnUrl = Linking.createURL('/wallet');
      const { authorizationUrl, reference } = await paymentsApi.topup(amountKobo, returnUrl, token!);

      /**
       * Web takes the whole tab; native gets the auth session.
       *
       * `openAuthSessionAsync` calls `window.open` on web, and by the time it
       * runs the `await` above has already ended the user activation that
       * authorised it — so the browser blocks the popup and the payment never
       * opens. Redirecting the tab has no such restriction, and it is how web
       * checkouts work anyway. The reference is parked first because this code
       * will not be alive when Paystack sends the customer back.
       */
      if (Platform.OS === 'web') {
        await savePendingTopup(reference);
        window.location.assign(authorizationUrl);
        return { status: 'REDIRECTING' };
      }

      await WebBrowser.openAuthSessionAsync(authorizationUrl, returnUrl);
      return paymentsApi.verifyTopup(reference, token!);
    },
    onSuccess: (result) => {
      if (result.status !== 'SUCCESS') return;
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['me'] }); // the balance on Profile
    },
  });
}

/**
 * Takes the customer to Paystack to pay for an order, then settles it.
 *
 * Same shape as the top-up, and for the same reason: web loses the tab, native
 * keeps the auth session. The reference is parked before leaving so the
 * confirmation screen can find out what happened without relying on being the
 * same instance that started it.
 */
export function usePayForOrder() {
  const { token } = useApp();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      orderId: string;
      reference: string;
      authorizationUrl: string;
    }): Promise<{ status: string; orderId: string } | { status: 'REDIRECTING' }> => {
      await savePendingPayment({ reference: input.reference, orderId: input.orderId });

      if (Platform.OS === 'web') {
        window.location.assign(input.authorizationUrl);
        return { status: 'REDIRECTING' };
      }

      await WebBrowser.openAuthSessionAsync(
        input.authorizationUrl,
        Linking.createURL('/payment-success')
      );

      const result = await paymentsApi.verify(input.reference, token!);
      await clearPendingPayment();
      return result;
    },
    onSuccess: (result) => {
      if (result.status !== 'SUCCESS') return;
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order'] });
    },
  });
}

/** Settles an order payment that finished while the app was navigated away. */
export function useSettleReturnedPayment() {
  const { token } = useApp();
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<{ status: string; orderId: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      const pending = await getPendingPayment().catch(() => null);
      if (!pending || cancelled) return;

      try {
        const result = await paymentsApi.verify(pending.reference, token);
        await clearPendingPayment();
        if (cancelled) return;

        setOutcome(result);
        qc.invalidateQueries({ queryKey: ['orders'] });
        qc.invalidateQueries({ queryKey: ['order', pending.orderId] });
      } catch {
        // Left parked so the next mount can try again.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, qc]);

  return outcome;
}

/**
 * Settles a top-up that finished while the app was navigated away.
 *
 * Runs on mount and asks the server about any parked reference. The reference
 * is only cleared once the server answers — a failed check leaves it in place
 * so the next mount tries again, because dropping it would strand a payment
 * the customer actually made.
 */
export function useSettleReturnedTopup() {
  const { token } = useApp();
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<TopupResult | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      const reference = await getPendingTopup().catch(() => null);
      if (!reference || cancelled) return;

      try {
        const result = await paymentsApi.verifyTopup(reference, token);
        await clearPendingTopup();
        if (cancelled) return;

        setOutcome(result);
        if (result.status === 'SUCCESS') {
          qc.invalidateQueries({ queryKey: ['wallet'] });
          qc.invalidateQueries({ queryKey: ['me'] });
        }
      } catch {
        // Left parked on purpose — see above.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, qc]);

  return outcome;
}

// ── marketplace / bidding ───────────────────────────────────

export function useMarketplaceRequests() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['marketplace-requests'],
    queryFn: () => marketplaceApi.requests(token!),
    enabled: Boolean(token),
  });
}

export function useBidRequest(id: string | undefined, sort: 'price' | 'eta' | 'rating') {
  const { token } = useApp();
  return useQuery({
    queryKey: ['bid-request', id, sort],
    queryFn: async () => {
      const r = await marketplaceApi.requestDetail(id!, sort, token!);
      return {
        request: {
          id: r.id,
          title: r.title,
          quantity: r.quantity,
          budget: koboToNaira(r.budgetKobo),
          dropoff: r.dropoffArea,
          closesAt: r.closesAt,
          bidCount: r.bids.length,
        },
        bids: r.bids.map(toBid),
        isOpen: r.isOpen,
      };
    },
    enabled: Boolean(id && token),
    // Bids arrive while the customer is watching.
    refetchInterval: (query) => (query.state.data?.isOpen ? 10_000 : false),
  });
}

export function usePostRequest() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => marketplaceApi.createRequest(body, token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketplace-requests'] }),
  });
}

export function useSelectBid() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, bidId }: { requestId: string; bidId: string }) =>
      marketplaceApi.selectBid(requestId, bidId, token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bid-request'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

// ── rider ───────────────────────────────────────────────────

export function useRiderMe() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['rider-me'],
    queryFn: async () => {
      const r = await riderApi.me(token!);
      return { ...r, todayEarnings: koboToNaira(r.today.earningsKobo), todayTrips: r.today.trips };
    },
    enabled: Boolean(token),
  });
}

/** The bank list, cached hard — it changes when a bank is licensed, not daily. */
export function useBanks() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['banks'],
    queryFn: () => riderApi.banks(token!),
    enabled: Boolean(token),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * Asks the bank who owns an account number, storing nothing.
 *
 * Separate from saving on purpose: the rider reads the name back and confirms
 * it is theirs before any money can be aimed at it. A transfer into a valid but
 * wrong account is a bank dispute, not something we can undo.
 */
export function useResolveAccount() {
  const { token } = useApp();
  return useMutation({
    mutationFn: ({ bankCode, accountNumber }: { bankCode: string; accountNumber: string }) =>
      riderApi.resolveAccount(bankCode, accountNumber, token!),
  });
}

export function useSavePayoutAccount() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bankCode, accountNumber }: { bankCode: string; accountNumber: string }) =>
      riderApi.savePayoutAccount(bankCode, accountNumber, token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rider-me'] }),
  });
}

export function useRiderJobs(sort: 'nearest' | 'payout' = 'nearest') {
  const { token } = useApp();
  return useQuery({
    queryKey: ['rider-jobs', sort],
    queryFn: async () => (await riderApi.jobs(sort, token!)).map(toRiderJob),
    enabled: Boolean(token),
    refetchInterval: 20_000, // the board moves as other riders claim work
  });
}

export function useRiderActive() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['rider-active'],
    queryFn: async () => {
      const j = await riderApi.active(token!);
      return j ? { job: toRiderJob(j), raw: j } : null;
    },
    enabled: Boolean(token),
    /**
     * An errand has two states where the rider is waiting on someone else: the
     * customer approving a price, and the customer confirming they paid the
     * seller. Nothing in the app tells them when that happens, so without a
     * poll a rider stands in a market watching a screen that will never change
     * and has no reason to think refreshing would help.
     */
    refetchInterval: (query) => {
      const status = query.state.data?.raw.status;
      return status === 'PRICE_PROPOSED' || status === 'RIDER_ASSIGNED' ? 15_000 : false;
    },
  });
}

export function useAcceptJob() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => riderApi.accept(id, token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rider-jobs'] });
      qc.invalidateQueries({ queryKey: ['rider-active'] });
    },
  });
}

export function useUpdateJobStatus() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED'; deliveryCode?: string; proofUrl?: string }) =>
      riderApi.updateStatus(id, body, token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rider-active'] });
      qc.invalidateQueries({ queryKey: ['rider-earnings'] });
      qc.invalidateQueries({ queryKey: ['rider-me'] });
    },
  });
}

export function useSetAvailability() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isOnline: boolean) => riderApi.setAvailability(isOnline, token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rider-me'] });
      qc.invalidateQueries({ queryKey: ['rider-jobs'] });
    },
  });
}

export function useRiderEarnings(range: 'today' | 'week' | 'month' = 'week') {
  const { token } = useApp();
  return useQuery({
    queryKey: ['rider-earnings', range],
    queryFn: async () => {
      const e = await riderApi.earnings(range, token!);
      return {
        available: koboToNaira(e.availableKobo),
        // What a payout would actually send now, versus what is still ageing
        // through the hold. One number for both made "available" a promise the
        // payout rules would not keep.
        payable: koboToNaira(e.payableKobo),
        held: koboToNaira(e.heldKobo),
        holdHours: e.holdHours,
        minimum: koboToNaira(e.minimumKobo),
        total: koboToNaira(e.totalKobo),
        trips: e.trips,
        rating: e.rating,
        week: e.series.map((s) => ({
          day: new Date(s.day).toLocaleDateString('en-NG', { weekday: 'short' }),
          value: koboToNaira(s.valueKobo),
        })),
      };
    },
    enabled: Boolean(token),
  });
}

export function useRiderPayouts() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['rider-payouts'],
    queryFn: () => riderApi.payouts(token!),
    enabled: Boolean(token),
  });
}

// ── customer: selling on Sendy Errands ──────────────────────────────

export function useMyVendorApplications() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['vendor-applications'],
    queryFn: () => vendorApplicationsApi.mine(token!),
    enabled: Boolean(token),
  });
}

export function useApplyToSell() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VendorApplicationBody) => vendorApplicationsApi.submit(body, token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendor-applications'] }),
  });
}

// ── customer: marketplace requests ──────────────────────────

/**
 * Posts a request for vendors to bid on.
 *
 * `photoUrls` are already-uploaded Cloudinary URLs — the screen uploads while
 * the customer is still typing, so submitting is one fast call rather than a
 * multi-megabyte one.
 */
export function useCreateRequest() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string;
      details?: string;
      quantity: number;
      budgetKobo?: number;
      dropoffArea: string;
      addressId?: string;
      photoUrls?: string[];
      bidWindowMinutes?: number;
    }) => marketplaceApi.createRequest(body, token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });
}

export function useUploadImage(folder: UploadFolder) {
  const { token } = useApp();
  return useMutation({
    mutationFn: (asset: ImagePickerAsset) => uploadImage(asset, folder, token!),
  });
}

/**
 * The jobs this rider accepted, active or finished.
 *
 * `useRiderJobs` is the open board of unclaimed work — a different list. A
 * rider had no way to see their own deliveries: accepting removed a job from
 * the board, and delivering removed it from everywhere.
 */
export function useRiderOrders(status: 'active' | 'completed' | 'all' = 'active') {
  const { token } = useApp();
  return useQuery({
    queryKey: ['rider-orders', status],
    queryFn: async () => (await riderApi.orders(status, token!)).map(toRiderJob),
    enabled: Boolean(token),
  });
}

// ── customer: favourites ────────────────────────────────────

export function useFavourites() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['favourites'],
    queryFn: async () => (await meApi.favourites(token!)).map(toVendor),
    enabled: Boolean(token),
  });
}

/** Just the ids, for cards that only need to know whether the heart is filled. */
export function useFavouriteIds(): Set<string> {
  const { data } = useFavourites();
  return new Set((data ?? []).map((v) => v.id));
}

/**
 * Toggles a saved vendor, updating the cache before the request lands.
 *
 * A heart that waits for a round trip reads as an unresponsive button on a
 * connection where that round trip can take a second. The cache is rolled back
 * if the write fails, so an optimistic heart never lies for longer than the
 * request takes to fail.
 */
export function useToggleFavourite() {
  const { token } = useApp();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ vendor, saved }: { vendor: Vendor; saved: boolean }) =>
      saved ? meApi.unsaveVendor(vendor.id, token!) : meApi.saveVendor(vendor.id, token!),

    onMutate: async ({ vendor, saved }) => {
      await qc.cancelQueries({ queryKey: ['favourites'] });
      const previous = qc.getQueryData<Vendor[]>(['favourites']);

      // The card hands over the whole vendor, so saving can fill the list
      // immediately instead of waiting a round trip to learn what it just
      // saved — the reason the heart used to look unresponsive.
      qc.setQueryData<Vendor[]>(['favourites'], (old = []) =>
        saved ? old.filter((v) => v.id !== vendor.id) : [vendor, ...old.filter((v) => v.id !== vendor.id)]
      );

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['favourites'], context.previous);
    },

    onSettled: () => qc.invalidateQueries({ queryKey: ['favourites'] }),
  });
}

// ── vendor ──────────────────────────────────────────────────

export function useVendorMe() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['vendor-me'],
    queryFn: () => vendorApi.me(token!),
    enabled: Boolean(token),
  });
}

export function useSetVendorOpen() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isOpen: boolean) => vendorApi.setOpen(isOpen, token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendor-me'] }),
  });
}

export function useVendorProducts() {
  const { token } = useApp();
  return useQuery({
    queryKey: ['vendor-products'],
    queryFn: () => vendorApi.products(token!),
    enabled: Boolean(token),
  });
}

/** Every catalogue write refreshes the list and the dashboard's product count. */
function useVendorProductMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor-products'] });
      qc.invalidateQueries({ queryKey: ['vendor-me'] });
    },
  });
}

export function useCreateVendorProduct() {
  const { token } = useApp();
  return useVendorProductMutation((body: VendorProductBody) =>
    vendorApi.createProduct(body, token!)
  );
}

export function useUpdateVendorProduct() {
  const { token } = useApp();
  return useVendorProductMutation((vars: { id: string; patch: Partial<VendorProductBody> }) =>
    vendorApi.updateProduct(vars.id, vars.patch, token!)
  );
}

export function useDeleteVendorProduct() {
  const { token } = useApp();
  return useVendorProductMutation((id: string) => vendorApi.deleteProduct(id, token!));
}

export function useVendorOrders(status: 'new' | 'active' | 'history' | 'all' = 'new') {
  const { token } = useApp();
  return useQuery({
    queryKey: ['vendor-orders', status],
    queryFn: () => vendorApi.orders(status, token!),
    enabled: Boolean(token),
    // A vendor watches this screen while cooking; a stale queue costs an order.
    refetchInterval: 20_000,
  });
}

export function useRespondToOrder() {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; accept: boolean; reason?: string }) =>
      vars.accept
        ? vendorApi.acceptOrder(vars.id, token!)
        : vendorApi.rejectOrder(vars.id, vars.reason, token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor-orders'] });
      qc.invalidateQueries({ queryKey: ['vendor-me'] });
    },
  });
}

// ── the errand loop ─────────────────────────────────────────

/**
 * The rider prices the item and names the seller's account.
 *
 * The account is resolved against Paystack on the server, and the response
 * carries the resolved holder name — which is the only thing standing between a
 * mistyped digit and money landing with a stranger. Sendy never moves this
 * money, so there is nothing to reverse if it goes wrong.
 */
export function useQuoteErrand(jobId: string) {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { actualItemKobo: number; bankCode: string; accountNumber: string }) =>
      riderErrandApi.quote(jobId, body, token!),
    onSuccess: () => {
      // 'rider-active' is the one that matters: it is what the active-delivery
      // screen renders. Leaving it out meant a successful action left the old
      // panel on screen, so the rider pressed again and got a 409 telling them
      // the job was not at a stage it had already passed.
      qc.invalidateQueries({ queryKey: ['rider-active'] });
      qc.invalidateQueries({ queryKey: ['rider-job', jobId] });
      qc.invalidateQueries({ queryKey: ['rider-jobs'] });
    },
  });
}

/** Rider: the item is in hand. Refused until the customer confirms payment. */
export function useAssetSecured(jobId: string) {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => riderErrandApi.assetSecured(jobId, token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rider-active'] });
      qc.invalidateQueries({ queryKey: ['rider-job', jobId] });
      qc.invalidateQueries({ queryKey: ['rider-deliveries'] });
    },
  });
}

/** Rider: arrived at the door. */
export function useAtDoorstep(jobId: string) {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => riderErrandApi.atDoorstep(jobId, token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rider-active'] });
      qc.invalidateQueries({ queryKey: ['rider-job', jobId] });
      qc.invalidateQueries({ queryKey: ['rider-deliveries'] });
    },
  });
}

/** Customer: confirms they transferred the item cost to the seller. */
export function useConfirmMerchantPaid(orderId: string) {
  const { token } = useApp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proofUrl?: string) => ordersApi.merchantPaid(orderId, proofUrl, token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

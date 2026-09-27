import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  Customer,
  DashboardStats,
  MarketplaceRequest,
  OrderDetail,
  OrderListItem,
  OrderStatus,
  PaymentsPage,
  Payout,
  PayoutsPage,
  PricingRuleType,
  ReviewStatus,
  ReviewsPage,
  SupportPage,
  SupportStatus,
  Rider,
  RiderStatus,
  Service,
  Vendor,
  VendorApplication,
  VendorApplicationStatus,
  VendorCatalogue,
} from '@/lib/types';

/** Ops screens are watched all day, so live counts refresh on their own. */
const LIVE_REFETCH_MS = 30_000;

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardStats>('/admin/dashboard'),
    refetchInterval: LIVE_REFETCH_MS,
  });
}

export function useRiders(status?: RiderStatus | 'ALL') {
  const query = status && status !== 'ALL' ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['riders', status ?? 'ALL'],
    queryFn: () => api<Rider[]>(`/admin/riders${query}`),
  });
}

export function useVerifyRider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: 'APPROVED' | 'REJECTED' | 'SUSPENDED'; note?: string }) =>
      api<Rider>(`/admin/riders/${vars.id}/verify`, {
        method: 'PATCH',
        body: { status: vars.status, ...(vars.note ? { note: vars.note } : {}) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['riders'] });
      // The pending-verification tile on the dashboard just changed.
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useOrders(filters: { status?: string; type?: string; channel?: string; q?: string }) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  // Filtered server-side rather than on the returned rows: the endpoint sends
  // the 100 most recent orders, so filtering here would show "web orders among
  // the last 100" while looking like "the last 100 web orders".
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.q) params.set('q', filters.q);
  const suffix = params.toString() ? `?${params}` : '';

  return useQuery({
    queryKey: ['orders', filters.status ?? '', filters.type ?? '', filters.channel ?? '', filters.q ?? ''],
    queryFn: () => api<OrderListItem[]>(`/admin/orders${suffix}`),
    refetchInterval: LIVE_REFETCH_MS,
  });
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderDetail>(`/admin/orders/${id}`),
    enabled: Boolean(id),
  });
}

/** Everything that mutates an order invalidates the same three views. */
function useOrderMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useAssignRider() {
  return useOrderMutation((vars: { orderId: string; riderId: string }) =>
    api(`/admin/orders/${vars.orderId}/assign`, { method: 'POST', body: { riderId: vars.riderId } })
  );
}

export function useSetOrderStatus() {
  return useOrderMutation((vars: { orderId: string; status: OrderStatus; note?: string }) =>
    api(`/admin/orders/${vars.orderId}/status`, {
      method: 'POST',
      body: { status: vars.status, ...(vars.note ? { note: vars.note } : {}) },
    })
  );
}

/**
 * Puts a price on an order. Invalidates payments too: a newly priced order can
 * appear in, or drop out of, the "delivered and never collected for" list.
 */
export function useQuoteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      orderId: string;
      deliveryFeeKobo: number;
      serviceFeeKobo: number;
      goodsEstimateKobo?: number;
      note?: string;
    }) => {
      const { orderId, ...body } = vars;
      return api(`/admin/orders/${orderId}/quote`, { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useRefundOrder() {
  return useOrderMutation((vars: { orderId: string; amountKobo?: number; reason?: string }) =>
    api(`/admin/orders/${vars.orderId}/refund`, {
      method: 'POST',
      body: {
        ...(vars.amountKobo ? { amountKobo: vars.amountKobo } : {}),
        ...(vars.reason ? { reason: vars.reason } : {}),
      },
    })
  );
}

export function useRequests(status?: string) {
  const query = status && status !== 'ALL' ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['requests', status ?? 'ALL'],
    queryFn: () => api<MarketplaceRequest[]>(`/admin/requests${query}`),
  });
}

/**
 * The admin list, not the public `GET /vendors` — that one caps `limit` at 50
 * and would quietly hide vendors once the catalogue grows past it.
 */
export function useVendors() {
  return useQuery({
    queryKey: ['vendors'],
    queryFn: () => api<Vendor[]>('/admin/vendors'),
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; isVerified?: boolean; canBid?: boolean; isOpen?: boolean }) => {
      const { id, ...patch } = vars;
      return api<Vendor>(`/admin/vendors/${id}`, { method: 'PATCH', body: patch });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });
}

/** A vendor's listings. Only fetched once its row is expanded. */
export function useVendorProducts(vendorId: string | null) {
  return useQuery({
    queryKey: ['vendor-products', vendorId],
    queryFn: () => api<VendorCatalogue>(`/admin/vendors/${vendorId}/products`),
    enabled: vendorId !== null,
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; name: string; orderItemsUnlinked: number }>(`/admin/products/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor-products'] });
      // The vendors table shows a product count, so it goes stale too.
      qc.invalidateQueries({ queryKey: ['vendors'] });
    },
  });
}

export function useDeleteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; name: string; productsDeleted: number }>(`/admin/vendors/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ── vendor applications ─────────────────────────────────────

export function useVendorApplications(status?: VendorApplicationStatus) {
  return useQuery({
    queryKey: ['vendor-applications', status ?? 'all'],
    queryFn: () =>
      api<VendorApplication[]>(
        `/admin/vendor-applications${status ? `?status=${status}` : ''}`
      ),
    refetchInterval: LIVE_REFETCH_MS,
  });
}

export function useDecideApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; decision: 'APPROVE' | 'REJECT'; note?: string }) => {
      const { id, ...body } = vars;
      return api<VendorApplication>(`/admin/vendor-applications/${id}/decide`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor-applications'] });
      // Approving creates a vendor, so that list is stale too.
      qc.invalidateQueries({ queryKey: ['vendors'] });
    },
  });
}

export function useInviteVendors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { requestId: string; vendorIds: string[] }) =>
      api<MarketplaceRequest>(`/admin/requests/${vars.requestId}/invite`, {
        method: 'POST',
        body: { vendorIds: vars.vendorIds },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });
}

export function usePayouts() {
  return useQuery({
    queryKey: ['payouts'],
    queryFn: () => api<PayoutsPage>('/admin/payouts'),
    // Transfers settle asynchronously, so a PROCESSING row becomes SUCCESS
    // without anyone touching the page.
    refetchInterval: 30_000,
  });
}

export function useSendPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { riderId: string; ignoreMinimum?: boolean }) =>
      api<{ reference: string; amountKobo: number; status: string }>(
        `/admin/riders/${vars.riderId}/payout`,
        { method: 'POST', body: { ignoreMinimum: vars.ignoreMinimum ?? false } }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }),
  });
}

/* ---- customers ----
   A directory, not a queue: it changes when someone orders, so it is not
   polled. */

export function useCustomers(q?: string) {
  const search = q?.trim();
  return useQuery({
    queryKey: ['customers', search ?? ''],
    queryFn: () => api<Customer[]>(`/admin/customers${search ? `?q=${encodeURIComponent(search)}` : ''}`),
  });
}

/* ---- payments ----
   Money in. Separate from payouts, which are money out. */

/** Both filters go to the server — see the route for why they differ in reach. */
export function paymentsQuery(filters: { status?: string; channel?: string }) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.channel) params.set('channel', filters.channel);
  return params.toString() ? `?${params}` : '';
}

export function usePayments(filters: { status?: string; channel?: string } = {}) {
  return useQuery({
    queryKey: ['payments', filters.status ?? '', filters.channel ?? ''],
    queryFn: () => api<PaymentsPage>(`/admin/payments${paymentsQuery(filters)}`),
    refetchInterval: LIVE_REFETCH_MS,
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      orderId: string;
      provider: 'CASH' | 'BANK_TRANSFER';
      amountKobo?: number;
      reference?: string;
      note?: string;
    }) => {
      const { orderId, ...body } = vars;
      return api<{ fullyPaid: boolean; outstandingKobo: number }>(
        `/admin/orders/${orderId}/payment`,
        { method: 'POST', body }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      // A recorded payment can move the order's status, and it changes what the
      // customer has spent.
      qc.invalidateQueries({ queryKey: ['order'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function useReconcilePayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Payout>(`/admin/payouts/${id}/reconcile`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }),
  });
}

/* ---- support ----
   A queue someone works through, so it refreshes like the other ops screens. */

export function useSupportRequests(status?: string) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  return useQuery({
    queryKey: ['support', status ?? ''],
    queryFn: () => api<SupportPage>(`/admin/support${suffix}`),
    refetchInterval: LIVE_REFETCH_MS,
  });
}

export function useUpdateSupportRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      status?: SupportStatus;
      internalNote?: string;
      markRead?: boolean;
    }) => {
      const { id, ...body } = vars;
      return api(`/admin/support/${id}`, { method: 'PATCH', body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['support'] }),
  });
}

/* ---- reviews ----
   A queue someone works through, so it refreshes on the live interval like the
   other ops screens. */

export function useReviews(status?: string) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  return useQuery({
    queryKey: ['reviews', status ?? ''],
    queryFn: () => api<ReviewsPage>(`/admin/reviews${suffix}`),
    refetchInterval: LIVE_REFETCH_MS,
  });
}

export function useModerateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: ReviewStatus }) =>
      api(`/admin/reviews/${vars.id}`, { method: 'PATCH', body: { status: vars.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  });
}

/* ---- service catalogue ----
   Not on LIVE_REFETCH_MS: a price list changes when someone edits it, not on
   its own, so polling it every 30s would be noise. */

export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => api<Service[]>('/admin/services'),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      name?: string;
      shortDescription?: string;
      baseFeeKobo?: number;
      isActive?: boolean;
      sortOrder?: number;
    }) => {
      const { id, ...body } = vars;
      return api<Service>(`/admin/services/${id}`, { method: 'PATCH', body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateServiceRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      rules: { type: PricingRuleType; label: string; value: string; isActive?: boolean }[];
    }) => api<Service>(`/admin/services/${vars.id}/rules`, { method: 'PUT', body: { rules: vars.rules } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

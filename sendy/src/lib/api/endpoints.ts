import { api } from './client';
import type { ApiBid, ApiOrder, ApiProduct, ApiRiderJob, ApiVendor } from './mappers';

/**
 * One function per endpoint. Thin on purpose — mapping to UI shapes happens in
 * the hooks, so these stay a faithful mirror of the API surface.
 */

// ── auth ────────────────────────────────────────────────────
export type Actor = 'customer' | 'rider' | 'vendor';

/** The code is emailed. `devCode` comes back only when OTP_DEV_MODE is on. */
export type ForgotPasswordResult = {
  email: string;
  expiresInSeconds: number;
  devCode?: string;
};

export type Session = {
  token: string;
  isNewAccount?: boolean;
  user?: ApiUser;
  rider?: ApiRider;
  vendor?: ApiVendorSession;
};

export type ApiUser = {
  id: string; phone: string; firstName: string; lastName: string;
  email: string | null; walletBalanceKobo: number; referralCode: string;
};

export type ApiRider = {
  id: string; phone: string; firstName: string; lastName: string;
  status: 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  isOnline: boolean; rating?: number;
  bankCode?: string | null; bankAccountNo?: string | null;
  bankName?: string | null; bankAccountName?: string | null;
};

export type Bank = { name: string; code: string; slug: string };

export type PayoutAccount = {
  bankCode: string | null; bankAccountNo: string | null;
  bankName: string | null; bankAccountName: string | null;
};

export type ApiVendorSession = {
  id: string; name: string; slug: string; phone: string | null;
  isVerified: boolean; isOpen: boolean;
};

export type ApiAddress = {
  id: string; label: string; line1: string; line2: string | null;
  city: string; landmark: string | null; contact: string; phone: string; isDefault: boolean;
};

export const authApi = {
  /** Customers and riders only — a vendor account is created by ops. */
  register: (input: {
    email: string; password: string;
    firstName: string; lastName: string; phone: string;
    role?: 'customer' | 'rider';
    referredByCode?: string;
    vehicleType?: 'MOTORBIKE' | 'BICYCLE' | 'TRICYCLE' | 'CAR' | 'VAN' | 'FOOT';
    plateNumber?: string;
  }) => api.post<Session>('/auth/register', input),

  login: (input: { email: string; password: string; role?: Actor }) =>
    api.post<Session>('/auth/login', input),

  /**
   * Always succeeds, whether or not the address is registered — the API refuses
   * to confirm which, so the screen must not imply an answer either.
   */
  forgotPassword: (email: string, role: Actor = 'customer') =>
    api.post<ForgotPasswordResult>('/auth/password/forgot', { email, role }),

  resetPassword: (input: { email: string; code: string; password: string; role?: Actor }) =>
    api.post<{ ok: true }>('/auth/password/reset', input),

  /** Requires the current password, so a borrowed unlocked phone can't lock the owner out. */
  changePassword: (input: { currentPassword: string; newPassword: string }, token: string) =>
    api.post<{ ok: true }>('/auth/password/change', input, token),

  session: (token: string) =>
    api.get<{ actor: Actor; user?: ApiUser; rider?: ApiRider; vendor?: ApiVendorSession }>(
      '/auth/session',
      token
    ),
};

// ── customer ────────────────────────────────────────────────
export const meApi = {
  get: (token: string) => api.get<ApiUser>('/me', token),
  update: (body: Partial<Pick<ApiUser, 'firstName' | 'lastName' | 'email'>>, token: string) =>
    api.patch<ApiUser>('/me', body, token),
  addresses: (token: string) => api.get<ApiAddress[]>('/me/addresses', token),
  addAddress: (body: Omit<ApiAddress, 'id'>, token: string) =>
    api.post<ApiAddress>('/me/addresses', body, token),
  favourites: (token: string) => api.get<ApiVendor[]>('/me/favourites', token),
  saveVendor: (vendorId: string, token: string) =>
    api.put<{ vendorId: string; saved: boolean }>(`/me/favourites/${vendorId}`, {}, token),
  unsaveVendor: (vendorId: string, token: string) =>
    api.del<{ vendorId: string; saved: boolean }>(`/me/favourites/${vendorId}`, token),

  wallet: (token: string) =>
    api.get<{ balanceKobo: number; transactions: WalletTxn[] }>('/me/wallet', token),

  /**
   * Closes the account. POST rather than DELETE because it carries a body —
   * the password, re-checked server-side so a borrowed unlocked phone cannot
   * do this.
   */
  deleteAccount: (password: string, token: string) =>
    api.post<{ deleted: true }>('/me/delete', { password }, token),

  /** The list and the badge count in one call, so they cannot disagree. */
  notifications: (token: string) =>
    api.get<{ items: ApiNotification[]; unread: number }>('/me/notifications', token),

  /** Omit `id` to mark everything read. */
  markNotificationsRead: (token: string, id?: string) =>
    api.post<{ marked: number; unread: number }>(
      '/me/notifications/read',
      id ? { id } : {},
      token
    ),
};

export type ApiDeliveryBid = {
  id: string;
  orderId: string;
  riderId: string;
  priceKobo: number;
  note: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN';
  createdAt: string;
  /** Enough to choose on more than price alone. */
  rider: {
    id: string;
    firstName: string;
    lastName: string;
    rating: number;
    completedJobs: number;
    vehicleType: string | null;
  };
};

export type ApiNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  orderId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type WalletTxn = {
  id: string; type: string; amountKobo: number; balanceKobo: number;
  description: string; createdAt: string;
};

export type VendorApplicationBody = {
  businessName: string;
  category: string;
  area: string;
  state?: string;
  phone: string;
  address?: string;
  contactName?: string;
};

export type ApiVendorApplication = {
  id: string;
  businessName: string;
  category: string;
  area: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export const vendorApplicationsApi = {
  submit: (body: VendorApplicationBody, token: string) =>
    api.post<ApiVendorApplication>('/vendor-applications', body, token),
  mine: (token: string) => api.get<ApiVendorApplication[]>('/vendor-applications/mine', token),
};

export const vendorsApi = {
  list: (params: { q?: string; openOnly?: boolean; sort?: string; limit?: number } = {}, token?: string | null) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
    ).toString();
    return api.get<ApiVendor[]>(`/vendors${qs ? `?${qs}` : ''}`, token);
  },
  detail: (slug: string, token?: string | null) => api.get<ApiVendor>(`/vendors/${slug}`, token),
};

export const ordersApi = {
  create: (
    body: { vendorId: string; addressId: string; items: { productId: string; quantity: number; note?: string }[] },
    token: string
  ) => api.post<ApiOrder>('/orders', body, token),

  createErrand: (body: Record<string, unknown>, token: string) =>
    api.post<ApiOrder>('/orders/errand', body, token),

  createPackage: (body: Record<string, unknown>, token: string) =>
    api.post<ApiOrder>('/orders/package', body, token),

  list: (status: 'active' | 'history' | 'all', token: string) =>
    api.get<ApiOrder[]>(`/orders?status=${status}`, token),

  detail: (id: string, token: string) => api.get<ApiOrder>(`/orders/${id}`, token),

  /** Riders who want more than was offered, cheapest first. */
  bids: (id: string, token: string) =>
    api.get<{ offeredKobo: number; assigned: boolean; bids: ApiDeliveryBid[] }>(
      `/orders/${id}/bids`,
      token
    ),

  acceptBid: (id: string, bidId: string, token: string) =>
    api.post<ApiOrder>(`/orders/${id}/bids/${bidId}/accept`, {}, token),

  cancel: (id: string, reason: string | undefined, token: string) =>
    api.post<ApiOrder>(`/orders/${id}/cancel`, { reason }, token),

  /**
   * Records that the customer transferred the item cost to the seller.
   *
   * A claim, not a verified fact — Sendy never sees that money. What it stores
   * is a timestamp, the resolved account name the customer was shown, and
   * optionally their transfer receipt.
   */
  merchantPaid: (id: string, proofUrl: string | undefined, token: string) =>
    api.post<ApiOrder>(`/orders/${id}/merchant-paid`, { proofUrl }, token),
};

/** What the rider reports from the stall, once Paystack has resolved it. */
export type MerchantQuote = {
  accountName: string;
  accountNumber: string;
  bankName: string | null;
};

export const riderErrandApi = {
  /** Price the item and name the seller's account. Resolved server-side. */
  quote: (
    jobId: string,
    body: { actualItemKobo: number; bankCode: string; accountNumber: string },
    token: string
  ) => api.post<{ order: ApiOrder; merchant: MerchantQuote }>(`/rider/jobs/${jobId}/quote`, body, token),

  assetSecured: (jobId: string, token: string) =>
    api.post<ApiOrder>(`/rider/jobs/${jobId}/asset-secured`, {}, token),

  atDoorstep: (jobId: string, token: string) =>
    api.post<ApiOrder>(`/rider/jobs/${jobId}/doorstep`, {}, token),
};

export const paymentsApi = {
  checkout: (orderId: string, method: 'WALLET' | 'PAYSTACK', callbackUrl: string, token: string) =>
    api.post<{ method: string; status: string; walletBalanceKobo?: number; authorizationUrl?: string; reference?: string }>(
      '/payments/checkout',
      { orderId, method, callbackUrl },
      token
    ),
  verify: (reference: string, token: string) =>
    api.post<{ status: string; orderId: string }>('/payments/verify', { reference }, token),

  topup: (amountKobo: number, callbackUrl: string, token: string) =>
    api.post<{ authorizationUrl: string; reference: string }>(
      '/payments/wallet/topup',
      { amountKobo, callbackUrl },
      token
    ),

  /** Settles a top-up once the payment sheet closes. Safe to call repeatedly. */
  verifyTopup: (reference: string, token: string) =>
    api.post<TopupResult>('/payments/wallet/verify', { reference }, token),
};

export type TopupResult = {
  status: 'SUCCESS' | 'FAILED' | 'ABANDONED';
  creditedKobo: number;
  balanceKobo: number;
};

export const marketplaceApi = {
  products: (q: string | undefined, state: string | undefined, token?: string | null) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (state && state !== 'All') qs.set('state', state);
    return api.get<ApiProduct[]>(`/marketplace/products${qs.toString() ? `?${qs}` : ''}`, token);
  },

  /**
   * One product for the item screen. Serves both a vendor's menu item and a
   * marketplace listing, so it is not filtered to `isMarketplace`.
   */
  product: (id: string, token?: string | null) =>
    api.get<ApiProduct>(`/marketplace/products/${id}`, token),

  requests: (token: string) =>
    api.get<(MarketplaceRequest & { _count: { bids: number } })[]>('/marketplace/requests', token),

  createRequest: (body: Record<string, unknown>, token: string) =>
    api.post<MarketplaceRequest>('/marketplace/requests', body, token),

  requestDetail: (id: string, sort: 'price' | 'eta' | 'rating', token: string) =>
    api.get<MarketplaceRequest & { bids: ApiBid[]; isOpen: boolean }>(
      `/marketplace/requests/${id}?sort=${sort}`,
      token
    ),

  selectBid: (requestId: string, bidId: string, token: string) =>
    api.post<ApiOrder>(`/marketplace/requests/${requestId}/select`, { bidId }, token),
};

export type MarketplaceRequest = {
  id: string; title: string; details: string | null; quantity: number;
  budgetKobo: number | null; dropoffArea: string; status: string; closesAt: string;
};

// ── rider ───────────────────────────────────────────────────
export const riderApi = {
  me: (token: string) =>
    api.get<ApiRider & { today: { earningsKobo: number; trips: number }; zone: string | null; plateNumber: string | null; vehicleType: string | null; completedJobs: number }>(
      '/rider/me',
      token
    ),

  setAvailability: (isOnline: boolean, token: string) =>
    api.patch<{ id: string; isOnline: boolean }>('/rider/availability', { isOnline }, token),

  banks: (token: string) => api.get<Bank[]>('/rider/banks', token),

  /**
   * Ask for more than the customer offered.
   *
   * The alternative is `acceptJob`, which is unchanged and stays the one-tap
   * path — this is only for a rider who wants the job at a different price.
   */
  bid: (orderId: string, priceKobo: number, note: string | undefined, token: string) =>
    api.post<ApiDeliveryBid>(`/rider/jobs/${orderId}/bid`, { priceKobo, note }, token),

  withdrawBid: (orderId: string, token: string) =>
    api.del<{ withdrawn: true }>(`/rider/jobs/${orderId}/bid`, token),

  /** Asks the bank who owns an account, without storing anything. */
  resolveAccount: (bankCode: string, accountNumber: string, token: string) =>
    api.post<{ accountNumber: string; accountName: string }>(
      '/rider/payout-account/resolve',
      { bankCode, accountNumber },
      token
    ),

  savePayoutAccount: (bankCode: string, accountNumber: string, token: string) =>
    api.put<PayoutAccount>('/rider/payout-account', { bankCode, accountNumber }, token),

  jobs: (sort: 'nearest' | 'payout', token: string) =>
    api.get<ApiRiderJob[]>(`/rider/jobs?sort=${sort}`, token),

  job: (id: string, token: string) => api.get<ApiRiderJob & ApiOrder>(`/rider/jobs/${id}`, token),

  accept: (id: string, token: string) => api.post<ApiOrder>(`/rider/jobs/${id}/accept`, {}, token),

  active: (token: string) => api.get<(ApiRiderJob & ApiOrder) | null>('/rider/active', token),

  /** Jobs this rider accepted — the open board is `jobs` above. */
  orders: (status: 'active' | 'completed' | 'all', token: string) =>
    api.get<ApiRiderJob[]>(`/rider/orders?status=${status}`, token),

  updateStatus: (
    id: string,
    body: { status: 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED'; deliveryCode?: string; proofUrl?: string },
    token: string
  ) => api.post<ApiOrder>(`/rider/jobs/${id}/status`, body, token),

  earnings: (range: 'today' | 'week' | 'month', token: string) =>
    api.get<{
      availableKobo: number; payableKobo: number; heldKobo: number;
      holdHours: number; minimumKobo: number;
      totalKobo: number; trips: number; rating: number;
      series: { day: string; valueKobo: number }[];
      earnings: { id: string; grossKobo: number; commissionKobo: number; netKobo: number; createdAt: string }[];
    }>(`/rider/earnings?range=${range}`, token),

  payouts: (token: string) => api.get<ApiPayout[]>('/rider/payouts', token),
};

export type ApiPayout = {
  id: string;
  amountKobo: number;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
  reference: string;
  bankName: string | null;
  bankAccountNo: string | null;
  failureReason: string | null;
  createdAt: string;
  settledAt: string | null;
};

export const uploadsApi = {
  signature: (folder: string, token: string) =>
    api.post<{ signature: string; timestamp: number; folder: string; apiKey: string; cloudName: string; uploadUrl: string }>(
      '/uploads/signature',
      { folder },
      token
    ),
};

// ── vendor ──────────────────────────────────────────────────
export type ApiVendorProduct = {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  section: string | null;
  badge: string | null;
  imageUrl: string | null;
  isMarketplace: boolean;
  inStock: boolean;
  _count: { orderItems: number };
};

export type VendorProductBody = {
  name: string;
  description?: string;
  priceKobo: number;
  section?: string;
  imageUrl?: string;
  isMarketplace?: boolean;
  inStock?: boolean;
};

export type ApiVendorMe = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  area: string | null;
  isVerified: boolean;
  isOpen: boolean;
  rating: number;
  _count: { products: number; orders: number };
  today: { salesKobo: number; orders: number };
  awaitingAcceptance: number;
};

export const vendorApi = {
  me: (token: string) => api.get<ApiVendorMe>('/vendor/me', token),

  setOpen: (isOpen: boolean, token: string) =>
    api.patch<{ id: string; isOpen: boolean }>('/vendor/me', { isOpen }, token),

  products: (token: string) => api.get<ApiVendorProduct[]>('/vendor/products', token),

  createProduct: (body: VendorProductBody, token: string) =>
    api.post<ApiVendorProduct>('/vendor/products', body, token),

  updateProduct: (id: string, body: Partial<VendorProductBody>, token: string) =>
    api.patch<ApiVendorProduct>(`/vendor/products/${id}`, body, token),

  deleteProduct: (id: string, token: string) =>
    api.del<{ id: string; name: string }>(`/vendor/products/${id}`, token),

  orders: (status: 'new' | 'active' | 'history' | 'all', token: string) =>
    api.get<ApiVendorOrder[]>(`/vendor/orders?status=${status}`, token),

  acceptOrder: (id: string, token: string) =>
    api.post<ApiOrder>(`/vendor/orders/${id}/accept`, {}, token),

  rejectOrder: (id: string, reason: string | undefined, token: string) =>
    api.post<ApiOrder>(`/vendor/orders/${id}/reject`, { reason }, token),
};

export type ApiVendorOrder = {
  id: string;
  reference: string;
  status: string;
  subtotalKobo: number;
  totalKobo: number;
  createdAt: string;
  items: { id: string; name: string; quantity: number; unitPriceKobo: number; note: string | null }[];
  customer: { firstName: string; lastName: string; phone: string } | null;
  address: { line1: string; city: string; landmark: string | null } | null;
  rider: { firstName: string; lastName: string; phone: string } | null;
};

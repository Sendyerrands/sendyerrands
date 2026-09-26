/**
 * Shapes returned by the admin API.
 *
 * These mirror `api/prisma/schema.prisma` as the admin routes serialise it —
 * Prisma models are returned whole, so money stays in **kobo integers** and
 * dates arrive as ISO strings. Convert with `naira()` at the render edge; never
 * store naira in state, or a stray value renders 100x wrong.
 */

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PLACED'
  | 'VENDOR_ACCEPTED'
  | 'RIDER_ASSIGNED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type OrderType = 'FOOD' | 'PACKAGE' | 'ERRAND' | 'MARKETPLACE';

/** Where an order came in from. WEB orders are booked on the website, with no
 *  account behind them — the customer record is minted from their phone. */
export type OrderChannel = 'APP' | 'WEB';

export type SupportStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export type SupportCategory =
  | 'ORDER_ISSUE'
  | 'MISSING_ITEM'
  | 'DELIVERY_PROBLEM'
  | 'REFUND_REQUEST'
  | 'PAYMENT_ISSUE'
  | 'GENERAL';

export type SupportRequest = {
  id: string;
  reference: string;
  name: string;
  email: string | null;
  phone: string | null;
  subject: string;
  category: SupportCategory;
  message: string;
  status: SupportStatus;
  /** Null means nobody in ops has opened it yet. */
  readAt: string | null;
  internalNote: string | null;
  createdAt: string;
  order: { reference: string } | null;
  user: { firstName: string; lastName: string; phone: string } | null;
};

export type SupportPage = {
  requests: SupportRequest[];
  counts: Record<SupportStatus, number>;
  unread: number;
};

export type ReviewStatus = 'PENDING' | 'PUBLISHED' | 'HIDDEN';

export type Review = {
  id: string;
  overallRating: number;
  riderRating: number | null;
  serviceRating: number | null;
  comment: string | null;
  status: ReviewStatus;
  createdAt: string;
  order: { reference: string; type: OrderType; channel: OrderChannel } | null;
  customer: { firstName: string; lastName: string } | null;
  rider: { firstName: string; lastName: string } | null;
};

/** The queue plus how much is sitting in each state, so the tabs can say so. */
export type ReviewsPage = {
  reviews: Review[];
  counts: Record<ReviewStatus, number>;
};

export type PricingRuleType = 'PER_KM' | 'PER_KG' | 'WAITING_TIME' | 'URGENCY_MULTIPLIER' | 'FLAT_FEE';

export type PricingRule = {
  id: string;
  serviceId: string;
  type: PricingRuleType;
  label: string;
  /** A string, not a number: Prisma serialises Decimal as a string, and
   *  parsing it into a float here is how 1.30 becomes 1.2999999999999998. */
  value: string;
  isActive: boolean;
};

export type Service = {
  id: string;
  /** Used by the website's URLs and booking form, so it is not editable. */
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  icon: string | null;
  baseFeeKobo: number;
  isActive: boolean;
  sortOrder: number;
  pricingRules: PricingRule[];
};

export type RiderStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export type DocumentStatus = 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export type AdminRole = 'SUPERADMIN' | 'OPERATIONS' | 'SUPPORT';

export type Admin = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
};

export type DashboardStats = {
  ordersToday: number;
  gmvTodayKobo: number;
  activeRiders: number;
  pendingVerifications: number;
  openRequests: number;
  liveOrders: number;
};

export type RiderDocument = {
  id: string;
  type: string;
  fileUrl: string;
  status: DocumentStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
};

export type Rider = {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  plateNumber: string | null;
  zone: string | null;
  status: RiderStatus;
  isOnline: boolean;
  rating: number;
  completedJobs: number;
  bankName: string | null;
  bankAccountNo: string | null;
  createdAt: string;
  documents: RiderDocument[];
  _count?: { orders: number };
};

export type OrderListItem = {
  id: string;
  reference: string;
  type: OrderType;
  channel: OrderChannel;
  status: OrderStatus;
  totalKobo: number;
  createdAt: string;
  customer: { firstName: string; lastName: string; phone: string } | null;
  rider: { firstName: string; lastName: string; phone: string } | null;
  vendor: { name: string } | null;
};

export type OrderEvent = {
  id: string;
  status: OrderStatus;
  note: string | null;
  actorType: string | null;
  createdAt: string;
};

export type OrderItem = {
  id: string;
  name: string;
  quantity: number;
  unitPriceKobo: number;
};

export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';

/** WALLET and PAYSTACK arrive from code; the other two are entered by hand. */
export type PaymentProvider = 'PAYSTACK' | 'WALLET' | 'CASH' | 'BANK_TRANSFER';

export type Payment = {
  id: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amountKobo: number;
  reference: string | null;
  note: string | null;
  paidAt: string | null;
  createdAt: string;
  /** Null for anything a gateway created — that is how the two are told apart. */
  recordedBy: { name: string } | null;
};

/** A ledger row, which unlike an order's own payments carries the order back. */
export type LedgerPayment = Payment & {
  order: {
    id: string;
    reference: string;
    channel: OrderChannel;
    totalKobo: number;
    customer: { firstName: string; lastName: string; phone: string } | null;
  } | null;
};

/** Delivered, with nothing recorded as received. Money the business is owed. */
export type UnpaidOrder = {
  id: string;
  reference: string;
  channel: OrderChannel;
  totalKobo: number;
  deliveredAt: string | null;
  customer: { firstName: string; lastName: string; phone: string } | null;
  rider: { firstName: string; lastName: string } | null;
};

export type PaymentsPage = {
  payments: LedgerPayment[];
  /** Across every payment ever, not just the listed page. */
  totals: Record<PaymentStatus, number>;
  counts: Record<PaymentStatus, number>;
  unpaid: UnpaidOrder[];
  unpaidTotalKobo: number;
};

export type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  /** Null where the only address on file was synthesised for a web booking. */
  email: string | null;
  phone: string;
  walletBalanceKobo: number;
  isActive: boolean;
  createdAt: string;
  /** What was actually collected, so an unpaid order does not count as spend. */
  totalSpentKobo: number;
  lastOrderAt: string | null;
  /** Empty means they have never ordered. ['WEB'] means no app account. */
  channels: OrderChannel[];
  _count: { orders: number; supportRequests: number };
};

export type OrderDetail = OrderListItem & {
  subtotalKobo: number;
  deliveryFeeKobo: number;
  serviceFeeKobo: number;
  riderPayoutKobo: number;
  deliveryCode: string | null;
  note: string | null;
  deliveredAt: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    walletBalanceKobo: number;
  } | null;
  rider: (Rider & { id: string }) | null;
  address: {
    label: string;
    line1: string;
    line2: string | null;
    city: string;
    landmark: string | null;
    contact: string;
    phone: string;
  } | null;
  items: OrderItem[];
  events: OrderEvent[];
  payments: Payment[];
  errandDetail: { task: string; budgetKobo: number | null; pickupAddress: string | null } | null;
  packageDetail: { size: string; description: string | null; pickupAddress: string | null } | null;
};

export type Bid = {
  id: string;
  priceKobo: number;
  etaMinutes: number;
  note: string | null;
  status: string;
  vendor: { name: string } | null;
};

export type MarketplaceRequest = {
  id: string;
  title: string;
  description: string | null;
  budgetKobo: number | null;
  status: string;
  closesAt: string;
  createdAt: string;
  customer: { firstName: string; lastName: string; phone: string } | null;
  bids: Bid[];
  photoUrls?: string[];
  /** Vendors ops asked to quote. Empty means the request is open to all. */
  invitedVendors: { id: string; name: string }[];
};

export type Vendor = {
  id: string;
  name: string;
  slug: string;
  tags: string[];
  area: string | null;
  rating: number;
  isVerified: boolean;
  isOpen: boolean;
  canBid: boolean;
  coverUrl: string | null;
  /** Decides whether a vendor may be deleted — one with orders may not. */
  _count: { products: number; orders: number };
};

/** A catalogue listing, as the admin sees it. */
export type AdminProduct = {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  section: string | null;
  badge: string | null;
  imageUrl: string | null;
  isMarketplace: boolean;
  inStock: boolean;
  /** How many past order lines reference this listing. */
  _count: { orderItems: number };
};

export type VendorCatalogue = {
  vendor: { id: string; name: string };
  products: AdminProduct[];
};

export type VendorApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type VendorApplication = {
  id: string;
  businessName: string;
  category: string;
  area: string;
  phone: string;
  address: string | null;
  contactName: string | null;
  note: string | null;
  status: VendorApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  applicant: { id: string; firstName: string; lastName: string; phone: string } | null;
  vendor: { id: string; name: string; slug: string } | null;
};

export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED';

export type Payout = {
  id: string;
  amountKobo: number;
  status: PayoutStatus;
  reference: string;
  bankName: string | null;
  bankAccountNo: string | null;
  failureReason: string | null;
  createdAt: string;
  settledAt: string | null;
  rider: { firstName: string; lastName: string; phone: string };
  _count: { earnings: number };
};

/** A rider with unpaid work, and how much of it is actually sendable. */
export type PayoutDue = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  payableKobo: number;
  heldKobo: number;
  meetsMinimum: boolean;
};

export type PayoutsPage = {
  holdHours: number;
  minimumKobo: number;
  due: PayoutDue[];
  payouts: Payout[];
};

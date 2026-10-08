import type { Bid, MenuItem, Order, Product, RiderJob, Thumb, Vendor } from '@/lib/mock';

/**
 * Translates API payloads into the shapes the screens already render.
 *
 * Two conversions happen here and NOWHERE else, so no screen has to think
 * about them:
 *
 *  1. MONEY. The API speaks kobo (integers); the UI's `naira()` helper takes
 *     naira. Converting at this boundary means every existing `naira(x)` call
 *     keeps working untouched. A stray kobo value reaching the UI would render
 *     "₦450,000" for a ₦4,500 plate — so it is done once, here.
 *
 *  2. IMAGES. The API returns a nullable `imageUrl`; the UI's `Thumb` wants
 *     `{ tone, uri? }`. `tone` is always preserved even when a URL exists,
 *     because it is what renders while the photo loads or if it 404s.
 */

export const koboToNaira = (kobo: number | null | undefined): number =>
  kobo == null ? 0 : kobo / 100;

export const nairaToKobo = (naira: number): number => Math.round(naira * 100);

/** Picks a sensible fallback gradient from whatever we know about the item. */
function toneFor(name: string, tags: string[] = []): Thumb['tone'] {
  const haystack = `${name} ${tags.join(' ')}`.toLowerCase();

  if (/jollof|fried rice|rice &|party/.test(haystack)) return 'jollof';
  if (/yam|egusi|amala|swallow|eba|okra|ewedu/.test(haystack)) return 'swallow';
  if (/goat|suya|meat|grill|pepper soup|catfish|ogufe/.test(haystack)) return 'goat';
  if (/rice|grain|oil|foodstuff|bulk|dangote/.test(haystack)) return 'rice';
  if (/charger|phone|gadget|electronic|cable|tech/.test(haystack)) return 'charger';
  if (/pharmac|drug|paracetamol|health|medicine/.test(haystack)) return 'pharmacy';
  if (/market|shop|store|mart/.test(haystack)) return 'market';
  return 'parcel';
}

function thumbFrom(name: string, url: string | null | undefined, tags: string[] = []): Thumb {
  return { tone: toneFor(name, tags), ...(url ? { uri: url } : {}) };
}

/** Opening hours are stored 24-hour ("22:00"); Nigerians read "10:00 PM". */
function to12Hour(time: string | null | undefined): string {
  if (!time) return '';
  const [h, m = '00'] = time.split(':');
  const hour = Number(h);
  if (Number.isNaN(hour)) return time;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m} ${suffix}`;
}

// ─────────────────────────────────────────────── API payload types

export type ApiVendor = {
  id: string;
  slug: string;
  name: string;
  tags: string[];
  area: string | null;
  rating: number;
  ratingCount: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  deliveryFeeKobo: number;
  freeOverKobo: number | null;
  discountLabel: string | null;
  isVerified: boolean;
  isOpen: boolean;
  closesAt: string | null;
  opensAt: string | null;
  coverUrl: string | null;
  products?: ApiProduct[];
  sections?: string[];
};

export type ApiProduct = {
  id: string;
  vendorId: string;
  name: string;
  description: string | null;
  priceKobo: number;
  section: string | null;
  badge: string | null;
  imageUrl: string | null;
  isMarketplace: boolean;
  isBiddable: boolean;
  // The single-product endpoint returns more of the vendor than the grid does.
  vendor?: {
    id?: string;
    name: string;
    slug: string;
    area?: string | null;
    state?: string | null;
    isVerified: boolean;
    isOpen?: boolean;
    etaMinMinutes?: number;
    etaMaxMinutes?: number;
    deliveryFeeKobo?: number;
    freeOverKobo?: number | null;
  };
};

export type ApiOrder = {
  id: string;
  reference: string;
  type: 'FOOD' | 'MARKETPLACE' | 'ERRAND' | 'PACKAGE';
  status: string;
  totalKobo: number;
  subtotalKobo: number;
  deliveryFeeKobo: number;
  serviceFeeKobo: number;
  discountKobo: number;
  deliveryCode: string | null;
  createdAt: string;
  placedAt: string | null;
  vendor?: { name: string; slug: string; coverUrl: string | null } | null;
  items?: { id: string; name: string; quantity: number; unitPriceKobo?: number; note?: string | null }[];
  packageDetail?: { dropoffAddress: string; size: string } | null;
  errandDetail?: {
    task: string;
    pickupName: string;
    /** What the rider found it actually costs, once they have looked. */
    actualItemKobo?: number | null;
    /**
     * Resolved by Paystack on the server, never typed by the rider. Shown to
     * the customer before they transfer — the only protection in a flow where
     * Sendy never touches the money and nothing can be reversed.
     */
    merchantAccountName?: string | null;
    merchantAccountNo?: string | null;
    merchantBankName?: string | null;
    merchantPaidAt?: string | null;
    assetSecuredAt?: string | null;
    atDoorstepAt?: string | null;
  } | null;
  /** Used to tell whether the Sendy dispatch fee has been settled. */
  payments?: {
    id: string; provider: string; status: string; amountKobo: number; paidAt: string | null;
  }[];
  // phone is what the track screen's call and WhatsApp buttons dial — without
  // it they render but cannot do anything.
  rider?: { firstName: string; lastName: string; plateNumber: string | null; rating: number; phone: string | null } | null;
  stepper?: { status: string; label: string; at: string | null; state: 'done' | 'current' | 'pending' }[];
};

export type ApiBid = {
  id: string;
  priceKobo: number;
  etaMinutes: number;
  note: string | null;
  isBestPrice?: boolean;
  vendor: { id: string; name: string; rating: number; isVerified: boolean; ratingCount: number };
};

export type ApiRiderJob = {
  id: string;
  reference: string;
  status: string;
  /** Non-null on the detail endpoint only when this rider already holds it. */
  riderId?: string | null;
  type: 'FOOD' | 'MARKETPLACE' | 'ERRAND' | 'PACKAGE';
  riderPayoutKobo: number;
  vendor?: { name: string; area: string | null } | null;
  address?: { line1: string; city: string; landmark: string | null } | null;
  packageDetail?: {
    pickupName: string; pickupAddress: string;
    dropoffName: string; dropoffAddress: string; size: string;
  } | null;
  errandDetail?: {
    task: string;
    pickupName: string;
    pickupAddress: string;
    details?: string | null;
    photoUrls?: string[];
    budgetKobo?: number | null;
    /** What the rider found it actually costs, once they have looked. */
    actualItemKobo?: number | null;
    /**
     * Resolved by Paystack on the server, never typed by the rider. Shown to
     * the customer before they transfer — it is the only protection in a flow
     * where Sendy never touches the money and nothing can be reversed.
     */
    merchantAccountName?: string | null;
    merchantAccountNo?: string | null;
    merchantBankName?: string | null;
    merchantPaidAt?: string | null;
    assetSecuredAt?: string | null;
    atDoorstepAt?: string | null;
  } | null;
  payments?: {
    id: string; provider: string; status: string; amountKobo: number; paidAt: string | null;
  }[];
};

// ─────────────────────────────────────────────── mappers

export function toVendor(v: ApiVendor): Vendor {
  return {
    id: v.slug || v.id,
    name: v.name,
    tags: v.tags,
    rating: v.rating,
    ratingCount: v.ratingCount >= 1000 ? `${Math.floor(v.ratingCount / 100) / 10}k+` : String(v.ratingCount),
    etaMin: v.etaMinMinutes,
    etaMax: v.etaMaxMinutes,
    deliveryFee: koboToNaira(v.deliveryFeeKobo),
    discount: v.discountLabel ?? undefined,
    verified: v.isVerified,
    open: v.isOpen,
    closesAt: to12Hour(v.isOpen ? v.closesAt : v.opensAt),
    freeOver: v.freeOverKobo ? koboToNaira(v.freeOverKobo) : undefined,
    cover: thumbFrom(v.name, v.coverUrl, v.tags),
    area: v.area ?? '',
  };
}

export function toMenuItem(p: ApiProduct): MenuItem {
  return {
    id: p.id,
    vendorId: p.vendorId,
    name: p.name,
    description: p.description ?? '',
    price: koboToNaira(p.priceKobo),
    badge: p.badge ?? undefined,
    section: p.section ?? 'Menu',
    thumb: thumbFrom(p.name, p.imageUrl),
  };
}

export function toProduct(p: ApiProduct): Product {
  return {
    id: p.id,
    // The grid needs this to add to the cart at all. It was missing here while
    // `Product` did not declare it, so nothing caught the omission.
    vendorId: p.vendorId,
    name: p.name,
    vendor: p.vendor?.name ?? '',
    price: koboToNaira(p.priceKobo),
    biddable: p.isBiddable,
    // Where it ships from — the marketplace's most-asked question.
    area: p.vendor?.area ?? undefined,
    state: p.vendor?.state ?? undefined,
    thumb: thumbFrom(p.name, p.imageUrl),
  };
}

/**
 * Only these two mean an order is over and did not arrive.
 *
 * This used to be the other way round — a list of active statuses, with
 * everything else falling through to 'cancelled'. That makes adding a status to
 * the API a silent client bug: the four errand states landed here and every one
 * of them rendered "This order was cancelled" on a live order. Listing the
 * terminal ones instead means an unknown status reads as active, which is wrong
 * far less often and never alarming.
 */
const CANCELLED_STATUSES = ['CANCELLED', 'REFUNDED'];

const STATUS_COPY: Record<string, string> = {
  QUOTE_REQUESTED: 'Waiting for a rider',
  PRICE_PROPOSED: 'Price confirmed — your approval needed',
  MERCHANT_PAID: 'Paid the seller',
  PENDING_PAYMENT: 'Awaiting payment',
  PLACED: 'Order placed',
  VENDOR_ACCEPTED: 'Vendor accepted',
  RIDER_ASSIGNED: 'Rider assigned',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'On the way',
  AT_DOORSTEP: 'At your door',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

const TYPE_LABEL: Record<ApiOrder['type'], Order['type']> = {
  FOOD: 'Food',
  MARKETPLACE: 'Marketplace',
  ERRAND: 'Errand',
  PACKAGE: 'Package',
};

/** A human title for the order row — vendors don't exist on parcels/errands. */
function orderTitle(o: ApiOrder): string {
  if (o.vendor?.name) return o.vendor.name;
  if (o.errandDetail) return `Errand · ${o.errandDetail.pickupName}`;
  if (o.packageDetail) return `Send a package · ${o.packageDetail.dropoffAddress}`;
  return o.reference;
}

/** Last resort for a status the app has no copy for. Never the enum itself. */
function humanise(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function toOrder(o: ApiOrder): Order {
  const title = orderTitle(o);
  return {
    id: o.id,
    reference: o.reference,
    vendor: title,
    type: TYPE_LABEL[o.type],
    total: koboToNaira(o.totalKobo),
    placedAt: formatWhen(o.placedAt ?? o.createdAt),
    status: CANCELLED_STATUSES.includes(o.status)
      ? 'cancelled'
      : o.status === 'DELIVERED'
        ? 'delivered'
        : 'active',
    // Falling back to the raw enum put "QUOTE_REQUESTED" on screen, three times.
    // Title case at least reads as English while a label is missing.
    statusLabel: STATUS_COPY[o.status] ?? humanise(o.status),
    itemCount: o.items?.reduce((n, i) => n + i.quantity, 0) ?? 1,
    thumb: thumbFrom(title, o.vendor?.coverUrl, [o.type]),
  };
}

export function toBid(b: ApiBid): Bid {
  const initials = b.vendor.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return {
    id: b.id,
    vendor: b.vendor.name,
    initials,
    verified: b.vendor.isVerified,
    rating: b.vendor.rating,
    orders: b.vendor.ratingCount,
    price: koboToNaira(b.priceKobo),
    etaMinutes: b.etaMinutes,
    note: b.note ?? '',
    best: b.isBestPrice,
  };
}

/**
 * Every status a job card can be rendered in, not just the ones on the board.
 *
 * The board only ever shows unclaimed work, so the map covered those and let
 * everything else fall through. The detail screen shows jobs a rider already
 * holds — so an accepted errand hit the fallback and announced "Unpaid" over
 * one the customer had already paid the fee for.
 */
const PAYMENT_LABEL: Record<string, string> = {
  QUOTE_REQUESTED: 'Needs pricing',
  PRICE_PROPOSED: 'Awaiting customer',
  MERCHANT_PAID: 'Seller paid',
  PENDING_PAYMENT: 'Unpaid',
  PLACED: 'Prepaid',
  VENDOR_ACCEPTED: 'Prepaid',
  RIDER_ASSIGNED: 'In progress',
  PICKED_UP: 'Collected',
  IN_TRANSIT: 'On the way',
  AT_DOORSTEP: 'At the door',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export function toRiderJob(j: ApiRiderJob): RiderJob {
  const pickupName =
    j.packageDetail?.pickupName ?? j.errandDetail?.pickupName ?? j.vendor?.name ?? 'Pickup';
  const pickupAddress =
    j.packageDetail?.pickupAddress ?? j.errandDetail?.pickupAddress ?? j.vendor?.area ?? '';
  const dropoffName = j.packageDetail?.dropoffName ?? 'Customer';
  const dropoffAddress = j.packageDetail?.dropoffAddress ?? j.address?.line1 ?? '';

  return {
    id: j.id,
    type: j.type === 'FOOD' || j.type === 'MARKETPLACE' ? 'Food' : j.type === 'ERRAND' ? 'Errand' : 'Package',
    payout: koboToNaira(j.riderPayoutKobo),
    pickupName,
    pickupAddress,
    dropoffName,
    dropoffAddress,
    // Distance/duration need a maps provider — excluded from Phase 1, so these
    // are indicative until one is wired in.
    distanceKm: 0,
    minutes: 0,
    prepaid: true,
    /**
     * What the rider needs to know about money on THIS job.
     *
     * "Prepaid" was hardcoded true, which was honest while every order was paid
     * before it reached the board. An errand is posted unpaid — pricing it is
     * the job — so an errand awaiting a quote displayed "Prepaid" over an order
     * nobody had paid a kobo for.
     *
     * Prepaid/Cash is also the wrong question for an errand. The rider never
     * handles the item money either way: the customer transfers it straight to
     * the seller. What matters is which step it is waiting on.
     */
    paymentLabel: PAYMENT_LABEL[j.status] ?? (j.type === 'ERRAND' ? 'Unpaid' : 'Prepaid'),
    notes: j.errandDetail?.task ?? undefined,
  };
}

/** "Today, 2:31 PM" / "Yesterday, 5:12 PM" / "3 Aug, 1:20 PM" */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true });

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (daysAgo === 0) return `Today, ${time}`;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  return `${date.getDate()} ${date.toLocaleString('en-NG', { month: 'short' })}, ${time}`;
}

// Mock data for the UI build. Every value here mirrors the approved Figma frames
// so the app reads like the real thing during review.
//
// Chunk 2 (backend) replaces this module with API calls — the shapes below are
// deliberately the shapes the REST endpoints should return.

export type Thumb = {
  /** Local branded placeholder tint. Swap `uri` in once real photography lands. */
  tone: 'jollof' | 'swallow' | 'goat' | 'rice' | 'charger' | 'parcel' | 'pharmacy' | 'market';
  uri?: string;
};

export type Vendor = {
  id: string;
  name: string;
  tags: string[];
  rating: number;
  ratingCount: string;
  etaMin: number;
  etaMax: number;
  deliveryFee: number;
  discount?: string;
  verified: boolean;
  open: boolean;
  closesAt: string;
  freeOver?: number;
  cover: Thumb;
  area: string;
};

export type MenuItem = {
  id: string;
  vendorId: string;
  name: string;
  description: string;
  price: number;
  badge?: string;
  section: string;
  thumb: Thumb;
};

export type Product = {
  id: string;
  name: string;
  vendor: string;
  price: number;
  biddable?: boolean;
  /** Where it ships from — marketplace buyers weigh this as much as price. */
  area?: string;
  state?: string;
  thumb: Thumb;
};

export type Bid = {
  id: string;
  vendor: string;
  initials: string;
  verified: boolean;
  rating: number;
  orders: number;
  price: number;
  etaMinutes: number;
  note: string;
  best?: boolean;
};

export type Address = {
  id: string;
  label: string;
  line1: string;
  line2: string;
  contact: string;
  phone: string;
  isDefault?: boolean;
};

export type OrderStage = {
  label: string;
  time?: string;
  state: 'done' | 'current' | 'pending';
  detail?: string;
};

export type Order = {
  id: string;
  reference: string;
  vendor: string;
  type: 'Food' | 'Package' | 'Errand' | 'Marketplace';
  total: number;
  placedAt: string;
  status: 'active' | 'delivered' | 'cancelled';
  statusLabel: string;
  itemCount: number;
  thumb: Thumb;
};

export type RiderJob = {
  id: string;
  type: 'Package' | 'Errand' | 'Food';
  payout: number;
  pickupName: string;
  pickupAddress: string;
  dropoffName: string;
  dropoffAddress: string;
  distanceKm: number;
  minutes: number;
  prepaid: boolean;
  /** What to show the rider about payment. Falls back to prepaid when absent. */
  paymentLabel?: string;
  notes?: string;
};

// ─────────────────────────────────────────────────────────── vendors

export const VENDORS: Vendor[] = [
  {
    id: 'mama-nkechi',
    name: 'Mama Nkechi Kitchen',
    tags: ['Nigerian', 'Rice & Grains', 'Swallow'],
    rating: 4.8,
    ratingCount: '1,200+',
    etaMin: 25,
    etaMax: 35,
    deliveryFee: 1300,
    discount: 'Up to ₦2,300 off today',
    verified: true,
    open: true,
    closesAt: '10:00 PM',
    freeOver: 10000,
    cover: { tone: 'jollof' },
    area: 'Lekki Phase 1',
  },
  {
    id: 'iya-basira',
    name: 'Iya Basira Amala Spot',
    tags: ['Swallow', 'Soups', 'Local'],
    rating: 4.6,
    ratingCount: '840',
    etaMin: 20,
    etaMax: 30,
    deliveryFee: 900,
    discount: 'Up to ₦1,500 off',
    verified: true,
    open: true,
    closesAt: '9:00 PM',
    cover: { tone: 'swallow' },
    area: 'Surulere',
  },
  {
    id: 'suya-republic',
    name: 'Suya Republic',
    tags: ['Grills', 'Suya', 'Small chops'],
    rating: 4.7,
    ratingCount: '2,100+',
    etaMin: 30,
    etaMax: 45,
    deliveryFee: 1500,
    verified: true,
    open: true,
    closesAt: '11:30 PM',
    cover: { tone: 'goat' },
    area: 'Victoria Island',
  },
  {
    id: 'ikeja-grains',
    name: 'Ikeja Grains Mart',
    tags: ['Foodstuff', 'Grains', 'Bulk'],
    rating: 4.5,
    ratingCount: '310',
    etaMin: 45,
    etaMax: 70,
    deliveryFee: 2200,
    verified: true,
    open: false,
    closesAt: '8:00 AM',
    cover: { tone: 'rice' },
    area: 'Ikeja',
  },
  {
    id: 'healthplus-vi',
    name: 'HealthPlus Pharmacy, VI',
    tags: ['Pharmacy', 'Wellness'],
    rating: 4.9,
    ratingCount: '560',
    etaMin: 15,
    etaMax: 25,
    deliveryFee: 1100,
    verified: true,
    open: true,
    closesAt: '10:00 PM',
    cover: { tone: 'pharmacy' },
    area: 'Victoria Island',
  },
];

export const vendorById = (id: string) => VENDORS.find((v) => v.id === id) ?? VENDORS[0];

// ─────────────────────────────────────────────────────────── menu

export const MENU: MenuItem[] = [
  {
    id: 'jollof-chicken',
    vendorId: 'mama-nkechi',
    name: 'Jollof Rice + Chicken',
    description: 'Smoky party jollof, grilled chicken, fried plantain & coleslaw.',
    price: 4500,
    badge: 'Bestseller',
    section: 'Popular',
    thumb: { tone: 'jollof' },
  },
  {
    id: 'pounded-yam-egusi',
    vendorId: 'mama-nkechi',
    name: 'Pounded Yam & Egusi',
    description: 'Fresh pounded yam with rich egusi and assorted meat.',
    price: 5200,
    section: 'Popular',
    thumb: { tone: 'swallow' },
  },
  {
    id: 'peppered-goat',
    vendorId: 'mama-nkechi',
    name: 'Peppered Goat Meat',
    description: 'Spicy, slow-cooked goat meat. Serves 2.',
    price: 6800,
    badge: 'Spicy',
    section: 'Popular',
    thumb: { tone: 'goat' },
  },
  {
    id: 'ofada-sauce',
    vendorId: 'mama-nkechi',
    name: 'Ofada Rice & Ayamase',
    description: 'Local ofada rice with green pepper sauce and assorted meat.',
    price: 5800,
    section: 'Rice & Grains',
    thumb: { tone: 'rice' },
  },
  {
    id: 'fried-rice',
    vendorId: 'mama-nkechi',
    name: 'Fried Rice + Turkey',
    description: 'Vegetable fried rice with grilled turkey and plantain.',
    price: 5500,
    section: 'Rice & Grains',
    thumb: { tone: 'jollof' },
  },
  {
    id: 'eba-okra',
    vendorId: 'mama-nkechi',
    name: 'Eba & Okra Soup',
    description: 'Garri swallow with okra, stockfish and beef.',
    price: 4200,
    section: 'Swallow',
    thumb: { tone: 'swallow' },
  },
  {
    id: 'pepper-soup',
    vendorId: 'mama-nkechi',
    name: 'Catfish Pepper Soup',
    description: 'Hot catfish pepper soup with scent leaf.',
    price: 6200,
    section: 'Soups',
    thumb: { tone: 'goat' },
  },
];

export const MENU_SECTIONS = ['Popular', 'Rice & Grains', 'Swallow', 'Soups'];

export const menuFor = (vendorId: string) => MENU.filter((m) => m.vendorId === vendorId);
export const menuItemById = (id: string) => MENU.find((m) => m.id === id) ?? MENU[0];

// ─────────────────────────────────────────────────────────── marketplace

export const PRODUCTS: Product[] = [
  {
    id: 'dangote-rice',
    name: 'Dangote Rice 50kg',
    vendor: 'Ikeja Grains Mart',
    price: 52000,
    thumb: { tone: 'rice' },
  },
  {
    id: 'iphone-charger',
    name: 'iPhone 15 Charger',
    vendor: 'GadgetHub Lekki',
    price: 18500,
    biddable: true,
    thumb: { tone: 'charger' },
  },
  {
    id: 'goat-meat-pack',
    name: 'Fresh Goat Meat (5kg)',
    vendor: 'Mile 12 Butchers',
    price: 24000,
    thumb: { tone: 'goat' },
  },
  {
    id: 'jollof-tray',
    name: 'Party Jollof Tray (20 plates)',
    vendor: 'Mama Nkechi Kitchen',
    price: 68000,
    biddable: true,
    thumb: { tone: 'jollof' },
  },
  {
    id: 'palm-oil',
    name: 'Palm Oil 25L Keg',
    vendor: 'Oye Market Supplies',
    price: 41000,
    thumb: { tone: 'market' },
  },
  {
    id: 'paracetamol',
    name: 'Emzor Paracetamol (Carton)',
    vendor: 'HealthPlus Pharmacy',
    price: 15600,
    thumb: { tone: 'pharmacy' },
  },
];

export const BID_REQUEST = {
  id: 'req-1041',
  title: 'Original iPhone 15 Pro charger (20W USB-C)',
  qty: 1,
  dropoff: 'VI',
  budget: 25000,
  closesIn: '4:20',
  bidCount: 3,
};

export const BIDS: Bid[] = [
  {
    id: 'bid-1',
    vendor: 'GadgetHub Lekki',
    initials: 'GH',
    verified: true,
    rating: 4.9,
    orders: 320,
    price: 19500,
    etaMinutes: 40,
    note: 'Genuine Apple 20W, sealed box. 12-month warranty & receipt.',
    best: true,
  },
  {
    id: 'bid-2',
    vendor: 'TechPlug NG',
    initials: 'TP',
    verified: true,
    rating: 4.7,
    orders: 188,
    price: 21000,
    etaMinutes: 30,
    note: 'Original, in stock now. Fastest delivery in Lekki–VI axis.',
  },
  {
    id: 'bid-3',
    vendor: 'Alaba Gadget World',
    initials: 'AG',
    verified: false,
    rating: 4.4,
    orders: 96,
    price: 17800,
    etaMinutes: 75,
    note: 'Grade-A copy, tested. No warranty. Pickup from Alaba.',
  },
];

// ─────────────────────────────────────────────────────────── account

export const CUSTOMER = {
  name: 'Chinedu Okafor',
  firstName: 'Chinedu',
  initials: 'CO',
  phone: '0803 123 4567',
  email: 'chinedu.okafor@gmail.com',
  walletBalance: 5200,
  sendyCredit: 1500,
  referralCode: 'SENDY-CHI42',
};

export const ADDRESSES: Address[] = [
  {
    id: 'addr-home',
    label: 'Home',
    line1: '12 Adeola Odeku St, Victoria Island',
    line2: 'Lagos',
    contact: 'Chinedu Okafor',
    phone: '0803 123 4567',
    isDefault: true,
  },
  {
    id: 'addr-office',
    label: 'Office',
    line1: '24 Bourdillon Rd, Ikoyi',
    line2: 'Lagos',
    contact: 'Chinedu Okafor',
    phone: '0803 123 4567',
  },
  {
    id: 'addr-mum',
    label: "Mum's place",
    line1: '8 Karimu Kotun St, Victoria Island',
    line2: 'Lagos',
    contact: 'Adaeze Okafor',
    phone: '0802 447 9910',
  },
];

// ─────────────────────────────────────────────────────────── orders

export const TRACKING_STAGES: OrderStage[] = [
  { label: 'Order placed', time: '2:31 PM', state: 'done' },
  { label: 'Vendor accepted', time: '2:33 PM', state: 'done' },
  { label: 'Rider assigned', time: '2:36 PM', state: 'done' },
  { label: 'Picked up from vendor', time: '2:44 PM', state: 'done' },
  { label: 'On the way to you', state: 'current', detail: 'Now · 12 min away' },
  { label: 'Delivered', state: 'pending' },
];

export const ACTIVE_RIDER = {
  name: 'Emeka Adeyemi',
  initials: 'EA',
  rating: 4.9,
  plate: 'LND-482-GY',
};

export const ORDERS: Order[] = [
  {
    id: 'ord-8841',
    reference: 'SND-8841',
    vendor: 'Mama Nkechi Kitchen',
    type: 'Food',
    total: 15700,
    placedAt: 'Today, 2:31 PM',
    status: 'active',
    statusLabel: 'On the way · 12 min',
    itemCount: 3,
    thumb: { tone: 'jollof' },
  },
  {
    id: 'ord-8836',
    reference: 'SND-8836',
    vendor: 'Send a package · Ikoyi → VI',
    type: 'Package',
    total: 1300,
    placedAt: 'Today, 11:04 AM',
    status: 'active',
    statusLabel: 'Rider assigned',
    itemCount: 1,
    thumb: { tone: 'parcel' },
  },
  {
    id: 'ord-8790',
    reference: 'SND-8790',
    vendor: 'GadgetHub Lekki',
    type: 'Marketplace',
    total: 19500,
    placedAt: 'Yesterday, 5:12 PM',
    status: 'delivered',
    statusLabel: 'Delivered',
    itemCount: 1,
    thumb: { tone: 'charger' },
  },
  {
    id: 'ord-8712',
    reference: 'SND-8712',
    vendor: 'Errand · Shoprite Ikeja City Mall',
    type: 'Errand',
    total: 9800,
    placedAt: '3 Aug, 1:20 PM',
    status: 'delivered',
    statusLabel: 'Delivered',
    itemCount: 2,
    thumb: { tone: 'market' },
  },
  {
    id: 'ord-8655',
    reference: 'SND-8655',
    vendor: 'Iya Basira Amala Spot',
    type: 'Food',
    total: 6400,
    placedAt: '1 Aug, 7:45 PM',
    status: 'cancelled',
    statusLabel: 'Cancelled',
    itemCount: 2,
    thumb: { tone: 'swallow' },
  },
];

// ─────────────────────────────────────────────────────────── rider

export const RIDER = {
  name: 'Emeka Adeyemi',
  firstName: 'Emeka',
  initials: 'EA',
  rating: 4.9,
  plate: 'LND-482-GY',
  zone: 'Victoria Island',
  todayEarnings: 12400,
  todayTrips: 6,
  onlineTime: '4h 12m',
};

export const RIDER_JOBS: RiderJob[] = [
  {
    id: 'job-2201',
    type: 'Package',
    payout: 2100,
    pickupName: 'GadgetHub, Lekki Phase 1',
    pickupAddress: '12 Admiralty Way, Lekki',
    dropoffName: 'Adaeze O.',
    dropoffAddress: '8 Karimu Kotun St, Victoria Island',
    distanceKm: 3.1,
    minutes: 22,
    prepaid: true,
    notes: '1 small box · Fragile · Leave at reception, ask for Tunde.',
  },
  {
    id: 'job-2202',
    type: 'Errand',
    payout: 1650,
    pickupName: 'Shoprite, Ikeja City Mall',
    pickupAddress: 'Obafemi Awolowo Way, Ikeja',
    dropoffName: 'Chinedu O.',
    dropoffAddress: '12 Adeola Odeku St, VI',
    distanceKm: 18.4,
    minutes: 55,
    prepaid: true,
    notes: 'Buy 2 cartons of Eva Water. Budget held: ₦9,000.',
  },
  {
    id: 'job-2203',
    type: 'Food',
    payout: 1900,
    pickupName: 'Mama Nkechi Kitchen, Lekki',
    pickupAddress: '5 Fola Osibo Rd, Lekki Phase 1',
    dropoffName: 'Bola A.',
    dropoffAddress: '22 Ozumba Mbadiwe, VI',
    distanceKm: 2.8,
    minutes: 20,
    prepaid: true,
    notes: 'Hot bag required. 3 packs.',
  },
  {
    id: 'job-2204',
    type: 'Package',
    payout: 2450,
    pickupName: 'Sendy Errands Hub, Ikoyi',
    pickupAddress: '24 Bourdillon Rd, Ikoyi',
    dropoffName: 'Femi K.',
    dropoffAddress: '1 Ligali Ayorinde, VI',
    distanceKm: 4.6,
    minutes: 26,
    prepaid: false,
    notes: 'Collect ₦2,450 cash on delivery.',
  },
];

export const riderJobById = (id: string) => RIDER_JOBS.find((j) => j.id === id) ?? RIDER_JOBS[0];

export const EARNINGS = {
  available: 42300,
  nextPayout: 'Friday, 2 Aug',
  weekTotal: 48900,
  trips: 34,
  onlineHours: '22h',
  rating: 4.9,
  acceptance: '92%',
  week: [
    { day: 'Mon', value: 6200 },
    { day: 'Tue', value: 7800 },
    { day: 'Wed', value: 5100 },
    { day: 'Thu', value: 8600 },
    { day: 'Fri', value: 7200 },
    { day: 'Sat', value: 12400 },
    { day: 'Sun', value: 1600 },
  ],
};

export const RIDER_ACTIVE = {
  jobId: 'job-2201',
  customer: 'Adaeze O.',
  stage: 'on-the-way' as const,
  code: '4-digit',
};

// ─────────────────────────────────────────────────────────── home content

/**
 * Home promo banners.
 *
 * The artwork is deliberately TEXT-FREE — every headline, sub and button here
 * is rendered by `PromoCarousel`. Nothing is baked into a PNG, so changing a
 * word is a code edit rather than a re-export, and the copy stays crisp at any
 * density and translatable later.
 *
 * `bg` is the artwork's own edge colour, so the letterboxing that fits an odd
 * aspect ratio into the carousel blends in instead of showing a band.
 *
 * `safe` is the band of the ARTWORK the copy may occupy, as fractions of its
 * width and height. Each was measured off the source PNG by scanning for pixels
 * that differ from `bg` — that is where the illustration actually is, so the
 * copy is guaranteed to land on empty background rather than over a rider's
 * helmet. Re-measure if a banner is re-exported.
 */
export type Promo = {
  id: string;
  /** Accessibility label for the whole slide. */
  title: string;
  href: string;
  bg: string;
  headline: string;
  sub?: string;
  cta: string;
  /** Ink for this artwork's background. */
  textColor: string;
  subColor: string;
  /**
   * Drop a soft shadow behind the copy. Only needed where the artwork is light
   * enough that white text would otherwise wash out.
   */
  shadow?: boolean;
  ctaBg: string;
  ctaTextColor: string;
  safe: { left: number; right: number; top: number; bottom: number };
};

/** theme.ts `colors.pink[600]`, inlined so this data module stays import-free. */
const PINK_600 = '#E6297A';

export const PROMOS: Promo[] = [
  {
    // Crimson, rider + yellow blob hard right. Empty from 0 to 65%.
    id: 'promo-1',
    title: '20% off your first three errands',
    href: '/errand',
    bg: '#D90330',
    headline: '20% off your\nfirst 3 errands',
    sub: 'We queue, we haggle, we deliver.',
    cta: 'Send a rider',
    textColor: '#FFFFFF',
    subColor: 'rgba(255,255,255,0.82)',
    ctaBg: '#FFFFFF',
    ctaTextColor: '#D90330',
    safe: { left: 0.06, right: 0.62, top: 0.1, bottom: 0.9 },
  },
  {
    // Dark maroon, courier hard left (to 20%) and stocked shelves from 70%.
    // The copy lives in the gap between them, which is why it stays short.
    id: 'promo-2',
    title: 'Shop any store on the marketplace',
    href: '/marketplace',
    bg: '#2C0410',
    headline: 'Any shop.\nOne rider.',
    sub: 'Groceries, chemist, gadgets.',
    cta: 'Shop now',
    textColor: '#FFFFFF',
    subColor: 'rgba(255,255,255,0.75)',
    ctaBg: PINK_600,
    ctaTextColor: '#FFFFFF',
    safe: { left: 0.23, right: 0.68, top: 0.12, bottom: 0.88 },
  },
  {
    // Light blue confetti, phone from 75%. Everything left of it is loose
    // confetti the copy can sit over, so it gets the full height.
    id: 'promo-3',
    title: 'Fund your Sendy Errands wallet',
    href: '/wallet',
    bg: '#81BDDC',
    headline: 'Top up once,\npay in one tap',
    sub: 'Refunds land back instantly.',
    cta: 'Fund wallet',
    // White for consistency with the other two banners. White on this light
    // blue is only ~2:1 contrast, so this is the one banner that needs the
    // shadow to stay legible.
    textColor: '#FFFFFF',
    subColor: 'rgba(255,255,255,0.92)',
    shadow: true,
    ctaBg: PINK_600,
    ctaTextColor: '#FFFFFF',
    safe: { left: 0.06, right: 0.7, top: 0.1, bottom: 0.9 },
  },
];

export type Category = {
  slug: string;
  label: string;
  icon: string;
  badge?: string;
  href?: string;
  /**
   * A second line under the label. Home carries two parcel tiles that look
   * identical at 30px, and the difference between them — whether it crosses a
   * state line — changes the price and the number of days. Without this the
   * choice is a coin flip.
   */
  caption?: string;
  /** Rendered grey and inert, with a 'Coming soon' caption. */
  comingSoon?: boolean;
};

export const CATEGORIES: Category[] = [
  { slug: 'errands', label: 'Errands', icon: 'receipt-outline', href: '/errand' },
  { slug: 'marketplace', label: 'Marketplace', icon: 'storefront-outline', badge: 'NEW', href: '/marketplace' },
  { slug: 'shops', label: 'Shops', icon: 'bag-handle-outline' },
  { slug: 'markets', label: 'Markets', icon: 'cart-outline' },
  /**
   * Logistics is deliberately not a pillar here. Interstate is a different
   * enough product — different pricing, different timescale — that giving it
   * equal billing on the home grid invited people into the wrong flow. It is
   * reached from inside Packages instead, where someone is already thinking
   * about a parcel and the banner can explain the difference in one line.
   * The /logistics route still exists and still works; only the tile is gone.
   */
  { slug: 'packages', label: 'Packages', icon: 'cube-outline', href: '/package' },
  /**
   * Last on purpose, and no route on purpose. Bills had a chevron and a
   * category page with nothing behind it; a tile that opens an empty screen is
   * worse than one that says it is not ready. Keeping the only inert tile at
   * the end means the grid reads as five things that work rather than drawing
   * the eye to the one that does not.
   */
  { slug: 'bills', label: 'Bills', icon: 'reader-outline', comingSoon: true },
];

export const RECENT_SEARCHES = ['Jollof rice', 'iPhone charger', 'Pharmacy near me', 'Dangote rice'];

export const SEARCH_SUGGESTIONS = [
  'Amala and ewedu',
  'Party jollof tray',
  'Send parcel to Ikeja',
  'Fuel delivery',
  'Suya tonight',
];

export const FAQS = [
  {
    q: 'How do I track my order?',
    a: 'Open Orders → tap the active order. You will see the live stepper and your rider’s details.',
  },
  {
    q: 'When am I charged for a bid?',
    a: 'Nothing is charged until you select a winning bid. We then authorise payment and assign a rider.',
  },
  {
    q: 'What if my rider cannot find me?',
    a: 'Your rider will call the number on the order. You can also chat in-app from the tracking screen.',
  },
  {
    q: 'How do refunds work?',
    a: 'Refunds go back to your Sendy Errands Wallet instantly, or to your bank in 3–5 working days.',
  },
];

export const PARCEL_SIZES = [
  { id: 'small', label: 'Small', hint: 'Fits a bag', price: 1300 },
  { id: 'medium', label: 'Medium', hint: '≤ 5 kg', price: 1900 },
  { id: 'large', label: 'Large', hint: '≤ 15 kg', price: 2800 },
  { id: 'xl', label: 'Extra large', hint: '≤ 30 kg', price: 4200 },
];

export const PARCEL_TYPES = ['Documents', 'Food', 'Electronics', 'Fragile', 'Clothing', 'Other'];

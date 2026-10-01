import Svg, { Circle, Path, Rect, type SvgProps } from 'react-native-svg';

/**
 * Flat two-tone illustrations for the home pillar grid.
 *
 * Ionicons are single-colour line glyphs, which made all eight tiles read as
 * one undifferentiated pink block. These are drawn per category so each pillar
 * carries its own hue and silhouette — the tile becomes scannable by colour
 * before the label is even read.
 *
 * Every icon takes a `main` (saturated) and `soft` (tinted fill) colour from
 * CATEGORY_PALETTE below, so the set stays coherent while staying distinct.
 */

type IconProps = SvgProps & { size?: number; main: string; soft: string };

const Frame = ({ size = 28, children, ...rest }: SvgProps & { size?: number; children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    {children}
  </Svg>
);

/** Errands — a clipboard with a completed check. */
export const ErrandsIcon = ({ size, main, soft, ...rest }: IconProps) => (
  <Frame size={size} {...rest}>
    <Rect x="4" y="3.5" width="16" height="17.5" rx="3.2" fill={soft} />
    <Rect x="8.25" y="1.75" width="7.5" height="4" rx="2" fill={main} />
    <Path
      d="M8.75 12.75l2.4 2.4 4.3-4.6"
      stroke={main}
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Frame>
);

/**
 * Delivery — a delivery van.
 *
 * This was a scooter first, which fell apart at 30px: the wheels, cargo box and
 * frame read as three unrelated blobs rather than one vehicle. A van is a
 * single silhouette, so it survives the size.
 */
export const DeliveryIcon = ({ size, main, soft, ...rest }: IconProps) => (
  <Frame size={size} {...rest}>
    <Rect x="1.8" y="6.4" width="12.4" height="10.2" rx="2" fill={soft} />
    <Path d="M14.2 9.6h3.5l4 4.1v2.9h-7.5z" fill={main} />
    <Circle cx="6.6" cy="18.2" r="2.5" fill={main} />
    <Circle cx="17.4" cy="18.2" r="2.5" fill={main} />
    <Circle cx="6.6" cy="18.2" r="0.95" fill="#FFFFFF" />
    <Circle cx="17.4" cy="18.2" r="0.95" fill="#FFFFFF" />
  </Frame>
);

/** Marketplace — a storefront under its awning. */
export const MarketplaceIcon = ({ size, main, soft, ...rest }: IconProps) => (
  <Frame size={size} {...rest}>
    <Rect x="4.5" y="8.6" width="15" height="11.9" rx="2" fill={soft} />
    <Path d="M2.8 8.6L4.6 3.9h14.8l1.8 4.7z" fill={main} />
    <Rect x="9.4" y="13.2" width="5.2" height="7.3" rx="1.2" fill={main} />
  </Frame>
);

/** Shops — a shopping bag. */
export const ShopsIcon = ({ size, main, soft, ...rest }: IconProps) => (
  <Frame size={size} {...rest}>
    <Path
      d="M5.4 8h13.2l-1.15 11.35A2.2 2.2 0 0115.26 21.3H8.74a2.2 2.2 0 01-2.19-1.95z"
      fill={soft}
    />
    <Path
      d="M8.7 9V6.75a3.3 3.3 0 016.6 0V9"
      stroke={main}
      strokeWidth="2.1"
      strokeLinecap="round"
    />
  </Frame>
);

/** Pharmacy — a medicine bottle with a cross. */
export const PharmacyIcon = ({ size, main, soft, ...rest }: IconProps) => (
  <Frame size={size} {...rest}>
    <Rect x="6.1" y="6.4" width="11.8" height="14.2" rx="2.8" fill={soft} />
    <Rect x="7.6" y="2.9" width="8.8" height="3.6" rx="1.5" fill={main} />
    <Path d="M12 10.6v6.2M8.9 13.7h6.2" stroke={main} strokeWidth="2.2" strokeLinecap="round" />
  </Frame>
);

/** Markets — a produce basket. */
export const MarketsIcon = ({ size, main, soft, ...rest }: IconProps) => (
  <Frame size={size} {...rest}>
    <Circle cx="9.3" cy="6.9" r="2.9" fill={main} opacity={0.45} />
    <Circle cx="14.7" cy="7.4" r="2.4" fill={main} />
    <Path d="M3.4 11.1h17.2l-1.9 8.5a1.6 1.6 0 01-1.56 1.25H6.86A1.6 1.6 0 015.3 19.6z" fill={soft} />
    <Path d="M3.4 11.1h17.2" stroke={main} strokeWidth="2.1" strokeLinecap="round" />
  </Frame>
);

/**
 * Food — a covered dish on a plate.
 *
 * A cloche rather than cutlery: a knife and fork at 30px is two thin strokes
 * that disappear next to the solid shapes the rest of the set uses, and reads
 * as "restaurant" rather than "food on its way to you". The dome carries the
 * tint, the plate underlines it.
 */
export const FoodIcon = ({ size, main, soft, ...rest }: IconProps) => (
  <Frame size={size} {...rest}>
    {/* The cloche — a half-disc sitting on its rim. */}
    <Path d="M4 14.5a8 8 0 0 1 16 0z" fill={soft} />
    {/* Handle on top, so the dome does not read as a plain hill. */}
    <Circle cx="12" cy="5.4" r="1.5" fill={main} />
    {/* Rim and plate, drawn as two weights so they stay apart when small. */}
    <Path d="M3 15.1h18" stroke={main} strokeWidth="2.1" strokeLinecap="round" />
    <Path d="M6 19.1h12" stroke={main} strokeWidth="2.1" strokeLinecap="round" />
  </Frame>
);

/** Bills — a wallet with its clasp. */
export const BillsIcon = ({ size, main, soft, ...rest }: IconProps) => (
  <Frame size={size} {...rest}>
    <Rect x="2.8" y="5.6" width="18.4" height="13.6" rx="3.2" fill={soft} />
    <Path d="M2.8 9.4h18.4" stroke={main} strokeWidth="1.7" opacity={0.35} />
    <Rect x="13.4" y="11.1" width="7.8" height="4.6" rx="2.3" fill={main} />
    <Circle cx="16.9" cy="13.4" r="1.05" fill="#FFFFFF" />
  </Frame>
);

/**
 * Packages — a taped parcel.
 *
 * Two side-by-side boxes of different heights read as a bar chart, so this is a
 * single parcel with a lid seam and a vertical tape strip instead.
 */
export const PackagesIcon = ({ size, main, soft, ...rest }: IconProps) => (
  <Frame size={size} {...rest}>
    <Rect x="2.9" y="6.6" width="18.2" height="13.8" rx="2.4" fill={soft} />
    <Rect x="9.95" y="6.6" width="4.1" height="13.8" fill={main} />
    <Path d="M2.9 11.3h18.2" stroke={main} strokeWidth="1.8" opacity={0.42} />
  </Frame>
);

/**
 * Per-category colours: the tile tint, plus the two icon tones.
 *
 * `main` is deep and saturated and `soft` is a mid-tone — not a pastel — so the
 * glyph holds its weight against the tint at 30px. An earlier pass used pale
 * fills for both and the icons washed out into their tiles.
 */
export const CATEGORY_PALETTE: Record<string, { tint: string; main: string; soft: string }> = {
  errands: { tint: '#FFEFD6', main: '#B8620A', soft: '#F7A93B' },
  logistics: { tint: '#FFE2ED', main: '#B01358', soft: '#F569A6' },
  marketplace: { tint: '#FFE3E1', main: '#C0261F', soft: '#F4766F' },
  shops: { tint: '#FFEAD6', main: '#C2530A', soft: '#FB9A47' },
  pharmacy: { tint: '#DFEBFF', main: '#1B4FA8', soft: '#5D9BEE' },
  markets: { tint: '#DDF2E6', main: '#12703F', soft: '#4FBE84' },
  bills: { tint: '#D8F0E9', main: '#0A6E5C', soft: '#3FB39B' },
  // Warm red-orange: the appetite colour, and distinct from Shops' orange and
  // Marketplace's red at tile size.
  food: { tint: '#FFE6DA', main: '#C2410C', soft: '#FB8A5C' },
  packages: { tint: '#E9DEFF', main: '#4E31C4', soft: '#9B84F5' },
};

const ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  errands: ErrandsIcon,
  logistics: DeliveryIcon,
  marketplace: MarketplaceIcon,
  shops: ShopsIcon,
  pharmacy: PharmacyIcon,
  markets: MarketsIcon,
  bills: BillsIcon,
  food: FoodIcon,
  packages: PackagesIcon,
};

/**
 * Greys for a category that is not available yet.
 *
 * Two tones rather than one flat fill, so the glyph keeps the shape reading it
 * has in colour — a single grey collapses the van, the meter and the basket
 * into indistinguishable blobs at 30px.
 */
const MUTED = { main: '#6B7280', soft: '#C3C8D0' };

/** Resolves a category slug to its icon + palette. Falls back to Packages. */
export function CategoryIcon({
  slug,
  size = 28,
  muted = false,
}: {
  slug: string;
  size?: number;
  /** Draw it grey — for a tile that is visible but not yet usable. */
  muted?: boolean;
}) {
  const palette = muted ? MUTED : (CATEGORY_PALETTE[slug] ?? CATEGORY_PALETTE.packages!);
  const Icon = ICONS[slug] ?? PackagesIcon;
  return <Icon size={size} main={palette.main} soft={palette.soft} />;
}

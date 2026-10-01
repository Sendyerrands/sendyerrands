import { Image, type ImageSource } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { PROMOS, type Promo } from '@/lib/mock';

/**
 * Slide aspect ratio for the whole carousel.
 *
 * Every slide must share one ratio or the carousel's height jumps as it
 * advances, but the source files are 3.102, 2.993 and 2.797. Nothing is cropped
 * to fit — cropping would eat a rider or a phone. Instead each image is padded
 * to this ratio with its own background colour, which is invisible because
 * those colours are sampled from the artwork's edge pixels.
 *
 * 3.0 sits in the middle of the spread: promo-2 lands exactly, promo-1 pads
 * ~3% and promo-3 ~7%. Export all three at 3:1 to remove padding entirely.
 */
const SLIDE_RATIO = 3.0;

/**
 * Each source file's own ratio, so the copy can be laid out against the
 * ARTWORK rather than the padded slide. Update these if you re-export a banner.
 */
const IMAGE_RATIO: Record<string, number> = {
  'promo-1': 2168 / 699, // 3.102
  'promo-2': 2170 / 725, // 2.993
  'promo-3': 2098 / 750, // 2.797
  // Composed at exactly the slide ratio, so it fills edge to edge with no
  // letterboxing — the teal in the artwork and `bg` are the same colour.
  'promo-4': 2100 / 700, // 3.000
};

/** Side inset — the banner is a rounded card, not a full-bleed strip. */
const GUTTER = 16;
/**
 * Must equal GUTTER. The next slide starts at GUTTER + slideWidth + GAP; with
 * slideWidth = containerWidth - 2*GUTTER that lands inside the viewport unless
 * GAP >= GUTTER, leaving a sliver of the next banner against the right edge.
 */
const GAP = GUTTER;

const AUTOPLAY_MS = 4500;
/** After a manual swipe, leave the carousel alone for a while. */
const RESUME_AFTER_TOUCH_MS = 9000;

const PROMO_IMAGES: Record<string, ImageSource | number> = {
  'promo-1': require('../../assets/images/promo-errands.png'),
  'promo-2': require('../../assets/images/promo-market.png'),
  'promo-3': require('../../assets/images/promo-wallet.png'),
  'promo-4': require('../../assets/images/promo-bills.png'),
};

/**
 * Vertical budget for the copy block, as fractions of its SAFE BAND — not of
 * the slide.
 *
 * Two reasons it has to be the band. A 3:1 banner is ~120px tall on a phone and
 * ~250px on a tablet, so fixed point sizes would swim on one and clip on the
 * other. And each banner offers a different amount of clear space: promo-3 only
 * has 64% of its height before the "Sendy Errands" lockup, against 80% for
 * promo-1. Sizing off the slide made the block overflow the short band and
 * collide with that lockup; sizing off the band means it always fits.
 *
 * These sum to 1, with the headline taking whatever the rest leave over.
 */
const PILL_PCT = 0.235;
const GAP_SUB_PILL = 0.055;
const SUB_PCT = 0.135;
const GAP_HEAD_SUB = 0.04;
const HEADLINE_LINE_HEIGHT = 1.16;
const SUB_LINE_HEIGHT = 1.3;
/** A one-line headline would otherwise inherit the whole leftover budget. */
const HEADLINE_MAX_PCT = 0.3;

/**
 * Where the artwork actually lands inside its slide once padded.
 *
 * The copy is authored against the artwork ("clear of the rider"), not the
 * slide, so it survives a change of SLIDE_RATIO or a re-export at a different
 * shape. This converts one to the other.
 *
 * Every banner's four edges are a single flat colour, so padding is invisible
 * whichever way it falls and the artwork is simply centred.
 */
function artworkRect(promoId: string, slideWidth: number) {
  const slideHeight = slideWidth / SLIDE_RATIO;
  const ratio = IMAGE_RATIO[promoId] ?? SLIDE_RATIO;

  if (ratio >= SLIDE_RATIO) {
    // Wider than the slide: fills the width, padded above and below.
    const height = slideWidth / ratio;
    return { x: 0, y: (slideHeight - height) / 2, width: slideWidth, height };
  }

  // Taller than the slide: fills the height, padded left and right.
  const width = slideHeight * ratio;
  return { x: (slideWidth - width) / 2, y: 0, width, height: slideHeight };
}

/**
 * The copy block: headline, optional sub, and the CTA pill.
 *
 * It is a sibling of the artwork's Pressable rather than a child, because a
 * button nested inside a button is invalid on web (design.md §7 note). The
 * whole block is `pointerEvents="box-none"` so only the pill itself is
 * tappable and the rest of the slide still routes to the banner press.
 */
function PromoCopy({
  promo,
  slideWidth,
  onPress,
}: {
  promo: Promo;
  slideWidth: number;
  onPress: () => void;
}) {
  const art = artworkRect(promo.id, slideWidth);
  const { safe } = promo;

  // Everything below is measured against this, so a banner with less clear
  // space simply gets a smaller block rather than an overflowing one.
  const band = art.height * (safe.bottom - safe.top);

  const subBlock = promo.sub ? SUB_PCT * SUB_LINE_HEIGHT + GAP_HEAD_SUB : 0;
  const headlineLines = promo.headline.split('\n').length;
  const headlinePct = Math.min(
    HEADLINE_MAX_PCT,
    (1 - PILL_PCT - GAP_SUB_PILL - subBlock) / (headlineLines * HEADLINE_LINE_HEIGHT)
  );

  const headline = Math.round(band * headlinePct);
  const sub = Math.round(band * SUB_PCT);
  const pillHeight = Math.round(band * PILL_PCT);

  // Lifts white copy off a light illustration without tinting the artwork.
  const shadow = promo.shadow
    ? {
        textShadowColor: 'rgba(12,44,62,0.45)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 6,
      }
    : null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: art.x + art.width * safe.left,
        width: art.width * (safe.right - safe.left),
        top: art.y + art.height * safe.top,
        height: band,
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: promo.textColor,
          fontSize: headline,
          lineHeight: Math.round(headline * HEADLINE_LINE_HEIGHT),
          ...shadow,
        }}
        className="font-display"
      >
        {promo.headline}
      </Text>

      {promo.sub ? (
        <Text
          style={{
            color: promo.subColor,
            fontSize: sub,
            lineHeight: Math.round(sub * SUB_LINE_HEIGHT),
            marginTop: Math.round(band * GAP_HEAD_SUB),
            ...shadow,
          }}
          numberOfLines={1}
        >
          {promo.sub}
        </Text>
      ) : null}

      <Pressable
        onPress={onPress}
        disabled={promo.comingSoon}
        // "Coming soon" is a label, not an action — announcing it as a button
        // promises something to tap.
        accessibilityRole={promo.comingSoon ? 'text' : 'button'}
        accessibilityLabel={
          promo.comingSoon ? `${promo.title}. ${promo.cta}.` : `${promo.cta} — ${promo.title}`
        }
        style={{
          backgroundColor: promo.ctaBg,
          marginTop: Math.round(band * GAP_SUB_PILL),
          height: pillHeight,
          paddingHorizontal: Math.round(pillHeight * 0.55),
          alignSelf: 'flex-start',
        }}
        className="rounded-full items-center justify-center active:opacity-80"
      >
        <Text
          style={{ color: promo.ctaTextColor, fontSize: Math.round(pillHeight * 0.42) }}
          className="font-semibold"
          numberOfLines={1}
        >
          {promo.cta}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Promo banner carousel (design.md §9) — inset artwork slides that advance on
 * their own, with copy and a CTA rendered in code over text-free artwork.
 */
export function PromoCarousel({ onPress }: { onPress?: (id: string) => void }) {
  const router = useRouter();

  /**
   * Measure the carousel's own box rather than the window.
   *
   * Sizing slides off the window width made the banner overflow the right edge
   * whenever the app was not exactly window-wide — a device-frame preview, a
   * tablet, or any parent that adds padding. onLayout is the real width here.
   */
  const [containerWidth, setContainerWidth] = useState(0);
  const slideWidth = Math.max(containerWidth - GUTTER * 2, 0);
  const stride = slideWidth + GAP;

  const [index, setIndex] = useState(0);
  const ref = useRef<ScrollView>(null);
  const pausedUntil = useRef(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - containerWidth) > 0.5) setContainerWidth(next);
  };

  useEffect(() => {
    if (PROMOS.length < 2 || slideWidth <= 0) return;

    const timer = setInterval(() => {
      // Don't yank the carousel out from under someone mid-swipe.
      if (Date.now() < pausedUntil.current) return;

      setIndex((prev) => {
        const next = (prev + 1) % PROMOS.length;
        ref.current?.scrollTo({ x: next * stride, animated: true });
        return next;
      });
    }, AUTOPLAY_MS);

    return () => clearInterval(timer);
  }, [stride, slideWidth]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / stride);
    if (next !== index) setIndex(next);
  };

  const go = (promoId: string, href?: string) => {
    if (onPress) return onPress(promoId);
    // A slide with nowhere to go stays put rather than pushing an empty route.
    if (!href) return;
    router.push(href as never);
  };

  // Hold the slot at the right height until the first measurement lands.
  if (slideWidth === 0) {
    return (
      <View onLayout={onLayout}>
        <View
          style={{ marginHorizontal: GUTTER, aspectRatio: SLIDE_RATIO }}
          className="rounded-lg bg-pink-100"
        />
        <View className="h-1.5 mt-3" />
      </View>
    );
  }

  return (
    <View onLayout={onLayout}>
      <ScrollView
        ref={ref}
        horizontal
        /**
         * NOT pagingEnabled. That snaps to multiples of the ScrollView's own
         * width, but these slides are inset and therefore narrower, so the two
         * fight and the last slide settles a GAP short of its gutter.
         * snapToInterval is the one that understands the slide pitch.
         */
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={stride}
        snapToAlignment="start"
        disableIntervalMomentum
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          pausedUntil.current = Date.now() + RESUME_AFTER_TOUCH_MS;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: GUTTER }}
      >
        {PROMOS.map((promo, i) => (
          <View
            key={promo.id}
            // No trailing gap on the last slide, or the content overruns by GAP
            // and the final rest position lands short of the right gutter.
            style={{ width: slideWidth, marginRight: i === PROMOS.length - 1 ? 0 : GAP }}
          >
            <Pressable
              onPress={() => go(promo.id, promo.href)}
              // Not a button when there is nowhere to go. A screen reader
              // announcing "button" on a slide that cannot be activated is the
              // same lie the old Bills tile told.
              accessibilityRole={promo.comingSoon ? 'image' : 'button'}
              accessibilityLabel={promo.title}
              disabled={promo.comingSoon}
              style={{ backgroundColor: promo.bg, aspectRatio: SLIDE_RATIO }}
              className="rounded-lg overflow-hidden"
            >
              {/*
                Artwork only where artwork exists.
                The fallback used to be promo-1's illustration, which would put
                a rider on a slide about paying light bills. A slide with none
                shows its background colour, which the copy is designed against.
              */}
              {PROMO_IMAGES[promo.id] ? (
                <Image
                  source={PROMO_IMAGES[promo.id]!}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="contain"
                />
              ) : null}
            </Pressable>

            <PromoCopy
              promo={promo}
              slideWidth={slideWidth}
              onPress={() => go(promo.id, promo.href)}
            />
          </View>
        ))}
      </ScrollView>

      <View className="flex-row justify-center mt-3">
        {PROMOS.map((p, i) => (
          <View
            key={p.id}
            className={`h-1.5 rounded-full mx-1 ${
              i === index ? 'w-5 bg-pink-600' : 'w-1.5 bg-pink-200'
            }`}
          />
        ))}
      </View>
    </View>
  );
}

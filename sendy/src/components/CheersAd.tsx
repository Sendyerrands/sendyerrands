import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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

import { openInApp } from '@/lib/open-in-app';
import { colors } from '@/lib/theme';

/**
 * A paid placement for Cheers TV.
 *
 * Labelled "Sponsored", and that is not negotiable. This is the one block on
 * the home screen Sendy did not write and is paid to carry, and a reader is
 * entitled to know that before they tap.
 *
 * It sits at the FOOT of the screen, below everything Sendy sells. An
 * advertiser above the pillar grid competes with the product for the first
 * screenful; below it, the people who scroll that far are the ones still
 * reading.
 *
 * It advances on its own, and stops as soon as anyone touches it — rotating a
 * slide out from under a finger is the one thing a carousel must never do. It
 * picks up again a few seconds after they let go.
 */

/** Cheers TV's own brand colours, sampled from the supplied artwork. */
const CHEERS_PURPLE = '#6B13BE';

type Slide = {
  id: string;
  source: number;
  alt: string;
  /** Photos fill the card; logos sit inside it with room to breathe. */
  fit: 'cover' | 'contain';
};

/**
 * Every slide shares one box, because a carousel whose slides differ in ratio
 * jumps in height as it advances.
 *
 * That box takes the PHOTO's own ratio rather than imposing a landscape one on
 * it. Cropping the artwork to 4:3 is what sliced its headline in half: the
 * words run across the bottom of a portrait image, so any landscape crop either
 * loses the subject or loses the sentence. Fitting the box to the artwork costs
 * some height and keeps every word. The logos are contained inside the same
 * box, so they keep their own shape too.
 */
const SLIDE_RATIO = 900 / 1170;
const SLIDES: Slide[] = [
  {
    id: 'traffic',
    source: require('../../assets/images/cheers-ad-traffic.jpg'),
    alt: 'Cheers TV: how is the traffic treating you?',
    fit: 'cover',
  },
  {
    id: 'wordmark-orange',
    source: require('../../assets/images/cheers-wordmark-orange.png'),
    alt: 'Cheers TV',
    fit: 'contain',
  },
  {
    id: 'wordmark-purple',
    source: require('../../assets/images/cheers-wordmark-purple.png'),
    alt: 'Cheers TV',
    fit: 'contain',
  },
  {
    id: 'mark-orange',
    source: require('../../assets/images/cheers-mark-orange.png'),
    alt: 'Cheers TV',
    fit: 'contain',
  },
];

const LINKS = {
  tiktok: 'https://www.tiktok.com/@connecttocheerstv?_r=1&_t=ZS-9ATOo9x3fEL',
  x: 'https://x.com/connectcheerstv',
};

const GUTTER = 16;
const GAP = 10;
/** Capped so the card stays a card on a tablet rather than a billboard. */
const MAX_SLIDE = 290;
const AUTOPLAY_MS = 4200;
/** After a swipe, leave it alone long enough to actually read the slide. */
const RESUME_AFTER_TOUCH_MS = 9000;

export function CheersAd() {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  /** When the viewer last touched it. 0 means they have not. */
  const touchedAt = useRef(0);

  // Narrower than the screen on purpose: the next slide peeks past the edge,
  // which is what tells someone there is more without needing a caption.
  const slideW = Math.min(Math.max(0, width - GUTTER * 2), MAX_SLIDE);
  const slideH = Math.round(slideW / SLIDE_RATIO);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!slideW) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / (slideW + GAP));
    if (next !== index) setIndex(next);
  };

  /*
    Autoplay.

    Skipped entirely until the layout has a width, because scrolling to
    `slideW + GAP` while slideW is 0 just scrolls to 0 and the carousel sits on
    the first slide looking broken.

    The touch check is inside the tick rather than in a listener that clears
    the interval: it keeps one timer for the component's life instead of
    tearing one down and standing another up on every drag.
  */
  useEffect(() => {
    if (!slideW || SLIDES.length < 2) return;
    const t = setInterval(() => {
      if (Date.now() - touchedAt.current < RESUME_AFTER_TOUCH_MS) return;
      setIndex((prev) => {
        const next = (prev + 1) % SLIDES.length;
        scrollRef.current?.scrollTo({ x: next * (slideW + GAP), animated: true });
        return next;
      });
    }, AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [slideW]);

  return (
    <View className="mt-7" onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {/* Brand row. "Sponsored" sits beside the name because it qualifies it. */}
      <View className="flex-row items-center px-4 mb-2">
        <Image
          source={require('../../assets/images/cheers-logo.png')}
          style={{ width: 26, height: 26, borderRadius: 13 }}
          contentFit="contain"
          accessible={false}
        />
        <Text className="text-ink text-[13.5px] font-semibold ml-2">Cheers TV</Text>
        <View className="ml-1.5 rounded px-1.5 py-0.5 bg-surface">
          <Text className="text-muted text-[9.5px] font-bold tracking-wide">SPONSORED</Text>
        </View>
      </View>

      <Text className="text-body text-[12.5px] px-4 mb-2.5 leading-[17px]">
        Cheers TV is a media company telling the stories people are actually talking about.
      </Text>

      {slideW > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={slideW + GAP}
          decelerationRate="fast"
          onScroll={onScroll}
          scrollEventThrottle={16}
          /* Both, not just the drag: a tap that never becomes a drag still
             means someone is looking at this slide. */
          onTouchStart={() => {
            touchedAt.current = Date.now();
          }}
          onScrollBeginDrag={() => {
            touchedAt.current = Date.now();
          }}
          contentContainerStyle={{ paddingHorizontal: GUTTER }}
        >
          {SLIDES.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => void openInApp(LINKS.tiktok)}
              accessibilityRole="link"
              accessibilityLabel={`${s.alt}. Sponsored. Opens Cheers TV on TikTok.`}
              style={{
                width: slideW,
                height: slideH,
                marginRight: i === SLIDES.length - 1 ? 0 : GAP,
                // Logos are transparent cut-outs; the card gives them a surface
                // to sit on rather than showing the screen through them.
                padding: s.fit === 'contain' ? 18 : 0,
              }}
              className="rounded-lg overflow-hidden bg-surface"
            >
              <Image
                source={s.source}
                style={{ width: '100%', height: '100%' }}
                contentFit={s.fit}
                transition={160}
                accessible={false}
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View className="flex-row justify-center mt-2">
        {SLIDES.map((s, i) => (
          <View
            key={s.id}
            className={`h-1 rounded-full mx-0.5 ${
              i === index ? 'w-3 bg-pink-600' : 'w-1 bg-hairline'
            }`}
          />
        ))}
      </View>

      <View className="flex-row px-4 mt-3">
        <Pressable
          onPress={() => void openInApp(LINKS.tiktok)}
          accessibilityRole="link"
          accessibilityLabel="Watch Cheers TV on TikTok"
          style={{ backgroundColor: CHEERS_PURPLE }}
          className="flex-1 flex-row items-center justify-center rounded-md py-2 mr-2 active:opacity-80"
        >
          <Ionicons name="logo-tiktok" size={13} color={colors.white} />
          <Text className="text-white text-[12.5px] font-semibold ml-1.5">TikTok</Text>
        </Pressable>

        <Pressable
          onPress={() => void openInApp(LINKS.x)}
          accessibilityRole="link"
          accessibilityLabel="Follow Cheers TV on X"
          className="flex-1 flex-row items-center justify-center rounded-md py-2 border border-hairline active:bg-surface"
        >
          <Text className="text-ink text-[13px] font-bold">𝕏</Text>
          <Text className="text-ink text-[12.5px] font-semibold ml-1.5">Follow</Text>
        </Pressable>
      </View>

      {/* Small print. Says plainly this is not Sendy, because it sits in a feed
          of things that are. */}
      <Text className="text-muted text-[10.5px] px-4 mt-2.5 leading-[15px]">
        Paid placement. Cheers TV is an independent media company, not part of Sendy Errands.
      </Text>
    </View>
  );
}

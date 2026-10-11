import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
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
 * Labelled "Sponsored" and not negotiable. This is the one block on the home
 * screen Sendy did not write and is paid to carry, and a reader is entitled to
 * know that before they tap. Everything else here is ours; this is not.
 *
 * Built as a carousel rather than a single image because the slot is meant to
 * take a run of creatives — add to CREATIVES and it swipes, with dots. With one
 * creative it renders as a plain card: no dots, no swipe affordance promising
 * content that is not there.
 */

/** Cheers TV's own brand colours, from the supplied artwork — not Sendy's. */
const CHEERS_PURPLE = '#6B13BE';

type Creative = {
  id: string;
  source: number;
  /** Described for a screen reader, since the artwork carries the message. */
  alt: string;
  /** Source aspect ratio, so the card never letterboxes or crops the subject. */
  ratio: number;
};

const CREATIVES: Creative[] = [
  {
    id: 'traffic',
    source: require('../../assets/images/cheers-ad-traffic.jpg'),
    alt: 'Cheers TV: How is the traffic treating you?',
    ratio: 1080 / 1404,
  },
];

const LINKS = {
  tiktok: 'https://www.tiktok.com/@connecttocheerstv?_r=1&_t=ZS-9ATOo9x3fEL',
  x: 'https://x.com/connectcheerstv',
};

const GUTTER = 16;

export function CheersAd() {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const slideWidth = Math.max(0, width - GUTTER * 2);
  const many = CREATIVES.length > 1;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!slideWidth) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / (slideWidth + GUTTER));
    if (next !== index) setIndex(next);
  };

  return (
    <View className="mt-6" onLayout={onLayout}>
      {/* Brand row. The "Sponsored" chip sits beside the name, not buried under
          the card, because it qualifies the name. */}
      <View className="flex-row items-center px-4 mb-2.5">
        <Image
          source={require('../../assets/images/cheers-logo.png')}
          style={{ width: 34, height: 34, borderRadius: 17 }}
          contentFit="contain"
          accessible={false}
        />
        <View className="ml-2.5 flex-1">
          <View className="flex-row items-center">
            <Text className="text-ink text-[15px] font-semibold">Cheers TV</Text>
            <View className="ml-2 rounded px-1.5 py-0.5 bg-surface">
              <Text className="text-muted text-[10px] font-bold tracking-wide">SPONSORED</Text>
            </View>
          </View>
          <Text className="text-muted text-[12px] mt-0.5">Your World, Your Voice.</Text>
        </View>
      </View>

      <Text className="text-body text-[13.5px] px-4 mb-3 leading-[19px]">
        Cheers TV is a media company telling the stories people are actually talking about —
        news, culture and the everyday life of the city.
      </Text>

      {/* The creatives. Horizontal even for one, so adding a second needs no
          layout change — and paging is only switched on when there is
          somewhere to page to. */}
      {slideWidth > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={many}
          pagingEnabled={false}
          snapToInterval={many ? slideWidth + GUTTER : undefined}
          decelerationRate="fast"
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingHorizontal: GUTTER }}
        >
          {CREATIVES.map((c, i) => (
            <Pressable
              key={c.id}
              onPress={() => void openInApp(LINKS.tiktok)}
              accessibilityRole="link"
              accessibilityLabel={`${c.alt}. Sponsored. Opens Cheers TV on TikTok.`}
              style={{
                width: slideWidth,
                marginRight: i === CREATIVES.length - 1 ? 0 : GUTTER,
              }}
              className="rounded-xl overflow-hidden bg-surface"
            >
              <Image
                source={c.source}
                style={{ width: '100%', aspectRatio: c.ratio }}
                contentFit="cover"
                transition={200}
                accessible={false}
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {many ? (
        <View className="flex-row justify-center mt-2.5">
          {CREATIVES.map((c, i) => (
            <View
              key={c.id}
              className={`h-1.5 rounded-full mx-1 ${
                i === index ? 'w-4 bg-pink-600' : 'w-1.5 bg-hairline'
              }`}
            />
          ))}
        </View>
      ) : null}

      {/* The small print. Says plainly that this is not Sendy, because the card
          sits in a feed of things that are. */}
      <Text className="text-muted text-[11.5px] px-4 mt-3 leading-[16px]">
        Paid placement. Cheers TV is an independent media company — not part of Sendy Errands,
        and nothing here is a Sendy service.
      </Text>

      <View className="flex-row px-4 mt-3">
        <Pressable
          onPress={() => void openInApp(LINKS.tiktok)}
          accessibilityRole="link"
          accessibilityLabel="Watch Cheers TV on TikTok"
          style={{ backgroundColor: CHEERS_PURPLE }}
          className="flex-1 flex-row items-center justify-center rounded-md py-2.5 mr-2 active:opacity-80"
        >
          <Ionicons name="logo-tiktok" size={15} color={colors.white} />
          <Text className="text-white text-[13.5px] font-semibold ml-1.5">Watch on TikTok</Text>
        </Pressable>

        <Pressable
          onPress={() => void openInApp(LINKS.x)}
          accessibilityRole="link"
          accessibilityLabel="Follow Cheers TV on X"
          className="flex-1 flex-row items-center justify-center rounded-md py-2.5 border border-hairline active:bg-surface"
        >
          <Text className="text-ink text-[14px] font-bold">𝕏</Text>
          <Text className="text-ink text-[13.5px] font-semibold ml-1.5">Follow on X</Text>
        </Pressable>
      </View>
    </View>
  );
}

import LottieView from 'lottie-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SendyMark } from '@/components/brand/SendyMark';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/**
 * Splash (design.md §10) — stacked lockup on the deep pink gradient with the
 * delivery animation below.
 *
 * The source file shipped an opaque white background solid, which framed the
 * animation in a white card floating on the gradient. That layer is stripped
 * from assets/lottie/delivery-splash.json, so the artwork now composites
 * straight onto the pink with a transparent background.
 */

// 6s at 50fps. Hold long enough to read as intentional, not so long it annoys.
const SPLASH_MS = 2800;

export default function Splash() {
  const router = useRouter();
  const { ready, signedIn, actor } = useApp();

  // Where a returning user belongs, once the stored session has been checked.
  const destination = !signedIn ? '/onboarding' : actor === 'rider' ? '/rider' : '/(tabs)/home';

  useEffect(() => {
    if (!ready) return; // hold the splash until the token check finishes
    const t = setTimeout(() => router.replace(destination as never), SPLASH_MS);
    return () => clearTimeout(t);
  }, [router, ready, destination]);

  return (
    <Pressable onPress={() => ready && router.replace(destination as never)} className="flex-1">
      <StatusBar style="light" />
      <LinearGradient
        colors={[colors.pink[600], colors.pink[900]]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ flex: 1 }}
      >
        <View className="flex-1 items-center justify-center px-6">
          {/* stacked lockup */}
          <View className="w-[112px] h-[112px] rounded-[32px] bg-white/15 items-center justify-center">
            <SendyMark size={78} color={colors.white} />
          </View>
          {/* 34px, not 40: "Sendy Errands" is thirteen characters and wrapped
              to two lines on a 360px-wide phone at the larger size.

              numberOfLines is belt-and-braces against the same problem in the
              other direction. _layout now holds the splash until the fonts
              load, so this should always render in Plus Jakarta — but if that
              times out, a narrow phone in the system font must shrink the name
              rather than break it in half. */}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            className="text-white text-[34px] font-display mt-6 tracking-tight text-center"
          >
            Sendy Errands
          </Text>
          <Text className="text-white/80 text-[15px] mt-1">Send. Shop. Delivered.</Text>

          {/* delivery animation — transparent background, sits on the gradient.
              3:2 matches the source artboard. */}
          <View className="w-full mt-8" style={{ aspectRatio: 3 / 2 }}>
            <LottieView
              source={require('../../assets/lottie/delivery-splash.json')}
              autoPlay
              loop
              resizeMode="contain"
              style={{ width: '100%', height: '100%' }}
            />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '@/lib/api/client';
import { AppProvider } from '@/store/app';

import '../global.css';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  /**
   * Hold the native splash until the fonts are in — but never indefinitely.
   *
   * This used to hide immediately, on the reasoning that the system font is a
   * clean fallback and blocking on webfonts is rude. The fallback is clean; the
   * swap is not. The splash renders "Sendy Errands" at 34px, which fits one
   * line in Plus Jakarta and does not in the wider system stack — so the first
   * paint wrapped to "Sendy" / "Errands", then snapped back to one line when
   * the font arrived, shifting everything below it. Reported, accurately, as
   * the text flickering between two names.
   *
   * Holding costs nothing here: the native splash is the same mark on the same
   * pink as the screen replacing it, so the wait is invisible. The timeout is
   * the important half — a font that never resolves must not leave someone
   * staring at a splash screen forever.
   */
  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync().catch(() => {});
      return;
    }

    const giveUp = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 3000);
    return () => clearTimeout(giveUp);
  }, [loaded]);

  // One client for the app's lifetime; created in state so Fast Refresh doesn't
  // discard the cache on every edit.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry(failureCount, error) {
              // Retrying a 401/403/404 just delays the real error.
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      })
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#FFFFFF' },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="index" options={{ animation: 'fade' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="cart" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="payment-success" options={{ animation: 'fade' }} />
          </Stack>
        </AppProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

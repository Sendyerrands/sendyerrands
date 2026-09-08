import { Ionicons } from '@expo/vector-icons';
import { QueryError } from '@/components/ui/QueryError';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { CategoryGrid } from '@/components/CategoryGrid';
import { PromoCarousel } from '@/components/PromoCarousel';
import { EmptyState, SectionGap, SectionHeader, Skeleton } from '@/components/ui/atoms';
import { Button, IconButton } from '@/components/ui/Button';
import { LocationSelector, Screen } from '@/components/ui/Screen';
import { VendorCard } from '@/components/VendorCard';
import { useNotifications, useVendors } from '@/lib/api/hooks';
import { colors, shadow } from '@/lib/theme';
import { useApp } from '@/store/app';

/**
 * Home (design.md §10) — header, promo carousel, pillar grid, then curated
 * vendor rails. This screen is the component reference for the whole app.
 */
export default function Home() {
  const router = useRouter();
  const { activeAddress } = useApp();
  const { data: vendors = [], isLoading, isError, error, refetch } = useVendors();

  // Gated on a token inside the hook, so a signed-out home screen simply shows
  // an unbadged bell rather than an error.
  const { data: notifications } = useNotifications();
  const unread = notifications?.unread ?? 0;

  const openVendor = (id: string) =>
    router.push({ pathname: '/vendor/[id]', params: { id } });

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
        {/* app bar */}
        <View className="flex-row items-center px-4 py-2">
          <LocationSelector
            address={(activeAddress?.line1 ?? 'Set your address').replace(', Victoria Island', ', VI')}
            onPress={() => router.push('/addresses')}
          />
          <IconButton
            icon="pricetags-outline"
            accessibilityLabel="Offers"
            className="ml-2"
            onPress={() => router.push('/(tabs)/search')}
          />
          {/* The badge was hardcoded true and there was no onPress: a red dot
              that never cleared, over nothing. It now counts real unread
              notifications and opens the screen that shows them. */}
          <IconButton
            icon="notifications-outline"
            accessibilityLabel={
              unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
            }
            badge={unread > 0}
            className="ml-2"
            onPress={() => router.push('/notifications')}
          />
        </View>

        {/* search + filter */}
        <View className="flex-row items-center px-4 mt-2 mb-4">
          <Pressable
            onPress={() => router.push('/(tabs)/search')}
            accessibilityRole="search"
            className="flex-1 flex-row items-center bg-surface rounded-full h-12 px-4"
          >
            <Ionicons name="search" size={18} color={colors.muted} />
            <Text className="text-muted text-[15px] ml-2.5">Search vendors, food, errands</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filters"
            style={shadow.card}
            className="w-12 h-12 rounded-full bg-pink-600 items-center justify-center ml-3 active:bg-pink-700"
          >
            <Ionicons name="options-outline" size={20} color={colors.white} />
          </Pressable>
        </View>

        {/* No onPress — each banner routes to its own href (errands, wallet). */}
        <PromoCarousel />

        <View className="mt-6">
          <CategoryGrid />
        </View>

        <SectionGap />

        {/* handpicked rail */}
        <View className="pt-5">
          <SectionHeader
            title="Handpicked for you"
            onAction={() => router.push({ pathname: '/category/[slug]', params: { slug: 'handpicked' } })}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16 }}
          >
            {isLoading
              ? [0, 1].map((i) => <Skeleton key={i} className="w-[280px] h-[236px] mr-3" />)
              : vendors.slice(0, 3).map((v) => (
                  <VendorCard key={v.id} vendor={v} width={280} onPress={() => openVendor(v.id)} />
                ))}
          </ScrollView>
        </View>

        <SectionGap />

        {/* discounts rail */}
        <View className="pt-5">
          <SectionHeader
            title="Discounts near you"
            onAction={() => router.push({ pathname: '/category/[slug]', params: { slug: 'discounts' } })}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16 }}
          >
            {vendors
              .filter((v) => v.discount)
              .map((v) => (
                <VendorCard key={v.id} vendor={v} width={280} onPress={() => openVendor(v.id)} />
              ))}
          </ScrollView>
        </View>

        <SectionGap />

        {/* full list */}
        <View className="pt-5 px-4">
          <Text className="text-ink text-[20px] font-bold mb-4">All vendors nearby</Text>

          {isError ? (
            <QueryError error={error} onRetry={() => refetch()} noun="vendors" />
          ) : isLoading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="w-full h-[236px] mb-5" />)
          ) : vendors.length === 0 ? (
            <EmptyState
              icon="storefront-outline"
              title="No vendors nearby yet"
              body="We're onboarding more vendors in your area. Try an errand or send a package in the meantime."
            />
          ) : (
            vendors.map((v) => <VendorCard key={v.id} vendor={v} onPress={() => openVendor(v.id)} />)
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

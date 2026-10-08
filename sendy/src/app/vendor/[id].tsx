import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { MenuItemRow } from '@/components/ProductCard';
import { Chip, EmptyState, Skeleton, Verified } from '@/components/ui/atoms';
import { Button, IconButton } from '@/components/ui/Button';
import { Screen, StickyBar } from '@/components/ui/Screen';
import { QueryError } from '@/components/ui/QueryError';
import { Thumb } from '@/components/ui/Thumb';
import { useVendor } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { colors } from '@/lib/theme';
import { confirmAsync } from '@/lib/confirm';
import { useApp } from '@/store/app';

/** Vendor / store detail (design.md §10) — cover, trust bar, catalogue by section. */
export default function VendorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { addToCart, wouldReplaceCart, cartCount, subtotal, setVendorFees } = useApp();
  const { data, isLoading, isError, error, refetch } = useVendor(id);
  const [section, setSection] = useState<string | null>(null);

  const vendor = data?.vendor;
  const sections = data?.sections ?? [];
  const activeSection = section ?? sections[0] ?? '';
  const visible = (data?.menu ?? []).filter((m) => m.section === activeSection);

  // Keep the cart's fee preview aligned with this vendor's real pricing.
  useEffect(() => {
    if (!data) return;
    setVendorFees({
      deliveryFee: data.deliveryFeeKobo / 100,
      freeOver: data.freeOverKobo ? data.freeOverKobo / 100 : undefined,
    });
  }, [data, setVendorFees]);

  if (isLoading || !vendor) {
    return (
      <Screen edges={[]}>
        <View className="h-[300px] bg-surface" />
        <View className="px-4 pt-6">
          <Skeleton className="w-2/3 h-7 mb-3" />
          <Skeleton className="w-1/2 h-5 mb-6" />
          <Skeleton className="w-full h-20 mb-4" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="w-full h-24 mb-3" />
          ))}
        </View>
        {isError ? (
          <View className="px-4">
            <QueryError error={error} onRetry={() => refetch()} noun="this vendor" />
          </View>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* cover */}
        <View className="relative">
          <Thumb data={vendor.cover} className="w-full h-[300px]" rounded="rounded-none" iconSize={64} />

          <View className="absolute top-12 left-4 right-4 flex-row">
            <IconButton icon="arrow-back" tone="white" onPress={() => router.back()} accessibilityLabel="Go back" />
            <View className="flex-1" />
            <IconButton icon="share-social-outline" tone="white" accessibilityLabel="Share vendor" />
            <View className="w-2" />
            <IconButton icon="heart-outline" tone="white" accessibilityLabel="Save vendor" />
          </View>

          {vendor.discount ? (
            <View className="absolute bottom-8 left-4 flex-row items-center bg-savings rounded-md px-3 py-2">
              <Ionicons name="pricetag" size={14} color={colors.white} />
              <Text className="text-white text-[13px] font-semibold ml-2">{vendor.discount}</Text>
            </View>
          ) : null}
        </View>

        {/* sheet */}
        <View className="bg-white rounded-t-xl -mt-5 pt-5">
          <View className="px-4">
            <View className="flex-row items-center">
              <Text className="text-ink text-[24px] font-display flex-1 pr-3">{vendor.name}</Text>
              {vendor.verified ? <Verified size={22} /> : null}
            </View>
            <Text className="text-muted text-[15px] mt-1.5">{vendor.tags.join(' · ')}</Text>

            {/* trust bar */}
            <View className="flex-row bg-surface rounded-lg mt-4 py-3">
              <Stat
                icon="star"
                iconColor={colors.star}
                value={vendor.rating.toFixed(1)}
                label={`${vendor.ratingCount} ratings`}
              />
              <View className="w-px bg-hairline my-1" />
              <Stat
                icon="time-outline"
                iconColor={colors.body}
                value={`${vendor.etaMin}–${vendor.etaMax}`}
                label="minutes"
              />
              <View className="w-px bg-hairline my-1" />
              <Stat value={naira(vendor.deliveryFee)} label="delivery fee" />
            </View>

            {/* status chips */}
            <View className="flex-row mt-3">
              <View className="flex-row items-center bg-success/10 rounded-full px-3 py-1.5 mr-2">
                <View className="w-1.5 h-1.5 rounded-full bg-success mr-2" />
                <Text className="text-success text-[13px] font-medium">
                  {vendor.open ? `Open · till ${vendor.closesAt}` : `Closed · opens ${vendor.closesAt}`}
                </Text>
              </View>
              {vendor.freeOver ? (
                <View className="flex-row items-center bg-pink-50 rounded-full px-3 py-1.5">
                  <Ionicons name="bicycle" size={13} color={colors.pink[600]} />
                  <Text className="text-pink-700 text-[13px] font-medium ml-1.5">
                    Free over ₦{vendor.freeOver / 1000}k
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* section chips */}
          <View className="mt-5">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
              {sections.map((s) => (
                <Chip key={s} label={s} selected={s === activeSection} onPress={() => setSection(s)} />
              ))}
            </ScrollView>
          </View>

          {/* menu */}
          <View className="mt-5">
            <Text className="text-ink text-[20px] font-bold px-4 mb-1">
              {activeSection === 'Popular' ? '👌 Popular right now' : activeSection}
            </Text>
            {visible.length ? (
              visible.map((item, i) => (
                <MenuItemRow
                  key={item.id}
                  item={item}
                  last={i === visible.length - 1}
                  onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
                  onAdd={async () => {
                    // Everything on this screen is one vendor's, so this only
                    // fires when the cart already holds someone else's.
                    if (
                      wouldReplaceCart(data.vendorId) &&
                      !(await confirmAsync(
                        'Start a new cart?',
                        `Your cart has items from another seller. Sendy sends one rider to one pickup, so adding from ${data.vendor.name || 'this seller'} will empty it first.`,
                        'Start new cart'
                      ))
                    ) {
                      return;
                    }
                    addToCart(
                      { id: item.id, name: item.name, price: item.price, thumb: item.thumb },
                      data.vendorId
                    );
                  }}
                />
              ))
            ) : (
              <Text className="text-muted text-[15px] px-4 py-8 text-center">
                Nothing in {activeSection} yet.
              </Text>
            )}
          </View>
        </View>
      </ScrollView>

      {cartCount > 0 ? (
        <StickyBar>
          <Button
            title="View cart"
            trailing={naira(subtotal)}
            icon="basket-outline"
            onPress={() => router.push('/cart')}
          />
        </StickyBar>
      ) : null}
    </Screen>
  );
}

function Stat({
  icon,
  iconColor,
  value,
  label,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  value: string;
  label: string;
}) {
  return (
    <View className="flex-1 items-center">
      <View className="flex-row items-center">
        {icon ? <Ionicons name={icon} size={14} color={iconColor} style={{ marginRight: 4 }} /> : null}
        <Text className="text-ink text-[15px] font-bold">{value}</Text>
      </View>
      <Text className="text-muted text-[11px] mt-0.5">{label}</Text>
    </View>
  );
}

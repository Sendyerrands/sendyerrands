import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { VendorCard } from '@/components/VendorCard';
import { Chip, Divider, EmptyState } from '@/components/ui/atoms';
import { Button, IconButton } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useVendors } from '@/lib/api/hooks';
import { useApp } from '@/store/app';
import { colors, shadow } from '@/lib/theme';

const TITLES: Record<string, string> = {
  handpicked: 'Handpicked for you',
  discounts: 'Discounts near you',
  trending: 'Trending vendors',
  shops: 'Shops',
  pharmacy: 'Pharmacies',
  markets: 'Local markets',
  food: 'Food',
  bills: 'Bills & top-ups',
};

/** Cuisine tags that mean "a cooked meal", for the Food category. */
const FOOD_TAGS = new Set([
  'Nigerian', 'Swallow', 'Soups', 'Local', 'Rice & Grains',
  'Grills', 'Suya', 'Small chops', 'Continental', 'Fast food', 'Pastries', 'Drinks',
]);

const SORTS = ['Recommended', 'Fastest', 'Top rated', 'Lowest fee'];
const RATINGS = ['Any', '4.0+', '4.5+', '4.8+'];

/** Category listing (design.md §10) — filtered vendor list + filter sheet. */
export default function CategoryListing() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sort, setSort] = useState('Recommended');
  const [rating, setRating] = useState('Any');
  const [openOnly, setOpenOnly] = useState(false);

  const title = TITLES[slug ?? ''] ?? 'Browse';

  const { activeAddress } = useApp();
  const { data: vendors = [] } = useVendors();
  let list = [...vendors];
  if (slug === 'discounts') list = list.filter((v) => v.discount);
  if (slug === 'pharmacy') list = list.filter((v) => v.tags.includes('Pharmacy'));
  if (slug === 'markets') list = list.filter((v) => v.tags.includes('Foodstuff'));
  /*
   * Food is prepared meals, which no single tag marks.
   *
   * Vendors tag themselves by cuisine — Nigerian, Swallow, Suya, Soups — so
   * matching one string would show one restaurant and hide the rest. Matching
   * the set keeps the page honest as vendors are added, and deliberately
   * excludes Foodstuff/Grains: a sack of rice belongs to Markets, and someone
   * who tapped Food wants dinner, not ingredients.
   */
  if (slug === 'food') list = list.filter((v) => v.tags.some((t) => FOOD_TAGS.has(t)));
  if (openOnly) list = list.filter((v) => v.open);
  if (rating !== 'Any') list = list.filter((v) => v.rating >= parseFloat(rating));
  if (sort === 'Fastest') list.sort((a, b) => a.etaMin - b.etaMin);
  if (sort === 'Top rated') list.sort((a, b) => b.rating - a.rating);
  if (sort === 'Lowest fee') list.sort((a, b) => a.deliveryFee - b.deliveryFee);

  const activeFilters = (rating !== 'Any' ? 1 : 0) + (openOnly ? 1 : 0) + (sort !== 'Recommended' ? 1 : 0);

  return (
    <Screen>
      <View className="flex-row items-center px-4 py-2">
        <IconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="Go back" />
        <Text className="flex-1 text-ink text-[17px] font-bold text-center px-2" numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Filters"
          className="w-10 h-10 rounded-full bg-surface items-center justify-center"
        >
          <Ionicons name="options-outline" size={19} color={colors.ink} />
          {activeFilters ? (
            <View className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-pink-600 items-center justify-center border border-white">
              <Text className="text-white text-[9px] font-bold">{activeFilters}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View className="py-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {SORTS.map((s) => (
            <Chip key={s} label={s} selected={s === sort} onPress={() => setSort(s)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        {/*
          "delivering to Victoria Island" was hardcoded here, on every category
          page, for every customer. It named a destination nobody had chosen —
          a line that is confidently wrong is worse than no line, because it
          reads as a setting that has been applied.

          It now names the address actually selected, and says nothing at all
          when none is.
        */}
        <Text className="text-muted text-[13px] mb-4">
          {list.length} vendor{list.length === 1 ? '' : 's'}
          {activeAddress?.line1 ? ` · delivering to ${activeAddress.line1}` : ''}
        </Text>

        {list.length ? (
          list.map((v) => (
            <VendorCard
              key={v.id}
              vendor={v}
              onPress={() => router.push({ pathname: '/vendor/[id]', params: { id: v.id } })}
            />
          ))
        ) : (
          <EmptyState
            icon="storefront-outline"
            title="Nothing matches those filters"
            body="Loosen a filter and we'll find more vendors near you."
          >
            <Button
              title="Clear filters"
              fullWidth={false}
              variant="secondary"
              onPress={() => {
                setRating('Any');
                setOpenOnly(false);
                setSort('Recommended');
              }}
            />
          </EmptyState>
        )}
      </ScrollView>

      {/* filter sheet (design.md §9) */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <Pressable className="flex-1 bg-ink/40" onPress={() => setSheetOpen(false)} accessibilityLabel="Close filters" />
        <View style={shadow.float} className="bg-white rounded-t-xl px-4 pb-10 pt-2.5">
          <View className="items-center pb-3">
            <View className="w-10 h-1 rounded-full bg-hairline" />
          </View>

          <View className="flex-row items-center mb-5">
            <Text className="text-ink text-[20px] font-bold flex-1">Filters</Text>
            <Pressable
              onPress={() => {
                setRating('Any');
                setOpenOnly(false);
                setSort('Recommended');
              }}
              accessibilityRole="button"
            >
              <Text className="text-pink-600 text-[15px] font-semibold">Reset</Text>
            </Pressable>
          </View>

          <Text className="text-ink text-[15px] font-semibold mb-2.5">Sort by</Text>
          <View className="flex-row flex-wrap mb-5">
            {SORTS.map((s) => (
              <View key={s} className="mb-2">
                <Chip label={s} selected={s === sort} onPress={() => setSort(s)} />
              </View>
            ))}
          </View>

          <Text className="text-ink text-[15px] font-semibold mb-2.5">Minimum rating</Text>
          <View className="flex-row flex-wrap mb-5">
            {RATINGS.map((r) => (
              <Chip key={r} label={r} selected={r === rating} onPress={() => setRating(r)} />
            ))}
          </View>

          <Divider className="mb-4" />

          <Pressable
            onPress={() => setOpenOnly(!openOnly)}
            accessibilityRole="switch"
            accessibilityState={{ checked: openOnly }}
            className="flex-row items-center mb-6"
          >
            <Text className="flex-1 text-ink text-[15px]">Open now only</Text>
            <View className={`w-12 h-7 rounded-full p-0.5 ${openOnly ? 'bg-pink-600' : 'bg-hairline'}`}>
              <View className={`w-6 h-6 rounded-full bg-white ${openOnly ? 'ml-auto' : ''}`} />
            </View>
          </Pressable>

          <Button title={`Show ${list.length} vendors`} onPress={() => setSheetOpen(false)} />
        </View>
      </Modal>
    </Screen>
  );
}

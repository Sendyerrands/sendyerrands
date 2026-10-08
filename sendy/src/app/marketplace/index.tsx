import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { ProductCard } from '@/components/ProductCard';
import { Badge, Chip, SectionHeader } from '@/components/ui/atoms';
import { IconButton } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useMarketplaceProducts, useMarketplaceRequests } from '@/lib/api/hooks';
import { confirmAsync } from '@/lib/confirm';
import { STATE_FILTERS } from '@/lib/states';
import { timeUntil } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

const CATEGORIES = ['All', 'Foodstuff', 'Electronics', 'Pharmacy', 'Home', 'Fashion'];

/** Marketplace browse (design.md §11) — listings plus the "post a request" entry. */
export default function Marketplace() {
  const router = useRouter();
  const { addToCart, wouldReplaceCart } = useApp();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [state, setState] = useState('All');

  // useWindowDimensions, not Dimensions.get: the latter is a snapshot, so the
  // grid keeps phone-width columns when the window actually changes size —
  // Android split-screen, a folding phone opening, a tablet.
  const { width } = useWindowDimensions();
  const colWidth = (width - 16 * 2 - 12) / 2;
  const { data: products = [] } = useMarketplaceProducts(query.trim() || undefined, state);

  // The API returns requests newest first, so the head is the one to surface.
  const { data: requests } = useMarketplaceRequests();
  const latest = requests?.[0];

  return (
    <Screen>
      {/* header */}
      <View className="flex-row items-center px-4 py-2">
        <IconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="Go back" />
        <View className="flex-1 ml-3">
          <View className="flex-row items-center">
            <Text className="text-ink text-[20px] font-bold mr-2">Marketplace</Text>
            <Badge label="NEW" tone="savings" />
          </View>
          <Text className="text-muted text-[13px]">Buy anything · we deliver</Text>
        </View>
        <IconButton icon="cart-outline" badge onPress={() => router.push('/cart')} accessibilityLabel="Cart" />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
        {/* search */}
        <View className="px-4 mt-2">
          <View className="flex-row items-center bg-surface rounded-full h-12 px-4">
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search products, brands, vendors"
              placeholderTextColor={colors.muted}
              className="flex-1 ml-2.5 text-ink text-[15px]"
              style={{ outlineStyle: 'none' } as never}
            />
          </View>
        </View>

        {/* bidding CTA — the §11 differentiator */}
        <View className="px-4 mt-4">
          <Pressable
            onPress={() => router.push('/marketplace/post-request')}
            accessibilityRole="button"
            className="rounded-lg overflow-hidden"
          >
            <LinearGradient
              colors={[colors.pink[600], colors.pink[900]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 18 }}
            >
              <View className="absolute right-3 bottom-2 opacity-15">
                <Ionicons name="document-text" size={92} color={colors.white} />
              </View>
              <Text className="text-white text-[18px] font-bold leading-[24px]">
                Can&apos;t find it? Get vendors to bid
              </Text>
              <Text className="text-white/85 text-[13px] mt-1.5 leading-[18px] pr-16">
                Post a request — vendors compete on price & speed. Sendy Errands delivers.
              </Text>
              <View className="flex-row items-center bg-white rounded-full px-4 py-2.5 self-start mt-4">
                <Text className="text-pink-600 text-[13px] font-bold mr-1.5">Post a request</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.pink[600]} />
              </View>
            </LinearGradient>
          </Pressable>
        </View>

        {/* categories */}
        <View className="mt-5">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
            {CATEGORIES.map((c) => (
              <Chip key={c} label={c} selected={c === category} onPress={() => setCategory(c)} />
            ))}
          </ScrollView>
        </View>

        {/*
          Proximity, as coarsely as it can usefully be expressed.

          Filtering happens on the server so it applies to the whole catalogue
          rather than whichever page happens to be loaded — filtering a fetched
          list would quietly hide items that simply had not arrived yet.
        */}
        <View className="mt-3">
          <View className="flex-row items-center px-4 mb-2">
            <Ionicons name="location-outline" size={14} color={colors.muted} />
            <Text className="text-muted text-[13px] ml-1.5">
              {state === 'All' ? 'Anywhere in Nigeria' : `Selling in ${state}`}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
            {STATE_FILTERS.map((s) => (
              <Chip key={s} label={s} selected={s === state} onPress={() => setState(s)} />
            ))}
          </ScrollView>
        </View>

        {/* open bids shortcut — hidden until the customer actually has a request */}
        {latest ? (
          <View className="px-4 mt-5">
            <Pressable
              onPress={() =>
                router.push({ pathname: '/marketplace/bids', params: { id: latest.id } })
              }
              accessibilityRole="button"
              className="flex-row items-center bg-pink-50 rounded-lg p-3.5 active:bg-pink-100"
            >
              <View className="w-9 h-9 rounded-full bg-white items-center justify-center mr-3">
                <Ionicons name="hammer-outline" size={17} color={colors.pink[600]} />
              </View>
              <View className="flex-1">
                <Text className="text-ink text-[15px] font-semibold">
                  {latest._count.bids === 0
                    ? 'No bids yet on your request'
                    : `${latest._count.bids} ${latest._count.bids === 1 ? 'bid' : 'bids'} on your request`}
                </Text>
                <Text className="text-muted text-[13px] mt-0.5" numberOfLines={1}>
                  {latest.title} ·{' '}
                  {new Date(latest.closesAt).getTime() > Date.now()
                    ? `closes in ${timeUntil(latest.closesAt)}`
                    : 'bidding closed'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.pink[600]} />
            </Pressable>
          </View>
        ) : null}

        {/* products */}
        <View className="mt-6">
          <SectionHeader title="Trending near you" onAction={() => {}} />
          <View className="flex-row flex-wrap px-4 justify-between">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                width={colWidth}
                onPress={() => router.push({ pathname: '/item/[id]', params: { id: p.id } })}
                /*
                  This used to be `router.push('/cart')` — the button looked
                  like an add button, was labelled "Add <item>", and navigated
                  to an unchanged cart instead of putting anything in it. It
                  could not do better at the time: `toProduct` dropped
                  `vendorId`, and the cart is keyed per vendor.

                  Crossing vendors still empties the cart, because one rider
                  collects from one pickup — but it now asks first instead of
                  wiping without a word.
                */
                onAdd={async () => {
                  if (
                    wouldReplaceCart(p.vendorId) &&
                    !(await confirmAsync(
                      'Start a new cart?',
                      `Your cart has items from another seller. Sendy sends one rider to one pickup, so adding from ${p.vendor || 'this seller'} will empty it first.`,
                      'Start new cart'
                    ))
                  ) {
                    return;
                  }
                  addToCart(
                    { id: p.id, name: p.name, price: p.price, thumb: p.thumb },
                    p.vendorId
                  );
                }}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

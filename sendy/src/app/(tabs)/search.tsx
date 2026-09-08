import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Chip, Divider, EmptyState, SectionHeader } from '@/components/ui/atoms';
import { Screen } from '@/components/ui/Screen';
import { Thumb } from '@/components/ui/Thumb';
import { VendorCard } from '@/components/VendorCard';
import { naira } from '@/lib/format';
import { useVendors } from '@/lib/api/hooks';
import { SEARCH_SUGGESTIONS } from '@/lib/mock';
import {
  addRecentSearch,
  clearRecentSearches,
  loadRecentSearches,
  removeRecentSearch,
} from '@/lib/recent-searches';
import { colors } from '@/lib/theme';

const FILTERS = ['All', 'Vendors', 'Dishes', 'Marketplace', 'Errands'];

/** Search (design.md §10) — recent, suggestions, then results. */
export default function Search() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [recent, setRecent] = useState<string[]>([]);

  // Read once on mount. Storage is async on native, so the list arrives a beat
  // after the first render — empty is the correct thing to show until it does.
  useEffect(() => {
    let alive = true;
    loadRecentSearches().then((list) => {
      if (alive) setRecent(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Recorded on submit, not on keystroke.
   *
   * Saving as the user types would fill the list with every prefix of one
   * search — "j", "jo", "jol" — which is noise, not history. Submitting (or
   * tapping a suggestion) is the point at which someone has decided what they
   * meant.
   */
  const commitSearch = (term: string) => {
    setQuery(term);
    void addRecentSearch(term).then(setRecent);
  };

  const q = query.trim().toLowerCase();
  // Matching happens server-side so results reflect the live catalogue.
  const { data: vendors = [] } = useVendors(q ? { q } : {});
  const vendorHits = q ? vendors : [];
  const dishHits: { id: string; name: string; price: number; thumb: never }[] = [];
  const hasResults = vendorHits.length > 0;

  return (
    <Screen>
      {/* search field */}
      <View className="flex-row items-center px-4 py-2">
        <View className="flex-1 flex-row items-center bg-surface rounded-full h-12 px-4">
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search vendors, food, errands"
            placeholderTextColor={colors.muted}
            className="flex-1 ml-2.5 text-ink text-[15px]"
            style={{ outlineStyle: 'none' } as never}
            returnKeyType="search"
            onSubmitEditing={() => commitSearch(query)}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View className="py-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {FILTERS.map((f) => (
            <Chip key={f} label={f} selected={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {!q ? (
          <>
            {/* Absent entirely when there is no history, rather than shown
                empty or filled with someone else's. A first-time user goes
                straight to the suggestions below, which is what they need. */}
            {recent.length > 0 ? (
              <>
                <View className="px-4 pt-4">
                  <View className="flex-row items-center mb-3">
                    <Text className="text-ink text-[15px] font-bold flex-1">Recent</Text>
                    <Pressable
                      onPress={() => void clearRecentSearches().then(setRecent)}
                      accessibilityRole="button"
                      accessibilityLabel="Clear recent searches"
                      hitSlop={8}
                    >
                      <Text className="text-muted text-[13px]">Clear</Text>
                    </Pressable>
                  </View>
                  {recent.map((r) => (
                    <View key={r} className="flex-row items-center">
                      <Pressable
                        onPress={() => commitSearch(r)}
                        accessibilityRole="button"
                        className="flex-row items-center py-3 flex-1 active:opacity-60"
                      >
                        <Ionicons name="time-outline" size={17} color={colors.muted} />
                        <Text className="text-body text-[15px] ml-3 flex-1" numberOfLines={1}>
                          {r}
                        </Text>
                      </Pressable>
                      {/* Was a decorative arrow that looked tappable and was
                          not. A per-row remove is what people reach for here. */}
                      <Pressable
                        onPress={() => void removeRecentSearch(r).then(setRecent)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${r} from recent searches`}
                        hitSlop={10}
                        className="pl-3 py-3"
                      >
                        <Ionicons name="close" size={16} color={colors.muted} />
                      </Pressable>
                    </View>
                  ))}
                </View>

                <Divider className="mx-4 my-2" />
              </>
            ) : null}

            <View className="px-4 pt-3">
              <Text className="text-ink text-[15px] font-bold mb-3">Popular on Sendy Errands</Text>
              <View className="flex-row flex-wrap">
                {SEARCH_SUGGESTIONS.map((s) => (
                  <View key={s} className="mb-2">
                    <Chip label={s} onPress={() => commitSearch(s)} />
                  </View>
                ))}
              </View>
            </View>

            <View className="pt-6">
              <SectionHeader
                title="Trending vendors"
                onAction={() => router.push({ pathname: '/category/[slug]', params: { slug: 'trending' } })}
              />
              <View className="px-4">
                {vendors.slice(0, 2).map((v) => (
                  <VendorCard
                    key={v.id}
                    vendor={v}
                    onPress={() => router.push({ pathname: '/vendor/[id]', params: { id: v.id } })}
                  />
                ))}
              </View>
            </View>
          </>
        ) : hasResults ? (
          <View className="px-4 pt-2">
            {dishHits.length ? (
              <>
                <Text className="text-muted text-[13px] font-semibold mb-2">DISHES</Text>
                {dishHits.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => router.push({ pathname: '/item/[id]', params: { id: m.id } })}
                    accessibilityRole="button"
                    className="flex-row items-center py-3 active:opacity-70"
                  >
                    <Thumb data={m.thumb} className="w-12 h-12" iconSize={18} />
                    <View className="flex-1 ml-3">
                      <Text className="text-ink text-[15px] font-semibold">{m.name}</Text>
                      <Text className="text-muted text-[13px]">Mama Nkechi Kitchen</Text>
                    </View>
                    <Text className="text-ink text-[15px] font-bold">{naira(m.price)}</Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {vendorHits.length ? (
              <>
                <Text className="text-muted text-[13px] font-semibold mt-4 mb-3">VENDORS</Text>
                {vendorHits.map((v) => (
                  <VendorCard
                    key={v.id}
                    vendor={v}
                    onPress={() => router.push({ pathname: '/vendor/[id]', params: { id: v.id } })}
                  />
                ))}
              </>
            ) : null}
          </View>
        ) : (
          <EmptyState
            icon="search-outline"
            title={`No results for “${query}”`}
            body="Try a different spelling, or post it as a request and let vendors bid for it."
          >
            <Pressable
              onPress={() => router.push('/marketplace/post-request')}
              accessibilityRole="button"
              className="bg-pink-600 rounded-full px-6 h-12 items-center justify-center active:bg-pink-700"
            >
              <Text className="text-white text-[15px] font-semibold">Post a request</Text>
            </Pressable>
          </EmptyState>
        )}
      </ScrollView>
    </Screen>
  );
}

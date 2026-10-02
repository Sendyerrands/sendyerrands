import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card, Chip, EmptyState } from '@/components/ui/atoms';
import { IconButton } from '@/components/ui/Button';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { useServiceCategories, useServiceProviders } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { ApiServiceProvider } from '@/lib/api/endpoints';

/**
 * Services — browse the people who come to you.
 *
 * The pillar that replaced Markets. Unlike every other listing in this app it
 * is selling a person rather than a thing, so the card leads with who they are
 * and what they are rated, and the price shown is the ARRIVAL fee, not the job.
 * The job cannot be priced here and saying so plainly is the whole premise.
 */
export default function ServicesBrowse() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('All');

  const { data: categories = [] } = useServiceCategories();
  const { data: providers = [], isLoading } = useServiceProviders(q.trim() || undefined, category);

  return (
    <Screen>
      <ScreenHeader onBack={() => router.back()} title="Services" />

      <View className="px-4">
        <Text className="text-body text-[14px] leading-[20px] mb-4">
          A barber, a cleaner, a plumber — at your place. You agree the price with them
          before any work starts.
        </Text>

        {/* search */}
        <View className="bg-surface rounded-md h-[46px] px-3.5 flex-row items-center mb-3">
          <Ionicons name="search" size={17} color={colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Barber, cleaning, plumbing…"
            placeholderTextColor={colors.muted}
            className="flex-1 ml-2.5 text-ink text-[15px]"
            style={{ outlineStyle: 'none' } as never}
            autoCapitalize="none"
          />
          {q ? (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* categories — only when there are any, so the row is never a lone "All" */}
        {categories.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: 8 }}
            className="mb-2"
          >
            {['All', ...categories].map((c) => (
              <View key={c} className="mr-2">
                <Chip label={c} selected={c === category} onPress={() => setCategory(c)} />
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <Text className="text-muted text-[13px]">Finding providers…</Text>
        ) : providers.length === 0 ? (
          <EmptyState
            icon="construct-outline"
            title={q || category !== 'All' ? 'Nothing matches that' : 'No providers yet'}
            body={
              q || category !== 'All'
                ? 'Try a different category, or clear the search.'
                : 'We are still signing people up in your area.'
            }
          />
        ) : (
          providers.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              onPress={() =>
                router.push({ pathname: '/service-booking/[slug]', params: { slug: p.slug } })
              }
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function ProviderCard({
  provider,
  onPress,
}: {
  provider: ApiServiceProvider;
  onPress: () => void;
}) {
  /**
   * The cheapest way to get them to you, which is what a browse card should
   * compare on. Someone who cannot ride has no bike fee at all, so this is not
   * simply "the bike price".
   */
  const fromKobo = provider.canTravelByBike
    ? Math.min(provider.bikeFeeKobo, provider.carFeeKobo)
    : provider.carFeeKobo;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="mb-3 active:opacity-80">
      <Card className="p-4">
        <View className="flex-row items-start">
          <View className="w-11 h-11 rounded-full bg-surface items-center justify-center mr-3">
            <Ionicons name="person" size={21} color={colors.muted} />
          </View>

          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-ink text-[16px] font-semibold flex-1" numberOfLines={1}>
                {provider.name}
              </Text>
              {provider.isVerified ? (
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              ) : null}
            </View>

            <Text className="text-muted text-[12.5px] mt-0.5">
              {provider.category}
              {provider.area ? ` · ${provider.area}` : ''}
            </Text>

            <View className="flex-row items-center mt-1.5">
              <Ionicons name="star" size={12} color={colors.pink[600]} />
              <Text className="text-body text-[12.5px] ml-1">
                {provider.rating.toFixed(1)} ({provider.ratingCount})
              </Text>
              <Text className="text-muted text-[12.5px] ml-2">
                · {provider.typicalMinMinutes}–{provider.typicalMaxMinutes} min
              </Text>
            </View>
          </View>
        </View>

        {provider.tags.length ? (
          <Text className="text-muted text-[12.5px] mt-3" numberOfLines={1}>
            {provider.tags.join(' · ')}
          </Text>
        ) : null}

        {/*
          Named as the arrival fee, every time.
          "From ₦1,000" next to a barber reads as the price of a haircut, which
          it is not and cannot be — the provider quotes that once they can see
          the job. Mislabelling it here would make every quote feel like a
          markup.
        */}
        <View className="flex-row items-center mt-3 pt-3 border-t border-hairline">
          <Ionicons
            name={provider.canTravelByBike ? 'bicycle-outline' : 'car-outline'}
            size={15}
            color={colors.body}
          />
          <Text className="text-body text-[13px] ml-2 flex-1">
            Arrival from {naira(fromKobo / 100)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </View>
      </Card>
    </Pressable>
  );
}

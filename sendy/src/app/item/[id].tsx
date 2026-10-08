import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Badge, Divider, EmptyState } from '@/components/ui/atoms';
import { Button, IconButton } from '@/components/ui/Button';
import { Screen, StickyBar } from '@/components/ui/Screen';
import { Thumb } from '@/components/ui/Thumb';
import { useProduct } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { colors } from '@/lib/theme';
import { confirmAsync } from '@/lib/confirm';
import { useApp } from '@/store/app';

/**
 * Product / item detail (design.md §10) — quantity, note, add to cart.
 *
 * The mock version offered priced "extras" (extra plantain, chilled drink).
 * They are gone: the server rebuilds every total from product IDs and has no
 * concept of item options, so an extra would be shown to the customer, charged
 * as ₦0, and silently dropped from the order. Per-item notes ARE supported by
 * `POST /orders`, so the note box is real and is sent through.
 */
export default function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { addToCart, wouldReplaceCart, setVendorFees } = useApp();

  const { data: item, isLoading, isError, error, refetch } = useProduct(id);

  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  if (isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted text-[15px]">Loading…</Text>
        </View>
      </Screen>
    );
  }

  if (isError || !item) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8">
          <EmptyState
            icon="alert-circle-outline"
            title="We couldn't load this item"
            body={error instanceof Error ? error.message : 'It may have been removed.'}
          >
            <View className="flex-row items-center mt-4" style={{ gap: 20 }}>
              <Pressable onPress={() => refetch()} accessibilityRole="button">
                <Text className="text-pink-600 text-[15px] font-semibold">Try again</Text>
              </Pressable>
              <Pressable onPress={() => router.back()} accessibilityRole="button">
                <Text className="text-body text-[15px] font-semibold">Go back</Text>
              </Pressable>
            </View>
          </EmptyState>
        </View>
      </Screen>
    );
  }

  const total = item.price * qty;

  return (
    <Screen edges={[]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
        <View className="relative">
          <Thumb data={item.thumb} className="w-full h-[300px]" rounded="rounded-none" iconSize={64} />
          <View className="absolute top-12 left-4 right-4 flex-row">
            <IconButton icon="arrow-back" tone="white" onPress={() => router.back()} accessibilityLabel="Go back" />
            <View className="flex-1" />
            <IconButton icon="heart-outline" tone="white" accessibilityLabel="Save item" />
          </View>
        </View>

        <View className="px-4 pt-5">
          <View className="flex-row items-start">
            <Text className="text-ink text-[24px] font-display flex-1 pr-3">{item.name}</Text>
            <Text className="text-ink text-[20px] font-bold">{naira(item.price)}</Text>
          </View>

          {item.description ? (
            <Text className="text-body text-[15px] mt-2 leading-[22px]">{item.description}</Text>
          ) : null}

          <Text className="text-muted text-[15px] mt-2">Sold by {item.vendor}</Text>

          <View className="flex-row flex-wrap mt-3" style={{ gap: 8 }}>
            {item.badge ? <Badge label={item.badge} tone="pink" /> : null}
            {item.biddable ? (
              <Badge label="Biddable — vendors can compete" tone="pink" icon="hammer-outline" />
            ) : null}
            {!item.vendorOpen ? <Badge label="Vendor is closed" tone="muted" /> : null}
          </View>

          {item.etaMin && item.etaMax ? (
            <Text className="text-muted text-[13px] mt-3">
              {item.etaMin}–{item.etaMax} min
              {item.deliveryFee != null ? ` · ${naira(item.deliveryFee)} delivery` : ''}
            </Text>
          ) : null}

          <Divider className="my-5" />

          {/* note — sent to the vendor with this line of the order */}
          <Text className="text-ink text-[17px] font-semibold mb-2.5">Any special instructions?</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={200}
            multiline
            placeholder="e.g. no slaw, extra pepper, call when outside…"
            placeholderTextColor={colors.muted}
            className="bg-surface rounded-md p-4 mb-6 text-ink text-[15px]"
            style={{ minHeight: 76, textAlignVertical: 'top' }}
          />

          {/* qty */}
          <View className="flex-row items-center">
            <Text className="text-ink text-[17px] font-semibold flex-1">Quantity</Text>
            <View className="flex-row items-center">
              <Pressable
                onPress={() => setQty(Math.max(1, qty - 1))}
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                className="w-10 h-10 rounded-full border border-hairline items-center justify-center active:bg-surface"
              >
                <Ionicons name="remove" size={18} color={colors.ink} />
              </Pressable>
              <Text className="text-ink text-[17px] font-bold w-11 text-center">{qty}</Text>
              <Pressable
                onPress={() => setQty(qty + 1)}
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                className="w-10 h-10 rounded-full bg-pink-600 items-center justify-center active:bg-pink-700"
              >
                <Ionicons name="add" size={18} color={colors.white} />
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <StickyBar>
        <Button
          title="Add to cart"
          trailing={naira(total)}
          onPress={async () => {
            // Asked once, before the qty loop — not per unit, which would put
            // the same dialog up `qty` times for one tap.
            if (
              wouldReplaceCart(item.vendorId) &&
              !(await confirmAsync(
                'Start a new cart?',
                'Your cart has items from another seller. Sendy sends one rider to one pickup, so adding this will empty it first.',
                'Start new cart'
              ))
            ) {
              return;
            }

            // Without this the cart previews the store's default ₦1,300 while
            // the server charges this vendor's real fee at checkout.
            if (item.deliveryFee != null) {
              setVendorFees({ deliveryFee: item.deliveryFee, freeOver: item.freeOver });
            }

            for (let i = 0; i < qty; i++) {
              addToCart(
                {
                  id: item.id,
                  name: item.name,
                  price: item.price,
                  thumb: item.thumb,
                  note: note.trim() || undefined,
                },
                // The real vendor, not a hardcoded one: adding to the wrong
                // vendor's cart would silently clear whatever was already in it.
                item.vendorId
              );
            }
            router.push('/cart');
          }}
        />
      </StickyBar>
    </Screen>
  );
}

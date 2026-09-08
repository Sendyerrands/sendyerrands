import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Card, Divider } from '@/components/ui/atoms';
import { Screen } from '@/components/ui/Screen';
import { useOrders } from '@/lib/api/hooks';
import { FAQS } from '@/lib/mock';
import { colors, shadow } from '@/lib/theme';

/** Support (design.md §10) — contact channels, open tickets, FAQ. */

/**
 * Stored in E.164 because both links need it that way: wa.me wants digits with
 * the country code and no plus, and tel: is unambiguous across networks only
 * with the country code. The previous number here was never provisioned, which
 * made both buttons dead controls on the one screen people reach when something
 * has already gone wrong.
 */
const SUPPORT_PHONE = '+2347047654376';

export default function Support() {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(FAQS[0].q);

  /**
   * Signed-out users get an empty list rather than an error: the hook is gated
   * on a token, and support has to stay reachable for someone who cannot get
   * into their account — which is one of the likelier reasons to be here.
   *
   * Capped at three. This is a shortcut to a reference number, not the orders
   * screen, and a long list would bury the contact buttons above it.
   */
  const { data: orders = [] } = useOrders('active');
  const activeOrders = orders.slice(0, 3);

  return (
    <Screen>
      <View className="px-4 py-3">
        <Text className="text-ink text-[24px] font-display">Support</Text>
        <Text className="text-body text-[15px] mt-1">
          We&apos;re here 7am–11pm daily. Most replies in under 3 minutes.
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        {/* channels */}
        <View className="flex-row mb-4">
          <Channel
            icon="logo-whatsapp"
            label="WhatsApp"
            hint="Fastest"
            primary
            onPress={() => Linking.openURL(`https://wa.me/${SUPPORT_PHONE.replace(/[^0-9]/g, '')}`)}
          />
          <View className="w-3" />
          <Channel
            icon="call"
            label="Call us"
            hint="7am–11pm"
            onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}
          />
        </View>

        {/*
          This was "Your tickets" over a fabricated one: "Missing item ·
          SND-8790 — Charger arrived without the cable. Agent Ifeoma is on it.
          Updated 14 min ago." Every user saw it, including users who had never
          contacted anyone. It invented a support system that does not exist,
          an agent who does not exist, and an order that was not theirs.

          There is no ticket backend to render instead. What people actually
          need on this screen is the order reference to quote — the Terms ask
          for it and support will ask for it — so the section shows their live
          orders, which is real, and nothing at all when there are none.
        */}
        {activeOrders.length > 0 ? (
          <>
            <Text className="text-ink text-[15px] font-bold mb-2.5">Need help with an order?</Text>
            <Card className="overflow-hidden mb-4">
              {activeOrders.map((order, i) => (
                <View key={order.id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable
                    onPress={() => router.push({ pathname: '/track/[id]', params: { id: order.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${order.reference}, ${order.statusLabel}`}
                    className="flex-row items-center p-4 active:bg-surface"
                  >
                    <View className="w-9 h-9 rounded-full bg-pink-50 items-center justify-center mr-3">
                      <Ionicons name="cube-outline" size={18} color={colors.pink[600]} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-ink text-[15px] font-semibold" numberOfLines={1}>
                        {order.vendor}
                      </Text>
                      <Text className="text-muted text-[13px] mt-0.5">
                        {order.reference} · {order.statusLabel}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </Card>
            <Text className="text-muted text-[12px] mb-4 -mt-2 leading-[17px]">
              Quote the reference when you message us — it is the fastest way for us to find it.
            </Text>
          </>
        ) : null}

        {/* faq */}
        <Text className="text-ink text-[15px] font-bold mb-2.5">Common questions</Text>
        <Card className="overflow-hidden">
          {FAQS.map((faq, i) => {
            const expanded = open === faq.q;
            return (
              <View key={faq.q}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => setOpen(expanded ? null : faq.q)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  className="px-4 py-3.5 active:bg-surface"
                >
                  <View className="flex-row items-center">
                    <Text className="text-ink text-[15px] font-medium flex-1 pr-3">{faq.q}</Text>
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={17}
                      color={colors.muted}
                    />
                  </View>
                  {expanded ? (
                    <Text className="text-body text-[13px] mt-2 leading-[19px]">{faq.a}</Text>
                  ) : null}
                </Pressable>
              </View>
            );
          })}
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/help')}
          className="flex-row items-center justify-center mt-6 py-3"
        >
          <Ionicons name="document-text-outline" size={16} color={colors.pink[600]} />
          <Text className="text-pink-600 text-[15px] font-semibold ml-2">Read the help centre</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function Channel({
  icon,
  label,
  hint,
  onPress,
  primary = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={shadow.card}
      className={`flex-1 rounded-lg p-4 ${primary ? 'bg-pink-600' : 'bg-white border border-hairline'}`}
    >
      <Ionicons name={icon} size={22} color={primary ? colors.white : colors.pink[600]} />
      <Text className={`text-[15px] font-semibold mt-3 ${primary ? 'text-white' : 'text-ink'}`}>
        {label}
      </Text>
      <Text className={`text-[13px] mt-0.5 ${primary ? 'text-white/80' : 'text-muted'}`}>{hint}</Text>
    </Pressable>
  );
}

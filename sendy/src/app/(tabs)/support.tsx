import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Badge, Card, Divider } from '@/components/ui/atoms';
import { Screen } from '@/components/ui/Screen';
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

        {/* open ticket */}
        <Text className="text-ink text-[15px] font-bold mb-2.5">Your tickets</Text>
        <Card className="p-4 mb-4">
          <View className="flex-row items-start">
            <View className="w-9 h-9 rounded-full bg-pink-50 items-center justify-center mr-3">
              <Ionicons name="alert-circle-outline" size={18} color={colors.pink[600]} />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center">
                <Text className="text-ink text-[15px] font-semibold flex-1">Missing item · SND-8790</Text>
                <Badge label="Open" tone="info" />
              </View>
              <Text className="text-muted text-[13px] mt-1 leading-[18px]">
                Charger arrived without the cable. Agent Ifeoma is on it.
              </Text>
              <Text className="text-muted text-[11px] mt-2">Updated 14 min ago</Text>
            </View>
          </View>
        </Card>

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

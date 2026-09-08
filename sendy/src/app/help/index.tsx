import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Card } from '@/components/ui/atoms';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { HELP_TOPICS, searchHelp } from '@/lib/help';
import { colors } from '@/lib/theme';

const SUPPORT_PHONE = '+2347047654376';

/** Help centre — browsable topics, with search across every article. */
export default function HelpCentre() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const results = searchHelp(query);
  const searching = query.trim().length >= 2;

  return (
    <Screen>
      <ScreenHeader title="Help centre" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search help"
          icon="search-outline"
        />

        {searching ? (
          results.length ? (
            <>
              <Text className="text-muted text-[13px] font-semibold mb-2.5">
                {results.length} {results.length === 1 ? 'RESULT' : 'RESULTS'}
              </Text>
              {results.map(({ topic, article }) => (
                <Pressable
                  key={`${topic.slug}-${article.slug}`}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({ pathname: '/help/[topic]', params: { topic: topic.slug } })
                  }
                >
                  <Card className="p-4 mb-2.5">
                    <Text className="text-ink text-[15px] font-semibold">{article.q}</Text>
                    <Text className="text-muted text-[13px] mt-1" numberOfLines={2}>
                      {article.a[0]}
                    </Text>
                    <Text className="text-pink-600 text-[12px] font-semibold mt-2">
                      {topic.title}
                    </Text>
                  </Card>
                </Pressable>
              ))}
            </>
          ) : (
            <View className="items-center py-10">
              <Ionicons name="search-outline" size={30} color={colors.muted} />
              <Text className="text-ink text-[15px] font-semibold mt-3">No results</Text>
              <Text className="text-muted text-[13px] mt-1 text-center px-8 leading-[18px]">
                Try a different word, or talk to someone — the options are below.
              </Text>
            </View>
          )
        ) : (
          <>
            <Text className="text-muted text-[13px] font-semibold mb-2.5">BROWSE</Text>
            {HELP_TOPICS.map((topic) => (
              <Pressable
                key={topic.slug}
                accessibilityRole="button"
                accessibilityLabel={`${topic.title}. ${topic.blurb}`}
                onPress={() =>
                  router.push({ pathname: '/help/[topic]', params: { topic: topic.slug } })
                }
              >
                <Card className="flex-row items-center p-4 mb-2.5">
                  <View className="w-10 h-10 rounded-full bg-pink-50 items-center justify-center mr-3">
                    <Ionicons name={topic.icon} size={19} color={colors.pink[600]} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-ink text-[15px] font-semibold">{topic.title}</Text>
                    <Text className="text-muted text-[13px] mt-0.5">{topic.blurb}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={colors.muted} />
                </Card>
              </Pressable>
            ))}
          </>
        )}

        {/* Always reachable, search or browse — the point of a help centre is
            that nobody gets stuck in it. */}
        <Text className="text-muted text-[13px] font-semibold mt-6 mb-2.5">STILL STUCK?</Text>
        <View className="flex-row">
          <Contact
            icon="logo-whatsapp"
            label="WhatsApp"
            hint="Fastest"
            onPress={() => Linking.openURL(`https://wa.me/${SUPPORT_PHONE.replace(/[^0-9]/g, '')}`)}
          />
          <View className="w-3" />
          <Contact
            icon="call"
            label="Call us"
            hint="7am–11pm"
            onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Contact({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="flex-1">
      <Card className="items-center py-4">
        <Ionicons name={icon} size={22} color={colors.pink[600]} />
        <Text className="text-ink text-[14px] font-semibold mt-2">{label}</Text>
        <Text className="text-muted text-[12px] mt-0.5">{hint}</Text>
      </Card>
    </Pressable>
  );
}

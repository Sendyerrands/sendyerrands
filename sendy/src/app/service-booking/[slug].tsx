import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader, StickyBar } from '@/components/ui/Screen';
import { ApiError } from '@/lib/api/client';
import { useBookService, useServiceProvider } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/**
 * Book a service provider.
 *
 * The form asks for the two things only the customer knows — what the job is
 * and where it is — and one decision that is genuinely theirs to make: how the
 * provider travels.
 *
 * It does NOT ask what they will pay. That is the point of the pillar: nobody
 * can price a leak or a deep clean from a text box, so the provider quotes once
 * they can see it, and the customer accepts or walks away. The screen says so
 * before the button rather than letting someone discover it afterwards.
 */
export default function ServiceBooking() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { activeAddress } = useApp();

  const { data: provider, isLoading } = useServiceProvider(slug);
  const book = useBookService();

  const [task, setTask] = useState('');
  const [details, setDetails] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [mode, setMode] = useState<'BIKE' | 'CAR' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefill from the saved address, but leave it editable: a barber may be
  // going to the office, not home.
  useEffect(() => {
    if (activeAddress?.line1 && !address) setAddress(activeAddress.line1);
    // Only on first arrival of the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAddress?.line1]);

  /**
   * Default to the cheaper option the provider can actually do.
   *
   * Pre-selecting bike for someone who cannot ride would mean the first thing
   * the customer sees is an option that will be refused on submit.
   */
  useEffect(() => {
    if (provider && mode === null) setMode(provider.canTravelByBike ? 'BIKE' : 'CAR');
  }, [provider, mode]);

  if (isLoading || !provider) {
    return (
      <Screen>
        <ScreenHeader onBack={() => router.back()} title="Book a service" />
        <Text className="text-muted text-[13px] px-4">Loading…</Text>
      </Screen>
    );
  }

  const feeKobo = mode === 'BIKE' ? provider.bikeFeeKobo : provider.carFeeKobo;
  const valid = task.trim().length >= 3 && address.trim().length >= 3 && mode !== null;

  const submit = () => {
    if (!valid || !mode) return;
    setError(null);
    book.mutate(
      {
        providerSlug: provider.slug,
        task: task.trim(),
        details: details.trim() || undefined,
        address: address.trim(),
        landmark: landmark.trim() || undefined,
        arrivalMode: mode,
      },
      {
        onSuccess: (order) =>
          router.replace({ pathname: '/track/[id]', params: { id: order.id } }),
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : 'Could not make that booking.'),
      }
    );
  };

  return (
    <Screen>
      <ScreenHeader onBack={() => router.back()} title="Book a service" />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* who */}
        <Card className="p-4 mb-5">
          <View className="flex-row items-center">
            <View className="w-11 h-11 rounded-full bg-surface items-center justify-center mr-3">
              <Ionicons name="person" size={21} color={colors.muted} />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center">
                <Text className="text-ink text-[16px] font-semibold flex-1">{provider.name}</Text>
                {provider.isVerified ? (
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                ) : null}
              </View>
              <Text className="text-muted text-[12.5px] mt-0.5">
                {provider.category}
                {provider.area ? ` · ${provider.area}` : ''} · usually{' '}
                {provider.typicalMinMinutes}–{provider.typicalMaxMinutes} min
              </Text>
            </View>
          </View>
          {provider.bio ? (
            <Text className="text-body text-[13px] mt-3 leading-[19px]">{provider.bio}</Text>
          ) : null}
        </Card>

        {/* what */}
        <Input
          label="What do you need done?"
          value={task}
          onChangeText={(v) => {
            setError(null);
            setTask(v);
          }}
          placeholder="e.g. Low fade and beard trim"
        />
        <Input
          label="Any details? (optional)"
          value={details}
          onChangeText={setDetails}
          placeholder="Two people, I have my own clippers…"
        />

        {/* where */}
        <Input
          label="Where should they come?"
          value={address}
          onChangeText={(v) => {
            setError(null);
            setAddress(v);
          }}
          placeholder="Flat 3, 12 Admiralty Way, Lekki"
        />
        <Input
          label="Landmark (optional)"
          value={landmark}
          onChangeText={setLandmark}
          placeholder="Opposite the blue gate"
          helper="Street names are patchy in a lot of Lagos — this is usually what gets them to the door."
        />

        {/* how they travel */}
        <Text className="text-ink text-[15px] font-semibold mt-5 mb-1">How should they arrive?</Text>
        <Text className="text-muted text-[12.5px] mb-3">
          This is Sendy&apos;s fee, and the only thing we charge for.
        </Text>

        {provider.canTravelByBike ? (
          <ArrivalOption
            icon="bicycle-outline"
            title="By bike"
            body="Cheaper and usually quicker through traffic."
            feeKobo={provider.bikeFeeKobo}
            selected={mode === 'BIKE'}
            onPress={() => setMode('BIKE')}
          />
        ) : (
          /* Said out loud rather than silently offering one option: a customer
             who expected the cheaper choice should know why it is missing. */
          <View className="flex-row items-start bg-surface rounded-md p-3 mb-2.5">
            <Ionicons name="information-circle-outline" size={16} color={colors.body} />
            <Text className="text-body text-[12.5px] ml-2 flex-1 leading-[17px]">
              {provider.name} travels by car — their equipment does not go on a bike.
            </Text>
          </View>
        )}

        <ArrivalOption
          icon="car-outline"
          title="By car"
          body="Costs more. Needed for tools, equipment, or heavy rain."
          feeKobo={provider.carFeeKobo}
          selected={mode === 'CAR'}
          onPress={() => setMode('CAR')}
        />

        {/* the thing people most need to understand before they tap */}
        <View className="flex-row items-start bg-pink-50 rounded-md p-3.5 mt-4">
          <Ionicons name="pricetag-outline" size={16} color={colors.pink[600]} />
          <Text className="text-body text-[12.5px] ml-2.5 flex-1 leading-[18px]">
            You only pay the arrival fee now. {provider.name} will send you a price for the work
            itself once they know what it involves — you can accept it or decline, and nothing
            starts until you do.
          </Text>
        </View>

        {error ? <Text className="text-error text-[13px] mt-3">{error}</Text> : null}
      </ScrollView>

      <StickyBar>
        <Button
          title={book.isPending ? 'Booking…' : `Book — ${naira(feeKobo / 100)} arrival`}
          loading={book.isPending}
          disabled={!valid || book.isPending}
          onPress={submit}
        />
      </StickyBar>
    </Screen>
  );
}

function ArrivalOption({
  icon,
  title,
  body,
  feeKobo,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  feeKobo: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${naira(feeKobo / 100)}`}
      className={`flex-row items-center rounded-md p-3.5 mb-2.5 border ${
        selected ? 'border-pink-600 bg-pink-50' : 'border-hairline bg-white'
      }`}
    >
      <Ionicons name={icon} size={20} color={selected ? colors.pink[600] : colors.body} />
      <View className="flex-1 ml-3">
        <Text className="text-ink text-[15px] font-semibold">{title}</Text>
        <Text className="text-muted text-[12.5px] mt-0.5 leading-[17px]">{body}</Text>
      </View>
      <Text className={`text-[15px] font-bold ml-2 ${selected ? 'text-pink-600' : 'text-ink'}`}>
        {naira(feeKobo / 100)}
      </Text>
    </Pressable>
  );
}

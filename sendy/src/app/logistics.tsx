import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card, Chip, Divider } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader, StickyBar } from '@/components/ui/Screen';
import { useCreatePackage } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import {
  PARCEL_SIZES,
  PARCEL_TYPES,
  SIZE_ENUM,
  crossesStates,
  parcelEta,
  parcelPrice,
  type ParcelSizeId,
} from '@/lib/logistics';
import { NIGERIAN_STATES } from '@/lib/states';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/**
 * Logistics — parcels between states.
 *
 * The Delivery pillar used to point at the same same-city form as Packages, so
 * two of the eight tiles on Home did exactly one thing. This is the other half:
 * the route is chosen first, as a pair of states, because that is the decision
 * that changes the price and the number of days — and asking for it up front is
 * what lets both be shown honestly before anyone fills in an address.
 *
 * Same-state is still allowed and simply prices as a local delivery. Refusing
 * it would be a wall in front of someone who picked the wrong tile.
 */
export default function Logistics() {
  const router = useRouter();
  const { signedIn } = useApp();
  const createPackage = useCreatePackage();

  const [origin, setOrigin] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [size, setSize] = useState<ParcelSizeId>('small');
  const [type, setType] = useState('Documents');

  const [pickupName, setPickupName] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupPhone, setPickupPhone] = useState('');
  const [dropoffName, setDropoffName] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [dropoffPhone, setDropoffPhone] = useState('');
  const [notes, setNotes] = useState('');

  const interstate = crossesStates(origin, destination);
  const price = parcelPrice(size, interstate);
  const eta = parcelEta(interstate);
  const isFragile = type === 'Fragile';

  const routeChosen = Boolean(origin && destination);

  // Mirrors the server's zod schema so the CTA never offers a doomed submit.
  const canSubmit =
    routeChosen &&
    pickupName.trim().length >= 2 &&
    pickupAddress.trim().length >= 4 &&
    dropoffName.trim().length >= 2 &&
    dropoffAddress.trim().length >= 4 &&
    dropoffPhone.replace(/\D/g, '').length >= 10;

  const submit = () => {
    if (!signedIn) return router.push('/signin');

    createPackage.mutate(
      {
        pickupName: pickupName.trim(),
        pickupAddress: pickupAddress.trim(),
        ...(pickupPhone.trim() ? { pickupPhone: pickupPhone.trim() } : {}),
        dropoffName: dropoffName.trim(),
        dropoffAddress: dropoffAddress.trim(),
        dropoffPhone: dropoffPhone.trim(),
        size: SIZE_ENUM[size],
        contents: type,
        isFragile,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        // The server recomputes the fee from these. Sending them is what makes
        // the price on this screen the price that gets charged.
        ...(origin ? { originState: origin } : {}),
        ...(destination ? { destinationState: destination } : {}),
      },
      {
        onSuccess: (order) =>
          router.replace({ pathname: '/track/[id]', params: { id: order.id } }),
      }
    );
  };

  return (
    <Screen>
      <ScreenHeader title="Logistics" />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 150 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-ink text-[22px] font-display leading-[28px]">
          Send a parcel{'\n'}across Nigeria
        </Text>
        <Text className="text-body text-[15px] mt-2 mb-4 leading-[22px]">
          Pick the route first — it sets the price and how long it takes.
        </Text>

        {/*
          The mirror of the banner on Packages, and it earns its place now that
          Packages is the only way in here — someone who arrives, realises they
          meant same-city, and finds no way across would have to go back to Home
          and start again. `replace` rather than `push` for the same reason it
          is used there: this is switching flows, not stacking one on the other.
        */}
        <Pressable
          onPress={() => router.replace('/package')}
          accessibilityRole="button"
          className="flex-row items-center bg-surface rounded-md p-3.5 mb-6"
        >
          <Ionicons name="cube-outline" size={18} color={colors.pink[600]} />
          <View className="flex-1 ml-2.5">
            <Text className="text-ink text-[13px] font-semibold">Between states</Text>
            <Text className="text-body text-[12px] mt-0.5 leading-[17px]">
              Staying in one city? Send a package instead — it costs less and arrives today.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>

        {/* route — the decision everything else depends on */}
        <Card className="p-4 mb-4">
          <Text className="text-muted text-[11px] font-semibold tracking-wide mb-2.5">FROM</Text>
          <StatePicker states={NIGERIAN_STATES} selected={origin} onSelect={setOrigin} />

          <View className="items-center py-3">
            <Ionicons name="arrow-down" size={18} color={colors.muted} />
          </View>

          <Text className="text-muted text-[11px] font-semibold tracking-wide mb-2.5">TO</Text>
          <StatePicker states={NIGERIAN_STATES} selected={destination} onSelect={setDestination} />
        </Card>

        {/* The route summary appears only once there is a route to summarise —
            a card reading "— → —, Same day" before any choice is made would be
            stating a delivery time for a journey nobody has described. */}
        {routeChosen ? (
          <View
            className={`flex-row items-center rounded-md p-3.5 mb-6 ${
              interstate ? 'bg-pink-50' : 'bg-surface'
            }`}
          >
            <Ionicons
              name={interstate ? 'trail-sign-outline' : 'bicycle-outline'}
              size={18}
              color={interstate ? colors.pink[600] : colors.body}
            />
            <View className="ml-2.5 flex-1">
              <Text className="text-ink text-[14px] font-semibold">
                {origin} → {destination}
              </Text>
              <Text className="text-body text-[13px] mt-0.5">
                {interstate ? 'Interstate' : 'Within one state'} · {eta}
              </Text>
            </View>
          </View>
        ) : (
          <View className="h-2" />
        )}

        {/* parcel size */}
        <Text className="text-body text-[15px] mb-2.5">Parcel size</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mb-6"
          contentContainerStyle={{ paddingRight: 16 }}
        >
          {PARCEL_SIZES.map((s) => {
            const selected = s.id === size;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSize(s.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                className={`w-[116px] rounded-md border-[1.5px] p-3 mr-3 ${
                  selected ? 'border-pink-600 bg-pink-50' : 'border-hairline bg-white'
                }`}
              >
                <Ionicons
                  name="cube-outline"
                  size={22}
                  color={selected ? colors.pink[600] : colors.body}
                />
                <Text
                  className={`text-[15px] font-semibold mt-2.5 ${selected ? 'text-pink-700' : 'text-ink'}`}
                >
                  {s.label}
                </Text>
                <Text className="text-muted text-[11px] mt-0.5">{s.hint}</Text>
                {/* Priced per tile so the size trade-off is visible while
                    choosing, rather than only in the total afterwards. */}
                <Text className="text-body text-[12px] font-semibold mt-1.5">
                  {naira(interstate ? s.interstate : s.local)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* addresses */}
        <Card className="p-4 mb-6">
          <View className="flex-row items-center mb-3">
            <View className="w-2.5 h-2.5 rounded-full bg-pink-600 mr-2" />
            <Text className="text-muted text-[11px] font-semibold tracking-wide">
              PICK-UP{origin ? ` · ${origin.toUpperCase()}` : ''}
            </Text>
          </View>
          <Input
            label="Sender's name"
            value={pickupName}
            onChangeText={setPickupName}
            placeholder="Who is handing it over?"
          />
          <Input
            label="Pick-up address"
            value={pickupAddress}
            onChangeText={setPickupAddress}
            placeholder="Street and area"
            helper={origin ? `In ${origin}. We add the state for you.` : undefined}
          />
          <Input
            label="Sender's phone (optional)"
            value={pickupPhone}
            onChangeText={setPickupPhone}
            keyboardType="phone-pad"
            placeholder="0803 123 4567"
          />

          <Divider className="my-4" />

          <View className="flex-row items-center mb-3">
            <Ionicons name="location" size={14} color={colors.ink} />
            <Text className="text-muted text-[11px] font-semibold tracking-wide ml-1.5">
              DROP-OFF{destination ? ` · ${destination.toUpperCase()}` : ''}
            </Text>
          </View>
          <Input
            label="Receiver's name"
            value={dropoffName}
            onChangeText={setDropoffName}
            placeholder="Who is receiving it?"
          />
          <Input
            label="Drop-off address"
            value={dropoffAddress}
            onChangeText={setDropoffAddress}
            placeholder="Street and area"
            helper={destination ? `In ${destination}. We add the state for you.` : undefined}
          />
        </Card>

        {/* contents */}
        <Text className="text-body text-[15px] mb-2.5">What are you sending?</Text>
        <View className="flex-row flex-wrap mb-6">
          {PARCEL_TYPES.map((t) => (
            <View key={t} className="mb-2 mr-2">
              <Chip label={t} selected={t === type} onPress={() => setType(t)} />
            </View>
          ))}
        </View>

        <Text className="text-body text-[15px] mb-2.5">Receiver&apos;s phone</Text>
        <View className="flex-row items-center bg-surface rounded-md h-[52px] px-4 mb-6">
          <Ionicons name="call-outline" size={17} color={colors.muted} />
          <Text className="text-ink text-[15px] ml-2.5 mr-2">+234</Text>
          <Divider className="w-px h-6 bg-hairline" />
          <TextInput
            value={dropoffPhone}
            onChangeText={setDropoffPhone}
            keyboardType="phone-pad"
            placeholder="0803 123 4567"
            placeholderTextColor={colors.muted}
            className="flex-1 ml-3 text-ink text-[15px]"
            style={{ outlineStyle: 'none' } as never}
          />
        </View>

        <Input
          label="Notes for the rider (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Gate code, floor, who to ask for…"
          multiline
        />

        {createPackage.isError ? (
          <View className="bg-error/10 rounded-md p-3.5 mb-4">
            <Text className="text-error text-[13px]">
              {createPackage.error instanceof Error
                ? createPackage.error.message
                : 'Could not create this delivery.'}
            </Text>
          </View>
        ) : null}

        <View className="flex-row items-start bg-surface rounded-md p-3.5">
          <Ionicons name="shield-checkmark-outline" size={17} color={colors.success} />
          <Text className="text-body text-[13px] ml-2.5 flex-1 leading-[18px]">
            {interstate
              ? `Parcels are covered up to ${naira(50000)}. Interstate parcels move by road and are handed over with a photo and the receiver's code at drop-off.`
              : `Parcels are covered up to ${naira(50000)}. Fragile items are hand-carried and confirmed with a photo at drop-off.`}
          </Text>
        </View>
      </ScrollView>

      <StickyBar>
        <Button
          title={
            createPackage.isPending
              ? 'Creating…'
              : routeChosen
                ? 'Continue'
                : 'Choose a route first'
          }
          trailing={routeChosen ? naira(price) : undefined}
          disabled={!canSubmit || createPackage.isPending}
          onPress={submit}
        />
      </StickyBar>
    </Screen>
  );
}

/**
 * A horizontal state row rather than a modal picker.
 *
 * There are 37 options and the five Sendy Errands actually serves are first, so
 * the common choice is reachable without opening anything. The row scrolls for
 * the rest.
 */
function StatePicker({
  states,
  selected,
  onSelect,
}: {
  states: string[];
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingRight: 8 }}
    >
      {states.map((s) => (
        <View key={s} className="mr-2">
          <Chip label={s} selected={s === selected} onPress={() => onSelect(s)} />
        </View>
      ))}
    </ScrollView>
  );
}

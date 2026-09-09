import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { DeliveryOfferInput, MIN_OFFER_NAIRA } from '@/components/DeliveryOfferInput';
import { Card, Chip, Divider } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader, StickyBar } from '@/components/ui/Screen';
import { useCreatePackage, type PackageBody } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { PARCEL_SIZES, PARCEL_TYPES } from '@/lib/mock';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/** The picker's ids are lowercase; the API's enum is not. */
const SIZE_ENUM: Record<string, PackageBody['size']> = {
  small: 'SMALL',
  medium: 'MEDIUM',
  large: 'LARGE',
  xl: 'EXTRA_LARGE',
};

/** Create Pickup / Delivery (design.md §10) — the second service pillar. */
export default function SendPackage() {
  const router = useRouter();
  const { activeAddress, signedIn } = useApp();
  const createPackage = useCreatePackage();

  const [size, setSize] = useState('small');
  const [type, setType] = useState('Food');

  const [pickupName, setPickupName] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupPhone, setPickupPhone] = useState('');

  /**
   * Drop-off defaults to the saved address — that's the common case — but stays
   * editable, because a parcel often goes to someone else.
   *
   * `null` means "untouched, show the saved address". Seeding useState from the
   * store instead would leave these blank forever, since the address hydrates
   * after the first render.
   */
  const [dropoffName, setDropoffName] = useState<string | null>(null);
  const [dropoffAddress, setDropoffAddress] = useState<string | null>(null);
  const [dropoffPhone, setDropoffPhone] = useState('');
  const [notes, setNotes] = useState('');

  const dropName = dropoffName ?? activeAddress?.contact ?? '';
  const dropAddress = dropoffAddress ?? activeAddress?.line1 ?? '';

  /*
   * The size table is the suggestion now, not the price. The customer names
   * what they will pay and riders can counter it, so this seeds the field
   * rather than deciding the charge.
   */
  const suggested = PARCEL_SIZES.find((s) => s.id === size)?.price ?? 1300;
  const [offer, setOffer] = useState(String(suggested));
  const price = Number(offer.replace(/[^\d]/g, '')) || suggested;
  const isFragile = type === 'Fragile';

  // Changing the parcel size re-suggests, unless the customer has already
  // typed a number of their own — overwriting that would be rude.
  const [touchedOffer, setTouchedOffer] = useState(false);
  useEffect(() => {
    if (!touchedOffer) setOffer(String(suggested));
  }, [suggested, touchedOffer]);

  // Mirrors the server's zod schema so the CTA never offers a doomed submit.
  const canSubmit =
    pickupName.trim().length >= 2 &&
    pickupAddress.trim().length >= 4 &&
    dropName.trim().length >= 2 &&
    dropAddress.trim().length >= 4 &&
    dropoffPhone.replace(/\D/g, '').length >= 10 &&
    price >= MIN_OFFER_NAIRA;

  const submit = () => {
    if (!signedIn) return router.push('/signin');

    createPackage.mutate(
      {
        pickupName: pickupName.trim(),
        pickupAddress: pickupAddress.trim(),
        ...(pickupPhone.trim() ? { pickupPhone: pickupPhone.trim() } : {}),
        dropoffName: dropName.trim(),
        dropoffAddress: dropAddress.trim(),
        dropoffPhone: dropoffPhone.trim(),
        size: SIZE_ENUM[size] ?? 'SMALL',
        contents: type,
        isFragile,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(activeAddress ? { addressId: activeAddress.id } : {}),
        deliveryFeeKobo: price * 100,
      },
      {
        onSuccess: (order) =>
          router.replace({ pathname: '/track/[id]', params: { id: order.id } }),
      }
    );
  };

  return (
    <Screen>
      <ScreenHeader title="Send a package" />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 150 }} showsVerticalScrollIndicator={false}>
        {/*
          This form is same-city only: it prices on parcel size alone and quotes
          same-day, both of which are wrong the moment a parcel crosses a state
          line. Someone who ends up here for a Lagos → Kano parcel would fill in
          two addresses, be quoted ₦1,300, and find out at handover. Saying so
          costs one line and the way out is a tap.
        */}
        <Pressable
          onPress={() => router.replace('/logistics')}
          accessibilityRole="button"
          className="flex-row items-center bg-surface rounded-md p-3.5 mb-5"
        >
          <Ionicons name="trail-sign-outline" size={18} color={colors.pink[600]} />
          <View className="flex-1 ml-2.5">
            <Text className="text-ink text-[13px] font-semibold">
              Same city, same day
            </Text>
            <Text className="text-body text-[12px] mt-0.5 leading-[17px]">
              Sending to another state? Use Logistics instead.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>

        {/* route */}
        <Card className="p-4 mb-6">
          <View className="flex-row items-center mb-3">
            <View className="w-2.5 h-2.5 rounded-full bg-pink-600 mr-2" />
            <Text className="text-muted text-[11px] font-semibold tracking-wide">PICK-UP</Text>
          </View>
          <Input label="Sender's name" value={pickupName} onChangeText={setPickupName} placeholder="Who is handing it over?" />
          <Input label="Pick-up address" value={pickupAddress} onChangeText={setPickupAddress} placeholder="Street and area" />
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
            <Text className="text-muted text-[11px] font-semibold tracking-wide ml-1.5">DROP-OFF</Text>
          </View>
          <Input label="Receiver's name" value={dropName} onChangeText={setDropoffName} placeholder="Who is receiving it?" />
          <Input label="Drop-off address" value={dropAddress} onChangeText={setDropoffAddress} placeholder="Street and area" />
        </Card>

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
                className={`w-[104px] rounded-md border-[1.5px] p-3 mr-3 ${
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
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Sits under the size picker because the size is what the suggestion
            is derived from — the number moves when you change the parcel, and
            seeing that happen explains where it came from. */}
        <DeliveryOfferInput
          value={offer}
          onChange={(v) => {
            setTouchedOffer(true);
            setOffer(v);
          }}
          suggestedNaira={suggested}
          hint={`We suggest ${naira(suggested)} for this size. Riders can accept it or ask for more.`}
        />

        {/* contents */}
        <Text className="text-body text-[15px] mb-2.5">What are you sending?</Text>
        <View className="flex-row flex-wrap mb-6">
          {PARCEL_TYPES.map((t) => (
            <View key={t} className="mb-2">
              <Chip label={t} selected={t === type} onPress={() => setType(t)} />
            </View>
          ))}
        </View>

        {/* receiver */}
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
            Parcels are covered up to {naira(50000)}. Fragile items are hand-carried and confirmed
            with a photo at drop-off.
          </Text>
        </View>
      </ScrollView>

      <StickyBar>
        <Button
          title={createPackage.isPending ? 'Creating…' : 'Continue'}
          trailing={naira(price)}
          disabled={!canSubmit || createPackage.isPending}
          onPress={submit}
        />
      </StickyBar>
    </Screen>
  );
}

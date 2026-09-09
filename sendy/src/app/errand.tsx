import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { DeliveryOfferInput, MIN_OFFER_NAIRA } from '@/components/DeliveryOfferInput';
import { Button } from '@/components/ui/Button';
import { Input, SelectField } from '@/components/ui/Input';
import { Screen, ScreenHeader, StickyBar } from '@/components/ui/Screen';
import { useCreateErrand, useUploadImage } from '@/lib/api/hooks';
import { pickImages } from '@/lib/api/uploads';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

const MAX_PHOTOS = 3;

/*
 * What an errand used to cost, and now what we suggest it should.
 *
 * Mirrors DEFAULT_DELIVERY_FEE_KOBO on the server, which is still the fallback
 * when this field is not sent. Keeping the two in step matters: the number here
 * is a promise about what a rider is likely to accept.
 */
const SUGGESTED_ERRAND_FEE = 1300;

/** A picked image: local while it uploads, permanent URL once it lands. */
type Photo = { localUri: string; url: string | null; failed: boolean; reason?: string | null };

/** Create Errand (design.md §10) — the first service pillar. */
export default function CreateErrand() {
  const router = useRouter();
  const { activeAddress, signedIn } = useApp();
  const createErrand = useCreateErrand();

  const [task, setTask] = useState('');
  const [details, setDetails] = useState('');
  const [pickupName, setPickupName] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [budget, setBudget] = useState('');
  const [offer, setOffer] = useState(String(SUGGESTED_ERRAND_FEE));

  /**
   * The three camera tiles were decorative — a Pressable with no onPress, on a
   * screen whose whole job is describing something the rider has never seen.
   * The API has accepted photoUrls since the first commit and the upload path
   * already existed for marketplace requests; nothing was wired to it.
   */
  const [photos, setPhotos] = useState<Photo[]>([]);
  const upload = useUploadImage('errand-photos');

  const uploading = photos.some((p) => p.url === null && !p.failed);

  // Mirrors the server's zod schema, so the button doesn't offer to submit
  // something the API will reject. Waits on uploads too: submitting mid-upload
  // would post the errand without the photos that are still in flight.
  const canSubmit =
    task.trim().length >= 3 &&
    pickupName.trim().length >= 2 &&
    pickupAddress.trim().length >= 4 &&
    Boolean(activeAddress) &&
    (Number(offer.replace(/[^0-9]/g, '')) || 0) >= MIN_OFFER_NAIRA &&
    !uploading;

  async function addPhotos() {
    const assets = await pickImages(MAX_PHOTOS - photos.length);
    if (assets.length === 0) return;

    // Placeholders go in immediately so the grid fills while bytes are still
    // moving — on Lagos mobile data an upload is seconds, not milliseconds.
    setPhotos((prev) => [
      ...prev,
      ...assets.map((a) => ({ localUri: a.uri, url: null, failed: false })),
    ]);

    for (const asset of assets) void send(asset);
  }

  async function send(asset: ImagePickerAsset) {
    try {
      const url = await upload.mutateAsync(asset);
      setPhotos((prev) => prev.map((p) => (p.localUri === asset.uri ? { ...p, url } : p)));
    } catch (err) {
      // Keep why. "Try again" is bad advice for a file that is too large or a
      // provider that is not configured — both fail identically forever.
      const reason = err instanceof Error ? err.message : null;
      setPhotos((prev) =>
        prev.map((p) => (p.localUri === asset.uri ? { ...p, failed: true, reason } : p))
      );
    }
  }

  const submit = () => {
    if (!activeAddress) return router.push('/addresses');
    if (!signedIn) return router.push('/signin');

    const budgetNaira = Number(budget.replace(/[^\d]/g, ''));
    const offerNaira = Number(offer.replace(/[^\d]/g, '')) || SUGGESTED_ERRAND_FEE;

    createErrand.mutate(
      {
        addressId: activeAddress.id,
        task: task.trim(),
        ...(details.trim() ? { details: details.trim() } : {}),
        pickupName: pickupName.trim(),
        pickupAddress: pickupAddress.trim(),
        // The wire is kobo; the field is naira for the human.
        ...(budgetNaira > 0 ? { budgetKobo: budgetNaira * 100 } : {}),
        // Only the ones that actually landed. A failed upload has no URL, and
        // posting its local file:// path would give the rider a broken image.
        photoUrls: photos.map((p) => p.url).filter((u): u is string => u !== null),
        deliveryFeeKobo: offerNaira * 100,
      },
      {
        onSuccess: (order) =>
          router.replace({ pathname: '/track/[id]', params: { id: order.id } }),
      }
    );
  };

  return (
    <Screen>
      <ScreenHeader title="Create errand" />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 150 }} showsVerticalScrollIndicator={false}>
        <Input
          label="What do you need done?"
          value={task}
          onChangeText={setTask}
          placeholder="e.g. Buy 2 cartons of Eva Water"
          autoFocus
        />

        <Input
          label="Add details"
          value={details}
          onChangeText={setDetails}
          placeholder="Brands, sizes, quantities — anything the rider should know before shopping…"
          multiline
        />

        <Input
          label="Pick-up from"
          value={pickupName}
          onChangeText={setPickupName}
          placeholder="e.g. Shoprite, Ikeja City Mall"
        />

        <Input
          label="Pick-up address"
          value={pickupAddress}
          onChangeText={setPickupAddress}
          placeholder="Street and area the rider should go to"
        />

        <SelectField
          label="Deliver to"
          icon="location-outline"
          value={activeAddress?.line1}
          placeholder="Choose a drop-off address"
          onPress={() => router.push('/addresses')}
        />

        <Input
          label="What do you think it costs? (optional)"
          value={budget}
          onChangeText={setBudget}
          placeholder="0"
          prefix="₦"
          keyboardType="number-pad"
          // Was "your budget — we'll hold this and refund any change", which
          // described the old flow: the guess was charged up front and
          // reconciled against a receipt afterwards. Nothing is held now.
          helper="Just a guess, so riders can judge the job. You're not charged this."
        />

        {/* Straight after the item guess, because the two numbers are easily
            confused and reading them together is what separates them: one is
            what the thing costs, the other is what the trip costs. */}
        <DeliveryOfferInput
          value={offer}
          onChange={setOffer}
          suggestedNaira={SUGGESTED_ERRAND_FEE}
          hint="This is the rider's fee for going — separate from the price of the item."
        />

        <Text className="text-body text-[15px] mb-2.5">Add photos (optional)</Text>
        {/* Worth more here than anywhere else in the app: the rider is buying
            something they have never seen, from a description someone typed in
            a hurry. A photo of the exact brand settles it. */}
        <View className="flex-row mb-6">
          {photos.map((photo) => (
            <View
              key={photo.localUri}
              className="w-[76px] h-[76px] rounded-md overflow-hidden mr-3 bg-surface"
            >
              <Image
                source={{ uri: photo.localUri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />

              {photo.url === null ? (
                <View className="absolute inset-0 items-center justify-center bg-ink/40">
                  {photo.failed ? (
                    <Ionicons name="alert-circle" size={20} color={colors.white} />
                  ) : (
                    <ActivityIndicator color={colors.white} />
                  )}
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
                onPress={() => setPhotos((prev) => prev.filter((p) => p.localUri !== photo.localUri))}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-ink/70 items-center justify-center"
              >
                <Ionicons name="close" size={13} color={colors.white} />
              </Pressable>
            </View>
          ))}

          {photos.length < MAX_PHOTOS ? (
            <Pressable
              onPress={addPhotos}
              accessibilityRole="button"
              accessibilityLabel="Add photo"
              className="w-[76px] h-[76px] rounded-md border-[1.5px] border-dashed border-pink-200 bg-pink-50 items-center justify-center mr-3"
            >
              <Ionicons name="camera-outline" size={22} color={colors.pink[400]} />
            </Pressable>
          ) : null}
        </View>

        {photos.some((p) => p.failed) ? (
          <Text className="text-error text-[13px] mb-4 -mt-2">
            {photos.find((p) => p.failed)?.reason ?? 'A photo didn’t upload.'} Remove it and post
            without it, or try a different picture.
          </Text>
        ) : null}

        {createErrand.isError ? (
          <View className="bg-error/10 rounded-md p-3.5 mb-4">
            <Text className="text-error text-[13px]">
              {createErrand.error instanceof Error
                ? createErrand.error.message
                : 'Could not create this errand.'}
            </Text>
          </View>
        ) : null}

        <View className="flex-row items-start bg-surface rounded-md p-3.5">
          <Ionicons name="wallet-outline" size={17} color={colors.body} />
          <Text className="text-body text-[13px] ml-2.5 flex-1 leading-[18px]">
            You pay nothing now. A rider finds the item, confirms the real price and sends you the
            seller&apos;s account — we show you whose account it is before you transfer. You pay the
            seller directly, and Sendy Errands only for the delivery.
          </Text>
        </View>
      </ScrollView>

      <StickyBar>
        <Button
          title={
            createErrand.isPending ? 'Posting…' : uploading ? 'Uploading photos…' : 'Find me a rider'
          }
          /*
            No price here at all.
            
            Posting an errand charges nothing — the dispatch fee is collected
            later, when the customer accepts the rider's price, and the quote
            panel shows the real figure then. Any number here is guesswork the
            screen cannot back up: "from ₦1,300" was the delivery fee alone and
            the actual total came to ₦1,600 once the service fee landed, so the
            first thing the customer saw was already wrong by ₦300.
          */
          disabled={!canSubmit || createErrand.isPending}
          onPress={submit}
        />
      </StickyBar>
    </Screen>
  );
}

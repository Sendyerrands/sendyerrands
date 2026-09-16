import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card, EmptyState } from '@/components/ui/atoms';
import { Button, IconButton } from '@/components/ui/Button';
import { MapCanvas, TRACK_ROUTE } from '@/components/ui/MapCanvas';
import { Screen, StickyBar } from '@/components/ui/Screen';
import { SlideToConfirm } from '@/components/ui/SlideToConfirm';
import { HorizontalStepper } from '@/components/ui/Stepper';
import { Image } from 'expo-image';

import { ErrandRiderPanel } from '@/components/ErrandRiderPanel';
import { ApiError } from '@/lib/api/client';
import { pickImages } from '@/lib/api/uploads';
import { useRiderActive, useUpdateJobStatus, useUploadImage } from '@/lib/api/hooks';
import { colors, shadow } from '@/lib/theme';

const STEPS = ['Picked up', 'On the way', 'Delivered'];

/** Active delivery (design.md §10) — status updates + proof of delivery. */
export default function RiderActiveDelivery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: active } = useRiderActive();
  const updateStatus = useUpdateJobStatus();
  const job = active?.job;
  const orderId = active?.raw.id ?? id;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * Proof of delivery. The card was a dashed border and a camera icon with no
   * handler behind it, on the one screen where a photo is the evidence that a
   * handover happened — and useUpdateJobStatus has accepted proofUrl since it
   * was written. Nothing ever sent one.
   */
  const [proof, setProof] = useState<{ localUri: string; url: string | null; failed: boolean } | null>(null);
  const uploadProof = useUploadImage('proof-of-delivery');

  async function addProof() {
    const [asset] = await pickImages(1);
    if (!asset) return;
    setProof({ localUri: asset.uri, url: null, failed: false });
    try {
      const url = await uploadProof.mutateAsync(asset);
      setProof({ localUri: asset.uri, url, failed: false });
    } catch (err) {
      setProof({ localUri: asset.uri, url: null, failed: true });
      setError(err instanceof Error ? err.message : 'That photo could not be uploaded.');
    }
  }
  const codeRef = useRef<TextInput>(null);

  /**
   * Drive the stepper off the server's status, not local state — a reopened
   * app must show where the delivery actually is.
   *
   * The three steps mirror the server's three remaining transitions exactly:
   * RIDER_ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED. Collapsing pick-up
   * into "on the way" made the first slide post IN_TRANSIT straight from
   * RIDER_ASSIGNED, which the state machine rejects with a 409 — the rider
   * could claim a job and then never move it.
   */
  const status = active?.raw.status;
  /**
   * AT_DOORSTEP is the last step for everyone. Without it here an errand at the
   * door computed step 0, so the slide offered "confirm pick-up" and would have
   * posted PICKED_UP — backwards, and rejected by the server.
   */
  const step =
    status === 'AT_DOORSTEP' ? 2 : status === 'IN_TRANSIT' ? 2 : status === 'PICKED_UP' ? 1 : 0;

  /**
   * Errands run their own sequence and their own controls.
   *
   * The slide-to-confirm below assumes RIDER_ASSIGNED → PICKED_UP → IN_TRANSIT
   * → DELIVERED, which an errand does not follow: it has to be priced, and the
   * customer has to pay a seller, before there is anything to pick up. Sliding
   * "confirm pick-up" from RIDER_ASSIGNED would be rejected by the state machine
   * anyway — and would be a rider claiming goods nobody has paid for.
   */
  const isErrand = active?.raw.type === 'ERRAND';
  const errand = active?.raw.errandDetail ?? null;
  // Handover is the same act on every pillar, so the code entry is shared.
  const errandHandsOver = isErrand && status === 'AT_DOORSTEP';
  const atTheDoor = step === STEPS.length - 1;

  /** What this slide does next, in the server's own vocabulary. */
  const NEXT = ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] as const;
  const SLIDE_LABEL = [
    'Slide to confirm pick-up',
    'Slide to mark on the way',
    'Slide to confirm delivery',
  ];

  const advance = async () => {
    if (!orderId) return;
    setError(null);
    try {
      if (atTheDoor) {
        await updateStatus.mutateAsync({
          id: orderId,
          status: 'DELIVERED',
          deliveryCode: code,
          // Only a URL that actually landed. A failed upload has none, and the
          // delivery should still be confirmable without one.
          ...(proof?.url ? { proofUrl: proof.url } : {}),
        });
        router.replace('/rider');
        return;
      }
      await updateStatus.mutateAsync({ id: orderId, status: NEXT[step] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this delivery.');
    }
  };

  if (!job) {
    return (
      <Screen edges={[]} className="bg-surface">
        <View className="h-[360px] bg-hairline" />
        <View className="flex-1 bg-white rounded-t-xl -mt-6 p-4">
          <EmptyState
            icon="bicycle-outline"
            title="No active delivery"
            body="Accept a job and it will show up here."
          >
            <Button title="Find jobs" fullWidth={false} onPress={() => router.replace('/rider/jobs')} />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={[]} className="bg-surface">
      {/* map */}
      <View className="h-[360px]">
        <MapCanvas
          className="absolute inset-0"
          route={TRACK_ROUTE}
          dotted
          // Kept clear of the top chrome — the drop-off pin must not sit under Help.
          markers={[
            { x: 16, y: 78, icon: 'storefront', tone: 'white' },
            { x: 45, y: 55, icon: 'bicycle', tone: 'pink', halo: true },
            { x: 76, y: 36, icon: 'home', tone: 'white' },
          ]}
        />
        <View className="flex-row items-center px-4 pt-12">
          <IconButton icon="arrow-back" tone="white" onPress={() => router.back()} accessibilityLabel="Go back" />
          <View className="flex-1" />
          <Pressable
            accessibilityRole="button"
            style={shadow.card}
            className="flex-row items-center bg-white rounded-full px-4 h-10"
          >
            <Ionicons name="headset-outline" size={16} color={colors.ink} />
            <Text className="text-ink text-[13px] font-semibold ml-2">Help</Text>
          </Pressable>
        </View>
      </View>

      {/* sheet */}
      <View className="flex-1 bg-white rounded-t-xl -mt-6" style={shadow.float}>
        <View className="items-center pt-2.5 pb-1">
          <View className="w-10 h-1 rounded-full bg-hairline" />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
          <View className="flex-row items-start">
            <View className="flex-1">
              <View className="flex-row items-center mb-2">
                <View className="w-1.5 h-1.5 rounded-full bg-pink-600 mr-2" />
                <Text className="text-pink-600 text-[11px] font-bold tracking-wide">
                  {atTheDoor ? 'AT THE DOOR' : 'DELIVERING'}
                </Text>
              </View>
              <Text className="text-ink text-[20px] font-bold">Drop-off to {job.dropoffName}</Text>
              <Text className="text-muted text-[13px] mt-1">{job.dropoffAddress}</Text>
            </View>
            <IconButton icon="chatbubble-ellipses-outline" accessibilityLabel="Message customer" />
            <View className="w-2" />
            <IconButton icon="call" tone="pink" accessibilityLabel="Call customer" />
          </View>

          {isErrand ? (
            <View className="mt-6">
              <ErrandRiderPanel orderId={orderId} status={status ?? ''} errand={errand} />
            </View>
          ) : (
            /* stepper */
            <View className="mt-6">
              <HorizontalStepper steps={STEPS} activeIndex={step} />
            </View>
          )}

          {/* proof of delivery */}
          <Text className="text-muted text-[13px] font-semibold mt-7 mb-2.5">PROOF OF DELIVERY</Text>
          <Pressable onPress={addProof} accessibilityRole="button">
            <Card className="flex-row items-center p-4">
              <View className="w-14 h-14 rounded-md overflow-hidden border-[1.5px] border-dashed border-pink-200 bg-pink-50 items-center justify-center mr-3.5">
                {proof ? (
                  <>
                    <Image
                      source={{ uri: proof.localUri }}
                      style={{ width: '100%', height: '100%' }}
                      contentFit="cover"
                    />
                    {proof.url === null ? (
                      <View className="absolute inset-0 items-center justify-center bg-ink/40">
                        {proof.failed ? (
                          <Ionicons name="alert-circle" size={18} color={colors.white} />
                        ) : (
                          <ActivityIndicator color={colors.white} />
                        )}
                      </View>
                    ) : null}
                  </>
                ) : (
                  <Ionicons name="camera-outline" size={22} color={colors.pink[400]} />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-ink text-[15px] font-semibold">
                  {proof?.url ? 'Photo attached' : proof?.failed ? 'Tap to retry' : 'Snap a photo at the door'}
                </Text>
                <Text className="text-muted text-[13px] mt-1 leading-[18px]">
                  {/* Optional, and said so. A rider cannot always take a usable
                      photo, and blocking handover on one would strand them.

                      This line used to continue "Confirm the 4-digit code…" in
                      the same breath, so the word Optional read as applying to
                      the code as well. Riders skipped the code, found the slide
                      inert, and reported the slider broken. The code has its
                      own instruction now, next to the boxes. */}
                  Optional — a photo of the handover helps if anything is disputed.
                </Text>
              </View>
              {proof?.url ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : null}
            </Card>
          </Pressable>

          {/* code entry — only meaningful once the rider is at the door */}
          {atTheDoor ? (
            <>
              {/* Required, and says so, right above the boxes it applies to.
                  The slide below is inert until all four digits are in, and a
                  disabled control with no stated reason is indistinguishable
                  from a broken one. */}
              <Text className="text-ink text-[15px] font-semibold mt-5">
                Enter {job.dropoffName.split(' ')[0]}&apos;s 4-digit code
              </Text>
              <Text className="text-muted text-[13px] mt-1 leading-[18px]">
                Ask them for it. You can&apos;t confirm delivery without it.
              </Text>

              <Pressable onPress={() => codeRef.current?.focus()} className="flex-row mt-3">
                <TextInput
                  ref={codeRef}
                  value={code}
                  onChangeText={(v) => {
                    setError(null);
                    setCode(v.replace(/\D/g, '').slice(0, 4));
                  }}
                  keyboardType="number-pad"
                  maxLength={4}
                  className="absolute w-full h-full opacity-0"
                  style={{ outlineStyle: 'none' } as never}
                />
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    className={`flex-1 h-[56px] rounded-md border-[1.5px] bg-white items-center justify-center mr-2.5 ${
                      code.length === i ? 'border-pink-600' : 'border-hairline'
                    }`}
                  >
                    {code[i] ? (
                      <Text className="text-ink text-[22px] font-bold">{code[i]}</Text>
                    ) : (
                      <View className="w-2 h-2 rounded-full bg-hairline" />
                    )}
                  </View>
                ))}
              </Pressable>

              {error ? <Text className="text-error text-[13px] mt-3">{error}</Text> : null}
            </>
          ) : null}
        </ScrollView>
      </View>

      {/* An errand's controls live in the panel above until the rider is at the
          door; only handover uses the shared slide. */}
      {!isErrand || errandHandsOver ? (
      <StickyBar>
        {/* Always names the NEXT transition, never the current state — and now
            actually requires the gesture it names. */}
        <SlideToConfirm
          label={SLIDE_LABEL[step]!}
          pendingLabel="Updating…"
          pending={updateStatus.isPending}
          disabled={atTheDoor && code.length < 4}
          // The track itself says what is missing. A dimmed "Slide to confirm
          // delivery" is a slider that looks broken; "Enter the code first" is
          // an instruction.
          disabledLabel={
            atTheDoor && code.length < 4
              ? `Enter the code first (${code.length}/4)`
              : undefined
          }
          onConfirm={advance}
        />
      </StickyBar>
      ) : null}
    </Screen>
  );
}

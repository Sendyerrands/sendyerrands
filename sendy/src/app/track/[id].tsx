import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { DeliveryBidsPanel } from '@/components/DeliveryBidsPanel';
import { ErrandQuotePanel } from '@/components/ErrandQuotePanel';
import { Badge, Card, Divider, Skeleton } from '@/components/ui/atoms';
import { Button, IconButton } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { VerticalStepper } from '@/components/ui/Stepper';
import { useCancelOrder, useCheckout, useOrder } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import type { OrderStage } from '@/lib/mock';
import { colors, shadow } from '@/lib/theme';

/**
 * The headline answers "where is my order?" — so it has to come from the real
 * status. Anything generic here reads as a promise the order hasn't made yet.
 */
const HEADLINE: Record<string, string> = {
  QUOTE_REQUESTED: 'Finding you a rider',
  PRICE_PROPOSED: 'The rider found it',
  MERCHANT_PAID: 'Rider is collecting it',
  AT_DOORSTEP: 'Your rider is at the door',
  PENDING_PAYMENT: 'Pay to confirm this order',
  PLACED: 'Waiting for the vendor',
  VENDOR_ACCEPTED: 'Being prepared',
  RIDER_ASSIGNED: 'A rider is heading to pick it up',
  PICKED_UP: 'Picked up — on the way to you',
  IN_TRANSIT: 'On the way to you',
  DELIVERED: 'Delivered',
  CANCELLED: 'Order cancelled',
  REFUNDED: 'Refunded',
};

/** Order tracking (design.md §10) — status header, rider card, status stepper. */
export default function TrackOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading } = useOrder(id);
  const checkout = useCheckout();
  const cancel = useCancelOrder();
  const [payError, setPayError] = useState<string | null>(null);

  const order = data?.order;
  const rider = data?.rider;

  // `order.status` is the coarse active/delivered/cancelled bucket the list
  // screens use; the raw status is what this screen actually needs.
  const status = data?.raw.status ?? '';
  const unpaid = status === 'PENDING_PAYMENT';

  /**
   * The errand lane. An errand is posted unpaid and priced by a rider standing
   * in front of the item, so it passes through states the other pillars never
   * see — and the customer's money leaves at a different moment, to a different
   * person.
   */
  const errand = data?.raw.errandDetail ?? null;
  const awaitingQuote = status === 'QUOTE_REQUESTED';
  const quoted = status === 'PRICE_PROPOSED';
  const feePaid = (data?.raw.payments ?? []).some((p) => p.status === 'SUCCESS');

  /** The rider has the goods and is coming — the code becomes useful here. */
  const handingOver = ['PICKED_UP', 'IN_TRANSIT', 'AT_DOORSTEP'].includes(status);
  const enRoute = ['PICKED_UP', 'IN_TRANSIT', 'AT_DOORSTEP'].includes(status);

  /**
   * Everything past the point of no return, mirroring the server's own refusals.
   *
   * Derived from one list rather than assembled from booleans: the old gate was
   * `(unpaid || (live && !enRoute)) && status !== 'cancelled'`, which read as
   * three separate rules and quietly let through every status nobody had
   * thought about — AT_DOORSTEP, and MERCHANT_PAID, where the customer's money
   * has already gone to a seller and nothing here can get it back.
   */
  const cannotCancel = [
    'MERCHANT_PAID',
    'PICKED_UP',
    'IN_TRANSIT',
    'AT_DOORSTEP',
    'DELIVERED',
    'CANCELLED',
    'REFUNDED',
  ].includes(status);
  // Everything between payment and delivery — the window where a map and a
  // rider card mean something.
  const live = order?.status === 'active' && !unpaid;

  // The API owns the stepper: it drops steps that don't apply (a parcel has no
  // vendor) and marks skipped ones done, so the client just renders it.
  const stages: OrderStage[] = (data?.stepper ?? []).map((s) => ({
    label: s.label,
    time: s.at ? new Date(s.at).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true }) : undefined,
    state: s.state,
    detail: s.state === 'current' && live ? 'In progress' : undefined,
  }));

  if (isLoading || !order) {
    return (
      <Screen edges={[]} className="bg-surface">
        <View className="h-[260px] bg-hairline" />
        <View className="flex-1 bg-white rounded-t-xl -mt-6 p-4">
          <Skeleton className="w-1/2 h-7 mb-4" />
          <Skeleton className="w-full h-20 mb-6" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="w-full h-10 mb-3" />
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={[]} className="bg-surface">
      {/*
        A status header, not a map.

        This was a 420px canvas with a drawn route and a bicycle marker moving
        along it. Sendy Errands has no location provider and no rider GPS, so that
        bicycle was decoration — it promised live positioning the product cannot
        do, on the exact feature that is scoped and priced as MVP 2. Showing a
        real status the server actually knows is both honest and more useful
        than a map that never moves.
      */}
      <View className="h-[260px] bg-ink">
        <View className="flex-row items-center px-4 pt-12">
          <IconButton
            icon="arrow-back"
            tone="white"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/orders'))}
            accessibilityLabel="Go back"
          />
          <View className="flex-1" />
          <Pressable
            onPress={() => router.push('/(tabs)/support')}
            accessibilityRole="button"
            style={shadow.card}
            className="flex-row items-center bg-white rounded-full px-4 h-10"
          >
            <Ionicons name="headset-outline" size={16} color={colors.ink} />
            <Text className="text-ink text-[13px] font-semibold ml-2">Help</Text>
          </Pressable>
        </View>

        <View className="flex-1 items-center justify-center px-8 pb-8">
          <View className="w-[72px] h-[72px] rounded-full bg-white/10 items-center justify-center">
            <Ionicons
              name={
                order.status === 'cancelled'
                  ? 'close-circle-outline'
                  : unpaid
                    ? 'time-outline'
                    : enRoute
                      ? 'bicycle'
                      : live
                        ? 'restaurant-outline'
                        : 'checkmark-circle-outline'
              }
              size={32}
              color={colors.white}
            />
          </View>
          <Text className="text-white text-[20px] font-bold mt-4 text-center">
            {HEADLINE[status] ?? order.statusLabel}
          </Text>
          <Text className="text-white/70 text-[14px] mt-1.5 text-center leading-[20px]">
            {/*
              Says where the order is, never where the rider is. The server
              knows the stage; nothing in this system knows a position.
            */}
            {order.status === 'cancelled'
              ? 'This order was cancelled.'
              : unpaid
                ? 'Pay below and we’ll get moving.'
                : enRoute
                  ? 'Your rider will call when they arrive.'
                  : live
                    ? 'We’ll update this as your order moves.'
                    : 'Delivered. Thanks for using Sendy Errands.'}
          </Text>
        </View>
      </View>

      {/* sheet */}
      <View className="flex-1 bg-white rounded-t-xl -mt-6" style={shadow.float}>
        <View className="items-center pt-2.5 pb-1">
          <View className="w-10 h-1 rounded-full bg-hairline" />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          <View className="flex-row items-start">
            <View className="flex-1">
              {enRoute ? (
                <View className="flex-row items-center mb-2">
                  <View className="w-1.5 h-1.5 rounded-full bg-pink-600 mr-2" />
                  <Text className="text-pink-600 text-[11px] font-bold tracking-wide">ON THE WAY</Text>
                </View>
              ) : (
                // flex-row so the pill hugs its label instead of stretching
                <View className="mb-2 flex-row">
                  <Badge
                    label={order.statusLabel}
                    tone={
                      order.status === 'cancelled' ? 'error' : unpaid ? 'muted' : live ? 'info' : 'success'
                    }
                    icon={
                      order.status === 'cancelled'
                        ? 'close-circle'
                        : unpaid
                          ? 'time-outline'
                          : live
                            ? 'ellipse'
                            : 'checkmark-circle'
                    }
                  />
                </View>
              )}
              <Text className="text-ink text-[24px] font-display">
                {HEADLINE[status] ?? order.statusLabel}
              </Text>
            </View>
            {enRoute ? (
              <View className="w-11 h-11 rounded-full bg-pink-50 items-center justify-center">
                <Ionicons name="navigate" size={19} color={colors.pink[600]} />
              </View>
            ) : null}
          </View>

          {/* Nobody has looked at the item yet, so there is no price and nothing
              to pay. Saying so beats an empty space where a total belongs. */}
          {awaitingQuote ? (
            <Card className="p-4 mt-4">
              <View className="flex-row items-center">
                <Ionicons name="search-outline" size={17} color={colors.pink[600]} />
                <Text className="text-ink text-[15px] font-semibold ml-2.5">
                  Finding you a rider
                </Text>
              </View>
              <Text className="text-body text-[13px] mt-2 leading-[19px]">
                A rider will go and check what it actually costs, then send you the price and the
                seller&apos;s account. You haven&apos;t been charged anything.
              </Text>
            </Card>
          ) : null}

          {/* Only while the job is still looking for a rider, and only on the
              two pillars where the fee is negotiable. Renders nothing when no
              rider has asked for more, which is most of the time. */}
          <DeliveryBidsPanel
            orderId={id}
            active={
              // `rider` is only populated once one is assigned, which is the
              // same question as "is this still open" without adding a field.
              !rider &&
              ['ERRAND', 'PACKAGE'].includes(data?.raw.type ?? '') &&
              ['QUOTE_REQUESTED', 'PLACED'].includes(status)
            }
          />

          {quoted && errand?.actualItemKobo ? (
            <View className="mt-4">
              <ErrandQuotePanel
                orderId={id}
                itemKobo={errand.actualItemKobo}
                dispatchKobo={data?.raw.totalKobo ?? 0}
                merchant={{
                  accountName: errand.merchantAccountName ?? null,
                  accountNumber: errand.merchantAccountNo ?? null,
                  bankName: errand.merchantBankName ?? null,
                }}
                feePaid={feePaid}
              />
            </View>
          ) : null}

          {/*
            The handover code, shown to the person who has to say it out loud.

            The rider's screen has asked for a 4-digit code from the customer
            since the first build. The customer was never shown one — it was
            fetched by useOrder and rendered nowhere, so the last step of every
            delivery ended with a rider asking for digits nobody had. Withheld
            until the rider actually has the goods, because before that it is
            just a number with no use.
          */}
          {handingOver && data?.deliveryCode ? (
            <Card className="p-4 mt-4">
              <Text className="text-muted text-[11px] font-semibold tracking-wide">
                YOUR DELIVERY CODE
              </Text>
              <Text className="text-ink text-[34px] font-bold tracking-[10px] mt-2" selectable>
                {data.deliveryCode}
              </Text>
              <Text className="text-body text-[13px] mt-1.5 leading-[19px]">
                Give this to {rider ? rider.firstName : 'your rider'} when they hand it over — it
                is how we know it reached you.
              </Text>
            </Card>
          ) : null}

          {/* An order created from a bid, an errand or a parcel is priced by the
              server and lands here unpaid — this is the only place to settle it. */}
          {unpaid ? (
            <Card className="p-4 mt-4">
              <Text className="text-body text-[13px] leading-[18px]">
                We&apos;ve held {naira(order.total)} against this order. Nothing moves until it&apos;s
                paid.
              </Text>
              {payError ? (
                <View className="bg-error/10 rounded-md p-3 mt-3">
                  <Text className="text-error text-[13px]">{payError}</Text>
                </View>
              ) : null}
              <View className="mt-3">
                <Button
                  title={`Pay ${naira(order.total)} from wallet`}
                  icon="wallet-outline"
                  loading={checkout.isPending}
                  onPress={() => {
                    setPayError(null);
                    checkout.mutate(
                      { orderId: order.id, method: 'WALLET' },
                      {
                        onError: (err) =>
                          setPayError(
                            err instanceof Error ? err.message : 'Could not take that payment.'
                          ),
                      }
                    );
                  }}
                />
              </View>
              <Pressable
                onPress={() => router.push('/wallet')}
                accessibilityRole="button"
                className="items-center mt-3 py-1"
              >
                <Text className="text-pink-600 text-[13px] font-semibold">Top up my wallet</Text>
              </Pressable>
            </Card>
          ) : null}

          {/* rider */}
          {live && rider ? (
            <Card className="flex-row items-center p-3.5 mt-4">
              <View className="w-11 h-11 rounded-full bg-pink-100 items-center justify-center">
                <Text className="text-pink-700 text-[15px] font-bold">
                  {`${rider?.firstName?.[0] ?? ''}${rider?.lastName?.[0] ?? ''}`.toUpperCase() || 'SR'}
                </Text>
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-ink text-[15px] font-semibold">
                  {rider ? `${rider.firstName} ${rider.lastName}` : 'Finding a rider…'}
                </Text>
                <View className="flex-row items-center mt-0.5">
                  <Ionicons name="star" size={12} color={colors.star} />
                  <Text className="text-muted text-[13px] ml-1">
                    {rider?.rating ?? '—'} · {rider?.plateNumber ?? 'Assigning'}
                  </Text>
                </View>
              </View>
              {/*
                Both buttons did nothing. With no live map, contacting the rider
                IS the tracking — so these have to work. WhatsApp first because
                it is what people actually use here, and it degrades to the web
                link if the app is not installed.
              */}
              <IconButton
                icon="logo-whatsapp"
                accessibilityLabel="Message rider on WhatsApp"
                onPress={() =>
                  rider?.phone
                    ? Linking.openURL(
                        `https://wa.me/${rider.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                          `Hi, about my Sendy Errands order ${order.reference}`
                        )}`
                      )
                    : undefined
                }
              />
              <View className="w-2" />
              <IconButton
                icon="call"
                tone="pink"
                accessibilityLabel="Call rider"
                onPress={() => (rider?.phone ? Linking.openURL(`tel:${rider.phone}`) : undefined)}
              />
            </Card>
          ) : null}

          {/* stepper */}
          <View className="mt-6">
            <VerticalStepper stages={stages} />
          </View>

          <Divider className="my-5" />

          {/* summary */}
          <Text className="text-muted text-[13px] font-semibold mb-2.5">ORDER SUMMARY</Text>
          <Card className="p-4">
            <SummaryRow label="Reference" value={order.reference} />
            <SummaryRow label="Vendor" value={order.vendor} />
            <SummaryRow label="Items" value={`${order.itemCount}`} />
            <Divider className="my-3" />
            <View className="flex-row">
              {/* A cancelled order may or may not have been paid for by the time
                  it was cancelled, so it gets the neutral label. */}
              <Text className="text-ink text-[15px] font-bold flex-1">
                {unpaid
                  ? 'Total due'
                  : status === 'REFUNDED'
                    ? 'Refunded'
                    : status === 'CANCELLED'
                      ? 'Order total'
                      : 'Total paid'}
              </Text>
              <Text className="text-ink text-[17px] font-bold">{naira(order.total)}</Text>
            </View>
          </Card>

          {/* Gone rather than disabled: a greyed-out Cancel on a delivered
              order still reads as something you could have done in time. */}
          {!cannotCancel ? (
            <Pressable
              onPress={() => cancel.mutate({ id: order.id })}
              disabled={cancel.isPending}
              accessibilityRole="button"
              className="items-center mt-6 py-3"
            >
              <Text className="text-error text-[15px] font-semibold">
                {cancel.isPending ? 'Cancelling…' : 'Cancel order'}
              </Text>
            </Pressable>
          ) : null}

          {cancel.isError ? (
            <View className="bg-error/10 rounded-md p-3 mt-2">
              <Text className="text-error text-[13px]">
                {cancel.error instanceof Error ? cancel.error.message : 'Could not cancel this order.'}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Screen>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center mb-2.5">
      <Text className="text-muted text-[13px] flex-1">{label}</Text>
      <Text className="text-ink text-[13px] font-medium flex-1 text-right" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

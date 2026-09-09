import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { Card, Divider } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/client';
import { useAcceptBid, useOrderBids } from '@/lib/api/hooks';
import { koboToNaira } from '@/lib/api/mappers';
import { naira } from '@/lib/format';
import { colors } from '@/lib/theme';

/**
 * Riders asking more than the customer offered.
 *
 * Renders nothing at all when there are none, which is the common case and the
 * one the flow is designed around — a rider who is happy with the price simply
 * takes the job, and this panel never appears. It shows up only when someone
 * has asked for more, which is exactly when the customer has a decision.
 *
 * Every row leads with the rider, not the number. Sorting by price and showing
 * price alone is what turns a marketplace into a race to the bottom; a rating
 * and a job count are what make ₦2,500 from someone with 340 deliveries a
 * different proposition from ₦2,200 from someone with none.
 */
export function DeliveryBidsPanel({
  orderId,
  /** Off once a rider is assigned — there is nothing left to choose. */
  active,
}: {
  orderId: string;
  active: boolean;
}) {
  const { data } = useOrderBids(orderId, active);
  const accept = useAcceptBid(orderId);

  const bids = (data?.bids ?? []).filter((b) => b.status === 'PENDING');

  if (!active || bids.length === 0) return null;

  return (
    <View className="mt-4">
      <Text className="text-ink text-[15px] font-bold mb-1">
        {bids.length === 1 ? 'A rider wants more' : `${bids.length} riders want more`}
      </Text>
      <Text className="text-muted text-[13px] mb-2.5 leading-[18px]">
        You offered {naira(koboToNaira(data?.offeredKobo ?? 0))}. Accept one of these, or wait —
        another rider may still take it at your price.
      </Text>

      {accept.isError ? (
        <View className="bg-error/10 rounded-md p-3 mb-3">
          <Text className="text-error text-[13px]">
            {accept.error instanceof ApiError
              ? accept.error.message
              : 'Could not accept that offer.'}
          </Text>
        </View>
      ) : null}

      <Card className="overflow-hidden">
        {bids.map((bid, i) => (
          <View key={bid.id}>
            {i > 0 ? <Divider /> : null}
            <View className="p-4">
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-full bg-pink-50 items-center justify-center mr-3">
                  <Text className="text-pink-700 text-[15px] font-bold">
                    {bid.rider.firstName[0]?.toUpperCase()}
                  </Text>
                </View>

                <View className="flex-1">
                  <Text className="text-ink text-[15px] font-semibold">
                    {bid.rider.firstName} {bid.rider.lastName[0]}.
                  </Text>
                  <View className="flex-row items-center mt-0.5">
                    <Ionicons name="star" size={12} color={colors.star} />
                    <Text className="text-muted text-[13px] ml-1">
                      {bid.rider.rating.toFixed(1)}
                    </Text>
                    <Text className="text-muted text-[13px]">
                      {' · '}
                      {bid.rider.completedJobs}{' '}
                      {bid.rider.completedJobs === 1 ? 'delivery' : 'deliveries'}
                    </Text>
                    {bid.rider.vehicleType ? (
                      <Text className="text-muted text-[13px]">
                        {' · '}
                        {bid.rider.vehicleType.toLowerCase()}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <Text className="text-ink text-[19px] font-bold">
                  {naira(koboToNaira(bid.priceKobo))}
                </Text>
              </View>

              {bid.note ? (
                <Text className="text-body text-[13px] mt-2.5 leading-[18px]">
                  &ldquo;{bid.note}&rdquo;
                </Text>
              ) : null}

              <View className="mt-3">
                <Button
                  title={
                    accept.isPending
                      ? 'Accepting…'
                      : `Accept ${naira(koboToNaira(bid.priceKobo))}`
                  }
                  disabled={accept.isPending}
                  onPress={() => accept.mutate(bid.id)}
                />
              </View>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

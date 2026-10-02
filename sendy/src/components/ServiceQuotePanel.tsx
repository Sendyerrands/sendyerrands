import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Card } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/client';
import { useAcceptServiceQuote, useCheckout, useDeclineServiceQuote } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { koboToNaira } from '@/lib/api/mappers';
import { colors } from '@/lib/theme';

/**
 * The customer's half of a service negotiation.
 *
 * Same shape as ErrandQuotePanel, and deliberately so — it is the same deal in
 * different clothes. Sendy has charged for the arrival; the provider has named
 * a price for the work; the customer pays the provider directly and says so
 * here.
 *
 * The two numbers are kept visually apart throughout. Folding them into one
 * total would imply Sendy is collecting the lot, which it is not, and which is
 * exactly the confusion that put a customer's ₦56,000 shopping basket on a
 * tracking page as a Sendy service fee.
 */
export function ServiceQuotePanel({
  orderId,
  providerName,
  quotedKobo,
  arrivalKobo,
  arrivalMode,
  feePaid,
}: {
  orderId: string;
  providerName: string;
  quotedKobo: number;
  arrivalKobo: number;
  arrivalMode: 'BIKE' | 'CAR';
  /** Whether Sendy's arrival fee has been settled. */
  feePaid: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  const checkout = useCheckout();
  const accept = useAcceptServiceQuote(orderId);
  const decline = useDeclineServiceQuote(orderId);

  // A fee of zero is already settled — there is nothing to charge, so no
  // payment can ever succeed and gating on one would deadlock the booking.
  const feeSettled = feePaid || arrivalKobo <= 0;

  return (
    <Card className="p-4 mt-4 border-2 border-pink-600">
      <Text className="text-pink-600 text-[11px] font-bold tracking-wide">
        {providerName.toUpperCase()} HAS SENT YOU A PRICE
      </Text>

      <Text className="text-ink text-[26px] font-bold mt-1.5">
        {naira(koboToNaira(quotedKobo))}
      </Text>
      <Text className="text-body text-[13px] mt-1 leading-[19px]">
        for the work itself. You pay {providerName} directly — Sendy does not handle this money.
      </Text>

      <View className="h-px bg-hairline my-4" />

      {/* Sendy's side, named separately so the two never blur together. */}
      <View className="flex-row items-center">
        <Ionicons
          name={arrivalMode === 'BIKE' ? 'bicycle-outline' : 'car-outline'}
          size={15}
          color={colors.body}
        />
        <Text className="text-body text-[14px] flex-1 ml-2">
          Sendy arrival ({arrivalMode === 'BIKE' ? 'bike' : 'car'})
        </Text>
        <Text className="text-ink text-[15px] font-semibold">
          {naira(koboToNaira(arrivalKobo))}
        </Text>
        {feeSettled ? (
          <Ionicons
            name="checkmark-circle"
            size={17}
            color={colors.success}
            style={{ marginLeft: 8 }}
          />
        ) : null}
      </View>

      {error ? <Text className="text-error text-[13px] mt-3">{error}</Text> : null}

      <View className="mt-4">
        {!feeSettled ? (
          <Button
            title={checkout.isPending ? 'Opening…' : 'Pay arrival fee'}
            loading={checkout.isPending}
            onPress={() => {
              setError(null);
              checkout.mutate(
                { orderId, method: 'WALLET' },
                {
                  onError: (err) =>
                    setError(err instanceof ApiError ? err.message : 'Could not take that payment.'),
                }
              );
            }}
          />
        ) : (
          <>
            <Button
              title={accept.isPending ? 'Confirming…' : `I've paid ${providerName}`}
              loading={accept.isPending}
              onPress={() => {
                setError(null);
                accept.mutate(undefined, {
                  onError: (err) =>
                    setError(err instanceof ApiError ? err.message : 'Could not confirm that.'),
                });
              }}
            />
            <View className="h-2" />
            {/*
              Declining has to be as reachable as accepting. A price you can
              only say yes to is not a negotiation, and this is the last moment
              walking away is free.
            */}
            <Button
              title={decline.isPending ? 'Cancelling…' : 'Decline this price'}
              variant="secondary"
              loading={decline.isPending}
              onPress={() => {
                setError(null);
                decline.mutate(undefined, {
                  onError: (err) =>
                    setError(err instanceof ApiError ? err.message : 'Could not cancel that.'),
                });
              }}
            />
            <Text className="text-muted text-[12px] mt-2.5 text-center leading-[17px]">
              Only confirm once the money has actually left your account. Declining cancels the
              booking and nothing further is charged.
            </Text>
          </>
        )}
      </View>
    </Card>
  );
}

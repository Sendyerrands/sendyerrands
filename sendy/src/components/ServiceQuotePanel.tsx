import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Card } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/client';
import { useCheckout, useDeclineServiceQuote } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { koboToNaira } from '@/lib/api/mappers';
import { colors } from '@/lib/theme';

/**
 * The customer's half of a service negotiation.
 *
 * UNLIKE the errand panel, Sendy collects the whole amount here and pays the
 * provider out. So this shows ONE total, broken into its parts, and the
 * customer pays Sendy — they are never asked to transfer anything to the
 * provider themselves.
 *
 * That is the opposite of what this panel used to say, and the breakdown is
 * the reason it is safe to show a single figure now: the objection to one
 * total was that it implied Sendy was collecting the lot. It is.
 *
 * It is driven by `amountDueKobo`, NOT by the arrival fee. Keying the pay step
 * off the arrival fee is what made the payment step disappear entirely once
 * that fee went to zero: `arrivalKobo <= 0` read as "nothing to pay", the
 * button was skipped, and the customer was shown a confirmation for money they
 * had never been asked for.
 */
export function ServiceQuotePanel({
  orderId,
  providerName,
  quotedKobo,
  serviceFeeKobo,
  serviceChargeKobo,
  transportKobo,
  totalKobo,
  amountDueKobo,
}: {
  orderId: string;
  providerName: string;
  /** The provider's price for the work. */
  quotedKobo: number;
  serviceFeeKobo: number;
  serviceChargeKobo: number;
  transportKobo: number;
  /** Quote plus the three charges — what the customer owes Sendy. */
  totalKobo: number;
  /** What is left to pay. Zero once settled. */
  amountDueKobo: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const checkout = useCheckout();
  const decline = useDeclineServiceQuote(orderId);

  /*
    Settled means the money is in, not that the bill was zero. A booking with
    nothing to pay is not a thing that exists any more — there is always at
    least the ₦500 service fee once a price has been quoted.
  */
  const settled = amountDueKobo <= 0;

  /*
    Card payments leave the app, so the authorization URL has to be carried to
    the screen that waits for Paystack and verifies on the way back. The wallet
    path settles in place and simply refetches.
  */
  const pay = checkout;
  const payWith = async (method: 'PAYSTACK' | 'WALLET') => {
    setError(null);
    try {
      const result = await checkout.mutateAsync({ orderId, method });
      if (result.authorizationUrl) {
        router.push({
          pathname: '/payment-success',
          params: { reference: result.reference, url: result.authorizationUrl },
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not take that payment.');
    }
  };

  return (
    <Card className="p-4 mt-4 border-2 border-pink-600">
      <Text className="text-pink-600 text-[11px] font-bold tracking-wide">
        {providerName.toUpperCase()} HAS SENT YOU A PRICE
      </Text>

      <Text className="text-ink text-[26px] font-bold mt-1.5">
        {naira(koboToNaira(totalKobo))}
      </Text>
      <Text className="text-body text-[13px] mt-1 leading-[19px]">
        {settled
          ? `Paid. ${providerName} has been told and is on the way.`
          : `in total. You pay Sendy, and we pay ${providerName} once the job is done.`}
      </Text>

      <View className="h-px bg-hairline my-4" />

      {/* Every line, because three of the four are Sendy's and a customer is
          entitled to see which. A single total with "fees included" is how a
          booking becomes a complaint. */}
      <Line label={`${providerName}'s price`} kobo={quotedKobo} />
      <Line label="Service fee" kobo={serviceFeeKobo} />
      <Line label="Service charge (10%)" kobo={serviceChargeKobo} />
      <Line label="Transport (5%)" kobo={transportKobo} />

      <View className="h-px bg-hairline my-2.5" />

      <View className="flex-row items-center">
        <Text className="text-ink text-[14px] font-semibold flex-1">Total</Text>
        <Text className="text-ink text-[15px] font-bold">{naira(koboToNaira(totalKobo))}</Text>
        {settled ? (
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
        {!settled ? (
          <>
            {/*
              Card first, wallet second.

              This used to send WALLET and nothing else. That was defensible
              when the only charge was a ₦1,000 arrival fee; it is not when the
              bill is the whole job, because a customer with an empty wallet
              had no way to pay at all and the only feedback was a failed
              mutation.
            */}
            <Button
              title={pay.isPending ? 'Opening…' : `Pay ${naira(koboToNaira(amountDueKobo))}`}
              loading={pay.isPending}
              onPress={() => void payWith('PAYSTACK')}
            />
            <View className="h-2" />
            <Button
              title="Pay from wallet"
              variant="secondary"
              onPress={() => void payWith('WALLET')}
            />
            <View className="h-2" />
            {/*
              Declining has to be as reachable as paying. A price you can only
              say yes to is not a negotiation, and this is the last moment
              walking away is free — once the money is in, it is not a decline
              any more, it is a refund.
            */}
            <Button
              title={decline.isPending ? 'Cancelling…' : 'Decline this price'}
              variant="text"
              loading={decline.isPending}
              onPress={() => {
                setError(null);
                decline.mutate(undefined, {
                  onError: (err) =>
                    setError(err instanceof ApiError ? err.message : 'Could not cancel that.'),
                });
              }}
            />
            <Text className="text-muted text-[12px] mt-1.5 text-center leading-[17px]">
              Declining cancels the booking. Nothing is charged.
            </Text>
          </>
        ) : (
          <>
            {/*
              Paid. There is nothing left to approve.

              This used to offer "Confirm and send them" here, which asked the
              customer to agree to something they had already paid for — and
              tapping it answered "this order has already been paid for". The
              payment IS the approval now: the API moves a fully-paid service
              booking on by itself, so this says where things stand rather than
              asking a question with no answer left.
            */}
            <View className="flex-row items-start">
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text className="text-body text-[13px] ml-2 flex-1 leading-[18px]">
                Paid in full. {providerName} has been told and will set off — you&apos;ll see it
                here when they do.
              </Text>
            </View>

            <Text className="text-muted text-[12px] mt-2.5 text-center leading-[17px]">
              Something wrong? Contact support and we&apos;ll sort it out — the money is with
              Sendy, not with {providerName}.
            </Text>
          </>
        )}
      </View>
    </Card>
  );
}

/** One line of the bill. */
function Line({ label, kobo }: { label: string; kobo: number }) {
  return (
    <View className="flex-row items-center py-1">
      <Text className="text-body text-[13.5px] flex-1">{label}</Text>
      <Text className="text-ink text-[13.5px]">{naira(koboToNaira(kobo))}</Text>
    </View>
  );
}

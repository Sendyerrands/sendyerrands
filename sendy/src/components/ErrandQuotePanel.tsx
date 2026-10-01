import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/client';
import { useCheckout, useConfirmMerchantPaid } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { koboToNaira } from '@/lib/api/mappers';
import { colors } from '@/lib/theme';

/**
 * The step where the customer's money actually moves — and the only place in
 * Sendy Errands where it moves somewhere Sendy does not control.
 *
 * Two payments, deliberately shown as two things, because they behave
 * differently and go to different people:
 *
 *   1. The item, transferred by the customer straight to the seller's bank.
 *      Sendy never touches it. Nothing here can reverse it.
 *   2. The dispatch fee, paid to Sendy like any other order.
 *
 * The account holder's name is the largest text in the block on purpose. It is
 * the resolved answer from Paystack, never anything the rider typed, and it is
 * the entire protection this model offers: a rider who enters their own account
 * has to watch their own name appear here.
 */
export function ErrandQuotePanel({
  orderId,
  itemKobo,
  dispatchKobo,
  merchant,
  feePaid,
}: {
  orderId: string;
  itemKobo: number;
  dispatchKobo: number;
  merchant: {
    accountName: string | null;
    accountNumber: string | null;
    bankName: string | null;
  };
  /** Whether the Sendy dispatch fee has already been settled. */
  feePaid: boolean;
}) {
  const [copied, setCopied] = useState<'account' | 'amount' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkout = useCheckout();
  const confirm = useConfirmMerchantPaid(orderId);

  /**
   * A fee of zero is already settled.
   *
   * feePaid alone asks "is there a successful payment", which is never true
   * when there is nothing to charge — so an errand whose dispatch fee had not
   * been set yet offered the customer a "Pay delivery fee ₦0" button that no
   * amount of tapping could satisfy, and the confirm control underneath it was
   * unreachable. The rider sat waiting on a price the customer had no way to
   * accept.
   */
  const feeSettled = feePaid || dispatchKobo <= 0;

  const copy = async (value: string, what: 'account' | 'amount') => {
    await Clipboard.setStringAsync(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!merchant.accountNumber || !merchant.accountName) return null;

  return (
    <Card className="p-4 mb-4">
      <Text className="text-ink text-[17px] font-semibold">The rider found it</Text>
      <Text className="text-body text-[14px] mt-1 mb-4 leading-[20px]">
        Transfer the item cost straight to the seller, then pay Sendy Errands for the delivery.
      </Text>

      {/* ── the seller ─────────────────────────────────── */}
      <View className="bg-surface rounded-md p-3.5">
        <Text className="text-muted text-[11px] font-semibold tracking-wide mb-2">
          PAY THIS ACCOUNT
        </Text>

        {/* Biggest thing in the block. If this is not a shop, do not send. */}
        <Text className="text-ink text-[19px] font-bold leading-[24px]">
          {merchant.accountName}
        </Text>
        <Text className="text-body text-[13px] mt-0.5">{merchant.bankName ?? 'Bank'}</Text>

        <Pressable
          onPress={() => copy(merchant.accountNumber!, 'account')}
          accessibilityRole="button"
          accessibilityLabel={`Copy account number ${merchant.accountNumber}`}
          className="flex-row items-center mt-3 bg-white rounded-md px-3 py-2.5"
        >
          <Text className="text-ink text-[17px] font-mono tracking-[2px] flex-1" selectable>
            {merchant.accountNumber}
          </Text>
          <Ionicons
            name={copied === 'account' ? 'checkmark-circle' : 'copy-outline'}
            size={18}
            color={copied === 'account' ? colors.success : colors.pink[600]}
          />
        </Pressable>

        <Pressable
          onPress={() => copy(String(Math.round(itemKobo / 100)), 'amount')}
          accessibilityRole="button"
          accessibilityLabel="Copy amount"
          className="flex-row items-center mt-2 bg-white rounded-md px-3 py-2.5"
        >
          <Text className="text-ink text-[17px] font-semibold flex-1">
            {naira(koboToNaira(itemKobo))}
          </Text>
          <Ionicons
            name={copied === 'amount' ? 'checkmark-circle' : 'copy-outline'}
            size={18}
            color={copied === 'amount' ? colors.success : colors.pink[600]}
          />
        </Pressable>
      </View>

      {/*
        Said once, plainly, at the moment it is true. Sendy cannot reverse this
        transfer, cannot refund it, and will not see it — so the customer needs
        to know that before they tap, not in a help article afterwards.
      */}
      <View className="flex-row items-start mt-3">
        <Ionicons name="alert-circle-outline" size={15} color={colors.muted} />
        <Text className="text-muted text-[12px] ml-2 flex-1 leading-[17px]">
          This goes straight to the seller&apos;s bank, not to Sendy Errands. Check the name above
          matches the shop before you send — we can&apos;t reverse a bank transfer.
        </Text>
      </View>

      {/* ── the dispatch fee ───────────────────────────── */}
      <View className="h-px bg-hairline my-4" />

      <View className="flex-row items-center">
        <Text className="text-body text-[14px] flex-1">Sendy Errands delivery</Text>
        <Text className="text-ink text-[15px] font-semibold">
          {naira(koboToNaira(dispatchKobo))}
        </Text>
        {feeSettled ? (
          <Ionicons name="checkmark-circle" size={17} color={colors.success} style={{ marginLeft: 8 }} />
        ) : null}
      </View>

      {error ? <Text className="text-error text-[13px] mt-3">{error}</Text> : null}

      <View className="mt-4">
        {!feeSettled ? (
          <Button
            title={checkout.isPending ? 'Opening…' : 'Pay delivery fee'}
            loading={checkout.isPending}
            onPress={() => {
              setError(null);
              checkout.mutate(
                { orderId, method: 'WALLET' },
                {
                  onError: (err) =>
                    setError(
                      err instanceof ApiError ? err.message : 'Could not take the delivery fee.'
                    ),
                }
              );
            }}
          />
        ) : (
          /*
           * Only reachable once the fee is settled, which is what the server
           * enforces too. Confirming is what tells the rider to buy, so it is
           * deliberately the last thing that happens.
           */
          <Button
            title={confirm.isPending ? 'Confirming…' : 'I’ve sent the money'}
            loading={confirm.isPending}
            onPress={() => {
              setError(null);
              confirm.mutate(undefined, {
                onError: (err) =>
                  setError(err instanceof ApiError ? err.message : 'Could not confirm that.'),
              });
            }}
          />
        )}
      </View>

      {feeSettled ? (
        <Text className="text-muted text-[12px] mt-2.5 text-center">
          Only tap this once the transfer has actually left your account.
        </Text>
      ) : null}
    </Card>
  );
}

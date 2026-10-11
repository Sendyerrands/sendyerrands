import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Card } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { useProviderEarnings, useProviderMe, useProviderPayouts } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { colors } from '@/lib/theme';

/**
 * What a provider has made, and what Sendy took.
 *
 * The deduction is shown rather than netted away. A provider who can see that
 * ₦3,500 went on a ₦20,000 job has a number to argue with; one who only sees
 * what landed assumes the worst, and support gets the call either way.
 *
 * `payable` is the figure that matters: earned, not yet paid out, not voided.
 */
export default function ProviderEarnings() {
  const router = useRouter();
  const { data: me } = useProviderMe();
  const { data, isLoading } = useProviderEarnings();
  const { data: payouts = [] } = useProviderPayouts();

  const hasAccount = Boolean(me?.bankAccountNo);

  return (
    <Screen>
      <ScreenHeader onBack={() => router.back()} title="Earnings" />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <Text className="text-muted text-[13px]">Loading…</Text>
        ) : (
          <>
            <Card className="p-4">
              <Text className="text-muted text-[12px] uppercase tracking-wide">Ready to pay out</Text>
              <Text className="text-ink text-[30px] font-display mt-1">
                {naira((data?.payableKobo ?? 0) / 100)}
              </Text>
              <Text className="text-body text-[13px] mt-1 leading-[18px]">
                From {data?.jobsCompleted ?? 0} completed{' '}
                {data?.jobsCompleted === 1 ? 'job' : 'jobs'}.
              </Text>

              {!hasAccount ? (
                <View className="mt-3">
                  {/* Said plainly, with the fix one tap away. Money sitting in a
                      balance with nowhere to go is the kind of thing people
                      discover weeks later. */}
                  <View className="flex-row items-start bg-surface rounded-md p-3">
                    <Ionicons name="alert-circle-outline" size={17} color={colors.body} />
                    <Text className="text-body text-[13px] ml-2 flex-1 leading-[18px]">
                      We have nowhere to send this yet. Add your bank account and it goes out
                      with the next run.
                    </Text>
                  </View>
                  <View className="h-3" />
                  <Button
                    title="Add your bank account"
                    onPress={() => router.push('/provider/payout-account')}
                  />
                </View>
              ) : null}
            </Card>

            <View className="h-3" />

            <Card className="p-4">
              <Text className="text-ink text-[15px] font-semibold mb-2.5">All time</Text>

              <Row label="Work billed" value={naira((data?.grossKobo ?? 0) / 100)} />
              {/* Named as what it is. "Fees" with no explanation is what makes
                  people think they are being skimmed. */}
              <Row
                label="Sendy charges"
                value={`− ${naira((data?.feesKobo ?? 0) / 100)}`}
                hint="Service fee, service charge and transport, added to the customer's bill"
              />
              <View className="h-px bg-hairline my-2.5" />
              <Row label="Yours" value={naira((data?.earnedKobo ?? 0) / 100)} strong />
            </Card>

            <View className="h-3" />

            <Card className="p-4">
              <Text className="text-ink text-[15px] font-semibold mb-1">Recent jobs</Text>
              {(data?.recent ?? []).length === 0 ? (
                <Text className="text-muted text-[13px] mt-1">
                  Nothing yet. Finished jobs show up here.
                </Text>
              ) : (
                (data?.recent ?? []).map((e) => (
                  <View key={e.id} className="flex-row items-center py-2.5 border-b border-hairline">
                    <View className="flex-1">
                      <Text className="text-ink text-[14px]" numberOfLines={1}>
                        {e.order?.reference ?? 'Job'}
                      </Text>
                      <Text className="text-muted text-[12px] mt-0.5">
                        {e.voidedAt
                          ? 'Refunded — not payable'
                          : e.isPaidOut
                            ? 'Paid out'
                            : 'Awaiting payout'}
                      </Text>
                    </View>
                    <Text
                      className={`text-[14px] font-semibold ${
                        e.voidedAt ? 'text-muted line-through' : 'text-ink'
                      }`}
                    >
                      {naira(e.netKobo / 100)}
                    </Text>
                  </View>
                ))
              )}
            </Card>

            <View className="h-3" />

            <Card className="p-4">
              <Text className="text-ink text-[15px] font-semibold mb-1">Payouts</Text>
              {payouts.length === 0 ? (
                <Text className="text-muted text-[13px] mt-1">No payouts yet.</Text>
              ) : (
                payouts.map((p) => (
                  <View key={p.id} className="flex-row items-center py-2.5 border-b border-hairline">
                    <View className="flex-1">
                      <Text className="text-ink text-[14px]">{naira(p.amountKobo / 100)}</Text>
                      <Text className="text-muted text-[12px] mt-0.5" numberOfLines={1}>
                        {p.bankName ?? ''} {p.bankAccountNo ? `•••• ${p.bankAccountNo.slice(-4)}` : ''}
                      </Text>
                      {p.failureReason ? (
                        <Text className="text-error text-[12px] mt-0.5">{p.failureReason}</Text>
                      ) : null}
                    </View>
                    <Text className="text-muted text-[12px]">{p.status}</Text>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Row({
  label,
  value,
  hint,
  strong = false,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <View className="py-1.5">
      <View className="flex-row items-center justify-between">
        <Text className={`text-[14px] ${strong ? 'text-ink font-semibold' : 'text-body'}`}>
          {label}
        </Text>
        <Text className={`text-[14px] ${strong ? 'text-ink font-bold' : 'text-ink'}`}>{value}</Text>
      </View>
      {hint ? <Text className="text-muted text-[11.5px] mt-0.5 leading-[16px]">{hint}</Text> : null}
    </View>
  );
}

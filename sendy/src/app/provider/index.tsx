import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Card, EmptyState } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { ApiError } from '@/lib/api/client';
import type { ApiProviderJob } from '@/lib/api/endpoints';
import {
  useProviderComplete,
  useProviderEnRoute,
  useProviderJobs,
  useQuoteServiceJob,
} from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { koboToNaira } from '@/lib/api/mappers';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/**
 * The service provider's app.
 *
 * Deliberately one screen rather than a tab bar: a provider has exactly one
 * job to do here — look at what they have been booked for and move it along.
 * Tabs would be four routes where three of them are empty.
 *
 * The loop mirrors the rider's errand flow, because it is the same deal: the
 * person who can see the work is the only one who can price it, and the
 * customer approves before anything starts.
 */
export default function ProviderHome() {
  const router = useRouter();
  const { ready, signedIn, actor, signOut } = useApp();
  const { data: jobs = [], isLoading } = useProviderJobs();

  // Same gate the vendor and rider apps use: another actor's token would 403
  // on every panel here, which reads as a broken screen rather than a wrong
  // door.
  if (ready && (!signedIn || actor !== 'provider')) {
    return (
      <Screen>
        <ScreenHeader title="Service provider" />
        <EmptyState
          icon="construct-outline"
          title="Sign in as a provider"
          body="This area is for service providers. Sign in with your provider account to see your jobs."
        >
          <Button
            title="Sign in"
            fullWidth={false}
            onPress={() => router.replace({ pathname: '/signin', params: { role: 'provider' } })}
          />
        </EmptyState>
      </Screen>
    );
  }

  const open = jobs.filter((j) => !j.completedAt);
  const done = jobs.filter((j) => j.completedAt);

  return (
    <Screen>
      <ScreenHeader
        title="Your jobs"
        right={
          <Button
            title="Sign out"
            variant="text"
            fullWidth={false}
            /*
              Navigate, like the rider and vendor apps do. Signing out without
              it left you on /provider, where the gate above swaps in a "sign
              in as a provider" panel — the session really was gone, but it
              looked like the button had only redecorated the page.
            */
            onPress={async () => {
              await signOut();
              router.replace('/signin');
            }}
          />
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <Text className="text-muted text-[13px]">Loading…</Text>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="No bookings yet"
            body="When someone books you, the job appears here and you can price it."
          />
        ) : (
          <>
            {open.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}

            {done.length ? (
              <>
                <Text className="text-muted text-[11px] font-semibold tracking-wide mt-6 mb-2">
                  COMPLETED
                </Text>
                {done.map((job) => (
                  <Card key={job.id} className="p-4 mb-2">
                    <Text className="text-ink text-[15px] font-semibold">{job.task}</Text>
                    <Text className="text-muted text-[12.5px] mt-1">
                      {job.order.reference} ·{' '}
                      {job.quotedKobo ? naira(koboToNaira(job.quotedKobo)) : '—'}
                    </Text>
                  </Card>
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function JobCard({ job }: { job: ApiProviderJob }) {
  const status = job.order.status;
  const [price, setPrice] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const quote = useQuoteServiceJob(job.orderId);
  const enRoute = useProviderEnRoute(job.orderId);
  const complete = useProviderComplete(job.orderId);

  const priceNaira = Number(price.replace(/[^\d]/g, ''));
  const canQuote = ['QUOTE_REQUESTED', 'PRICE_PROPOSED'].includes(status);
  const alreadyQuoted = status === 'PRICE_PROPOSED';
  const paid = status === 'MERCHANT_PAID';
  const travelling = status === 'IN_TRANSIT';

  return (
    <Card className="p-4 mb-3">
      <View className="flex-row items-start">
        <View className="flex-1">
          <Text className="text-ink text-[16px] font-semibold">{job.task}</Text>
          <Text className="text-muted text-[12.5px] mt-0.5">
            {job.order.reference} · {job.order.customer?.firstName ?? 'Customer'}
          </Text>
        </View>
        <View className="flex-row items-center bg-surface rounded-full px-2.5 py-1">
          <Ionicons
            name={job.arrivalMode === 'BIKE' ? 'bicycle-outline' : 'car-outline'}
            size={13}
            color={colors.body}
          />
          <Text className="text-body text-[11.5px] font-semibold ml-1.5">
            {job.arrivalMode === 'BIKE' ? 'Bike' : 'Car'}
          </Text>
        </View>
      </View>

      {job.details ? (
        <Text className="text-body text-[13.5px] mt-2 leading-[19px]">{job.details}</Text>
      ) : null}

      {/* The address only matters once they are going, but a provider deciding
          what to charge needs to know how far it is. */}
      <Text className="text-body text-[13px] mt-2.5">{job.address}</Text>
      {job.landmark ? (
        <Text className="text-muted text-[12.5px] mt-0.5">{job.landmark}</Text>
      ) : null}

      {job.budgetKobo ? (
        <Text className="text-muted text-[12.5px] mt-2">
          They expect around {naira(koboToNaira(job.budgetKobo))}.
        </Text>
      ) : null}

      {error ? <Text className="text-error text-[13px] mt-3">{error}</Text> : null}

      <View className="h-px bg-hairline my-3.5" />

      {canQuote ? (
        <>
          {alreadyQuoted ? (
            <Text className="text-body text-[13px] mb-3 leading-[19px]">
              You quoted {naira(koboToNaira(job.quotedKobo ?? 0))}. Waiting for them to pay you —
              don&apos;t set off until they confirm. Price changed? Send a new one.
            </Text>
          ) : (
            <Text className="text-body text-[13px] mb-3 leading-[19px]">
              Only you can price this. They pay you directly; Sendy takes the arrival fee only.
            </Text>
          )}
          <Input
            label="Your price for the work"
            value={price}
            onChangeText={(v) => {
              setError(null);
              setPrice(v);
            }}
            placeholder="0"
            prefix="₦"
            keyboardType="number-pad"
          />
          <Button
            title={quote.isPending ? 'Sending…' : alreadyQuoted ? 'Send new price' : 'Send price'}
            loading={quote.isPending}
            disabled={!priceNaira || quote.isPending}
            onPress={() => {
              setError(null);
              quote.mutate(priceNaira * 100, {
                onError: (e) =>
                  setError(e instanceof ApiError ? e.message : 'Could not send that price.'),
              });
            }}
          />
        </>
      ) : paid ? (
        <>
          <Text className="text-body text-[13px] mb-3 leading-[19px]">
            They&apos;ve paid you {naira(koboToNaira(job.quotedKobo ?? 0))}. You&apos;re clear to go.
          </Text>
          <Button
            title={enRoute.isPending ? 'Updating…' : "I'm on my way"}
            loading={enRoute.isPending}
            onPress={() => {
              setError(null);
              enRoute.mutate(undefined, {
                onError: (e) =>
                  setError(e instanceof ApiError ? e.message : 'Could not update that.'),
              });
            }}
          />
        </>
      ) : travelling ? (
        <>
          {/* The code is the only thing between "I turned up" and "I did the
              work", and the customer is the only one who has it. */}
          <Text className="text-body text-[13px] mb-3 leading-[19px]">
            When the job is done, ask them for the code on their booking.
          </Text>
          <Input
            label="Customer's code"
            value={code}
            onChangeText={(v) => {
              setError(null);
              setCode(v.replace(/\D/g, '').slice(0, 4));
            }}
            placeholder="4 digits"
            keyboardType="number-pad"
          />
          <Button
            title={complete.isPending ? 'Finishing…' : 'Mark complete'}
            loading={complete.isPending}
            disabled={code.length < 4 || complete.isPending}
            onPress={() => {
              setError(null);
              complete.mutate(code, {
                onError: (e) =>
                  setError(e instanceof ApiError ? e.message : 'That code did not match.'),
              });
            }}
          />
        </>
      ) : (
        <Text className="text-muted text-[13px]">Nothing to do on this one right now.</Text>
      )}
    </Card>
  );
}

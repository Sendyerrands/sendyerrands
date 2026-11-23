import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { JobCard } from '@/components/JobCard';
import { Badge, Chip, EmptyState, Skeleton } from '@/components/ui/atoms';
import { QueryError } from '@/components/ui/QueryError';
import { Screen } from '@/components/ui/Screen';
import { useRiderJobs, useRiderMe } from '@/lib/api/hooks';
import { colors } from '@/lib/theme';

/**
 * Available jobs (design.md §10).
 *
 * The list used to be `const { data = [] } = useRiderJobs()` and nothing else,
 * so a failed request, a request still in flight and a genuinely empty board
 * all rendered the same blank screen. A rider whose fetch timed out — which the
 * API being asleep makes routine — saw "no work available" and had no way to
 * learn otherwise. Every one of those states now says which it is.
 */

/**
 * The API sorts by `createdAt` ascending for anything that is not `payout`.
 * That is longest-waiting, not nearest: distance needs a maps provider the app
 * does not have, and every job reports 0 km. Labelling it "Nearest" made the
 * chip a no-op that looked like a feature.
 */
const FILTERS = ['Longest waiting', 'Highest pay'] as const;
type Filter = (typeof FILTERS)[number];

export default function RiderJobs() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('Longest waiting');

  const { data: riderMe } = useRiderMe();
  const { data: jobs = [], isLoading, isError, error, refetch, isRefetching } =
    useRiderJobs(filter === 'Highest pay' ? 'payout' : 'nearest');

  const online = riderMe?.isOnline ?? false;

  /**
   * Browsing is allowed, accepting is not, until ops approves the documents.
   *
   * The rule was only ever stated by the server, as a 403 AFTER the rider had
   * found a job, read it and tapped Accept. That is the right answer far too
   * late: a rider reported the accept button as "dormant", having no way to
   * tell a refusal from a broken screen. Saying it up here costs one line and
   * turns a dead end into a next step.
   */
  const canAccept = riderMe?.status === 'APPROVED';

  return (
    <Screen>
      <View className="flex-row items-center px-4 py-3">
        <Text className="text-ink text-[24px] font-display flex-1">Available jobs</Text>
        {/* Reflects the toggle rather than always claiming Online, which told a
            rider they were taking work while they were not. */}
        <Badge
          label={online ? 'Online' : 'Offline'}
          tone={online ? 'success' : 'muted'}
          icon="ellipse"
        />
      </View>

      <View className="flex-row items-center px-4 pb-2">
        <Ionicons name="location-outline" size={14} color={colors.muted} />
        <Text className="text-muted text-[13px] ml-1.5">
          {/* "within 5 km" was invented — nothing here filters by distance. */}
          {riderMe?.zone ?? 'All areas'} · {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} open
        </Text>
      </View>

      {!canAccept ? (
        <Pressable
          onPress={() => router.push('/rider-verify')}
          accessibilityRole="button"
          className="flex-row items-center bg-savings/10 rounded-md mx-4 mt-1 mb-2 px-3 py-3"
        >
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.savings} />
          <View className="flex-1 ml-2.5">
            <Text className="text-savings text-[13px] font-semibold">
              You can browse, but not accept yet
            </Text>
            <Text className="text-body text-[12px] mt-0.5 leading-[17px]">
              {riderMe?.status === 'REJECTED'
                ? 'One of your documents was refused. Tap to see which.'
                : 'Your documents need approving first. Tap to upload them.'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.savings} />
        </Pressable>
      ) : null}

      <View className="py-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          {FILTERS.map((f) => (
            <Chip key={f} label={f} selected={f === filter} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.pink[600]} />
        }
      >
        {isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="w-full h-[152px] mb-4" />)
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} noun="available jobs" />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon="cube-outline"
            title="No jobs right now"
            body={
              online
                ? 'New work appears here on its own — this list refreshes every 20 seconds. Pull down to check straight away.'
                : 'Go online from your dashboard to start receiving jobs.'
            }
          />
        ) : (
          jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onPress={() => router.push({ pathname: '/rider-job/[id]', params: { id: job.id } })}
              onAccept={() => router.push({ pathname: '/rider-job/[id]', params: { id: job.id } })}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

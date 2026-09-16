import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { JobCard } from '@/components/JobCard';
import { SectionHeader } from '@/components/ui/atoms';
import { IconButton } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useNotifications, useRiderJobs, useRiderMe, useSetAvailability } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { colors } from '@/lib/theme';

/** Rider home (design.md §10) — availability toggle + today's numbers. */
export default function RiderHome() {
  const router = useRouter();
  const { data: rider } = useRiderMe();
  const { data: jobs = [] } = useRiderJobs();
  const setAvailability = useSetAvailability();
  const { data: notifications } = useNotifications();
  const unread = notifications?.unread ?? 0;
  const online = rider?.isOnline ?? false;
  const approved = rider?.status === 'APPROVED';
  const RIDER = {
    initials: rider ? (rider.firstName[0] + rider.lastName[0]).toUpperCase() : '–',
    name: rider ? rider.firstName + ' ' + rider.lastName : 'Rider',
    zone: rider?.zone ?? 'your area',
    todayEarnings: rider?.todayEarnings ?? 0,
    todayTrips: rider?.todayTrips ?? 0,
    completed: rider?.completedJobs != null ? String(rider.completedJobs) : '—',
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
        {/* header */}
        <View className="flex-row items-center px-4 py-3">
          <View className="w-11 h-11 rounded-full bg-pink-100 items-center justify-center">
            <Text className="text-pink-700 text-[15px] font-bold">{RIDER.initials}</Text>
          </View>
          <View className="flex-1 ml-3">
            <Text className="text-ink text-[17px] font-bold">{RIDER.name}</Text>
            {/* The number, not a greeting: it is the only way to tell which
                rider account this session belongs to. */}
            <Text className="text-muted text-[13px] mt-0.5">{rider?.phone ?? '—'}</Text>
          </View>
          {/* Back, and real. The previous bell had badge hardcoded to true and
              no onPress. This one counts unread rider notifications — an offer
              accepted, a seller paid, a job cancelled under them — and opens
              the list. */}
          <IconButton
            icon="notifications-outline"
            accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            badge={unread > 0}
            onPress={() => router.push('/notifications')}
          />
        </View>

        <VerificationBanner status={rider?.status} onPress={() => router.push('/rider-verify')} />

        {/* online card */}
        <View className="px-4">
          <LinearGradient
            colors={online ? [colors.pink[600], colors.pink[900]] : ['#4A4652', '#191420']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 16, padding: 18 }}
          >
            <View className="flex-row items-center">
              <View className="flex-1 flex-row items-center">
                <View className="w-2 h-2 rounded-full bg-white mr-2" />
                <Text className="text-white text-[17px] font-bold">
                  You&apos;re {online ? 'online' : 'offline'}
                </Text>
              </View>
              <Pressable
                onPress={() => setAvailability.mutate(!online)}
                disabled={!approved}
                accessibilityRole="switch"
                accessibilityState={{ checked: online, disabled: !approved }}
                accessibilityLabel="Toggle availability"
                className={`w-14 h-8 rounded-full p-1 ${
                  !approved ? 'bg-white/10' : online ? 'bg-white/30' : 'bg-white/20'
                }`}
              >
                <View
                  className={`w-6 h-6 rounded-full ${approved ? 'bg-white' : 'bg-white/40'} ${
                    online ? 'ml-auto' : ''
                  }`}
                />
              </Pressable>
            </View>

            {/*
              The server refuses to put an unapproved rider online (403 from
              PATCH /rider/availability). Without saying so here the toggle just
              did nothing when tapped, which reads as a broken switch rather
              than a rule.
            */}
            <Text className="text-white/80 text-[13px] mt-1.5">
              {!approved
                ? 'You can go online once your documents are approved.'
                : online
                  ? `Receiving requests in ${RIDER.zone}`
                  : 'Go online to receive requests'}
            </Text>

            <View className="flex-row mt-5">
              <Metric value={naira(RIDER.todayEarnings)} label="Today" />
              <View className="w-px bg-white/25 mx-4" />
              <Metric value={`${RIDER.todayTrips}`} label="Trips" />
              <View className="w-px bg-white/25 mx-4" />
              {/* Was labelled "Online" while showing the completed-jobs count. */}
              <Metric value={RIDER.completed} label="Completed" />
            </View>
          </LinearGradient>
        </View>

        {/* available jobs */}
        <View className="pt-6">
          <SectionHeader
            title="Available near you"
            actionLabel="See all"
            onAction={() => router.push('/rider/jobs')}
          />
          <View className="px-4">
            {online ? (
              jobs.slice(0, 3).map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  compact
                  onPress={() => router.push({ pathname: '/rider-job/[id]', params: { id: job.id } })}
                />
              ))
            ) : (
              <View className="items-center py-12">
                <View className="w-20 h-20 rounded-full bg-surface items-center justify-center mb-4">
                  <Ionicons name="moon-outline" size={32} color={colors.muted} />
                </View>
                <Text className="text-ink text-[17px] font-semibold">You&apos;re offline</Text>
                <Text className="text-muted text-[15px] text-center mt-1.5">
                  Flip the switch above to start receiving jobs.
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View>
      <Text className="text-white text-[18px] font-bold">{value}</Text>
      <Text className="text-white/75 text-[11px] mt-0.5">{label}</Text>
    </View>
  );
}

/**
 * Where an unapproved rider stands, and what to do about it.
 *
 * Approved riders see nothing — a permanent banner on the main screen for the
 * normal case is just noise. The others each get their own copy, because
 * "pending" (we have not looked yet) and "rejected" (we looked and said no)
 * call for completely different actions, and a rider who cannot tell them apart
 * will keep waiting for a decision that already happened.
 */
function VerificationBanner({
  status,
  onPress,
}: {
  status?: 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  onPress: () => void;
}) {
  if (!status || status === 'APPROVED') return null;

  const copy = {
    PENDING: {
      icon: 'document-text-outline' as const,
      title: 'Finish your verification',
      body: 'Upload your documents to start accepting jobs.',
      action: 'Continue',
    },
    IN_REVIEW: {
      icon: 'hourglass-outline' as const,
      title: 'Verification in review',
      body: 'We’re checking your documents. This usually takes a working day.',
      action: 'View',
    },
    REJECTED: {
      icon: 'alert-circle-outline' as const,
      title: 'Verification unsuccessful',
      body: 'Something didn’t check out. Open it to see what to re-submit.',
      action: 'See why',
    },
    SUSPENDED: {
      icon: 'pause-circle-outline' as const,
      title: 'Account suspended',
      body: 'You can’t accept jobs right now. Contact support to sort it out.',
      action: 'Details',
    },
  }[status];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${copy.title}. ${copy.body}`}
      className="mx-4 mb-1 flex-row items-center rounded-md bg-pink-50 px-3.5 py-3"
    >
      <Ionicons name={copy.icon} size={20} color={colors.pink[600]} />
      <View className="flex-1 ml-2.5">
        <Text className="text-pink-700 text-[14px] font-semibold">{copy.title}</Text>
        <Text className="text-pink-700/80 text-[12px] mt-0.5 leading-[16px]">{copy.body}</Text>
      </View>
      <Text className="text-pink-600 text-[13px] font-bold ml-2">{copy.action}</Text>
    </Pressable>
  );
}

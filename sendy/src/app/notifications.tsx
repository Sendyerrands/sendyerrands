import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card, Divider, EmptyState, Skeleton } from '@/components/ui/atoms';
import { QueryError } from '@/components/ui/QueryError';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { useMarkNotificationsRead, useNotifications } from '@/lib/api/hooks';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/**
 * Where the bell leads.
 *
 * The bell on Home had a permanent badge and no onPress — a red dot that never
 * cleared, over nothing, forever. This is the screen behind it: what actually
 * happened to this person's orders, oldest state kept, read state tracked.
 *
 * Not push. There is no APNs or FCM setup, and pretending otherwise would be
 * the same defect as the badge. When push arrives it sends from these rows.
 */
export default function Notifications() {
  const router = useRouter();
  const { signedIn } = useApp();
  const { data, isLoading, isError, error, refetch } = useNotifications();
  const markRead = useMarkNotificationsRead();

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  /**
   * Opening the screen is reading them.
   *
   * Marking on mount rather than per-tap: a status update is read the moment it
   * is on screen, and leaving the badge lit after someone has plainly looked at
   * the list is the sort of small dishonesty that makes people stop trusting
   * the badge.
   */
  useEffect(() => {
    if (unread > 0 && !markRead.isPending) markRead.mutate(undefined);
    // Only when the count changes — mutate is stable enough and including it
    // would re-fire on every render of a pending mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  if (!signedIn) {
    return (
      <Screen>
        <ScreenHeader title="Notifications" />
        <View className="flex-1 items-center justify-center px-8">
          <EmptyState
            icon="notifications-off-outline"
            title="Sign in to see updates"
            body="Order updates appear here once you have an account."
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Notifications" />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {isError ? (
          <QueryError error={error} onRetry={() => refetch()} noun="notifications" />
        ) : isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="w-full h-[72px] mb-3" />)
        ) : items.length === 0 ? (
          <View className="pt-16">
            <EmptyState
              icon="notifications-outline"
              title="Nothing yet"
              body="When you place an order, updates about it show up here."
            />
          </View>
        ) : (
          <Card className="overflow-hidden">
            {items.map((n, i) => {
              const unreadRow = !n.readAt;
              return (
                <View key={n.id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable
                    // Only tappable when it points somewhere. A row that looks
                    // interactive and goes nowhere is the thing this screen
                    // exists to stop.
                    onPress={
                      n.orderId
                        ? () =>
                            router.push({ pathname: '/track/[id]', params: { id: n.orderId! } })
                        : undefined
                    }
                    accessibilityRole={n.orderId ? 'button' : 'text'}
                    className={`flex-row items-start p-4 ${n.orderId ? 'active:bg-surface' : ''}`}
                  >
                    <View
                      className={`w-9 h-9 rounded-full items-center justify-center mr-3 ${
                        unreadRow ? 'bg-pink-50' : 'bg-surface'
                      }`}
                    >
                      <Ionicons
                        name="cube-outline"
                        size={18}
                        color={unreadRow ? colors.pink[600] : colors.muted}
                      />
                    </View>

                    <View className="flex-1">
                      <View className="flex-row items-center">
                        <Text className="text-ink text-[15px] font-semibold flex-1">{n.title}</Text>
                        {unreadRow ? (
                          <View className="w-2 h-2 rounded-full bg-pink-600 ml-2" />
                        ) : null}
                      </View>
                      <Text className="text-body text-[13px] mt-1 leading-[19px]">{n.body}</Text>
                      <Text className="text-muted text-[11px] mt-1.5">{when(n.createdAt)}</Text>
                    </View>

                    {n.orderId ? (
                      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * Relative for the first day, then the date.
 *
 * "3 days ago" stops being useful about as fast as it stops being accurate, and
 * for a delivery app the only timings anyone reasons about are minutes and
 * hours.
 */
function when(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const mins = Math.floor((Date.now() - then) / 60000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) {
    const hrs = Math.floor(mins / 60);
    return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  }
  return new Date(then).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

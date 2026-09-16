import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { nextOpeningLabel, riderHoursLabel, ridersAvailableNow } from '@/lib/rider-hours';
import { colors } from '@/lib/theme';

/**
 * Tells the customer whether anyone is on the road right now.
 *
 * Two registers. During hours it is one quiet line, because the information is
 * reassurance rather than news. Outside hours it becomes a proper notice: an
 * errand posted at 11pm sits unseen until morning, and a customer who does not
 * know that watches "Finding you a rider" for nine hours and concludes the app
 * is broken. Posting is still allowed — the order is real and will be picked up
 * — it is the expectation that has to change, not the action.
 */
export function RiderHoursNotice({ compact = false }: { compact?: boolean }) {
  const open = ridersAvailableNow();

  if (open) {
    if (compact) return null;
    return (
      <View className="flex-row items-center mb-4">
        <Ionicons name="time-outline" size={14} color={colors.muted} />
        <Text className="text-muted text-[13px] ml-1.5">Riders available {riderHoursLabel()}</Text>
      </View>
    );
  }

  return (
    <View className="flex-row items-start bg-savings/10 rounded-md p-3.5 mb-4">
      <Ionicons name="moon-outline" size={17} color={colors.savings} />
      <View className="flex-1 ml-2.5">
        <Text className="text-ink text-[13px] font-semibold">Riders are off until {nextOpeningLabel()}</Text>
        <Text className="text-body text-[13px] mt-0.5 leading-[18px]">
          You can still post this — it will be picked up when riders come back on at{' '}
          {nextOpeningLabel()}. Riders work {riderHoursLabel()}.
        </Text>
      </View>
    </View>
  );
}

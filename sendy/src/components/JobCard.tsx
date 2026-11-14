import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { naira } from '@/lib/format';
import type { RiderJob } from '@/lib/mock';
import { colors } from '@/lib/theme';

import { Badge, Card } from './ui/atoms';
import { Button } from './ui/Button';

const TYPE_ICON: Record<RiderJob['type'], keyof typeof Ionicons.glyphMap> = {
  Package: 'cube-outline',
  Errand: 'receipt-outline',
  Food: 'fast-food-outline',
};

/**
 * Rider job card. Payout is the loudest element — a rider scanning the list
 * decides on money first, then distance.
 */
export function JobCard({
  job,
  onPress,
  onAccept,
  compact = false,
}: {
  job: RiderJob;
  onPress?: () => void;
  onAccept?: () => void;
  compact?: boolean;
}) {
  return (
    // The accept CTA is a sibling of the tappable summary, never a nested button.
    <Card className="p-4 mb-3">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${job.type} job, ${naira(job.payout)}`}
      >
        <View className="flex-row items-start">
          <View className="flex-row items-center bg-pink-50 rounded-full px-2.5 py-1">
            <Ionicons name={TYPE_ICON[job.type]} size={13} color={colors.pink[600]} />
            <Text className="text-pink-700 text-[11px] font-semibold ml-1.5">{job.type}</Text>
          </View>
          <View className="flex-1" />
          <View className="items-end">
            <Text className="text-ink text-[18px] font-bold">{naira(job.payout)}</Text>
            <Text className="text-muted text-[11px]">you earn</Text>
          </View>
        </View>

        <View className="mt-4">
          <Leg
            tone="pink"
            kicker="PICK-UP"
            name={job.pickupName}
            address={job.pickupAddress}
            connector={!compact}
          />
          <Leg
            tone="ink"
            kicker="DROP-OFF"
            name={job.dropoffName}
            address={job.dropoffAddress}
          />
        </View>

        <View className="flex-row items-center mt-3.5">
          {/*
            Distance and duration need a maps provider, which is out of Phase 1,
            so they arrive as 0. Printing "0 km · ~0 min" is worse than printing
            nothing — a rider reads it as "the drop is next door" and takes a
            job across Lagos. They appear the moment real values do.
          */}
          {job.distanceKm > 0 ? <Meta icon="navigate-outline" label={`${job.distanceKm} km`} /> : null}
          {job.minutes > 0 ? <Meta icon="time-outline" label={`~${job.minutes} min`} /> : null}
          {/* Before payment, because whether the bike can carry it decides
              whether the fee is worth reading at all. */}
          {job.weightKg ? <Meta icon="barbell-outline" label={`${job.weightKg} kg`} /> : null}
          <Meta icon="card-outline" label={job.paymentLabel ?? (job.prepaid ? 'Prepaid' : 'Cash on delivery')} />
        </View>
      </Pressable>

      {onAccept ? (
        <View className="mt-4">
          <Button title="Accept job" iconRight="arrow-forward" onPress={onAccept} />
        </View>
      ) : null}
    </Card>
  );
}

function Leg({
  tone,
  kicker,
  name,
  address,
  connector = false,
}: {
  tone: 'pink' | 'ink';
  kicker: string;
  name: string;
  /** Where it actually is — without this a rider can't judge the trip at all. */
  address?: string;
  connector?: boolean;
}) {
  return (
    <View className="flex-row">
      <View className="items-center w-5 pt-1">
        {tone === 'pink' ? (
          <View className="w-2.5 h-2.5 rounded-full bg-pink-600" />
        ) : (
          <Ionicons name="location" size={14} color={colors.ink} />
        )}
        {connector ? <View className="w-[1.5px] flex-1 bg-hairline my-1" /> : null}
      </View>
      <View className={`flex-1 ${connector ? 'pb-3' : ''}`}>
        <Text className="text-muted text-[11px] font-semibold tracking-wide">{kicker}</Text>
        <Text className="text-ink text-[15px] font-semibold mt-0.5" numberOfLines={1}>
          {name}
        </Text>
        {address ? (
          <Text className="text-muted text-[13px] mt-0.5 leading-[18px]" numberOfLines={2}>
            {address}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Meta({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View className="flex-row items-center bg-surface rounded-md px-2.5 py-1.5 mr-2">
      <Ionicons name={icon} size={12} color={colors.body} />
      <Text className="text-body text-[11px] font-medium ml-1.5">{label}</Text>
    </View>
  );
}

/** Badge shown next to the online toggle on the rider home. */
export function OnlinePill({ online }: { online: boolean }) {
  return <Badge label={online ? 'Online' : 'Offline'} tone={online ? 'success' : 'muted'} />;
}

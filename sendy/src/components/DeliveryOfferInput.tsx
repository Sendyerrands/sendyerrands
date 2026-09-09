import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { Input } from '@/components/ui/Input';
import { naira } from '@/lib/format';
import { colors } from '@/lib/theme';

/** The lowest offer the server will accept — mirrors MIN_DELIVERY_FEE_KOBO. */
export const MIN_OFFER_NAIRA = 500;

/**
 * What the customer will pay a rider.
 *
 * The price used to be ours. It is theirs now, which means the screen has a new
 * job: someone who has never priced a delivery has to name a number, and an
 * empty box invites both a guess that no rider will take and a guess far above
 * what the job is worth.
 *
 * So it opens pre-filled with what we would have charged. Most people will
 * leave it alone, which is the point — the suggestion is the default, not a
 * placeholder. The quick-adjust buttons exist because the common edit is
 * "a bit more, it is raining" rather than a considered figure.
 */
export function DeliveryOfferInput({
  value,
  onChange,
  suggestedNaira,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  suggestedNaira: number;
  /** Why the suggestion is what it is — e.g. the parcel size or the distance. */
  hint?: string;
}) {
  const amount = Number(value.replace(/[^\d]/g, '')) || 0;
  const tooLow = amount > 0 && amount < MIN_OFFER_NAIRA;

  const bump = (by: number) =>
    onChange(String(Math.max(MIN_OFFER_NAIRA, (amount || suggestedNaira) + by)));

  return (
    <View className="mb-2">
      <Input
        label="What will you pay for delivery?"
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^\d]/g, ''))}
        placeholder={String(suggestedNaira)}
        prefix="₦"
        keyboardType="number-pad"
        helper={
          tooLow
            ? undefined
            : hint ?? `We suggest ${naira(suggestedNaira)}. Riders can accept it or ask for more.`
        }
      />

      {tooLow ? (
        <Text className="text-error text-[13px] -mt-2 mb-3">
          The lowest you can offer is {naira(MIN_OFFER_NAIRA)}. Below that nobody will take it.
        </Text>
      ) : null}

      {/* The common edit is nudging, not retyping. */}
      <View className="flex-row -mt-1 mb-1">
        {[-200, 200, 500].map((by) => (
          <Pressable
            key={by}
            onPress={() => bump(by)}
            accessibilityRole="button"
            accessibilityLabel={`${by > 0 ? 'Increase' : 'Decrease'} by ${Math.abs(by)} naira`}
            className="flex-row items-center bg-surface rounded-full px-3 py-1.5 mr-2 active:bg-hairline"
          >
            <Ionicons
              name={by > 0 ? 'add' : 'remove'}
              size={13}
              color={colors.body}
            />
            <Text className="text-body text-[13px] font-medium ml-1">{Math.abs(by)}</Text>
          </Pressable>
        ))}

        {amount !== suggestedNaira ? (
          <Pressable
            onPress={() => onChange(String(suggestedNaira))}
            accessibilityRole="button"
            className="rounded-full px-3 py-1.5 active:opacity-60"
          >
            <Text className="text-pink-700 text-[13px] font-semibold">Reset</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

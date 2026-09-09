import { Text, View } from 'react-native';

import { Input } from '@/components/ui/Input';
import { naira } from '@/lib/format';

/** The lowest offer the server will accept — mirrors MIN_DELIVERY_FEE_KOBO. */
export const MIN_OFFER_NAIRA = 500;

/**
 * What the customer will pay a rider.
 *
 * Just a field. It had −200/+200/+500 nudge buttons and a Reset, on the theory
 * that the common edit is a small adjustment rather than a considered figure —
 * that theory was wrong, and four extra controls under a number box is clutter
 * on a form that already asks for a lot.
 *
 * Still pre-filled with what we would have charged, because that part matters:
 * someone who has never priced a delivery, facing an empty box, guesses either
 * below what any rider will take or well above what the job is worth. The
 * suggestion is the default, not a placeholder.
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
  /** Why the suggestion is what it is — e.g. the parcel size. */
  hint?: string;
}) {
  const amount = Number(value.replace(/[^\d]/g, '')) || 0;
  const tooLow = amount > 0 && amount < MIN_OFFER_NAIRA;

  return (
    <View>
      <Input
        label="Estimated rider fee"
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
    </View>
  );
}

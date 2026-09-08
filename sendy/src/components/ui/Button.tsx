import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { colors, shadow } from '@/lib/theme';

/**
 * `danger` is deliberately its own variant rather than a className override on
 * `primary`. A button that closes an account should not carry the same colour
 * as the one that places an order — the affordance is the warning.
 */
type Variant = 'primary' | 'secondary' | 'text' | 'danger';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconRight?: keyof typeof Ionicons.glyphMap;
  /** Right-aligned value, e.g. the order total on a sticky CTA. */
  trailing?: string;
  className?: string;
};

/** Sendy Errands button — design.md §9. One filled-pink primary per screen. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
  icon,
  iconRight,
  trailing,
  className = '',
}: Props) {
  const container: Record<Variant, string> = {
    primary: 'bg-pink-600 active:bg-pink-700',
    secondary: 'bg-white border-[1.5px] border-pink-600 active:bg-pink-50',
    text: 'bg-transparent',
    danger: 'bg-error active:opacity-90',
  };
  const label: Record<Variant, string> = {
    primary: 'text-white',
    secondary: 'text-pink-600',
    text: 'text-pink-600',
    danger: 'text-white',
  };
  const tint = variant === 'primary' || variant === 'danger' ? colors.white : colors.pink[600];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={
        (variant === 'primary' || variant === 'danger') && !disabled ? shadow.card : undefined
      }
      className={[
        'h-[52px] rounded-full flex-row items-center justify-center px-6',
        fullWidth ? 'w-full' : '',
        container[variant],
        disabled ? 'opacity-40' : '',
        className,
      ].join(' ')}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={tint} style={{ marginRight: 8 }} /> : null}
          <Text className={`text-[15px] font-semibold ${label[variant]}`}>{title}</Text>
          {iconRight ? (
            <Ionicons name={iconRight} size={18} color={tint} style={{ marginLeft: 8 }} />
          ) : null}
          {trailing ? (
            <>
              <View className="flex-1" />
              <Text className={`text-[15px] font-bold ${label[variant]}`}>{trailing}</Text>
            </>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

/** 40–44px circular icon button on `surface` fill. */
export function IconButton({
  icon,
  onPress,
  size = 40,
  color = colors.ink,
  tone = 'surface',
  badge = false,
  className = '',
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  size?: number;
  color?: string;
  tone?: 'surface' | 'white' | 'pink';
  badge?: boolean;
  className?: string;
  accessibilityLabel?: string;
}) {
  const bg = tone === 'pink' ? 'bg-pink-600' : tone === 'white' ? 'bg-white' : 'bg-surface';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? icon}
      style={[{ width: size, height: size }, tone === 'white' ? shadow.card : undefined]}
      className={`${bg} rounded-full items-center justify-center ${className}`}
    >
      <Ionicons name={icon} size={size * 0.5} color={tone === 'pink' ? colors.white : color} />
      {badge ? (
        <View className="absolute top-2 right-2 w-2 h-2 rounded-full bg-pink-600 border border-white" />
      ) : null}
    </Pressable>
  );
}

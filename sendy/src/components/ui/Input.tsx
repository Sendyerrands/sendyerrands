import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/lib/theme';

/** Labelled input — `surface` fill, 52 high, pink focus ring (design.md §9). */
export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  helper,
  error,
  icon,
  prefix,
  suffix,
  keyboardType = 'default',
  autoFocus = false,
  multiline = false,
  secureTextEntry = false,
  autoCapitalize,
  autoComplete,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  helper?: string;
  error?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  prefix?: string;
  /** Trailing unit, e.g. "kg". The mirror of `prefix`, which already held "₦". */
  suffix?: string;
  /** 'decimal-pad' included because a weight is not a whole number — 'number-pad'
   *  has no decimal point on iOS, which makes "2.5 kg" untypeable. */
  keyboardType?: 'default' | 'phone-pad' | 'number-pad' | 'decimal-pad' | 'email-address';
  autoFocus?: boolean;
  multiline?: boolean;
  /** Renders a reveal toggle alongside the mask. */
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** Lets the OS password manager offer to fill and to save. */
  autoComplete?: 'email' | 'current-password' | 'new-password' | 'tel' | 'name' | 'off';
}) {
  const [focused, setFocused] = useState(false);

  /**
   * Password fields get a reveal toggle rather than a mask alone.
   *
   * The policy in the API asks for ten characters and rejects the obvious ones,
   * which means people type something long on a phone keyboard where the shift
   * state is invisible and every character is a dot. Without a way to look,
   * the failure mode is a confident sign-in attempt against a typo — and on the
   * signup screen, an account created with a password nobody can reproduce.
   */
  const [revealed, setRevealed] = useState(false);
  const masked = secureTextEntry && !revealed;
  const borderClass = error
    ? 'border-error'
    : focused
      ? 'border-pink-600'
      : 'border-transparent';

  return (
    <View className="mb-4">
      {label ? <Text className="text-body text-[15px] mb-2">{label}</Text> : null}
      <View
        className={`flex-row items-center bg-surface rounded-md border-[1.5px] px-4 ${borderClass} ${
          multiline ? 'h-[104px] py-3 items-start' : 'h-[52px]'
        }`}
      >
        {icon ? (
          <Ionicons name={icon} size={18} color={colors.muted} style={{ marginRight: 10 }} />
        ) : null}
        {prefix ? <Text className="text-ink text-[15px] mr-2">{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          multiline={multiline}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={masked}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          className="flex-1 text-ink text-[15px]"
          style={{ outlineStyle: 'none' } as never}
        />
        {/* After the field, before the reveal toggle: a unit belongs next to
            the number, and a password field has no unit to show. */}
        {suffix ? <Text className="text-muted text-[15px] ml-2">{suffix}</Text> : null}
        {secureTextEntry ? (
          <Pressable
            onPress={() => setRevealed((r) => !r)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={8}
            className="pl-2"
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={19} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text className="text-error text-[13px] mt-1.5">{error}</Text>
      ) : helper ? (
        <Text className="text-muted text-[13px] mt-1.5">{helper}</Text>
      ) : null}
    </View>
  );
}

/** Tappable field that opens a picker/sheet — used for addresses, dates. */
export function SelectField({
  label,
  value,
  icon,
  onPress,
  placeholder,
}: {
  label?: string;
  value?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  placeholder?: string;
}) {
  return (
    <View className="mb-4">
      {label ? <Text className="text-body text-[15px] mb-2">{label}</Text> : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        className="flex-row items-center bg-surface rounded-md h-[52px] px-4 active:bg-hairline"
      >
        {icon ? (
          <View className="w-7 h-7 rounded-full bg-white items-center justify-center mr-3">
            <Ionicons name={icon} size={15} color={colors.pink[600]} />
          </View>
        ) : null}
        <Text className={`flex-1 text-[15px] ${value ? 'text-ink' : 'text-muted'}`} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}

/** 6-box segmented OTP entry (design.md §9). */
export function OtpBoxes({
  length = 6,
  value,
  onChange,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(true);
  const chars = value.split('');

  return (
    <Pressable onPress={() => ref.current?.focus()} className="flex-row">
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="absolute w-full h-full opacity-0"
        style={{ outlineStyle: 'none' } as never}
      />
      {Array.from({ length }).map((_, i) => {
        const active = focused && i === chars.length;
        return (
          <View
            key={i}
            className={`w-[52px] h-[60px] rounded-md border-[1.5px] items-center justify-center mr-2.5 ${
              active ? 'border-pink-600 bg-white' : chars[i] ? 'border-hairline bg-white' : 'border-hairline bg-white'
            }`}
          >
            {chars[i] ? (
              <Text className="text-ink text-[24px] font-bold">{chars[i]}</Text>
            ) : active ? (
              <View className="w-[2px] h-6 bg-pink-600" />
            ) : null}
          </View>
        );
      })}
    </Pressable>
  );
}

import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader, StickyBar } from '@/components/ui/Screen';
import { ApiError } from '@/lib/api/client';
import { authApi, type Actor } from '@/lib/api/endpoints';
import { suggestEmail } from '@/lib/email-suggest';
import { useApp } from '@/store/app';

/**
 * Request a reset code.
 *
 * The API answers identically whether or not the address is registered, so that
 * this cannot be used to find out who banks with Sendy Errands. The screen has
 * to hold that line too: it says a code was sent *if* an account exists, and
 * never "no account found" — which would leak exactly what the endpoint spent
 * the effort hiding.
 */
export default function ForgotPassword() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const actor: Actor = role === 'rider' ? 'rider' : role === 'vendor' ? 'vendor' : 'customer';

  const { email, setEmail } = useApp();
  const [error, setError] = useState<string | null>(null);

  /**
   * A typo here is the quietest failure in the system: the endpoint answers
   * identically whether or not the address has an account — deliberately, so
   * it cannot be used to discover who has one — so a mistyped domain produces
   * a confident "check your email" for a message that was never sent.
   */
  const emailFix = suggestEmail(email.trim());

  const request = useMutation({
    mutationFn: () => authApi.forgotPassword(email.trim(), actor),
    onSuccess: (result) =>
      router.push({
        pathname: '/reset-password',
        // devCode only exists when the API is in OTP_DEV_MODE; it lets the flow
        // be exercised without an email provider configured.
        params: { role: actor, ...(result.devCode ? { devCode: result.devCode } : {}) },
      }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not send a code. Try again.'),
  });

  return (
    <Screen>
      <ScreenHeader title="Forgot password" />

      <View className="px-4 pt-4">
        <Text className="text-ink text-[28px] font-display leading-[34px]">Reset your password</Text>
        <Text className="text-body text-[15px] mt-2.5 mb-8 leading-[22px]">
          Enter your email and we’ll send you a 6-digit code.
        </Text>

        <Input
          label="Email"
          value={email}
          onChangeText={(v) => {
            setError(null);
            setEmail(v);
          }}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          autoFocus
        />
        {emailFix ? (
          /* Suggested, never applied for them. An address that genuinely is
             unusual has to survive this screen untouched. */
          <Pressable
            onPress={() => setEmail(emailFix)}
            accessibilityRole="button"
            accessibilityLabel={`Use ${emailFix} instead`}
            className="flex-row flex-wrap items-center mt-2"
          >
            <Text className="text-body text-[13px]">Did you mean </Text>
            <Text className="text-pink-600 text-[13px] font-bold underline">{emailFix}</Text>
            <Text className="text-body text-[13px]">?</Text>
          </Pressable>
        ) : null}

        {error ? <Text className="text-error text-[13px]">{error}</Text> : null}
      </View>

      <StickyBar>
        <Button
          title="Send code"
          disabled={email.trim().length < 4}
          loading={request.isPending}
          onPress={() => {
            setError(null);
            request.mutate();
          }}
        />
      </StickyBar>
    </Screen>
  );
}

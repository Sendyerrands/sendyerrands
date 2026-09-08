import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Card } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { ApiError } from '@/lib/api/client';
import { useDeleteAccount } from '@/lib/api/hooks';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/**
 * Closing the account.
 *
 * Required by Google Play: an app that lets people create an account must let
 * them delete it from inside the app, not only by emailing support. The web
 * half, for people who have already uninstalled, is at
 * sendyerrands.com/delete-account.html.
 *
 * Its own screen rather than a dialog, for two reasons. What is kept and what
 * is removed does not fit in an alert, and putting it behind a deliberate
 * navigation plus a typed password means nobody arrives here by mistake.
 */
export default function DeleteAccount() {
  const router = useRouter();
  const { signOut, user } = useApp();
  const del = useDeleteAccount();

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = () => {
    setError(null);

    del.mutate(password, {
      onSuccess: async () => {
        /**
         * Confirm first, then sign out.
         *
         * Signing out immediately would swap the tree to the signed-out state
         * mid-render and the person would never learn whether it worked — the
         * app would simply forget them, which is exactly what a failure looks
         * like too.
         */
        setDone(true);
        await signOut();
      },
      onError: (err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not close the account. Check your connection and try again.'
        ),
    });
  };

  if (done) {
    return (
      <Screen>
        <ScreenHeader title="Account closed" />
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="checkmark-circle" size={44} color={colors.success} />
          <Text className="text-ink text-[19px] font-semibold mt-4 text-center">
            Your account is closed
          </Text>
          <Text className="text-body text-[15px] mt-2 text-center leading-[22px]">
            Your name, contact details and saved addresses have been removed. Thank you for using
            Sendy Errands.
          </Text>
          <View className="h-6" />
          <Button title="Done" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Delete account" />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-start bg-error/10 rounded-md p-3.5 mb-5">
          <Ionicons name="warning-outline" size={18} color={colors.error} />
          <Text className="text-error text-[13px] ml-2.5 flex-1 leading-[19px]">
            This cannot be undone. You will need to create a new account to use Sendy Errands again.
          </Text>
        </View>

        <Text className="text-ink text-[15px] font-semibold mb-2">What we remove</Text>
        <Card className="p-4 mb-5">
          {[
            'Your name, email address and phone number',
            'Your saved delivery addresses',
            'Your saved vendors',
            'Your password and invite code',
          ].map((line) => (
            <View key={line} className="flex-row items-start mb-2 last:mb-0">
              <Ionicons name="close-circle-outline" size={15} color={colors.body} />
              <Text className="text-body text-[13px] ml-2 flex-1 leading-[19px]">{line}</Text>
            </View>
          ))}
        </Card>

        {/*
          Said plainly rather than buried in the policy. Someone deleting an
          account to remove their data deserves to know before they press the
          button that the order history does not go with it — finding out
          afterwards is the version that feels like a broken promise.
        */}
        <Text className="text-ink text-[15px] font-semibold mb-2">What we have to keep</Text>
        <Card className="p-4 mb-5">
          <Text className="text-body text-[13px] leading-[19px]">
            Records of orders and payments stay in our accounts, because we are required to keep
            them for tax and for disputes raised later. They stop being linked to you and are not
            used to contact you.
          </Text>
        </Card>

        <Input
          label="Confirm your password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          secureTextEntry
          autoCapitalize="none"
          helper={user?.email ? `Signed in as ${user.email}` : undefined}
        />

        {error ? <Text className="text-error text-[13px] mb-3">{error}</Text> : null}

        <Button
          title={del.isPending ? 'Closing…' : 'Delete my account'}
          variant="danger"
          disabled={!password || del.isPending}
          loading={del.isPending}
          onPress={submit}
        />

        <View className="h-3" />
        <Button title="Keep my account" variant="text" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

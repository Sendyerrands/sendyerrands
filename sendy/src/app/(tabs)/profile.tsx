import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';

import { Card, ListRow } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { koboToNaira } from '@/lib/api/mappers';
import { naira } from '@/lib/format';
import { legal, links } from '@/lib/links';
import { openInApp } from '@/lib/open-in-app';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/**
 * The share sheet on a phone, the clipboard on web.
 *
 * React Native Web does not implement Share — it throws rather than degrading —
 * so the split is required, not defensive. The button's label follows it, since
 * "Share" over something that silently copies is the same small lie as a button
 * that does nothing.
 */
async function shareCode(code: string) {
  // No site URL any more — the code alone is what someone needs to type in.
  const message = `Use my Sendy Errands invite code ${code} when you sign up on Sendy Errands.`;

  try {
    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(message);
    } else {
      await Share.share({ message });
    }
  } catch {
    // Dismissing the sheet rejects on iOS. That is a choice, not a failure.
  }
}

/** Profile (design.md §10) — wallet, addresses, payment, settings, referrals. */
export default function Profile() {
  const router = useRouter();
  const { signOut, addresses, user, signedIn } = useApp();
  const fullName = user ? user.firstName + ' ' + user.lastName : 'Your profile';
  const initials = user ? (user.firstName[0] + user.lastName[0]).toUpperCase() : '–';
  const walletBalance = koboToNaira(user?.walletBalanceKobo);

  /**
   * Signed out is a real state, not an empty version of the signed-in one.
   *
   * This screen used to render regardless: "Your profile" over a dash for
   * initials, a ₦0 wallet that opened a screen requiring a token, a referral
   * code showing "—" with a Share button beside it, and — at the bottom — Log
   * out, offered to someone who was not logged in. Every one of those is a
   * control that cannot work, and together they read as a broken account rather
   * than an absent one.
   *
   * Browsing without an account is deliberately still allowed: vendors, search
   * and help all work, and the ordering screens ask for sign-in at the point
   * they actually need it. This is the one place that has to say so plainly and
   * offer the way in.
   */
  if (!signedIn) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <View className="px-4 py-3">
            <Text className="text-ink text-[24px] font-display">Profile</Text>
          </View>

          <View className="px-4">
            <Card className="p-5 items-center">
              <View className="w-16 h-16 rounded-full bg-pink-50 items-center justify-center">
                <Ionicons name="person-outline" size={28} color={colors.pink[600]} />
              </View>
              <Text className="text-ink text-[18px] font-semibold mt-4">You&apos;re not signed in</Text>
              <Text className="text-body text-[14px] mt-2 mb-5 text-center leading-[20px]">
                Sign in to place orders, track deliveries and use your wallet.
              </Text>
              <Button title="Sign in" onPress={() => router.push('/signin')} />
              <Pressable
                onPress={() => router.push('/signup')}
                accessibilityRole="button"
                className="mt-3 py-2"
              >
                <Text className="text-pink-600 text-[15px] font-semibold">Create an account</Text>
              </Pressable>
            </Card>
          </View>

          {/* Both gates explain themselves to anyone who is not that kind of
              account, so they are safe to offer while signed out. */}
          <Text className="text-muted text-[13px] font-semibold px-4 mt-7 mb-2">MORE</Text>
          <Card className="mx-4 overflow-hidden">
            <ListRow icon="bicycle-outline" label="Sign in as a rider" onPress={() => router.push('/rider')} />
            <ListRow
              icon="business-outline"
              label="Vendor dashboard"
              onPress={() => router.push('/vendor-app')}
            />
            <ListRow icon="headset-outline" label="Help & support" last onPress={() => router.push('/help')} />
          </Card>

          <Text
            onPress={() => router.push('/diagnostics')}
            accessibilityRole="button"
            className="text-muted text-[11px] text-center mt-7"
          >
            Sendy Errands {Constants.expoConfig?.version ?? ''} · Diagnostics
          </Text>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <View className="px-4 py-3">
          <Text className="text-ink text-[24px] font-display">Profile</Text>
        </View>

        {/* identity */}
        <View className="flex-row items-center px-4 pb-5">
          <View className="w-16 h-16 rounded-full bg-pink-100 items-center justify-center">
            <Text className="text-pink-700 text-[20px] font-bold">{initials}</Text>
          </View>
          <View className="flex-1 ml-4">
            <Text className="text-ink text-[20px] font-bold">{fullName}</Text>
            <Text className="text-muted text-[13px] mt-0.5">{user?.phone ?? ''}</Text>
          </View>
          {/* The edit pencil is gone. The name on an account is what appears on
              every order, handover and payout record, so it is deliberately not
              editable in-app — and a control that opens nothing is worse than
              no control, because it reads as a broken feature rather than an
              absent one. */}
        </View>

        {/* wallet */}
        <View className="px-4">
          <Pressable onPress={() => router.push('/wallet')} accessibilityRole="button">
            <LinearGradient
              colors={[colors.pink[600], colors.pink[900]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 16, padding: 18 }}
            >
              <View className="flex-row items-center">
                <Text className="text-white/80 text-[13px] flex-1">Sendy Errands Wallet</Text>
                <Ionicons name="arrow-forward-circle" size={22} color="rgba(255,255,255,0.9)" />
              </View>
              <Text className="text-white text-[30px] font-bold mt-1.5">
                {naira(walletBalance)}
              </Text>
              <View className="flex-row items-center mt-3">
                <View className="bg-white/20 rounded-full px-3 py-1.5 flex-row items-center">
                  <Ionicons name="gift-outline" size={13} color={colors.white} />
                  <Text className="text-white text-[11px] font-semibold ml-1.5">
                    Sendy Errands Wallet
                  </Text>
                </View>
              </View>
            </LinearGradient>
          </Pressable>
        </View>

        {/*
          referral

          This said "Invite friends, earn ₦1,000" over a Share button with no
          onPress. Neither half was true: nothing reads referredByCode after
          registration stores it, so no reward has ever been paid, and the
          button did nothing at all.

          Paying the reward safely is a bigger job than the reward is worth
          right now — with no device or identity checks, ₦1,000 a signup is free
          money for anyone who can make email addresses, and it would be drawn
          against a real Paystack balance. So the claim is gone until the
          controls exist, and what remains is the part that genuinely works:
          the code is real, it is recorded against whoever signs up with it, and
          it can now actually be shared.
        */}
        {user?.referralCode ? (
          <View className="px-4 mt-4">
            <Card className="flex-row items-center p-4">
              <View className="w-10 h-10 rounded-full bg-pink-50 items-center justify-center mr-3">
                <Ionicons name="people-outline" size={19} color={colors.pink[600]} />
              </View>
              <View className="flex-1">
                <Text className="text-ink text-[15px] font-semibold">Your invite code</Text>
                <Text className="text-muted text-[13px] mt-0.5">{user.referralCode}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share your invite code"
                onPress={() => shareCode(user.referralCode)}
                className="bg-pink-50 rounded-full px-4 py-2 active:bg-pink-100"
              >
                <Text className="text-pink-700 text-[13px] font-semibold">
                  {Platform.OS === 'web' ? 'Copy' : 'Share'}
                </Text>
              </Pressable>
            </Card>
          </View>
        ) : null}

        {/* account */}
        <Text className="text-muted text-[13px] font-semibold px-4 mt-7 mb-2">ACCOUNT</Text>
        <Card className="mx-4 overflow-hidden">
          <ListRow
            icon="location-outline"
            label="Saved addresses"
            value={`${addresses.length}`}
            onPress={() => router.push('/addresses')}
          />
          {/* "Payment methods · 2 cards" used to sit here. There were no cards:
              Sendy Errands never stores them, Paystack collects them per
              payment and we only keep the reference. A row promising a card
              wallet we do not have, opening nothing, was worse than its
              absence — the Wallet above is the one payment method there is
              anything to manage. */}
          <ListRow icon="receipt-outline" label="Order history" onPress={() => router.push('/(tabs)/orders')} />
          <ListRow
            icon="heart-outline"
            label="Favourites"
            last
            onPress={() => router.push('/favourites')}
          />
        </Card>

        {/* PREFERENCES held Notifications, Language and Privacy & security.
            All three were labels with chevrons and no destination: push is not
            enabled, there is one language, and nothing sits behind privacy yet.
            They come back when they lead somewhere. */}

        <Text className="text-muted text-[13px] font-semibold px-4 mt-6 mb-2">MORE</Text>
        <Card className="mx-4 overflow-hidden">
          <ListRow icon="bicycle-outline" label="Switch to rider app" onPress={() => router.push('/rider')} />
          <ListRow
            icon="storefront-outline"
            label="Become a vendor"
            onPress={() => router.push('/become-vendor')}
          />
          {/* Shown to everyone rather than gated on being a vendor: the app has
              no way to know until it tries, and the vendor gate explains itself
              to anyone who is not one. */}
          <ListRow
            icon="business-outline"
            label="Vendor dashboard"
            onPress={() => router.push('/vendor-app')}
          />
          <ListRow
            icon="lock-closed-outline"
            label="Change password"
            onPress={() => router.push('/change-password')}
          />
          <ListRow icon="headset-outline" label="Help & support" onPress={() => router.push('/help')} />
          <ListRow icon="log-out-outline" label="Log out" danger last onPress={async () => { await signOut(); router.replace('/'); }} />
        </Card>

        {/* Legal has to be reachable from inside the app, not only from the
            Play listing — someone deciding whether to trust us with an address
            and a card is doing it here, not in the store.

            These open in an in-app browser rather than handing off to Chrome,
            so reading the policy does not mean leaving Sendy and finding your
            way back. Each row is hidden until its URL exists: a link that opens
            a blank sheet is worse than no link. */}
        <Text className="text-muted text-[13px] font-semibold mt-6 mb-2.5 px-1">LEGAL</Text>
        <Card>
          {legal.privacy ? (
            <ListRow
              icon="shield-checkmark-outline"
              label="Privacy Policy"
              onPress={() => void openInApp(legal.privacy)}
            />
          ) : null}
          {legal.terms ? (
            <ListRow
              icon="document-text-outline"
              label="Terms &amp; Conditions"
              onPress={() => void openInApp(legal.terms)}
            />
          ) : null}
          {/* Play requires this to be reachable in the app, not only by
              emailing support. It is a real screen rather than a web page, so
              it works whatever happens to the website. */}
          <ListRow
            icon="trash-outline"
            label="Delete account"
            danger
            last
            onPress={() => router.push('/delete-account')}
          />
        </Card>

        {/* Was a hardcoded "v1.0.0 (MVP)" — the same string in every build ever
            shipped, so no bug report could establish what the reporter was
            running. Diagnostics reads it from the running build instead. */}
        <Text
          onPress={() => router.push('/diagnostics')}
          accessibilityRole="button"
          className="text-muted text-[11px] text-center mt-7"
        >
          Sendy Errands {Constants.expoConfig?.version ?? ''} · Diagnostics
        </Text>
      </ScrollView>
    </Screen>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader, StickyBar } from '@/components/ui/Screen';
import { ApiError } from '@/lib/api/client';
import { useApplyAsProvider, useProviderApplications } from '@/lib/api/hooks';
import { colors } from '@/lib/theme';

/**
 * Apply to offer a service.
 *
 * Mirrors become-vendor: a provider is onboarded exactly as a vendor is. They
 * apply, ops reviews, and approval creates the listing. Nobody self-registers
 * into a listing customers will be asked to let into their home.
 *
 * The form asks only what a human needs to decide "should we call these people
 * back". Arrival fees and verification are set by ops on approval — an
 * applicant cannot meaningfully price those yet, and asking would cost
 * completions on a form whose whole purpose is low friction.
 */
export default function BecomeProvider() {
  const router = useRouter();
  const apply = useApplyAsProvider();
  const { data: applications = [] } = useProviderApplications();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [area, setArea] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
  const [canBike, setCanBike] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pending = applications.find((a) => a.status === 'PENDING');
  const rejected = applications.find((a) => a.status === 'REJECTED');
  const approved = applications.find((a) => a.status === 'APPROVED');

  const valid =
    name.trim().length >= 2 &&
    category.trim().length >= 2 &&
    area.trim().length >= 2 &&
    phone.trim().length >= 10;

  const submit = () => {
    if (!valid) return;
    setError(null);
    apply.mutate(
      {
        name: name.trim(),
        category: category.trim(),
        area: area.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        bio: bio.trim() || undefined,
        canTravelByBike: canBike,
      },
      {
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : 'Could not send that application.'),
      }
    );
  };

  /* An applicant with something already in should see where it stands rather
     than an empty form inviting a duplicate the API would refuse. */
  if (approved) {
    return (
      <Screen>
        <ScreenHeader onBack={() => router.back()} title="Offer a service" />
        <View className="px-4">
          <Card className="p-4">
            <View className="flex-row items-center">
              <Ionicons name="checkmark-circle" size={19} color={colors.success} />
              <Text className="text-ink text-[16px] font-semibold ml-2">You&apos;re approved</Text>
            </View>
            <Text className="text-body text-[14px] mt-2 leading-[20px]">
              {approved.name} is set up. Sign in with your provider account to see your jobs — if
              you have not set a password yet, contact support and we will do it with you.
            </Text>
            <View className="h-3" />
            <Button
              title="Go to provider sign in"
              onPress={() => router.replace({ pathname: '/signin', params: { role: 'provider' } })}
            />
          </Card>
        </View>
      </Screen>
    );
  }

  if (pending || apply.isSuccess) {
    return (
      <Screen>
        <ScreenHeader onBack={() => router.back()} title="Offer a service" />
        <View className="px-4">
          <Card className="p-4">
            <View className="flex-row items-center">
              <Ionicons name="time-outline" size={19} color={colors.body} />
              <Text className="text-ink text-[16px] font-semibold ml-2">With us now</Text>
            </View>
            <Text className="text-body text-[14px] mt-2 leading-[20px]">
              We have your application{pending ? ` for ${pending.name}` : ''}. Someone will call
              the number you gave to go through it. One application at a time, so there is nothing
              else to do here.
            </Text>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader onBack={() => router.back()} title="Offer a service" />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-ink text-[22px] font-display leading-[28px]">
          Get booked for work near you
        </Text>
        <Text className="text-body text-[14px] mt-2 mb-6 leading-[20px]">
          Barbers, cleaners, electricians, plumbers, stylists. Customers tell you what they need,
          you set the price once you have seen it, and they pay you directly.
        </Text>

        {/* The reason, where a rejected applicant will actually look. */}
        {rejected?.note ? (
          <View className="flex-row items-start bg-surface rounded-md p-3.5 mb-5">
            <Ionicons name="information-circle-outline" size={17} color={colors.body} />
            <Text className="text-body text-[13px] ml-2.5 flex-1 leading-[18px]">
              Your last application was not approved: {rejected.note}
            </Text>
          </View>
        ) : null}

        <Input
          label="What do you trade as?"
          value={name}
          onChangeText={(v) => {
            setError(null);
            setName(v);
          }}
          placeholder="Kay Cuts"
        />
        <Input
          label="What do you do?"
          value={category}
          onChangeText={setCategory}
          placeholder="Barber, Cleaning, Plumbing…"
        />
        <Input
          label="Which area do you work in?"
          value={area}
          onChangeText={setArea}
          placeholder="Lekki Phase 1"
        />
        <Input
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="08031234567"
          keyboardType="phone-pad"
          helper="This becomes how you sign in once you are approved, so use a number you keep."
        />
        <Input
          label="Email (optional)"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Input
          label="Tell customers about your work (optional)"
          value={bio}
          onChangeText={setBio}
          placeholder="Fades, beard trims, kids cuts. I bring my own clippers."
        />

        {/*
          Asked here rather than assumed, because it decides which arrival
          options a customer is ever shown. A cleaner with a vacuum or a plumber
          with pipe cannot ride, and offering them at the bike price would be
          selling something that cannot happen.
        */}
        <Text className="text-ink text-[15px] font-semibold mt-5 mb-2">How do you travel?</Text>
        <Pressable
          onPress={() => setCanBike(true)}
          accessibilityRole="radio"
          accessibilityState={{ selected: canBike }}
          className={`flex-row items-center rounded-md p-3.5 mb-2.5 border ${
            canBike ? 'border-pink-600 bg-pink-50' : 'border-hairline bg-white'
          }`}
        >
          <Ionicons name="bicycle-outline" size={19} color={canBike ? colors.pink[600] : colors.body} />
          <Text className="text-ink text-[14.5px] ml-3 flex-1">
            Bike or car — my tools travel light
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setCanBike(false)}
          accessibilityRole="radio"
          accessibilityState={{ selected: !canBike }}
          className={`flex-row items-center rounded-md p-3.5 border ${
            !canBike ? 'border-pink-600 bg-pink-50' : 'border-hairline bg-white'
          }`}
        >
          <Ionicons name="car-outline" size={19} color={!canBike ? colors.pink[600] : colors.body} />
          <Text className="text-ink text-[14.5px] ml-3 flex-1">
            Car only — I carry equipment
          </Text>
        </Pressable>

        {error ? <Text className="text-error text-[13px] mt-4">{error}</Text> : null}

        <Text className="text-muted text-[12.5px] mt-5 leading-[18px]">
          We review every application and call to confirm before anything goes live. Your arrival
          fees are set with you at that point.
        </Text>
      </ScrollView>

      <StickyBar>
        <Button
          title={apply.isPending ? 'Sending…' : 'Send application'}
          loading={apply.isPending}
          disabled={!valid || apply.isPending}
          onPress={submit}
        />
      </StickyBar>
    </Screen>
  );
}

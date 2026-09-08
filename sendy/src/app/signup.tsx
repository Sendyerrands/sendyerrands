import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Chip } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader, StickyBar } from '@/components/ui/Screen';
import { ApiError } from '@/lib/api/client';
import { authApi } from '@/lib/api/endpoints';
import { useApp } from '@/store/app';

/**
 * Create an account — one form.
 *
 * This replaces phone → OTP → profile-setup, which was three screens and two
 * round trips to create one account, and which had a genuinely awkward seam in
 * the middle: the OTP had to stay live across two verify calls so that the
 * second one could carry a name. None of that is needed when the credential is
 * something the person chooses.
 */
type Vehicle = 'MOTORBIKE' | 'BICYCLE' | 'TRICYCLE' | 'CAR' | 'VAN' | 'FOOT';

/** What dispatch can actually match on. Plates only exist for the motorised ones. */
const VEHICLES: { value: Vehicle; label: string }[] = [
  { value: 'MOTORBIKE', label: 'Motorbike' },
  { value: 'TRICYCLE', label: 'Keke' },
  { value: 'CAR', label: 'Car' },
  { value: 'VAN', label: 'Van' },
  { value: 'BICYCLE', label: 'Bicycle' },
  { value: 'FOOT', label: 'On foot' },
];

const PLATED: Vehicle[] = ['MOTORBIKE', 'TRICYCLE', 'CAR', 'VAN'];

/** Mirrors MIN_LENGTH in the API's lib/password.ts. */
const MIN_PASSWORD = 10;

export default function SignUp() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const asRider = role === 'rider';

  const { signIn, email, setEmail } = useApp();

  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [referral, setReferral] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle>('MOTORBIKE');
  const [plate, setPlate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const needsPlate = asRider && PLATED.includes(vehicle);
  const valid =
    first.trim().length > 1 &&
    last.trim().length > 1 &&
    email.trim().length > 3 &&
    phone.replace(/\D/g, '').length >= 10 &&
    password.length >= MIN_PASSWORD &&
    (!needsPlate || plate.trim().length >= 4);

  const register = useMutation({
    mutationFn: () =>
      authApi.register({
        email: email.trim(),
        password,
        firstName: first.trim(),
        lastName: last.trim(),
        phone: phone.trim(),
        role: asRider ? 'rider' : 'customer',
        // Referrals are a customer growth loop; riders have no equivalent.
        referredByCode: asRider ? undefined : referral.trim() || undefined,
        vehicleType: asRider ? vehicle : undefined,
        plateNumber: needsPlate ? plate.trim().toUpperCase() : undefined,
      }),
    onSuccess: async (session) => {
      await signIn(session.token, asRider ? 'rider' : 'customer');
      // The dashboard, not the verification wall: the server refuses job
      // acceptance for unapproved riders anyway, so there is nothing to protect
      // by locking them out of their own home screen.
      router.replace(asRider ? '/rider' : '/(tabs)/home');
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not create your account.'),
  });

  return (
    <Screen>
      <ScreenHeader title="Create account" />

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} className="px-4">
        <Text className="text-ink text-[28px] font-display leading-[34px] mt-3">
          {asRider ? <>Set up your{'\n'}rider account</> : <>Create your{'\n'}account</>}
        </Text>
        <Text className="text-body text-[15px] mt-2.5 mb-8 leading-[22px]">
          {asRider
            ? 'Customers see this name when you pick up and drop off. Verification comes next.'
            : 'Your rider uses this name and number at the door.'}
        </Text>

        <Input label="First name" value={first} onChangeText={setFirst} placeholder="Chinedu" autoCapitalize="words" autoComplete="name" autoFocus />
        <Input label="Last name" value={last} onChangeText={setLast} placeholder="Okafor" autoCapitalize="words" />
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          helper="You'll sign in with this."
        />
        <Input
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="0803 123 4567"
          keyboardType="phone-pad"
          autoComplete="tel"
          helper={asRider ? 'Customers call this number at the door.' : 'Your rider calls this at the door.'}
        />
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder={`At least ${MIN_PASSWORD} characters`}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          helper={
            password.length > 0 && password.length < MIN_PASSWORD
              ? `${MIN_PASSWORD - password.length} more character${MIN_PASSWORD - password.length === 1 ? '' : 's'}`
              : 'Length matters more than symbols. A few words you’ll remember beats P@ssw0rd.'
          }
        />

        {asRider ? (
          <>
            <Text className="text-body text-[15px] mb-2.5">What do you ride?</Text>
            <View className="flex-row flex-wrap mb-4">
              {VEHICLES.map((v) => (
                <View key={v.value} className="mb-2 mr-2">
                  <Chip label={v.label} selected={v.value === vehicle} onPress={() => setVehicle(v.value)} />
                </View>
              ))}
            </View>

            {/* A bicycle or a rider on foot has no plate to give. */}
            {needsPlate ? (
              <Input
                label="Plate number"
                value={plate}
                onChangeText={setPlate}
                placeholder="LND-482-GY"
                icon="car-outline"
                autoCapitalize="characters"
                helper="Customers use this to identify you at the door."
              />
            ) : null}
          </>
        ) : (
          <Input
            label="Referral code (optional)"
            value={referral}
            onChangeText={setReferral}
            placeholder="SENDY-XXXXX"
            autoCapitalize="characters"
            // Was "Get ₦1,000 off your first delivery." Nothing reads this code
            // after registration records it, so no discount has ever been
            // applied — the field worked, the promise attached to it did not.
            helper="If someone invited you, enter their code."
          />
        )}

        {error ? <Text className="text-error text-[13px]">{error}</Text> : null}

        <View className="flex-row items-center mt-2">
          <Text className="text-body text-[15px]">Already have an account?</Text>
          <Pressable
            onPress={() => router.replace({ pathname: '/signin', params: role ? { role } : {} })}
            accessibilityRole="button"
            className="ml-2"
          >
            <Text className="text-pink-600 text-[15px] font-semibold">Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>

      <StickyBar>
        <Button
          title={asRider ? 'Create account & get verified' : 'Create account'}
          disabled={!valid}
          loading={register.isPending}
          onPress={() => {
            setError(null);
            register.mutate();
          }}
        />
      </StickyBar>
    </Screen>
  );
}

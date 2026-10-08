import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Badge, Card, ListRow, Verified } from '@/components/ui/atoms';
import { Screen } from '@/components/ui/Screen';
import { useRiderMe } from '@/lib/api/hooks';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/** What each vehicle is called here — a tricycle is a keke to everyone who rides one. */
type RiderStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

/** One line of truth per status, so this card can never contradict the dashboard. */
const VERIFY_COPY: Record<RiderStatus, { title: string; body: string; badge: string }> = {
  PENDING: {
    title: 'Verification not started',
    body: 'Submit your documents to start accepting jobs.',
    badge: 'Pending',
  },
  IN_REVIEW: {
    title: 'Verification in review',
    body: 'We have your documents and are checking them.',
    badge: 'In review',
  },
  APPROVED: {
    title: 'Verification complete',
    body: 'ID, licence and guarantor approved.',
    badge: 'Active',
  },
  REJECTED: {
    title: 'Verification unsuccessful',
    body: 'Something did not check out. Open your documents to re-submit.',
    badge: 'Rejected',
  },
  SUSPENDED: {
    title: 'Account suspended',
    body: 'You cannot accept jobs right now. Contact rider support.',
    badge: 'Suspended',
  },
};

/** What each vehicle is called here — a tricycle is a keke to everyone who rides one. */
const VEHICLE_LABEL: Record<string, string> = {
  MOTORBIKE: 'Motorbike',
  BICYCLE: 'Bicycle',
  TRICYCLE: 'Keke',
  CAR: 'Car',
  VAN: 'Van',
  FOOT: 'On foot',
};

/** Rider profile — verification status, vehicle, documents, payout account. */
export default function RiderMe() {
  const router = useRouter();
  const { data: rider } = useRiderMe();
  const { signOut } = useApp();
  const status: RiderStatus = rider?.status ?? 'PENDING';
  const approved = status === 'APPROVED';
  const RIDER = {
    initials: rider ? (rider.firstName[0] + rider.lastName[0]).toUpperCase() : '–',
    name: rider ? rider.firstName + ' ' + rider.lastName : 'Rider',
    rating: rider?.rating ?? 5,
    plate: rider?.plateNumber ?? '—',
    zone: rider?.zone ?? '—',
  };
  const EARNINGS = { trips: rider?.completedJobs ?? 0 };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <View className="px-4 py-3">
          <Text className="text-ink text-[24px] font-display">Me</Text>
        </View>

        {/* identity */}
        <View className="flex-row items-center px-4 pb-5">
          <View className="w-16 h-16 rounded-full bg-pink-100 items-center justify-center">
            <Text className="text-pink-700 text-[20px] font-bold">{RIDER.initials}</Text>
          </View>
          <View className="flex-1 ml-4">
            <View className="flex-row items-center">
              <Text className="text-ink text-[20px] font-bold mr-1.5">{RIDER.name}</Text>
              <Verified size={17} />
            </View>
            <View className="flex-row items-center mt-1">
              <Ionicons name="star" size={13} color={colors.star} />
              <Text className="text-muted text-[13px] ml-1">
                {RIDER.rating} · {EARNINGS.trips} trips this week
              </Text>
            </View>
          </View>
        </View>

        {/*
          Driven by the rider's real status. This card used to say "Verification
          complete — ID, licence and guarantor approved" unconditionally, so an
          account that had submitted nothing was told it was fully approved,
          while the dashboard toggle refused to turn on. Two screens
          contradicting each other about the same fact.
        */}
        <View className="px-4">
          <Card className="flex-row items-center p-4">
            <View
              className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
                approved ? 'bg-success/10' : 'bg-pink-50'
              }`}
            >
              <Ionicons
                name={approved ? 'shield-checkmark' : 'shield-outline'}
                size={19}
                color={approved ? colors.success : colors.pink[600]}
              />
            </View>
            <View className="flex-1">
              <Text className="text-ink text-[15px] font-semibold">{VERIFY_COPY[status].title}</Text>
              <Text className="text-muted text-[13px] mt-0.5">{VERIFY_COPY[status].body}</Text>
            </View>
            <Badge label={VERIFY_COPY[status].badge} tone={approved ? 'success' : 'muted'} />
          </Card>
        </View>

        {/* vehicle */}
        <Text className="text-muted text-[13px] font-semibold px-4 mt-6 mb-2">VEHICLE</Text>
        <Card className="mx-4 overflow-hidden">
          <ListRow icon="bicycle-outline" label={VEHICLE_LABEL[rider?.vehicleType ?? 'MOTORBIKE']} value={RIDER.plate} />
          <ListRow icon="map-outline" label="Operating zone" value={RIDER.zone} last />
        </Card>

        {/* documents */}
        <Text className="text-muted text-[13px] font-semibold px-4 mt-6 mb-2">DOCUMENTS</Text>
        <Card className="mx-4 overflow-hidden">
          <ListRow
            icon="document-text-outline"
            label="Rider documents"
            value="3 approved"
            onPress={() => router.push('/rider-verify')}
          />
          <ListRow
            icon="card-outline"
            label="Payout account"
            value={
              rider?.bankAccountNo ? `${rider.bankName} ••${rider.bankAccountNo.slice(-4)}` : 'Not set'
            }
            last
            onPress={() => router.push('/rider/payout-account')}
          />
        </Card>

        {/* settings */}
        <Text className="text-muted text-[13px] font-semibold px-4 mt-6 mb-2">SETTINGS</Text>
        <Card className="mx-4 overflow-hidden">
          {/* "Job alerts · On" claimed a push notification that does not exist
              yet — the least helpful thing to be wrong about for someone
              waiting on work. It returns when notifications are actually sent. */}
          <ListRow
            icon="headset-outline"
            label="Rider support"
            onPress={() => router.push('/help')}
          />
          {/*
            Signs out on the way across. The app holds one session at a time and
            this is a rider token, so simply navigating to the customer tabs put
            the rider in an app where every authenticated call 403s — browsing
            looked fine until they opened Orders. Better to hand them the
            customer sign-in than a half-working app.
          */}
          <ListRow
            icon="swap-horizontal-outline"
            label="Switch to customer app"
            onPress={async () => {
              await signOut();
              router.replace('/signin');
            }}
          />
          {/*
            This only navigated to the splash and never cleared the session, so
            the stored token survived and the splash routed straight back into
            the rider app — logging out appeared to do nothing. Awaited, because
            signOut clears SecureStore and the query cache; navigating first
            races the splash against a token that is about to disappear.
          */}
          <ListRow
            icon="log-out-outline"
            label="Log out"
            danger
            last
            onPress={async () => {
              await signOut();
              // '/signin', not '/' — the splash holds 2.8s and then routes by
              // `signedIn`, so logging out replayed the startup animation and a
              // tap during it could land back in the rider app.
              router.replace('/signin');
            }}
          />
        </Card>

        <Text className="text-muted text-[11px] text-center mt-7">Sendy Errands Rider v1.0.0 (MVP)</Text>
      </ScrollView>
    </Screen>
  );
}

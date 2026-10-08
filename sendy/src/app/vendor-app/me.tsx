import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Badge, Card, ListRow, Verified } from '@/components/ui/atoms';
import { Screen } from '@/components/ui/Screen';
import { useVendorMe } from '@/lib/api/hooks';
import { naira } from '@/lib/format';
import { koboToNaira } from '@/lib/api/mappers';
import { colors } from '@/lib/theme';
import { useApp } from '@/store/app';

/** Vendor profile — verification, shop details, sign out. */
export default function VendorMe() {
  const router = useRouter();
  const { data: vendor } = useVendorMe();
  const { signOut } = useApp();

  const verified = vendor?.isVerified ?? false;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <View className="px-4 py-3">
          <Text className="text-ink text-[24px] font-display">Me</Text>
        </View>

        <View className="flex-row items-center px-4 pb-5">
          <View className="w-16 h-16 rounded-full bg-pink-100 items-center justify-center">
            <Ionicons name="storefront" size={26} color={colors.pink[700]} />
          </View>
          <View className="flex-1 ml-4">
            <View className="flex-row items-center">
              <Text className="text-ink text-[20px] font-bold mr-1.5" numberOfLines={1}>
                {vendor?.name ?? 'Your shop'}
              </Text>
              {verified ? <Verified size={17} /> : null}
            </View>
            <Text className="text-muted text-[13px] mt-0.5">{vendor?.phone ?? '—'}</Text>
          </View>
        </View>

        <View className="px-4">
          <Card className="flex-row items-center p-4">
            <View
              className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
                verified ? 'bg-success/10' : 'bg-pink-50'
              }`}
            >
              <Ionicons
                name={verified ? 'shield-checkmark' : 'shield-outline'}
                size={19}
                color={verified ? colors.success : colors.pink[600]}
              />
            </View>
            <View className="flex-1">
              <Text className="text-ink text-[15px] font-semibold">
                {verified ? 'Verified business' : 'Awaiting verification'}
              </Text>
              <Text className="text-muted text-[13px] mt-0.5">
                {verified
                  ? 'Customers can find and order from you.'
                  : 'Sendy Errands is reviewing your business details.'}
              </Text>
            </View>
            <Badge label={verified ? 'Live' : 'Pending'} tone={verified ? 'success' : 'muted'} />
          </Card>
        </View>

        <Text className="text-muted text-[13px] font-semibold px-4 mt-6 mb-2">SHOP</Text>
        <Card className="mx-4 overflow-hidden">
          <ListRow
            icon="pricetags-outline"
            label="Listings"
            value={`${vendor?._count.products ?? 0}`}
            onPress={() => router.push('/vendor-app/listings')}
          />
          <ListRow icon="location-outline" label="Area" value={vendor?.area ?? '—'} />
          <ListRow
            icon="cash-outline"
            label="Sales today"
            value={naira(koboToNaira(vendor?.today.salesKobo))}
            last
          />
        </Card>

        <Text className="text-muted text-[13px] font-semibold px-4 mt-6 mb-2">SETTINGS</Text>
        <Card className="mx-4 overflow-hidden">
          <ListRow icon="headset-outline" label="Vendor support" onPress={() => router.push('/help')} />
          {/*
            Signs out on the way across: the app holds one session at a time and
            this is a vendor token, so simply navigating to the customer tabs
            would 403 on everything that needs an account.
          */}
          <ListRow
            icon="swap-horizontal-outline"
            label="Switch to customer app"
            onPress={async () => {
              await signOut();
              router.replace('/signin');
            }}
          />
          <ListRow
            icon="log-out-outline"
            label="Log out"
            danger
            last
            onPress={async () => {
              await signOut();
              // '/signin', not the splash — see profile.tsx.
              router.replace('/signin');
            }}
          />
        </Card>

        <Text className="text-muted text-[11px] text-center mt-7">Sendy Errands Vendor v1.0.0 (MVP)</Text>
      </ScrollView>
    </Screen>
  );
}

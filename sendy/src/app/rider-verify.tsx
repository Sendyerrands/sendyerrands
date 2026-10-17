import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Badge, Card, Divider } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Screen, ScreenHeader, StickyBar } from '@/components/ui/Screen';
import { useRiderMe } from '@/lib/api/hooks';
import { colors } from '@/lib/theme';

type DocState = 'approved' | 'review' | 'rejected' | 'missing';

/**
 * The five documents, and what each one is called in the database.
 *
 * This list used to carry a hardcoded `state` - NIN, licence and photo were
 * all set to 'approved' - so every rider who opened this screen was told they
 * were 60% verified and that their ID had been accepted, including an account
 * created a minute earlier that had uploaded nothing. The labels stay here
 * because they are copy; the state now comes from the rider's own record.
 */
const DOCS: { id: DocumentType; label: string; hint: string }[] = [
  { id: 'NIN', label: 'NIN slip or National ID', hint: 'Front side, all corners visible' },
  { id: 'LICENCE', label: "Rider's licence", hint: 'Must be valid for 3+ months' },
  { id: 'PHOTO', label: 'Passport photograph', hint: 'Plain background, no cap' },
  { id: 'VEHICLE_PAPERS', label: 'Vehicle papers', hint: 'Registration & proof of ownership' },
  { id: 'GUARANTOR_FORM', label: 'Guarantor form', hint: 'Signed, with a valid ID attached' },
];

type DocumentType = 'NIN' | 'LICENCE' | 'PHOTO' | 'VEHICLE_PAPERS' | 'GUARANTOR_FORM';

/** A document with no row at all has not been uploaded, so it reads as missing. */
function stateOf(status: string | undefined): DocState {
  if (status === 'APPROVED') return 'approved';
  if (status === 'IN_REVIEW') return 'review';
  if (status === 'REJECTED') return 'rejected';
  return 'missing';
}

const TONE: Record<DocState, { label: string; tone: 'success' | 'info' | 'error' | 'muted'; icon: keyof typeof Ionicons.glyphMap }> = {
  approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle' },
  review: { label: 'In review', tone: 'info', icon: 'time' },
  // Its own state rather than folding into "Required": a rider whose licence
  // came back rejected needs to know it was looked at and refused, not think
  // the upload failed.
  rejected: { label: 'Rejected', tone: 'error', icon: 'alert-circle' },
  missing: { label: 'Required', tone: 'muted', icon: 'add-circle-outline' },
};

/** Rider verification (design.md §10) — document upload + status. */
export default function RiderVerify() {
  const router = useRouter();
  const { data: rider } = useRiderMe();

  const docs = DOCS.map((d) => ({
    ...d,
    state: stateOf(rider?.documents?.find((r) => r.type === d.id)?.status),
  }));
  const done = docs.filter((d) => d.state === 'approved').length;
  const pct = Math.round((done / docs.length) * 100);

  return (
    <Screen className="bg-surface">
      <View className="bg-white">
        <ScreenHeader title="Rider verification" onBack={() => router.replace('/rider')} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        {/* progress */}
        <Card className="p-4">
          <View className="flex-row items-center mb-3">
            <View className="flex-1">
              <Text className="text-ink text-[17px] font-bold">You&apos;re {pct}% verified</Text>
              <Text className="text-muted text-[13px] mt-0.5">
                {done} of {docs.length} documents approved
              </Text>
            </View>
            <View className="w-12 h-12 rounded-full bg-pink-50 items-center justify-center">
              <Ionicons name="shield-checkmark-outline" size={22} color={colors.pink[600]} />
            </View>
          </View>
          <View className="h-2 rounded-full bg-surface overflow-hidden">
            <View style={{ width: `${pct}%` }} className="h-full rounded-full bg-pink-600" />
          </View>
        </Card>

        <View className="flex-row items-start bg-info/10 rounded-md p-3.5 mt-4">
          <Ionicons name="information-circle" size={17} color={colors.info} />
          <Text className="text-info text-[13px] ml-2.5 flex-1 leading-[18px]">
            You can browse jobs now, but you can&apos;t accept any until every document is approved.
            Reviews take under 24 hours.
          </Text>
        </View>

        {/* documents */}
        <Text className="text-muted text-[13px] font-semibold mt-6 mb-2.5">DOCUMENTS</Text>
        <Card>
          {docs.map((doc, i) => {
            const t = TONE[doc.state];
            return (
              <View key={doc.id}>
                {i > 0 ? <Divider className="mx-4" /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${doc.label}, ${t.label}`}
                  className="flex-row items-center px-4 py-3.5 active:bg-surface"
                >
                  <View
                    className={`w-10 h-10 rounded-md items-center justify-center mr-3 ${
                      doc.state === 'missing' ? 'border-[1.5px] border-dashed border-pink-200 bg-pink-50' : 'bg-surface'
                    }`}
                  >
                    <Ionicons
                      name={doc.state === 'missing' ? 'cloud-upload-outline' : 'document-text-outline'}
                      size={18}
                      color={doc.state === 'missing' ? colors.pink[400] : colors.body}
                    />
                  </View>
                  <View className="flex-1 pr-2">
                    <Text className="text-ink text-[15px] font-medium">{doc.label}</Text>
                    <Text className="text-muted text-[13px] mt-0.5">{doc.hint}</Text>
                  </View>
                  <Badge label={t.label} tone={t.tone} icon={t.icon} />
                </Pressable>
              </View>
            );
          })}
        </Card>

        {/* bank */}
        <Text className="text-muted text-[13px] font-semibold mt-6 mb-2.5">PAYOUT ACCOUNT</Text>
        <Card className="flex-row items-center p-4">
          <View className="w-10 h-10 rounded-full bg-pink-50 items-center justify-center mr-3">
            <Ionicons name="card-outline" size={18} color={colors.pink[600]} />
          </View>
          <View className="flex-1">
            <Text className="text-ink text-[15px] font-semibold">GTBank ••4471</Text>
            <Text className="text-muted text-[13px] mt-0.5">Emeka Adeyemi</Text>
          </View>
          <Text className="text-pink-600 text-[13px] font-semibold">Change</Text>
        </Card>
      </ScrollView>

      <StickyBar>
        {/*
          Document upload is not wired yet — KYC provider is still undecided, so
          verification is done by the ops team from the dashboard. The button
          said "Upload guarantor form" and only navigated away, which reads as
          a broken upload rather than a feature that does not exist. Saying so
          costs nothing and stops riders retrying it.
        */}
        <Button
          title="Back to dashboard"
          icon="arrow-back"
          onPress={() => router.replace('/rider')}
        />
      </StickyBar>
    </Screen>
  );
}

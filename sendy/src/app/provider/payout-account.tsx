import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card, Skeleton } from '@/components/ui/atoms';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, ScreenHeader, StickyBar } from '@/components/ui/Screen';
import { ApiError } from '@/lib/api/client';
import type { Bank } from '@/lib/api/endpoints';
import {
  useProviderBanks,
  useProviderMe,
  useProviderResolveAccount,
  useProviderSavePayoutAccount,
} from '@/lib/api/hooks';
import { colors } from '@/lib/theme';

/**
 * Where a provider's money goes.
 *
 * A copy of the rider screen, and deliberately so: the rule it is built around
 * is not specific to riders. Nothing is saved until the bank has told us whose
 * account it is and the provider has agreed. A transfer into a valid but
 * wrong account cannot be pulled back by us — it is a dispute between two banks,
 * and in the meantime the money is somewhere else. Ten digits is a short walk
 * from a stranger's savings account, so the confirmation step is the feature.
 */
export default function ProviderPayoutAccount() {
  const router = useRouter();

  const { data: provider } = useProviderMe();
  const { data: banks = [], isLoading: banksLoading } = useProviderBanks();
  const resolve = useProviderResolveAccount();
  const save = useProviderSavePayoutAccount();

  const [bank, setBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [picking, setPicking] = useState(false);
  const [confirmed, setConfirmed] = useState<{ accountName: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const complete = bank !== null && /^\d{10}$/.test(accountNumber);

  // Any edit invalidates a name we already resolved.
  function edit(next: string) {
    setAccountNumber(next.replace(/\D/g, '').slice(0, 10));
    setConfirmed(null);
    setProblem(null);
  }

  async function check() {
    if (!complete) return;
    setProblem(null);
    try {
      setConfirmed(await resolve.mutateAsync({ bankCode: bank.code, accountNumber }));
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : 'Could not check that account.');
    }
  }

  async function confirm() {
    if (!complete) return;
    setProblem(null);
    try {
      await save.mutateAsync({ bankCode: bank.code, accountNumber });
      router.back();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : 'Could not save that account.');
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Payout account" onBack={() => router.back()} />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-40" keyboardShouldPersistTaps="handled">
        {provider?.bankAccountName ? (
          <Card className="p-4 mb-5">
            <Text className="text-muted text-[12px] font-semibold mb-1">CURRENT ACCOUNT</Text>
            <Text className="text-ink text-[15px] font-semibold">{provider.bankAccountName}</Text>
            <Text className="text-muted text-[13px] mt-0.5">
              {provider.bankName} · ••••{provider.bankAccountNo?.slice(-4)}
            </Text>
          </Card>
        ) : (
          <View className="bg-surface rounded-lg p-4 mb-5">
            <Text className="text-body text-[14px] leading-[20px]">
              Add the account your earnings should be paid into. We&apos;ll check the name with your
              bank before saving it.
            </Text>
          </View>
        )}

        <Text className="text-body text-[15px] mb-2">Bank</Text>
        {banksLoading ? (
          <Skeleton className="w-full h-[56px] mb-4" />
        ) : (
          <Pressable
            onPress={() => setPicking(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose your bank"
            className="flex-row items-center h-[56px] rounded-md border-[1.5px] border-hairline px-4 mb-4"
          >
            <Ionicons name="business-outline" size={18} color={colors.muted} />
            <Text className={`flex-1 ml-3 text-[15px] ${bank ? 'text-ink' : 'text-muted'}`}>
              {bank?.name ?? 'Choose your bank'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.muted} />
          </Pressable>
        )}

        <Input
          label="Account number"
          value={accountNumber}
          onChangeText={edit}
          placeholder="0123456789"
          keyboardType="number-pad"
          icon="card-outline"
          helper="10 digits."
        />

        {confirmed ? (
          <View className="bg-success/10 rounded-lg p-4 mt-1">
            <View className="flex-row items-center mb-1">
              <Ionicons name="checkmark-circle" size={17} color={colors.success} />
              <Text className="text-muted text-[12px] font-semibold ml-1.5">
                YOUR BANK SAYS THIS IS
              </Text>
            </View>
            <Text className="text-ink text-[17px] font-bold">{confirmed.accountName}</Text>
            <Text className="text-body text-[13px] mt-1.5 leading-[19px]">
              If that isn&apos;t your name, check the digits. We can&apos;t recover money sent to the
              wrong account.
            </Text>
          </View>
        ) : null}

        {problem ? <Text className="text-error text-[14px] mt-3">{problem}</Text> : null}
      </ScrollView>

      <StickyBar>
        {confirmed ? (
          <Button
            title="Yes, that's me — save it"
            onPress={confirm}
            loading={save.isPending}
          />
        ) : (
          <Button
            title="Check this account"
            onPress={check}
            disabled={!complete}
            loading={resolve.isPending}
          />
        )}
      </StickyBar>

      <BankPicker
        open={picking}
        banks={banks}
        onPick={(b) => {
          setBank(b);
          setConfirmed(null);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}

/** Searchable list — there are a few hundred banks and scrolling is hopeless. */
function BankPicker({
  open,
  banks,
  onPick,
  onClose,
}: {
  open: boolean;
  banks: Bank[];
  onPick: (bank: Bank) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? banks.filter((b) => b.name.toLowerCase().includes(q)) : banks;
  }, [banks, query]);

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <View className="flex-row items-center px-4 py-3 border-b border-hairline">
          <Text className="text-ink text-[18px] font-bold flex-1">Choose your bank</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" className="p-2">
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>

        <View className="px-4 py-3">
          <View className="flex-row items-center h-[46px] rounded-md bg-surface px-3">
            <Ionicons name="search" size={17} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search banks"
              placeholderTextColor={colors.muted}
              autoFocus
              className="flex-1 ml-2 text-ink text-[15px]"
              style={{ outlineStyle: 'none' } as never}
            />
          </View>
        </View>

        <ScrollView contentContainerClassName="pb-10" keyboardShouldPersistTaps="handled">
          {filtered.length === 0 ? (
            <Text className="text-muted text-[14px] text-center mt-8">No bank matches “{query}”.</Text>
          ) : (
            filtered.map((b) => (
              <Pressable
                key={`${b.code}-${b.slug}`}
                onPress={() => onPick(b)}
                accessibilityRole="button"
                className="px-4 py-3.5 border-b border-hairline active:bg-surface"
              >
                <Text className="text-ink text-[15px]">{b.name}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

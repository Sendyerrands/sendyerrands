import { useState } from 'react';

import { AccountActions, SuspendedPill } from '@/components/AccountActions';
import { PageHeader } from '@/components/Layout';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  Pill,
  inputClass,
} from '@/components/ui';
import { dateTime, naira } from '@/lib/format';
import { useProviders, useUpdateProvider } from '@/lib/hooks';
import type { ServiceProviderAdmin } from '@/lib/types';

/**
 * The service providers — barbers, cleaners, plumbers who come to the customer.
 *
 * This page did not exist, and its absence was a hole rather than an omission:
 * approving a provider application created the ServiceProvider row and then
 * nothing in the dashboard could touch it. A provider arrived unverified,
 * carrying the schema's default arrival fees, and there was no screen to set
 * either — so the approval queue minted records into a dead end and the
 * provider waited for a call that had nowhere to come from.
 *
 * The fees are the point of the editor. A provider two streets away and one
 * across the lagoon do not cost the same to send, and until ops says what this
 * person costs, every booking quotes the default.
 */

export function ServiceProviders() {
  const { data, isLoading, isError, error, refetch } = useProviders();
  const [editing, setEditing] = useState<ServiceProviderAdmin | null>(null);

  const providers = data ?? [];
  const unverified = providers.filter((p) => !p.isVerified && !p.suspendedAt).length;

  return (
    <>
      <PageHeader
        title="Service providers"
        subtitle="Verify a provider, set what it costs to send them out, or take them offline. Customers only ever see verified, available providers."
      />

      <div className="p-4 sm:p-8">
        {unverified > 0 ? (
          <p className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">
            {unverified} provider{unverified === 1 ? '' : 's'} not yet verified, so no customer can
            see {unverified === 1 ? 'them' : 'any of them'}. Set their arrival fees, then verify.
          </p>
        ) : null}

        <Card>
          {isLoading ? (
            <Loading />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : providers.length === 0 ? (
            <EmptyState
              title="No providers yet"
              hint="A provider is created by approving an application on the Provider applications page."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-semibold">Provider</th>
                    <th className="px-5 py-3 font-semibold">Does</th>
                    <th className="px-5 py-3 font-semibold">Area</th>
                    <th className="px-5 py-3 font-semibold">Arrival fees</th>
                    <th className="px-5 py-3 text-right font-semibold">Jobs</th>
                    <th className="px-5 py-3 font-semibold">State</th>
                    <th className="px-5 py-3 font-semibold">Joined</th>
                    <th className="px-5 py-3 text-right font-semibold">Account</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => (
                    <tr key={p.id} className="border-b border-hairline last:border-0 hover:bg-surface">
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-ink">{p.name}</p>
                          <SuspendedPill suspendedAt={p.suspendedAt} />
                        </div>
                        <p className="text-[12px] text-muted">
                          {p.phone ?? 'No phone'}
                          {p.email ? ` · ${p.email}` : ''}
                        </p>
                        {p.suspendedReason ? (
                          <p className="text-[12px] text-error">{p.suspendedReason}</p>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-body">
                        {p.category}
                        {p._count.packages > 0 ? (
                          <span className="block text-[12px] text-muted">
                            {p._count.packages} package{p._count.packages === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="block text-[12px] text-muted">Quotes each job</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-body">
                        {p.area ?? '—'}
                        <span className="block text-[12px] text-muted">{p.state}</span>
                      </td>
                      {/* The two numbers a booking actually charges. Shown rather
                          than hidden in the editor, because a provider sitting on
                          the defaults is the most common thing wrong here. */}
                      <td className="px-5 py-3">
                        <p className="num text-body">
                          {p.canTravelByBike ? `Bike ${naira(p.bikeFeeKobo)}` : 'No bike'}
                        </p>
                        <p className="num text-[12px] text-muted">Car {naira(p.carFeeKobo)}</p>
                      </td>
                      <td className="num px-5 py-3 text-right text-body">{p._count.orders}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Pill
                            tone={
                              p.isVerified ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
                            }
                            label={p.isVerified ? 'Verified' : 'Unverified'}
                          />
                          {p.isAvailable ? null : (
                            <Pill tone="bg-muted/15 text-body" label="Unavailable" />
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted">{dateTime(p.createdAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={Boolean(p.suspendedAt)}
                            onClick={() => setEditing(p)}
                          >
                            Edit
                          </Button>
                          <AccountActions
                            role="provider"
                            id={p.id}
                            name={p.name}
                            suspendedAt={p.suspendedAt}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <EditProvider provider={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function EditProvider({
  provider,
  onClose,
}: {
  provider: ServiceProviderAdmin | null;
  onClose: () => void;
}) {
  const update = useUpdateProvider();

  /* Naira in the inputs, kobo over the wire. Asking ops to type 25000 for
     ₦250 is how a fee ends up a hundred times wrong. */
  const [bike, setBike] = useState('');
  const [car, setCar] = useState('');
  const [verified, setVerified] = useState(false);
  const [available, setAvailable] = useState(false);
  const [bikeOk, setBikeOk] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);

  if (!provider) return null;

  // Fill from the row the first time this provider is opened.
  if (loaded !== provider.id) {
    setLoaded(provider.id);
    setBike(String(Math.round(provider.bikeFeeKobo / 100)));
    setCar(String(Math.round(provider.carFeeKobo / 100)));
    setVerified(provider.isVerified);
    setAvailable(provider.isAvailable);
    setBikeOk(provider.canTravelByBike);
  }

  const bikeKobo = Math.round(Number(bike) * 100);
  const carKobo = Math.round(Number(car) * 100);
  const feesValid =
    Number.isFinite(bikeKobo) && bikeKobo >= 0 && Number.isFinite(carKobo) && carKobo >= 0;

  const save = () => {
    update.mutate(
      {
        id: provider.id,
        patch: {
          isVerified: verified,
          isAvailable: available,
          canTravelByBike: bikeOk,
          bikeFeeKobo: bikeKobo,
          carFeeKobo: carKobo,
        },
      },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal
      open
      title={`Edit ${provider.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={save} loading={update.isPending} disabled={!feesValid}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bike arrival fee (₦)" hint="What Sendy charges to send them by bike.">
            <input
              value={bike}
              onChange={(e) => setBike(e.target.value)}
              inputMode="numeric"
              disabled={!bikeOk}
              className={inputClass}
            />
          </Field>
          <Field label="Car arrival fee (₦)" hint="Used when the job cannot go by bike.">
            <input
              value={car}
              onChange={(e) => setCar(e.target.value)}
              inputMode="numeric"
              className={inputClass}
            />
          </Field>
        </div>

        <Check
          checked={bikeOk}
          onChange={setBikeOk}
          label="Can travel by bike"
          hint="Off for anyone carrying equipment — a cleaner with a vacuum, a plumber with pipe. The bike option is then never offered."
        />
        <Check
          checked={verified}
          onChange={setVerified}
          label="Verified"
          hint="Customers only see verified providers. This is the switch that puts them live."
        />
        <Check
          checked={available}
          onChange={setAvailable}
          label="Available"
          hint="Normally the provider's own toggle. Turn it off to take them out of browse without suspending them."
        />

        {!feesValid ? (
          <p className="rounded-lg bg-error/10 px-3 py-2 text-error">
            Both fees must be a number of naira, zero or more.
          </p>
        ) : null}

        {update.isError ? (
          <p className="rounded-lg bg-error/10 px-3 py-2 text-error">
            {update.error instanceof Error ? update.error.message : 'That did not save.'}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-none accent-pink-600"
      />
      <span>
        <span className="block font-semibold text-ink">{label}</span>
        <span className="block text-[12px] text-muted">{hint}</span>
      </span>
    </label>
  );
}

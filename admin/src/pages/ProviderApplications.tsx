import { useState } from 'react';

import { PageHeader } from '@/components/Layout';
import { Button, Card, EmptyState, ErrorState, Field, Loading, Modal, Pill, inputClass } from '@/components/ui';
import { naira, relative } from '@/lib/format';
import { useDecideProviderApplication, useProviderApplications } from '@/lib/hooks';
import type { ProviderApplication, VendorApplicationStatus } from '@/lib/types';

/**
 * The service-provider onboarding queue.
 *
 * A sibling of the vendor queue rather than a tab inside it: approving one
 * creates a Vendor and approving the other creates a ServiceProvider, and ops
 * deciding someone's livelihood should be able to see which of the two they
 * are about to mint.
 *
 * This page did not exist until now. The API has served
 * /admin/provider-applications since the feature shipped and the app has been
 * taking applications, with nowhere for anyone to read them — so an applicant
 * waiting to be called back was waiting on a queue nobody could open.
 */

const TABS: { label: string; value: VendorApplicationStatus | undefined }[] = [
  { label: 'Pending', value: 'PENDING' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'All', value: undefined },
];

const TONES: Record<VendorApplicationStatus, string> = {
  PENDING: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-error/10 text-error',
};

export function ProviderApplications() {
  const [tab, setTab] = useState<VendorApplicationStatus | undefined>('PENDING');
  const [reviewing, setReviewing] = useState<ProviderApplication | null>(null);

  const { data, isLoading, isError, error, refetch } = useProviderApplications(tab);

  return (
    <>
      <PageHeader
        title="Provider applications"
        subtitle="People asking to offer a service — barbers, cleaners, plumbers. Approving creates the provider, unverified and unavailable until you set their fees."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setTab(t.value)}
            aria-pressed={tab === t.value}
            className={`h-8 rounded-lg px-3 text-[13px] font-semibold transition ${
              tab === t.value ? 'bg-pink-600 text-white' : 'bg-white text-body hover:bg-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            title="Nothing here"
            hint={
              tab === 'PENDING'
                ? 'No applications waiting. They arrive from Profile → Offer a service in the app.'
                : 'No applications with this status.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-semibold">Trades as</th>
                  <th className="px-5 py-3 font-semibold">Does</th>
                  <th className="px-5 py-3 font-semibold">Area</th>
                  <th className="px-5 py-3 font-semibold">Travels</th>
                  <th className="px-5 py-3 font-semibold">Contact</th>
                  <th className="px-5 py-3 font-semibold">Applied</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id} className="border-b border-hairline last:border-0 hover:bg-surface">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-ink">{a.name}</p>
                      {a.provider ? (
                        <p className="text-[12px] text-muted">created as /{a.provider.slug}</p>
                      ) : a.packages?.length ? (
                        <p className="text-[12px] text-muted">
                          {a.packages.length} package{a.packages.length === 1 ? '' : 's'} offered
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-body">{a.category}</td>
                    <td className="px-5 py-3 text-body">
                      {a.area}
                      <span className="block text-[12px] text-muted">{a.state}</span>
                    </td>
                    {/* The one thing only the applicant knows, and it decides
                        which arrival options a customer is ever shown. */}
                    <td className="px-5 py-3 text-body">
                      {a.canTravelByBike ? 'Bike or car' : 'Car only'}
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-body">{a.phone}</p>
                      {a.email ? <p className="text-[12px] text-muted">{a.email}</p> : null}
                    </td>
                    <td className="px-5 py-3 text-muted">{relative(a.createdAt)}</td>
                    <td className="px-5 py-3">
                      <Pill tone={TONES[a.status]} label={a.status} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      {a.status === 'PENDING' ? (
                        <Button size="sm" variant="secondary" onClick={() => setReviewing(a)}>
                          Review
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ReviewModal application={reviewing} onClose={() => setReviewing(null)} />
    </>
  );
}

function ReviewModal({
  application,
  onClose,
}: {
  application: ProviderApplication | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const decide = useDecideProviderApplication();

  if (!application) return null;

  const act = (decision: 'APPROVE' | 'REJECT') => {
    decide.mutate(
      { id: application.id, decision, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setNote('');
          onClose();
        },
      }
    );
  };

  return (
    <Modal open onClose={onClose} title="Review application">
      <div className="space-y-3 text-sm">
        <div>
          <p className="font-semibold text-ink">{application.name}</p>
          <p className="text-muted">
            {application.category} · {application.area}, {application.state}
          </p>
        </div>

        {application.bio ? <p className="text-body">{application.bio}</p> : null}

        {application.tags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {application.tags.map((t) => (
              <Pill key={t} tone="bg-surface text-body" label={t} />
            ))}
          </div>
        ) : null}

        <div className="rounded-lg bg-surface p-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">How they travel</p>
          <p className="text-body">
            {application.canTravelByBike
              ? 'Bike or car — their tools travel light.'
              : 'Car only — they carry equipment, so the bike option is never offered.'}
          </p>
        </div>

        {/* Shown because the prices become real the moment this is approved:
            these rows are created as bookable packages, not as a proposal. */}
        {application.packages?.length ? (
          <div>
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
              Packages they offer
            </p>
            {application.packages.map((p) => (
              <div key={p.tier} className="flex items-start justify-between gap-3 border-b border-hairline py-1.5 last:border-0">
                <div>
                  <p className="font-semibold text-ink">{p.name || p.tier}</p>
                  <p className="text-[12px] text-muted">{p.description}</p>
                </div>
                <p className="whitespace-nowrap text-ink">{naira(p.priceKobo)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">No packages — they quote each job.</p>
        )}

        <Field label="Note (optional)" hint="A rejection reason is shown to the applicant.">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Called and confirmed, or why not"
            className={inputClass}
          />
        </Field>

        <p className="text-[12px] text-muted">
          Approving creates the provider <strong>unverified and unavailable</strong>, so customers
          will not see them. Set their fees on the provider, then switch them live.
        </p>

        <div className="flex gap-2 pt-1">
          <Button onClick={() => act('APPROVE')} loading={decide.isPending}>
            Approve
          </Button>
          <Button variant="secondary" onClick={() => act('REJECT')} loading={decide.isPending}>
            Reject
          </Button>
        </div>
      </div>
    </Modal>
  );
}

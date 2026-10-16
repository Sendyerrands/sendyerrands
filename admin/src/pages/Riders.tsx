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
  RiderPill,
  inputClass,
} from '@/components/ui';
import { dateTime, fullName, humanise, initials } from '@/lib/format';
import { useRiders, useVerifyRider } from '@/lib/hooks';
import type { Rider, RiderStatus } from '@/lib/types';

const TABS: { key: RiderStatus | 'ALL'; label: string }[] = [
  { key: 'IN_REVIEW', label: 'Awaiting review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'PENDING', label: 'Not submitted' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'SUSPENDED', label: 'Suspended' },
  { key: 'ALL', label: 'All' },
];

export function Riders() {
  // Default to the queue that actually needs work.
  const [tab, setTab] = useState<RiderStatus | 'ALL'>('IN_REVIEW');
  const [selected, setSelected] = useState<Rider | null>(null);

  const { data, isLoading, isError, error, refetch } = useRiders(tab);

  return (
    <>
      <PageHeader
        title="Riders"
        subtitle="Verify documents before a rider can accept jobs. Approving unlocks the rider app."
      />

      <div className="p-4 sm:p-8">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${
                tab === t.key ? 'bg-pink-600 text-white' : 'bg-white text-body hover:bg-surface'
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
              hint={tab === 'IN_REVIEW' ? 'No riders are waiting for review.' : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-semibold">Rider</th>
                  <th className="px-5 py-3 font-semibold">Phone</th>
                  <th className="px-5 py-3 font-semibold">Zone</th>
                  <th className="px-5 py-3 font-semibold">Docs</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Applied</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="border-b border-hairline last:border-0 hover:bg-surface">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-pink-50 text-[11px] font-bold text-pink-600">
                          {initials(r)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{fullName(r)}</p>
                          <p className="truncate text-[12px] text-muted">
                            {r.plateNumber ?? 'No plate on file'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-body">{r.phone}</td>
                    <td className="px-5 py-3 text-body">{r.zone ?? '—'}</td>
                    <td className="px-5 py-3">
                      {r.documents.length === 0 ? (
                        <span className="text-[13px] text-muted">None</span>
                      ) : (
                        <span className="text-[13px] font-semibold text-body">
                          {r.documents.length}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <RiderPill status={r.status} />
                        {/* Distinct from the verification status on purpose: a rider
                            can be APPROVED and suspended at once, and the suspension
                            is the one that decides whether they can sign in. */}
                        <SuspendedPill suspendedAt={r.suspendedAt} />
                        {r.isOnline ? <Pill tone="bg-success/10 text-success" label="Online" /> : null}
                      </div>
                      {r.suspendedReason ? (
                        <p className="mt-1 text-[12px] text-error">{r.suspendedReason}</p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-muted">{dateTime(r.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => setSelected(r)}>
                          Review
                        </Button>
                        <AccountActions
                          role="rider"
                          id={r.id}
                          name={fullName(r)}
                          suspendedAt={r.suspendedAt}
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

      <ReviewModal rider={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ReviewModal({ rider, onClose }: { rider: Rider | null; onClose: () => void }) {
  const verify = useVerifyRider();
  const [note, setNote] = useState('');

  if (!rider) return null;

  const act = (status: 'APPROVED' | 'REJECTED') => {
    verify.mutate(
      { id: rider.id, status, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          setNote('');
          onClose();
        },
      }
    );
  };

  return (
    <Modal
      open
      title={`Review ${fullName(rider)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={verify.isPending}>
            Cancel
          </Button>
          {/* Reject, not suspend. Suspending used to live here and set
              RiderStatus.SUSPENDED, which nothing on the login path ever
              read - a suspended rider could sign in and keep working. The
              Suspend button on the row is the real one. */}
          <Button variant="danger" loading={verify.isPending} onClick={() => act('REJECTED')}>
            Reject
          </Button>
          <Button loading={verify.isPending} onClick={() => act('APPROVED')}>
            Approve
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Detail label="Phone" value={rider.phone} />
        <Detail label="Email" value={rider.email ?? '—'} />
        <Detail label="Plate number" value={rider.plateNumber ?? '—'} />
        <Detail label="Zone" value={rider.zone ?? '—'} />
        <Detail label="Completed jobs" value={String(rider.completedJobs)} />
        <Detail label="Rating" value={rider.rating.toFixed(1)} />
        <Detail label="Bank" value={rider.bankName ?? 'Not set'} />
        <Detail label="Account" value={rider.bankAccountNo ?? 'Not set'} />
      </dl>

      <div className="mt-5">
        <p className="mb-2 text-[13px] font-semibold text-body">Documents</p>
        {rider.documents.length === 0 ? (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] font-medium text-warning">
            This rider has not uploaded any documents yet. Approving now skips verification.
          </p>
        ) : (
          <ul className="space-y-2">
            {rider.documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between rounded-lg border border-hairline px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink">{humanise(doc.type)}</p>
                  <p className="text-[12px] text-muted">{humanise(doc.status)}</p>
                </div>
                <a
                  href={doc.fileUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[13px] font-semibold text-pink-600 hover:underline"
                >
                  View
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <Field
          label="Review note"
          hint="Saved against every document in this review. Tell a rejected rider what to fix."
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Optional"
            className={inputClass}
          />
        </Field>
      </div>

      {verify.isError ? (
        <p role="alert" className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-[13px] text-error">
          {verify.error instanceof Error ? verify.error.message : 'Could not update this rider.'}
        </p>
      ) : null}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

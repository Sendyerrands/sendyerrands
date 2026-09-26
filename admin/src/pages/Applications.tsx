import { useState } from 'react';

import { PageHeader } from '@/components/Layout';
import { Button, Card, EmptyState, ErrorState, Field, Loading, Modal, Pill, inputClass } from '@/components/ui';
import { relative } from '@/lib/format';
import { useDecideApplication, useVendorApplications } from '@/lib/hooks';
import type { VendorApplication, VendorApplicationStatus } from '@/lib/types';

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

export function Applications() {
  const [tab, setTab] = useState<VendorApplicationStatus | undefined>('PENDING');
  const [reviewing, setReviewing] = useState<VendorApplication | null>(null);

  const { data, isLoading, isError, error, refetch } = useVendorApplications(tab);

  return (
    <>
      <PageHeader
        title="Vendor applications"
        subtitle="Businesses asking to sell on Sendy Errands. Approving creates the vendor — unverified and closed until you add its listings."
      />

      <div className="p-4 sm:p-8">
        <div className="mb-4 flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.label}
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
                  ? 'No applications waiting. They arrive from Profile → Become a vendor in the app.'
                  : 'No applications with this status.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-semibold">Business</th>
                  <th className="px-5 py-3 font-semibold">Category</th>
                  <th className="px-5 py-3 font-semibold">Area</th>
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
                      <p className="font-semibold text-ink">{a.businessName}</p>
                      {a.vendor ? (
                        <p className="text-[12px] text-muted">created as /{a.vendor.slug}</p>
                      ) : a.address ? (
                        <p className="text-[12px] text-muted">{a.address}</p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-body">{a.category}</td>
                    <td className="px-5 py-3 text-body">{a.area}</td>
                    <td className="px-5 py-3">
                      <p className="text-body">{a.phone}</p>
                      {a.applicant ? (
                        <p className="text-[12px] text-muted">
                          {a.applicant.firstName} {a.applicant.lastName}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-muted">{relative(a.createdAt)}</td>
                    <td className="px-5 py-3">
                      <Pill tone={TONES[a.status]} label={a.status} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      {a.status === 'PENDING' ? (
                        <Button size="sm" onClick={() => setReviewing(a)}>
                          Review
                        </Button>
                      ) : a.note ? (
                        <span className="text-[12px] text-muted">{a.note}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <ReviewModal application={reviewing} onClose={() => setReviewing(null)} />
    </>
  );
}

function ReviewModal({
  application,
  onClose,
}: {
  application: VendorApplication | null;
  onClose: () => void;
}) {
  const decide = useDecideApplication();
  const [note, setNote] = useState('');

  function submit(decision: 'APPROVE' | 'REJECT') {
    if (!application) return;
    decide.mutate(
      { id: application.id, decision, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          setNote('');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open={application !== null}
      title="Review application"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={decide.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => submit('REJECT')} loading={decide.isPending}>
            Reject
          </Button>
          <Button onClick={() => submit('APPROVE')} loading={decide.isPending}>
            Approve
          </Button>
        </>
      }
    >
      {application === null ? null : (
        <>
          <dl className="mb-4 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Business</dt>
            <dd className="font-semibold text-ink">{application.businessName}</dd>
            <dt className="text-muted">Category</dt>
            <dd className="text-body">{application.category}</dd>
            <dt className="text-muted">Area</dt>
            <dd className="text-body">{application.area}</dd>
            <dt className="text-muted">Phone</dt>
            <dd className="text-body">{application.phone}</dd>
            {application.address ? (
              <>
                <dt className="text-muted">Address</dt>
                <dd className="text-body">{application.address}</dd>
              </>
            ) : null}
            {application.applicant ? (
              <>
                <dt className="text-muted">Applicant</dt>
                <dd className="text-body">
                  {application.applicant.firstName} {application.applicant.lastName} ·{' '}
                  {application.applicant.phone}
                </dd>
              </>
            ) : null}
          </dl>

          <Field label="Note (optional)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Why this was rejected, or an internal remark."
              className={inputClass}
            />
          </Field>

          <p className="mt-3 text-[12px] text-muted">
            Approving creates the vendor unverified and closed, so customers will not see it yet. Add
            its listings on the Vendors page, then switch it to verified and open.
          </p>

          {decide.isError ? (
            <p role="alert" className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-[13px] text-error">
              {decide.error instanceof Error ? decide.error.message : 'That decision failed.'}
            </p>
          ) : null}
        </>
      )}
    </Modal>
  );
}

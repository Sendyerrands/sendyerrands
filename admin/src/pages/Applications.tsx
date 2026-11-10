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

  /**
   * The address this vendor will sign in with.
   *
   * Pre-filled from the applicant, and editable, because the applicant's
   * account is not always the shop owner's — someone's assistant applies, or
   * the customer row has since been deleted and there is no email in the chain
   * at all. Approval now refuses without one rather than creating a vendor
   * nobody can ever sign into, which is what it used to do.
   */
  const [email, setEmail] = useState('');
  const applicantEmail = application?.applicant?.email ?? null;
  const loginEmail = (email.trim() || applicantEmail || '').toLowerCase();

  /** Set once an approval comes back, so the result can be reported honestly. */
  const [outcome, setOutcome] = useState<{ email: string; sent: boolean } | null>(null);

  function close() {
    setNote('');
    setEmail('');
    setOutcome(null);
    decide.reset();
    onClose();
  }

  function submit(decision: 'APPROVE' | 'REJECT') {
    if (!application) return;
    decide.mutate(
      {
        id: application.id,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        // Only when it differs from the applicant's: sending it always would
        // make a typo in a pre-filled box overwrite a perfectly good address.
        ...(decision === 'APPROVE' && email.trim() ? { email: loginEmail } : {}),
      },
      {
        onSuccess: (result) => {
          if (decision === 'REJECT') return close();
          /* Approval holds the modal open to report whether the vendor was
             actually told. Closing straight away is what let a silent email
             failure pass for success. */
          setOutcome({
            email: result.loginEmail ?? loginEmail,
            sent: result.emailSent === true,
          });
        },
      }
    );
  }

  return (
    <Modal
      open={application !== null}
      title={outcome ? 'Approved' : 'Review application'}
      onClose={close}
      footer={
        outcome ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={decide.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => submit('REJECT')} loading={decide.isPending}>
              Reject
            </Button>
            <Button
              onClick={() => submit('APPROVE')}
              loading={decide.isPending}
              /* No email, no approval. The server refuses too — this just says
                 so before the click rather than after it. */
              disabled={!loginEmail}
            >
              Approve
            </Button>
          </>
        )
      }
    >
      {application === null ? null : outcome ? (
        /* What happened, in the two cases that differ for the operator. */
        <div className="space-y-3 text-sm">
          <p className="rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
            <strong>{application.businessName}</strong> is now a vendor, signing in with{' '}
            <strong>{outcome.email}</strong>.
          </p>
          {outcome.sent ? (
            <p className="text-body">
              We emailed them their sign-in address and how to set a password. They have no password
              yet — they create one through <strong>Forgot password</strong> on the vendor sign-in,
              which is the only way in by design, so no temporary password exists to be leaked or
              changed later.
            </p>
          ) : (
            <p className="rounded-lg bg-error/10 px-3 py-2 text-[13px] text-error">
              <strong>The email did not go out.</strong> The vendor exists and is correct, but
              nobody has told them. Ring them on {application.phone}, tell them to use{' '}
              <strong>Forgot password</strong> on the vendor sign-in with {outcome.email}, and check
              the API logs for why the send failed.
            </p>
          )}
          <p className="text-[12px] text-muted">
            They are unverified and closed, so customers cannot see them. Add listings and a
            delivery fee on the Vendors page, then switch those on.
          </p>
        </div>
      ) : (
        <>
          {/* Said out loud because the result surprises people: approving does
              not put the vendor in the app. It creates them unverified and
              closed, with no catalogue and no delivery fee, and ops flips those
              on the Vendors page once the shop is actually ready. Without this
              line an approval reads as having silently failed. */}
          <p className="mb-4 rounded-lg bg-info/10 px-3 py-2 text-[13px] text-info">
            Approving creates the vendor <strong>unverified, closed and unable to bid</strong>, so
            customers will not see them yet. Set their delivery fee and catalogue on the Vendors
            page, then switch those on.
          </p>
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

          {/*
            The single most consequential field on this screen, and it used to
            not be here at all. Vendor.email is what every way in is keyed on:
            the reset flow finds the vendor by it, and so does the dashboard's
            own password-reset tool. Approving without one created an account
            that no person and no operator could ever enter.
          */}
          <Field
            label="Sign-in email"
            hint={
              applicantEmail
                ? `Leave blank to use the applicant's address, ${applicantEmail}.`
                : 'The applicant account is gone, so there is no address on file. Enter the owner\u2019s.'
            }
          >
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder={applicantEmail ?? 'owner@example.com'}
              className={inputClass}
            />
          </Field>

          {!loginEmail ? (
            <p className="mb-4 mt-2 rounded-lg bg-error/10 px-3 py-2 text-[13px] text-error">
              Enter an email before approving. Without one the vendor cannot sign in and cannot be
              sent a reset code, and there is no way to repair it afterwards except by hand.
            </p>
          ) : (
            <p className="mb-4 mt-2 text-[12px] text-muted">
              They will sign in with <strong className="text-ink">{loginEmail}</strong> and be
              emailed how to set a password.
            </p>
          )}

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

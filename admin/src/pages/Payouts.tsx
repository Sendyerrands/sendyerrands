import { useState } from 'react';

import { PageHeader } from '@/components/Layout';
import { Button, Card, EmptyState, ErrorState, Loading, Modal, Pill } from '@/components/ui';
import { naira, relative } from '@/lib/format';
import { usePayouts, useReconcilePayout, useSendPayout } from '@/lib/hooks';
import type { PayoutDue, PayoutStatus } from '@/lib/types';

/**
 * Rider payouts.
 *
 * Two tables, because they answer different questions. "Owed" is what ops acts
 * on; "History" is what they check when a rider says the money never arrived.
 *
 * Releasing money is the one destructive action in this dashboard that cannot
 * be undone from this dashboard, so it goes through a confirmation naming the
 * amount, the bank and the account holder.
 */

const TONES: Record<PayoutStatus, string> = {
  PENDING: 'bg-muted/15 text-muted',
  PROCESSING: 'bg-info/10 text-info',
  SUCCESS: 'bg-success/10 text-success',
  FAILED: 'bg-error/10 text-error',
  REVERSED: 'bg-error/10 text-error',
};

export function Payouts() {
  const { data, isLoading, isError, error, refetch } = usePayouts();
  const send = useSendPayout();
  const reconcile = useReconcilePayout();

  const [confirming, setConfirming] = useState<PayoutDue | null>(null);

  const failure = [send, reconcile].find((m) => m.isError);

  return (
    <>
      <PageHeader
        title="Rider payouts"
        subtitle={
          data
            ? `Earnings become payable ${data.holdHours}h after delivery. Minimum payout ${naira(data.minimumKobo)}.`
            : 'Releasing what riders have earned.'
        }
      />

      <div className="p-4 sm:p-8">
        {failure ? (
          <p role="alert" className="mb-3 rounded-lg bg-error/10 px-3 py-2 text-[13px] text-error">
            {failure.error instanceof Error ? failure.error.message : 'That action failed.'}
          </p>
        ) : null}

        {isLoading ? (
          <Card>
            <Loading />
          </Card>
        ) : isError ? (
          <Card>
            <ErrorState error={error} onRetry={() => refetch()} />
          </Card>
        ) : (
          <>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
              Owed
            </h2>
            <Card className="mb-8">
              {!data || data.due.length === 0 ? (
                <EmptyState
                  title="Nobody is owed anything"
                  hint="Earnings appear here once a delivery completes and clears the hold."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[46rem] text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                        <th className="px-5 py-3 font-semibold">Rider</th>
                        <th className="px-5 py-3 font-semibold">Payout account</th>
                        <th className="px-5 py-3 text-right font-semibold">Ready</th>
                        <th className="px-5 py-3 text-right font-semibold">Clearing</th>
                        <th className="px-5 py-3 text-right font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.due.map((r) => {
                        const hasAccount = Boolean(r.bankAccountName);
                        return (
                          <tr key={r.id} className="border-b border-hairline last:border-0 hover:bg-surface">
                            <td className="px-5 py-3">
                              <p className="font-semibold text-ink">
                                {r.firstName} {r.lastName}
                              </p>
                              <p className="text-[12px] text-muted">{r.phone}</p>
                            </td>
                            <td className="px-5 py-3">
                              {hasAccount ? (
                                <>
                                  <p className="text-body">{r.bankAccountName}</p>
                                  <p className="text-[12px] text-muted">
                                    {r.bankName} ••{r.bankAccountNo?.slice(-4)}
                                  </p>
                                </>
                              ) : (
                                <Pill tone="bg-warning/10 text-warning" label="Not set" />
                              )}
                            </td>
                            <td className="num px-5 py-3 text-right font-semibold text-ink">
                              {naira(r.payableKobo)}
                            </td>
                            {/* Held money is not a problem to solve, it is time
                                passing. Shown so nobody chases a number that is
                                simply not due yet. */}
                            <td className="num px-5 py-3 text-right text-muted">
                              {r.heldKobo > 0 ? naira(r.heldKobo) : '—'}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <Button
                                size="sm"
                                disabled={!hasAccount || r.payableKobo === 0 || send.isPending}
                                onClick={() => setConfirming(r)}
                              >
                                Pay
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
              History
            </h2>
            <Card>
              {!data || data.payouts.length === 0 ? (
                <EmptyState title="No payouts yet" hint="Released payouts show up here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[46rem] text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                        <th className="px-5 py-3 font-semibold">Rider</th>
                        <th className="px-5 py-3 font-semibold">Reference</th>
                        <th className="px-5 py-3 font-semibold">Sent to</th>
                        <th className="px-5 py-3 text-right font-semibold">Amount</th>
                        <th className="px-5 py-3 font-semibold">Status</th>
                        <th className="px-5 py-3 font-semibold">When</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.payouts.map((p) => (
                        <tr key={p.id} className="border-b border-hairline last:border-0 hover:bg-surface">
                          <td className="px-5 py-3">
                            <p className="font-semibold text-ink">
                              {p.rider.firstName} {p.rider.lastName}
                            </p>
                            <p className="text-[12px] text-muted">
                              {p._count.earnings} deliver{p._count.earnings === 1 ? 'y' : 'ies'}
                            </p>
                          </td>
                          <td className="num px-5 py-3 text-[12px] text-muted">{p.reference}</td>
                          <td className="px-5 py-3 text-body">
                            {p.bankName ? `${p.bankName} ••${p.bankAccountNo?.slice(-4)}` : '—'}
                          </td>
                          <td className="num px-5 py-3 text-right font-semibold text-ink">
                            {naira(p.amountKobo)}
                          </td>
                          <td className="px-5 py-3">
                            <Pill tone={TONES[p.status]} label={p.status} />
                            {p.failureReason ? (
                              <p className="mt-1 max-w-[16rem] text-[11px] text-muted">
                                {p.failureReason}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-5 py-3 text-muted">{relative(p.settledAt ?? p.createdAt)}</td>
                          <td className="px-5 py-3 text-right">
                            {/* Only offered where it can change something: a
                                settled payout has nothing left to learn. */}
                            {p.status === 'PENDING' || p.status === 'PROCESSING' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={reconcile.isPending}
                                onClick={() => reconcile.mutate(p.id)}
                              >
                                Check
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
          </>
        )}
      </div>

      <ConfirmPay
        rider={confirming}
        minimumKobo={data?.minimumKobo ?? 0}
        busy={send.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={(ignoreMinimum) => {
          if (!confirming) return;
          send.mutate(
            { riderId: confirming.id, ignoreMinimum },
            { onSuccess: () => setConfirming(null) }
            // Stays open on failure: "Paystack refused the transfer: …" belongs
            // next to the button that caused it.
          );
        }}
      />
    </>
  );
}

function ConfirmPay({
  rider,
  minimumKobo,
  busy,
  onCancel,
  onConfirm,
}: {
  rider: PayoutDue | null;
  minimumKobo: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (ignoreMinimum: boolean) => void;
}) {
  const below = rider !== null && !rider.meetsMinimum;

  return (
    <Modal
      open={rider !== null}
      title="Release payout"
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(below)} loading={busy}>
            {rider ? `Send ${naira(rider.payableKobo)}` : 'Send'}
          </Button>
        </>
      }
    >
      {rider === null ? null : (
        <>
          <p className="text-body">
            Send <strong className="text-ink">{naira(rider.payableKobo)}</strong> to{' '}
            <strong className="text-ink">{rider.bankAccountName}</strong> at {rider.bankName} ••
            {rider.bankAccountNo?.slice(-4)}?
          </p>
          <p className="mt-3 text-[13px] text-muted">
            This covers {rider.firstName}&apos;s cleared earnings. Once the bank accepts it we
            cannot pull it back — a wrong account becomes a dispute between two banks.
          </p>
          {below ? (
            <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">
              This is below the {naira(minimumKobo)} minimum. Sending anyway means the transfer fee
              takes a larger share than usual.
            </p>
          ) : null}
        </>
      )}
    </Modal>
  );
}

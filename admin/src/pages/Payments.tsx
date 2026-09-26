import { useState } from 'react';

import { PageHeader } from '@/components/Layout';
import { Button, Card, EmptyState, ErrorState, Field, Loading, Modal, Pill, inputClass } from '@/components/ui';
import { dateTime, fullName, humanise, naira, relative } from '@/lib/format';
import { usePayments, useRecordPayment } from '@/lib/hooks';
import type { PaymentStatus, UnpaidOrder } from '@/lib/types';

/**
 * Money in.
 *
 * Deliberately not the same page as Rider payouts, which is money out. Both are
 * "payments" in casual speech and a single netted figure is how a business
 * convinces itself it is profitable.
 *
 * Sendy has no online gateway on the website: customers pay cash at the door or
 * transfer into the company account, and somebody in ops confirms it. So the
 * page leads with what has NOT been collected, which is the part that costs
 * money if nobody looks.
 */

const TONES: Record<PaymentStatus, string> = {
  SUCCESS: 'bg-success/10 text-success',
  PENDING: 'bg-warning/10 text-warning',
  FAILED: 'bg-error/10 text-error',
  REFUNDED: 'bg-muted/15 text-body',
};

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'SUCCESS', label: 'Collected' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REFUNDED', label: 'Refunded' },
];

export function Payments() {
  const [filter, setFilter] = useState('');
  const { data, isLoading, isError, error, refetch } = usePayments(filter);
  const [recording, setRecording] = useState<UnpaidOrder | null>(null);

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="What customers have paid. Rider payouts are money out and live on their own page."
      />

      <div className="p-4 sm:p-8">
        {isLoading ? (
          <Card>
            <Loading />
          </Card>
        ) : isError ? (
          <Card>
            <ErrorState error={error} onRetry={() => refetch()} />
          </Card>
        ) : !data ? null : (
          <>
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <Stat label="Collected" value={naira(data.totals.SUCCESS)} tone="text-success" />
              <Stat
                label="Awaiting confirmation"
                value={naira(data.totals.PENDING)}
                tone={data.totals.PENDING > 0 ? 'text-warning' : 'text-ink'}
                hint={`${data.counts.PENDING} payment${data.counts.PENDING === 1 ? '' : 's'}`}
              />
              {/* The number this page exists for. */}
              <Stat
                label="Delivered, not collected"
                value={naira(data.unpaidTotalKobo)}
                tone={data.unpaidTotalKobo > 0 ? 'text-error' : 'text-ink'}
                hint={`${data.unpaid.length} order${data.unpaid.length === 1 ? '' : 's'}`}
              />
            </div>

            {data.unpaid.length > 0 ? (
              <>
                <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
                  Owed to us
                </h2>
                <Card className="mb-8">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[46rem] text-sm">
                      <thead>
                        <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                          <th className="px-5 py-3 font-semibold">Order</th>
                          <th className="px-5 py-3 font-semibold">Customer</th>
                          <th className="px-5 py-3 font-semibold">Delivered by</th>
                          <th className="px-5 py-3 font-semibold">Delivered</th>
                          <th className="px-5 py-3 text-right font-semibold">Owed</th>
                          <th className="px-5 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {data.unpaid.map((o) => (
                          <tr key={o.id} className="border-b border-hairline last:border-0 hover:bg-surface">
                            <td className="px-5 py-3">
                              <p className="num font-semibold text-ink">{o.reference}</p>
                              <p className="text-[12px] text-muted">{humanise(o.channel)}</p>
                            </td>
                            <td className="px-5 py-3">
                              <p className="text-body">{fullName(o.customer)}</p>
                              <p className="num text-[12px] text-muted">{o.customer?.phone ?? '—'}</p>
                            </td>
                            {/* Who to ask. On a cash delivery the rider is the
                                one who was standing there. */}
                            <td className="px-5 py-3 text-body">{fullName(o.rider)}</td>
                            <td className="px-5 py-3 text-muted">{relative(o.deliveredAt)}</td>
                            <td className="num px-5 py-3 text-right font-semibold text-ink">
                              {naira(o.totalKobo)}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <Button size="sm" onClick={() => setRecording(o)}>
                                Record payment
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            ) : null}

            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Ledger</h2>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFilter(f.value)}
                    className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                      filter === f.value
                        ? 'bg-pink-600 text-white'
                        : 'bg-muted/10 text-body hover:bg-muted/20'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <Card>
              {data.payments.length === 0 ? (
                <EmptyState
                  title={filter ? `Nothing ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()}` : 'No payments yet'}
                  hint="A payment lands here when a card clears, or when ops records cash or a transfer against an order."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[52rem] text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                        <th className="px-5 py-3 font-semibold">Order</th>
                        <th className="px-5 py-3 font-semibold">Customer</th>
                        <th className="px-5 py-3 font-semibold">How</th>
                        <th className="px-5 py-3 font-semibold">Reference</th>
                        <th className="px-5 py-3 text-right font-semibold">Amount</th>
                        <th className="px-5 py-3 font-semibold">Status</th>
                        <th className="px-5 py-3 font-semibold">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.map((p) => {
                        const part =
                          p.order && p.status === 'SUCCESS' && p.amountKobo < p.order.totalKobo;
                        return (
                          <tr key={p.id} className="border-b border-hairline last:border-0 hover:bg-surface">
                            <td className="px-5 py-3">
                              <p className="num font-semibold text-ink">{p.order?.reference ?? '—'}</p>
                              <p className="text-[12px] text-muted">{humanise(p.order?.channel)}</p>
                            </td>
                            <td className="px-5 py-3">
                              <p className="text-body">{fullName(p.order?.customer)}</p>
                              <p className="num text-[12px] text-muted">
                                {p.order?.customer?.phone ?? '—'}
                              </p>
                            </td>
                            <td className="px-5 py-3">
                              <p className="text-body">{humanise(p.provider)}</p>
                              {/* Whose word it is. Gateway rows have nobody, and
                                  that absence is itself the useful signal. */}
                              {p.recordedBy ? (
                                <p className="text-[12px] text-muted">by {p.recordedBy.name}</p>
                              ) : null}
                            </td>
                            <td className="px-5 py-3">
                              <p className="num text-[12px] text-muted">{p.reference ?? '—'}</p>
                              {p.note ? (
                                <p className="max-w-[18rem] text-[12px] text-muted">{p.note}</p>
                              ) : null}
                            </td>
                            <td className="num px-5 py-3 text-right font-semibold text-ink">
                              {naira(p.amountKobo)}
                              {part ? (
                                <span className="block text-[11px] font-semibold text-warning">
                                  of {naira(p.order!.totalKobo)}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-5 py-3">
                              <Pill tone={TONES[p.status]} label={humanise(p.status)} />
                            </td>
                            <td className="px-5 py-3 text-muted">{dateTime(p.paidAt ?? p.createdAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>

      <RecordPayment order={recording} onClose={() => setRecording(null)} />
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: string;
  hint?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`num mt-1 text-xl font-bold ${tone}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-muted">{hint}</p> : null}
    </Card>
  );
}

/**
 * Recording a payment asserts that money changed hands. It cannot be undone
 * from here — reversing it is a refund, which puts the money in the customer's
 * wallet — so the confirmation says the amount, the order and the method.
 */
function RecordPayment({ order, onClose }: { order: UnpaidOrder | null; onClose: () => void }) {
  const record = useRecordPayment();

  const [provider, setProvider] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const reset = () => {
    setProvider('CASH');
    setAmount('');
    setReference('');
    setNote('');
    record.reset();
    onClose();
  };

  // Naira in the field, kobo on the wire. Blank means the whole outstanding
  // amount, which is what ops means nearly every time.
  const typed = Number(amount);
  const amountKobo = amount.trim() === '' ? undefined : Math.round(typed * 100);
  const invalid = amountKobo !== undefined && (!Number.isFinite(typed) || amountKobo < 1);

  return (
    <Modal
      open={order !== null}
      title="Record a payment"
      onClose={reset}
      footer={
        <>
          <Button variant="secondary" onClick={reset} disabled={record.isPending}>
            Cancel
          </Button>
          <Button
            loading={record.isPending}
            disabled={invalid}
            onClick={() => {
              if (!order) return;
              record.mutate(
                {
                  orderId: order.id,
                  provider,
                  ...(amountKobo !== undefined ? { amountKobo } : {}),
                  ...(reference.trim() ? { reference: reference.trim() } : {}),
                  ...(note.trim() ? { note: note.trim() } : {}),
                },
                { onSuccess: reset }
                // Stays open on failure: "already paid in full" belongs next to
                // the button that caused it.
              );
            }}
          >
            {order && amountKobo === undefined
              ? `Confirm ${naira(order.totalKobo)} received`
              : 'Confirm received'}
          </Button>
        </>
      }
    >
      {order === null ? null : (
        <div className="grid gap-4">
          <p className="text-body">
            <strong className="text-ink">{order.reference}</strong> for {fullName(order.customer)} —{' '}
            <strong className="text-ink">{naira(order.totalKobo)}</strong> outstanding.
          </p>

          <Field label="How it arrived">
            <div className="flex gap-2">
              {(
                [
                  { value: 'CASH', label: 'Cash' },
                  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
                ] as const
              ).map((o) => (
                <button
                  key={o.value}
                  onClick={() => setProvider(o.value)}
                  className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                    provider === o.value
                      ? 'bg-pink-600 text-white'
                      : 'border border-hairline text-body hover:bg-surface'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Amount received" hint="Leave blank for the full outstanding amount.">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder={(order.totalKobo / 100).toString()}
              className={inputClass}
            />
          </Field>

          <Field
            label={provider === 'BANK_TRANSFER' ? 'Transfer reference' : 'Reference'}
            hint="Optional. One is generated if you leave this blank."
          >
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={provider === 'BANK_TRANSFER' ? 'From the bank alert' : ''}
              className={inputClass}
            />
          </Field>

          <Field label="Note" hint="Who handed it over, or why the amount differs.">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </Field>

          <p className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">
            This goes on the books in your name and cannot be undone here. Reversing it means
            refunding the customer.
          </p>

          {record.isError ? (
            <p role="alert" className="rounded-lg bg-error/10 px-3 py-2 text-[13px] text-error">
              {record.error instanceof Error ? record.error.message : 'That could not be recorded.'}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

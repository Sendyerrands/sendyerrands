import { useState } from 'react';

import {
  Button,
  ErrorState,
  Field,
  Loading,
  Pill,
  StatusPill,
  inputClass,
} from '@/components/ui';
import { dateTime, fullName, humanise, naira } from '@/lib/format';
import {
  useAssignRider,
  useOrder,
  useRefundOrder,
  useRiders,
  useSetOrderStatus,
} from '@/lib/hooks';
import type { OrderStatus } from '@/lib/types';

/**
 * Mirrors the server's transition table in `api/src/services/orders.ts`.
 *
 * The API is still the authority — it rejects an illegal jump — but offering
 * only legal moves means ops never picks something that is going to bounce.
 * Keep this in step if the server table changes.
 *
 * PENDING_PAYMENT is never a *destination*: an order becomes payable by the
 * customer paying, not by ops rewinding it. The admin endpoint's own schema
 * omits it too.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['PLACED', 'CANCELLED'],
  PLACED: ['VENDOR_ACCEPTED', 'RIDER_ASSIGNED', 'CANCELLED'],
  VENDOR_ACCEPTED: ['RIDER_ASSIGNED', 'CANCELLED'],
  RIDER_ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
};

/**
 * Side panel for a single order: the audit trail plus the three ops actions.
 *
 * Actions are deliberately gated on the order's own state — a delivered order
 * can't be reassigned, and a refunded one can't be refunded twice. The API
 * enforces this too; hiding the controls just stops ops hitting an error wall.
 */
export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { data: order, isLoading, isError, error, refetch } = useOrder(orderId);

  if (!orderId) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} role="presentation" aria-hidden />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Order detail"
        className="relative z-10 flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
      >
        <header className="flex flex-none items-center justify-between border-b border-hairline px-6 py-4">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-ink">
              {order?.reference ?? 'Order'}
            </p>
            {order ? (
              <p className="text-[12px] text-muted">
                {humanise(order.type)} · {dateTime(order.createdAt)}
              </p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-muted hover:bg-surface"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <Loading />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : order ? (
            <Body order={order} onDone={onClose} />
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Body({
  order,
  onDone,
}: {
  order: NonNullable<ReturnType<typeof useOrder>['data']>;
  onDone: () => void;
}) {
  const isClosed = order.status === 'DELIVERED' || order.status === 'CANCELLED' || order.status === 'REFUNDED';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={order.status} />
        {order.deliveryCode ? (
          <Pill tone="bg-pink-50 text-pink-600" label={`Delivery code ${order.deliveryCode}`} />
        ) : null}
      </div>

      {/* money */}
      <section>
        <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Payment</h4>
        <dl className="space-y-1.5 text-sm">
          <Row label="Subtotal" value={naira(order.subtotalKobo)} />
          <Row label="Delivery fee" value={naira(order.deliveryFeeKobo)} />
          <Row label="Service fee" value={naira(order.serviceFeeKobo)} />
          <Row label="Rider payout" value={naira(order.riderPayoutKobo)} muted />
          <div className="!mt-2 border-t border-hairline pt-2">
            <Row label="Total" value={naira(order.totalKobo)} bold />
          </div>
        </dl>
        {order.payments.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {order.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 text-[13px]">
                <span className="min-w-0 text-body">
                  {humanise(p.provider)} · {humanise(p.status)}
                  {/* Cash and transfers have no external record to check, so the
                      only control on "this arrived" is whose word it is. */}
                  {p.recordedBy ? (
                    <span className="text-muted"> · recorded by {p.recordedBy.name}</span>
                  ) : null}
                </span>
                <span className="num whitespace-nowrap text-muted">{naira(p.amountKobo)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* people */}
      <section>
        <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">People</h4>
        <dl className="space-y-1.5 text-sm">
          <Row label="Customer" value={fullName(order.customer)} />
          <Row label="Phone" value={order.customer?.phone ?? '—'} />
          {order.vendor ? <Row label="Vendor" value={order.vendor.name} /> : null}
          <Row
            label="Rider"
            value={order.rider ? `${fullName(order.rider)} · ${order.rider.phone}` : 'Unassigned'}
          />
        </dl>
      </section>

      {/* where */}
      {order.address ? (
        <section>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
            Drop-off
          </h4>
          <p className="text-sm text-ink">{order.address.line1}</p>
          {order.address.line2 ? (
            <p className="text-sm text-body">{order.address.line2}</p>
          ) : null}
          {order.address.landmark ? (
            <p className="text-[13px] text-muted">Landmark: {order.address.landmark}</p>
          ) : null}
          <p className="mt-1 text-[13px] text-muted">
            {order.address.contact} · {order.address.phone}
          </p>
        </section>
      ) : null}

      {/* what */}
      {order.items.length > 0 ? (
        <section>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Items</h4>
          <ul className="space-y-1.5">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between text-sm">
                <span className="text-body">
                  {i.quantity}× {i.name}
                </span>
                <span className="num text-ink">{naira(i.unitPriceKobo * i.quantity)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {order.errandDetail ? (
        <section>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Errand</h4>
          <p className="text-sm text-ink">{order.errandDetail.task}</p>
          {order.errandDetail.budgetKobo ? (
            <p className="text-[13px] text-muted">
              Budget {naira(order.errandDetail.budgetKobo)}
            </p>
          ) : null}
        </section>
      ) : null}

      {order.packageDetail ? (
        <section>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Package</h4>
          <p className="text-sm text-ink">{humanise(order.packageDetail.size)}</p>
          {order.packageDetail.description ? (
            <p className="text-[13px] text-muted">{order.packageDetail.description}</p>
          ) : null}
        </section>
      ) : null}

      {/* audit trail */}
      <section>
        <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
          Timeline
        </h4>
        <ol className="space-y-3">
          {order.events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-pink-600" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">{humanise(e.status)}</p>
                <p className="text-[12px] text-muted">
                  {dateTime(e.createdAt)}
                  {e.actorType ? ` · by ${e.actorType.toLowerCase()}` : ''}
                </p>
                {e.note ? <p className="text-[13px] text-body">{e.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Actions order={order} isClosed={isClosed} onDone={onDone} />
    </div>
  );
}

function Actions({
  order,
  isClosed,
  onDone,
}: {
  order: NonNullable<ReturnType<typeof useOrder>['data']>;
  isClosed: boolean;
  onDone: () => void;
}) {
  const assign = useAssignRider();
  const setStatus = useSetOrderStatus();
  const refund = useRefundOrder();

  // Only approved riders can be assigned; the API rejects anyone else.
  const { data: riders } = useRiders('APPROVED');

  const [riderId, setRiderId] = useState('');
  const [nextStatus, setNextStatus] = useState<OrderStatus | ''>('');
  const [note, setNote] = useState('');
  const [refundNaira, setRefundNaira] = useState(String(order.totalKobo / 100));
  const [reason, setReason] = useState('');

  const busy = assign.isPending || setStatus.isPending || refund.isPending;
  const failure = assign.error ?? setStatus.error ?? refund.error;

  const allowed = TRANSITIONS[order.status] ?? [];

  const alreadyRefunded = order.status === 'REFUNDED';

  return (
    <section className="border-t border-hairline pt-5">
      <h4 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted">Actions</h4>

      {failure ? (
        <p role="alert" className="mb-3 rounded-lg bg-error/10 px-3 py-2 text-[13px] text-error">
          {failure instanceof Error ? failure.message : 'That action failed.'}
        </p>
      ) : null}

      <div className="space-y-5">
        {!isClosed ? (
          <div>
            <Field label="Assign rider" hint="Only approved riders appear here.">
              <div className="flex gap-2">
                <select
                  value={riderId}
                  onChange={(e) => setRiderId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Choose a rider…</option>
                  {(riders ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {fullName(r)} · {r.isOnline ? 'online' : 'offline'} · {r.completedJobs} jobs
                    </option>
                  ))}
                </select>
                <Button
                  size="md"
                  disabled={!riderId || busy}
                  loading={assign.isPending}
                  onClick={() => assign.mutate({ orderId: order.id, riderId })}
                >
                  Assign
                </Button>
              </div>
            </Field>
            {order.rider ? (
              <p className="mt-1 text-[12px] text-muted">
                Currently {fullName(order.rider)}. Reassigning requires unassigning first.
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <Field
            label="Override status"
            hint="For stuck orders. Only moves the state machine allows are listed; each one is written to the timeline."
          >
            <div className="flex gap-2">
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as OrderStatus)}
                disabled={allowed.length === 0}
                className={inputClass}
              >
                <option value="">
                  {allowed.length === 0 ? 'No moves left from here' : 'Choose a status…'}
                </option>
                {allowed.map((s) => (
                  <option key={s} value={s}>
                    {humanise(s)}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={!nextStatus || busy}
                loading={setStatus.isPending}
                onClick={() =>
                  nextStatus &&
                  setStatus.mutate({
                    orderId: order.id,
                    status: nextStatus,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  })
                }
              >
                Apply
              </Button>
            </div>
          </Field>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Reason (optional, saved to the timeline)"
            className={`${inputClass} mt-2`}
          />
        </div>

        <div>
          <Field
            label="Refund to wallet"
            hint="Credits the customer's Sendy Errands Wallet instantly and marks the order refunded."
          >
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={order.totalKobo / 100}
                value={refundNaira}
                onChange={(e) => setRefundNaira(e.target.value)}
                disabled={alreadyRefunded}
                className={inputClass}
              />
              <Button
                variant="danger"
                disabled={alreadyRefunded || busy || !refundNaira}
                loading={refund.isPending}
                onClick={() =>
                  refund.mutate(
                    {
                      orderId: order.id,
                      // The API takes kobo; this field is naira for the human.
                      amountKobo: Math.round(Number(refundNaira) * 100),
                      ...(reason.trim() ? { reason: reason.trim() } : {}),
                    },
                    { onSuccess: onDone }
                  )
                }
              >
                Refund
              </Button>
            </div>
          </Field>
          {alreadyRefunded ? (
            <p className="mt-1 text-[12px] text-muted">This order has already been refunded.</p>
          ) : (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Refund reason (optional)"
              className={`${inputClass} mt-2`}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? 'text-muted' : 'text-body'}>{label}</dt>
      <dd className={`num ${bold ? 'font-bold text-ink' : muted ? 'text-muted' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  );
}

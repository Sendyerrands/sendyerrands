import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/Layout';
import { OrderDrawer } from '@/components/OrderDrawer';
import { Card, EmptyState, ErrorState, Loading, StatusPill, inputClass } from '@/components/ui';
import { dateTime, fullName, humanise, naira } from '@/lib/format';
import { useOrders } from '@/lib/hooks';
import type { OrderChannel, OrderStatus, OrderType } from '@/lib/types';

const STATUSES: OrderStatus[] = [
  'QUOTE_REQUESTED',
  'PRICE_PROPOSED',
  'MERCHANT_PAID',
  'PENDING_PAYMENT',
  'PLACED',
  'VENDOR_ACCEPTED',
  'RIDER_ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DOORSTEP',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
];

const TYPES: OrderType[] = ['FOOD', 'PACKAGE', 'ERRAND', 'MARKETPLACE', 'SERVICE'];

/**
 * "Website" rather than "Web": ops read this column to know where a customer
 * came from and how to reach them back. A website booking has no app account
 * behind it — the customer record was minted from the phone number they typed,
 * so WhatsApp is the only way to reach them.
 */
const CHANNEL_LABEL: Record<OrderChannel, string> = {
  APP: 'App',
  WEB: 'Website',
};

const CHANNELS: OrderChannel[] = ['APP', 'WEB'];

export function Orders() {
  // Deep links: /orders?open=<id> from the dashboard, ?q=<phone> from Customers.
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');

  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [channel, setChannel] = useState('');
  const [q, setQ] = useState(params.get('q') ?? '');

  /**
   * Follow ?q= when it changes. The initial state covers arriving here, but
   * React Router keeps this component mounted between two links to it, so
   * without this the second link from Customers would quietly do nothing.
   */
  const linkedQuery = params.get('q');
  useEffect(() => {
    if (linkedQuery !== null) setQ(linkedQuery);
  }, [linkedQuery]);

  const { data, isLoading, isError, error, refetch } = useOrders({ status, type, channel, q });

  const closeDrawer = () => {
    params.delete('open');
    setParams(params, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Assign riders, override a stuck status, or refund to the customer's wallet."
      />

      <div className="p-4 sm:p-8">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
              Search
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="SND-8841 or 0803…"
              className={`${inputClass} w-56`}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
              Status
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={`${inputClass} w-48`}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanise(s)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
              Type
            </span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={`${inputClass} w-44`}
            >
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanise(t)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
              Source
            </span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className={`${inputClass} w-40`}
            >
              <option value="">All sources</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </label>

          {status || type || channel || q ? (
            <button
              onClick={() => {
                setStatus('');
                setType('');
                setChannel('');
                setQ('');
              }}
              className="h-10 text-[13px] font-semibold text-pink-600 hover:underline"
            >
              Clear
            </button>
          ) : null}
        </div>

        <Card>
          {isLoading ? (
            <Loading />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : !data || data.length === 0 ? (
            <EmptyState title="No orders match" hint="Try clearing the filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-semibold">Reference</th>
                  <th className="px-5 py-3 font-semibold">Type</th>
                  <th className="px-5 py-3 font-semibold">Source</th>
                  <th className="px-5 py-3 font-semibold">Customer</th>
                  <th className="px-5 py-3 font-semibold">Vendor</th>
                  <th className="px-5 py-3 font-semibold">Rider</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                  <th className="px-5 py-3 text-right font-semibold">Placed</th>
                </tr>
              </thead>
              <tbody>
                {data.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setParams({ open: o.id }, { replace: true })}
                    className="cursor-pointer border-b border-hairline last:border-0 hover:bg-surface"
                  >
                    <td className="px-5 py-3 font-semibold text-pink-600">{o.reference}</td>
                    <td className="px-5 py-3 text-body">{humanise(o.type)}</td>
                    {/* Deliberately quieter than the status pill beside it.
                        Status is the column ops act on; source is context, and
                        a second coloured pill would dilute the first. Website
                        orders carry the emphasis because they are the ones with
                        no app account behind them. */}
                    <td className="px-5 py-3">
                      {o.channel === 'WEB' ? (
                        <span className="font-semibold text-body">{CHANNEL_LABEL.WEB}</span>
                      ) : (
                        <span className="text-muted">{CHANNEL_LABEL.APP}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-body">{fullName(o.customer)}</td>
                    <td className="px-5 py-3 text-body">{o.vendor?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-body">
                      {o.rider ? (
                        fullName(o.rider)
                      ) : (
                        <span className="font-semibold text-warning">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={o.status} />
                    </td>
                    <td className="num px-5 py-3 text-right font-semibold text-ink">
                      {naira(o.totalKobo)}
                    </td>
                    <td className="px-5 py-3 text-right text-muted">{dateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}
        </Card>

        {data && data.length >= 100 ? (
          <p className="mt-3 text-[12px] text-muted">
            Showing the 100 most recent. Narrow the filters to see older orders.
          </p>
        ) : null}
      </div>

      <OrderDrawer orderId={openId} onClose={closeDrawer} />
    </>
  );
}

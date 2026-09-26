import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/Layout';
import { Card, EmptyState, ErrorState, Loading, Pill } from '@/components/ui';
import { dateTime, fullName, naira, relative } from '@/lib/format';
import { useCustomers } from '@/lib/hooks';
import type { Customer } from '@/lib/types';

/**
 * The customer directory, replacing the PHP admin's customers.php.
 *
 * Read-only. Ops comes here to answer "who is this number calling me" and "have
 * they ordered before" — not to edit anybody, which happens on the order or the
 * refund that actually caused the change.
 */

/** Typing is debounced so each keystroke is not a request. */
function useDebounced(value: string, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export function Customers() {
  const [query, setQuery] = useState('');
  const search = useDebounced(query);
  const { data, isLoading, isError, error, refetch } = useCustomers(search);

  const customers = data ?? [];

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Everyone who has ordered, from the app or the website. Spend is what was collected, not what was ordered."
      />

      <div className="p-4 sm:p-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone or email"
            className="min-w-0 flex-1 rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-pink-600 sm:max-w-sm"
          />
          {data ? (
            <p className="text-[13px] text-muted">
              {customers.length}
              {/* The endpoint caps at 200. Saying so beats a page that silently
                  stops listing people who exist. */}
              {customers.length === 200 ? '+ (narrow the search)' : ''}
            </p>
          ) : null}
        </div>

        {isLoading ? (
          <Card>
            <Loading />
          </Card>
        ) : isError ? (
          <Card>
            <ErrorState error={error} onRetry={() => refetch()} />
          </Card>
        ) : customers.length === 0 ? (
          <Card>
            <EmptyState
              title={search ? 'Nobody matches that' : 'No customers yet'}
              hint={
                search
                  ? 'Try just the last four digits of the phone number.'
                  : 'A customer record appears on the first order, from either the app or the website.'
              }
            />
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-semibold">Customer</th>
                    <th className="px-5 py-3 font-semibold">Contact</th>
                    <th className="px-5 py-3 text-right font-semibold">Orders</th>
                    <th className="px-5 py-3 text-right font-semibold">Spent</th>
                    <th className="px-5 py-3 text-right font-semibold">Wallet</th>
                    <th className="px-5 py-3 font-semibold">Last order</th>
                    <th className="px-5 py-3 font-semibold">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <Row key={c.id} customer={c} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function Row({ customer: c }: { customer: Customer }) {
  // ['WEB'] alone: the record was minted by a website booking and has never been
  // signed into, so there is no password to reset and no app to notify them on.
  const webOnly = c.channels.length === 1 && c.channels[0] === 'WEB';

  return (
    <tr className="border-b border-hairline last:border-0 hover:bg-surface">
      <td className="px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink">{fullName(c)}</p>
          {!c.isActive ? <Pill tone="bg-error/10 text-error" label="Disabled" /> : null}
          {webOnly ? <Pill tone="bg-muted/15 text-body" label="Website only" /> : null}
          {c._count.supportRequests > 0 ? (
            <Pill
              tone="bg-warning/10 text-warning"
              label={`${c._count.supportRequests} support`}
            />
          ) : null}
        </div>
      </td>
      <td className="px-5 py-3">
        {/* Links to their orders rather than opening a detail page that would
            only repeat this row — the orders search matches on phone. */}
        <Link
          to={`/orders?q=${encodeURIComponent(c.phone)}`}
          className="num font-semibold text-pink-600 hover:underline"
        >
          {c.phone}
        </Link>
        <p className="truncate text-[12px] text-muted">{c.email ?? 'No email on file'}</p>
      </td>
      <td className="num px-5 py-3 text-right text-body">{c._count.orders}</td>
      <td className="num px-5 py-3 text-right font-semibold text-ink">
        {c.totalSpentKobo > 0 ? naira(c.totalSpentKobo) : '—'}
      </td>
      {/* Usually zero. It is non-zero when they have been refunded, which is
          exactly when someone is asking about it. */}
      <td className="num px-5 py-3 text-right text-muted">
        {c.walletBalanceKobo > 0 ? naira(c.walletBalanceKobo) : '—'}
      </td>
      <td className="px-5 py-3 text-muted">{c.lastOrderAt ? relative(c.lastOrderAt) : '—'}</td>
      <td className="px-5 py-3 text-muted">{dateTime(c.createdAt)}</td>
    </tr>
  );
}

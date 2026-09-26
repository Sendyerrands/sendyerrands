import { useState } from 'react';

import { PageHeader } from '@/components/Layout';
import { Card, EmptyState, ErrorState, Loading } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { useSupportRequests, useUpdateSupportRequest } from '@/lib/hooks';
import type { SupportCategory, SupportRequest, SupportStatus } from '@/lib/types';

const TABS: { value: SupportStatus; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'RESOLVED', label: 'Resolved' },
];

const CATEGORY: Record<SupportCategory, string> = {
  ORDER_ISSUE: 'Order issue',
  MISSING_ITEM: 'Missing item',
  DELIVERY_PROBLEM: 'Delivery problem',
  REFUND_REQUEST: 'Refund request',
  PAYMENT_ISSUE: 'Payment issue',
  GENERAL: 'General',
};

/** A refund or a missing item is money or goods; the rest is a question. */
const URGENT: SupportCategory[] = ['REFUND_REQUEST', 'MISSING_ITEM', 'PAYMENT_ISSUE'];

function waLink(phone: string | null, name: string) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  const text = encodeURIComponent(`Hello ${name.split(' ')[0]} 👋\n\nAbout your message to Sendy Errands:`);
  return `https://wa.me/${digits}?text=${text}`;
}

export function Support() {
  const [tab, setTab] = useState<SupportStatus>('OPEN');
  const { data, isLoading, isError, error, refetch } = useSupportRequests(tab);
  const update = useUpdateSupportRequest();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const requests = data?.requests ?? [];

  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Requests from the website. Replies happen on WhatsApp or by email — this is where you track that they were dealt with."
      />

      <div className="p-4 sm:p-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {TABS.map((t) => {
            const n = data?.counts?.[t.value];
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                  active ? 'bg-pink-600 text-white' : 'bg-muted/10 text-body hover:bg-muted/20'
                }`}
              >
                {t.label}
                {typeof n === 'number' ? (
                  <span className={active ? 'ml-1.5 opacity-80' : 'ml-1.5 text-muted'}>{n}</span>
                ) : null}
              </button>
            );
          })}
          {data && data.unread > 0 ? (
            <span className="ml-1 rounded-full bg-warning/10 px-3 py-1.5 text-[12.5px] font-semibold text-warning">
              {data.unread} never opened
            </span>
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
        ) : requests.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing here"
              hint="Requests sent from the website's support form land in this queue."
            />
          </Card>
        ) : (
          <div className="grid gap-3">
            {requests.map((r: SupportRequest) => {
              const wa = waLink(r.phone ?? r.user?.phone ?? null, r.name);
              return (
                <Card key={r.id}>
                  <div className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Unread is its own signal: an open request someone
                              has read is not the same as one nobody has seen. */}
                          {!r.readAt ? (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-bold text-warning">
                              New
                            </span>
                          ) : null}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              URGENT.includes(r.category)
                                ? 'bg-error/10 text-error'
                                : 'bg-muted/15 text-body'
                            }`}
                          >
                            {CATEGORY[r.category]}
                          </span>
                          <span className="font-mono text-[12px] text-muted">{r.reference}</span>
                          {r.order ? (
                            <span className="font-mono text-[12px] text-muted">
                              · {r.order.reference}
                            </span>
                          ) : null}
                        </div>
                        <h3 className="mt-2 text-[16px] font-semibold text-ink">{r.subject}</h3>
                      </div>
                      <span className="whitespace-nowrap text-[12px] text-muted">
                        {dateTime(r.createdAt)}
                      </span>
                    </div>

                    <p className="mt-3 max-w-[64ch] whitespace-pre-line text-[15px] text-body">
                      {r.message}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
                      <span>{r.name}</span>
                      {r.phone ? <span>{r.phone}</span> : null}
                      {r.email ? <span>{r.email}</span> : null}
                      {!r.user ? <span>No account</span> : null}
                    </div>

                    {r.internalNote ? (
                      <p className="mt-3 rounded-lg bg-muted/10 px-3 py-2 text-[13.5px] text-body">
                        <span className="font-semibold">Note:</span> {r.internalNote}
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {wa ? (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener"
                          onClick={() => update.mutate({ id: r.id, markRead: true })}
                          className="rounded-lg bg-pink-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-pink-700"
                        >
                          Reply on WhatsApp
                        </a>
                      ) : r.email ? (
                        <a
                          href={`mailto:${r.email}?subject=${encodeURIComponent('Re: ' + r.subject)}`}
                          onClick={() => update.mutate({ id: r.id, markRead: true })}
                          className="rounded-lg bg-pink-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-pink-700"
                        >
                          Reply by email
                        </a>
                      ) : (
                        <span className="text-[13px] text-muted">No phone or email given</span>
                      )}

                      {r.status !== 'IN_PROGRESS' && r.status !== 'RESOLVED' ? (
                        <button
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: r.id, status: 'IN_PROGRESS', markRead: true })}
                          className="rounded-lg border border-hairline px-3.5 py-2 text-[13px] font-semibold text-body hover:border-ink hover:text-ink disabled:opacity-60"
                        >
                          Mark in progress
                        </button>
                      ) : null}

                      {r.status !== 'RESOLVED' ? (
                        <button
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: r.id, status: 'RESOLVED', markRead: true })}
                          className="rounded-lg border border-hairline px-3.5 py-2 text-[13px] font-semibold text-body hover:border-ink hover:text-ink disabled:opacity-60"
                        >
                          Mark resolved
                        </button>
                      ) : (
                        <button
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: r.id, status: 'OPEN' })}
                          className="text-[13px] font-semibold text-muted hover:text-ink disabled:opacity-60"
                        >
                          Reopen
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setNoteFor(noteFor === r.id ? null : r.id);
                          setNote(r.internalNote ?? '');
                        }}
                        className="text-[13px] font-semibold text-muted hover:text-ink"
                      >
                        {r.internalNote ? 'Edit note' : 'Add note'}
                      </button>
                    </div>

                    {noteFor === r.id ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="What was done, or what still needs doing"
                          className="min-w-0 flex-1 rounded-lg border border-hairline px-3 py-2 text-[14px] outline-none focus:border-pink-600"
                        />
                        <button
                          disabled={update.isPending}
                          onClick={async () => {
                            await update.mutateAsync({ id: r.id, internalNote: note.trim() });
                            setNoteFor(null);
                          }}
                          className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
                        >
                          Save note
                        </button>
                      </div>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {update.isError ? (
          <p className="mt-3 text-[13px] font-semibold text-error">Couldn't update that request. Try again.</p>
        ) : null}
      </div>
    </>
  );
}

import { useState } from 'react';

import { PageHeader } from '@/components/Layout';
import { Card, EmptyState, ErrorState, Loading } from '@/components/ui';
import { dateTime, fullName } from '@/lib/format';
import { useModerateReview, useReviews } from '@/lib/hooks';
import type { Review, ReviewStatus } from '@/lib/types';

const TABS: { value: ReviewStatus; label: string; blurb: string }[] = [
  { value: 'PENDING', label: 'Pending', blurb: 'Waiting to be read. Nothing here is visible to customers yet.' },
  { value: 'PUBLISHED', label: 'Published', blurb: 'Live on the website.' },
  { value: 'HIDDEN', label: 'Hidden', blurb: 'Read and kept back. Not shown anywhere public.' },
];

/** Filled stars up to the rating, hollow after — readable without counting. */
function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-[13px] tracking-[0.12em] text-pink-600" aria-label={`Rated ${rating} out of 5`}>
      {'★'.repeat(rating)}
      <span className="text-muted/40">{'★'.repeat(Math.max(0, 5 - rating))}</span>
    </span>
  );
}

export function Reviews() {
  const [tab, setTab] = useState<ReviewStatus>('PENDING');
  const { data, isLoading, isError, error, refetch } = useReviews(tab);
  const moderate = useModerateReview();

  const counts = data?.counts;
  const reviews = data?.reviews ?? [];

  return (
    <>
      <PageHeader
        title="Reviews"
        subtitle="Customers rate an errand once it's done. Nothing appears on the website until it's published here."
      />

      <div className="p-4 sm:p-8">
        <div className="mb-4 flex flex-wrap gap-2">
          {TABS.map((t) => {
            const n = counts?.[t.value];
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
        </div>

        <p className="mb-4 text-[13px] text-muted">{TABS.find((t) => t.value === tab)?.blurb}</p>

        {isLoading ? (
          <Card>
            <Loading />
          </Card>
        ) : isError ? (
          <Card>
            <ErrorState error={error} onRetry={() => refetch()} />
          </Card>
        ) : reviews.length === 0 ? (
          <Card>
            <EmptyState
              title={tab === 'PENDING' ? 'Nothing waiting' : 'Nothing here'}
              hint={
                tab === 'PENDING'
                  ? 'New reviews land here as customers rate completed errands.'
                  : 'Reviews you publish or hide will show up here.'
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3">
            {reviews.map((r: Review) => (
              <Card key={r.id}>
                <div className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Stars rating={r.overallRating} />
                      <span className="ml-2 text-[13px] text-muted">
                        {r.customer ? fullName(r.customer) : 'Unknown customer'}
                        {r.order ? (
                          <>
                            {' · '}
                            <span className="font-mono">{r.order.reference}</span>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <span className="text-[12px] text-muted">{dateTime(r.createdAt)}</span>
                  </div>

                  {r.comment ? (
                    <p className="mt-3 max-w-[60ch] text-[15px] text-ink">{r.comment}</p>
                  ) : (
                    <p className="mt-3 text-[14px] italic text-muted">
                      Rating only — the customer left no comment.
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
                    {r.rider ? <span>Rider: {fullName(r.rider)}</span> : <span>No rider recorded</span>}
                    {typeof r.riderRating === 'number' ? <span>Rider rated {r.riderRating}/5</span> : null}
                    {typeof r.serviceRating === 'number' ? <span>Service rated {r.serviceRating}/5</span> : null}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {/* Only the status is changeable. Editing a customer's words
                        would publish something they did not write under their
                        own name. */}
                    {r.status !== 'PUBLISHED' ? (
                      <button
                        disabled={moderate.isPending}
                        onClick={() => moderate.mutate({ id: r.id, status: 'PUBLISHED' })}
                        className="rounded-lg bg-pink-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-pink-700 disabled:opacity-60"
                      >
                        Publish
                      </button>
                    ) : null}

                    {r.status !== 'HIDDEN' ? (
                      <button
                        disabled={moderate.isPending}
                        onClick={() => moderate.mutate({ id: r.id, status: 'HIDDEN' })}
                        className="rounded-lg border border-hairline px-3.5 py-2 text-[13px] font-semibold text-body hover:border-ink hover:text-ink disabled:opacity-60"
                      >
                        Hide
                      </button>
                    ) : null}

                    {r.status !== 'PENDING' ? (
                      <button
                        disabled={moderate.isPending}
                        onClick={() => moderate.mutate({ id: r.id, status: 'PENDING' })}
                        className="text-[13px] font-semibold text-muted hover:text-ink disabled:opacity-60"
                      >
                        Back to queue
                      </button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {moderate.isError ? (
          <p className="mt-3 text-[13px] font-semibold text-error">
            Couldn't update that review. Try again.
          </p>
        ) : null}
      </div>
    </>
  );
}

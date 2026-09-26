import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/Layout';
import { Card, ErrorState, Loading, inputClass } from '@/components/ui';
import { naira } from '@/lib/format';
import { useServices, useUpdateService, useUpdateServiceRules } from '@/lib/hooks';
import type { PricingRule, PricingRuleType, Service } from '@/lib/types';

const RULE_LABEL: Record<PricingRuleType, string> = {
  PER_KM: 'Per kilometre',
  PER_KG: 'Per kilogram',
  WAITING_TIME: 'Waiting time',
  URGENCY_MULTIPLIER: 'Urgency multiplier',
  FLAT_FEE: 'Flat fee',
};

/**
 * A multiplier is a bare number (1.30×); everything else is money. Saying which
 * is which matters — "150" and "1.30" mean very different things, and a column
 * of naira signs over a multiplier would be wrong.
 */
const isMultiplier = (t: PricingRuleType) => t === 'URGENCY_MULTIPLIER';

type Draft = {
  name: string;
  shortDescription: string;
  /** Naira, as typed. Converted to kobo on save. */
  fee: string;
  sortOrder: string;
  isActive: boolean;
  rules: { type: PricingRuleType; label: string; value: string; isActive: boolean }[];
};

function toDraft(s: Service): Draft {
  return {
    name: s.name,
    shortDescription: s.shortDescription ?? '',
    fee: String(s.baseFeeKobo / 100),
    sortOrder: String(s.sortOrder),
    isActive: s.isActive,
    rules: s.pricingRules.map((r: PricingRule) => ({
      type: r.type,
      label: r.label,
      value: r.value,
      isActive: r.isActive,
    })),
  };
}

export function Services() {
  const { data, isLoading, isError, error, refetch } = useServices();
  const updateService = useUpdateService();
  const updateRules = useUpdateServiceRules();

  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const open = data?.find((s) => s.id === openId) ?? null;

  // Reset the form whenever a different service is opened, so an edit started
  // on one service can never be saved onto another.
  useEffect(() => {
    setDraft(open ? toDraft(open) : null);
  }, [openId, open?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saving = updateService.isPending || updateRules.isPending;

  async function save() {
    if (!open || !draft) return;

    const feeNaira = Number(draft.fee);
    if (!Number.isFinite(feeNaira) || feeNaira < 0) return;

    await updateService.mutateAsync({
      id: open.id,
      name: draft.name.trim(),
      shortDescription: draft.shortDescription.trim(),
      baseFeeKobo: Math.round(feeNaira * 100),
      sortOrder: Number(draft.sortOrder) || 0,
      isActive: draft.isActive,
    });

    await updateRules.mutateAsync({
      id: open.id,
      rules: draft.rules.map((r) => ({
        type: r.type,
        label: r.label.trim(),
        value: r.value.trim(),
        isActive: r.isActive,
      })),
    });

    setSaved(open.id);
    setOpenId(null);
    window.setTimeout(() => setSaved(null), 4000);
  }

  return (
    <>
      <PageHeader
        title="Services"
        subtitle="The catalogue the website's booking form reads. Changing a price here changes what customers are quoted."
      />

      <div className="p-4 sm:p-8">
        <Card>
          {isLoading ? (
            <Loading />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-semibold">Service</th>
                    <th className="px-5 py-3 font-semibold">Slug</th>
                    <th className="px-5 py-3 text-right font-semibold">Starting from</th>
                    <th className="px-5 py-3 font-semibold">Pricing rules</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.map((s) => (
                    <tr key={s.id} className="border-b border-hairline last:border-0">
                      <td className="px-5 py-3">
                        <span className="font-semibold text-ink">{s.name}</span>
                        {s.shortDescription ? (
                          <span className="mt-0.5 block max-w-[28rem] text-[13px] text-muted">
                            {s.shortDescription}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 font-mono text-[13px] text-muted">{s.slug}</td>
                      <td className="num px-5 py-3 text-right font-semibold text-ink">
                        {naira(s.baseFeeKobo)}
                      </td>
                      <td className="px-5 py-3 text-body">
                        {s.pricingRules.length === 0 ? (
                          <span className="font-semibold text-warning">None set</span>
                        ) : (
                          s.pricingRules
                            .map((r) =>
                              isMultiplier(r.type) ? `${r.value}×` : `${naira(Number(r.value) * 100)}/km`
                            )
                            .join(' · ')
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            s.isActive ? 'bg-success/10 text-success' : 'bg-muted/15 text-body'
                          }`}
                        >
                          {s.isActive ? 'Live' : 'Hidden'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {saved === s.id ? (
                          <span className="text-[13px] font-semibold text-success">Saved</span>
                        ) : (
                          <button
                            onClick={() => setOpenId(openId === s.id ? null : s.id)}
                            className="text-[13px] font-semibold text-pink-600 hover:underline"
                          >
                            {openId === s.id ? 'Cancel' : 'Edit'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {open && draft ? (
          <Card className="mt-4">
            <div className="p-5 sm:p-6">
              <h2 className="text-[17px] font-semibold text-ink">
                Edit {open.name}
                <span className="ml-2 font-mono text-[13px] font-normal text-muted">{open.slug}</span>
              </h2>
              {/* Said plainly rather than left for someone to discover: the slug
                  is what the website's URLs and booking form use. */}
              <p className="mt-1 text-[13px] text-muted">
                The slug can't be changed — the website's links and booking form refer to it.
              </p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
                    Name
                  </span>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className={`${inputClass} w-full`}
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
                    Starting price (₦)
                  </span>
                  <input
                    value={draft.fee}
                    onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
                    inputMode="decimal"
                    className={`${inputClass} w-full`}
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
                    Short description
                  </span>
                  <input
                    value={draft.shortDescription}
                    onChange={(e) => setDraft({ ...draft, shortDescription: e.target.value })}
                    className={`${inputClass} w-full`}
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
                    Order in the list
                  </span>
                  <input
                    value={draft.sortOrder}
                    onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                    inputMode="numeric"
                    className={`${inputClass} w-full`}
                  />
                </label>

                <label className="flex items-end gap-2.5 pb-2.5">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                    className="h-4 w-4 accent-pink-600"
                  />
                  <span className="text-[14px] text-body">
                    Bookable on the website
                    <span className="block text-[12px] text-muted">
                      Unticked, it disappears from the booking form.
                    </span>
                  </span>
                </label>
              </div>

              <h3 className="mt-7 text-[14px] font-semibold text-ink">Pricing rules</h3>
              <p className="mt-1 text-[13px] text-muted">
                Added on top of the starting price. A multiplier scales the total; everything else is in naira.
              </p>

              <div className="mt-3 grid gap-3">
                {draft.rules.map((r, i) => (
                  <div key={`${r.type}-${i}`} className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                    <div>
                      <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
                        {RULE_LABEL[r.type]}
                      </span>
                      <input
                        value={r.label}
                        onChange={(e) => {
                          const rules = [...draft.rules];
                          rules[i] = { ...r, label: e.target.value };
                          setDraft({ ...draft, rules });
                        }}
                        className={`${inputClass} w-full`}
                      />
                    </div>
                    <div>
                      <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
                        {isMultiplier(r.type) ? 'Multiplier' : 'Amount (₦)'}
                      </span>
                      <input
                        value={r.value}
                        onChange={(e) => {
                          const rules = [...draft.rules];
                          rules[i] = { ...r, value: e.target.value };
                          setDraft({ ...draft, rules });
                        }}
                        inputMode="decimal"
                        className={`${inputClass} w-full`}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-pink-600 px-4 py-2 text-[14px] font-semibold text-white hover:bg-pink-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  onClick={() => setOpenId(null)}
                  className="text-[14px] font-semibold text-muted hover:text-ink"
                >
                  Cancel
                </button>
                {updateService.isError || updateRules.isError ? (
                  <span className="text-[13px] font-semibold text-error">
                    Couldn't save. Check the values and try again.
                  </span>
                ) : null}
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

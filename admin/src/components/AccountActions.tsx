import { useState } from 'react';

import { Button, Field, Modal, Pill, inputClass } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { relative } from '@/lib/format';
import { useAccount, useDeleteAccount, useRestoreAccount, useSuspendAccount } from '@/lib/hooks';
import type { AccountRole } from '@/lib/types';

/**
 * Suspend, restore and delete, for any kind of account.
 *
 * One component rather than four copies on four pages, because the dangerous
 * part is not the markup — it is the confirmation copy and the refusal, and
 * those must not drift between the riders table and the vendors table.
 *
 * WHAT THE TWO ACTIONS ACTUALLY DO, since the words are easy to blur:
 *
 *   Suspend  Reversible. Blocks sign-in on the next request, not in 30 days
 *            when the token expires, and hides the account from customers.
 *            Keeps every order, payment and payout row.
 *   Delete   Permanent, and refused by the API for any account that has
 *            traded — deleting those would blank the rider or vendor on past
 *            orders and take the payout ledger with it. The dialog reads the
 *            refusal before offering the button, so a delete that cannot work
 *            is never presented as if it could.
 */

type Mode = 'suspend' | 'restore' | 'delete';

export function AccountActions({
  role,
  id,
  name,
  suspendedAt,
  /** Compact omits the labels, for a table already dense with columns. */
  size = 'sm',
}: {
  role: AccountRole;
  id: string;
  name: string;
  suspendedAt: string | null;
  size?: 'sm' | 'md';
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const suspended = Boolean(suspendedAt);

  return (
    <>
      <div className="flex justify-end gap-1.5">
        {suspended ? (
          <Button size={size} variant="secondary" onClick={() => setMode('restore')}>
            Restore
          </Button>
        ) : (
          <Button size={size} variant="secondary" onClick={() => setMode('suspend')}>
            Suspend
          </Button>
        )}
        <Button size={size} variant="ghost" onClick={() => setMode('delete')}>
          Delete
        </Button>
      </div>

      {mode ? (
        <AccountDialog role={role} id={id} name={name} mode={mode} onClose={() => setMode(null)} />
      ) : null}
    </>
  );
}

/** The pill every account table shows, so the state is visible without opening anything. */
export function SuspendedPill({ suspendedAt }: { suspendedAt: string | null }) {
  if (!suspendedAt) return null;
  return <Pill tone="bg-error/10 text-error" label="Suspended" />;
}

function AccountDialog({
  role,
  id,
  name,
  mode,
  onClose,
}: {
  role: AccountRole;
  id: string;
  name: string;
  mode: Mode;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  // Read before deciding what to offer: the blockers come from the API, which
  // counts the rows, rather than from whatever the table happened to render.
  const { data: snapshot, isLoading } = useAccount(role, id);

  const suspend = useSuspendAccount();
  const restore = useRestoreAccount();
  const remove = useDeleteAccount();

  const pending = suspend.isPending || restore.isPending || remove.isPending;
  const error = suspend.error ?? restore.error ?? remove.error;

  const TITLES: Record<Mode, string> = {
    suspend: `Suspend ${name}`,
    restore: `Restore ${name}`,
    delete: `Delete ${name}`,
  };

  const run = () => {
    const done = { onSuccess: onClose };
    if (mode === 'suspend') suspend.mutate({ role, id, reason: reason.trim() }, done);
    else if (mode === 'restore') restore.mutate({ role, id }, done);
    else remove.mutate({ role, id }, done);
  };

  const blocked = mode === 'delete' && snapshot ? !snapshot.canDelete : false;

  return (
    <Modal
      open
      title={TITLES[mode]}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {/* Hidden, not disabled, when the API will refuse: a greyed button
              invites clicking and explains nothing. The reason is in the body. */}
          {blocked ? null : (
            <Button
              variant={mode === 'restore' ? 'primary' : 'danger'}
              onClick={run}
              loading={pending}
              disabled={isLoading || (mode === 'suspend' && reason.trim().length < 3)}
            >
              {mode === 'suspend' ? 'Suspend' : mode === 'restore' ? 'Restore' : 'Delete for good'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {mode === 'suspend' ? (
          <>
            <p className="text-body">
              They will be signed out and refused at the next request, and customers will stop
              seeing them. Nothing is deleted, and you can lift this at any time.
            </p>
            <Field
              label="Reason"
              hint="Shown to them when they are turned away, so make it something they can act on."
            >
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                autoFocus
                placeholder="Repeated no-shows — call the office"
                className={inputClass}
              />
            </Field>
          </>
        ) : null}

        {mode === 'restore' && snapshot ? (
          <>
            <p className="text-body">
              They will be able to sign in again immediately, and will come back exactly as they
              were before the suspension.
            </p>
            {snapshot.suspendedAt ? (
              <div className="rounded-lg bg-surface p-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Suspended {relative(snapshot.suspendedAt)}
                </p>
                <p className="text-body">{snapshot.suspendedReason ?? 'No reason recorded.'}</p>
              </div>
            ) : null}
          </>
        ) : null}

        {mode === 'delete' ? (
          isLoading ? (
            <p className="text-muted">Checking what this would affect…</p>
          ) : blocked && snapshot ? (
            <>
              <p className="font-semibold text-ink">This cannot be deleted.</p>
              <p className="text-body">
                {name} has {snapshot.blockers.join(', ')}. Deleting would erase that history rather
                than archive it — past orders would lose who handled them.
              </p>
              <p className="text-body">
                Suspend instead. It blocks sign-in straight away and can be lifted later.
              </p>
              {!snapshot.isSuspended ? (
                <Button
                  variant="danger"
                  onClick={() => suspend.mutate({ role, id, reason: 'Suspended by ops' }, { onSuccess: onClose })}
                  loading={suspend.isPending}
                >
                  Suspend instead
                </Button>
              ) : (
                <Pill tone="bg-error/10 text-error" label="Already suspended" />
              )}
            </>
          ) : (
            <>
              <p className="text-body">
                This is permanent and cannot be undone.{' '}
                {snapshot?.cascades ? `${snapshot.cascades} will go with it.` : null}
              </p>
              <p className="text-muted">
                Safe only because this account has never traded. Anything with orders, earnings or a
                wallet balance is refused.
              </p>
            </>
          )
        ) : null}

        {error ? (
          <p className="rounded-lg bg-error/10 px-3 py-2 text-error">
            {error instanceof ApiError ? error.message : 'That did not work. Try again.'}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { PageHeader } from '@/components/Layout';
import { Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/**
 * Account recovery, by hand.
 *
 * Stands in for the self-service reset flow, which is built and working but has
 * no email provider configured to deliver a code. Support takes the address over
 * the phone, types it here, and reads the generated password back.
 *
 * The password is generated rather than typed by whoever is on the call. An
 * operator choosing one produces "sendy123" every time, and it means a person
 * picked the credential for an account they do not own. It is shown once and
 * never stored readably — asking again produces a different one.
 *
 * Retire this page when RESEND_API_KEY is set. It is a workaround, and every day
 * it exists is a day someone's password travels down a phone line.
 */
type Role = 'customer' | 'rider' | 'vendor' | 'provider';

type ResetResult = { email: string; role: Role; name: string; password: string };

export function PasswordReset() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('customer');
  const [result, setResult] = useState<ResetResult | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = useMutation({
    mutationFn: () =>
      api<ResetResult>('/admin/password-reset', {
        method: 'POST',
        body: { email: email.trim(), role },
      }),
    onSuccess: (data) => {
      setResult(data);
      setCopied(false);
    },
  });

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.password);
    setCopied(true);
  };

  return (
    <>
      <PageHeader
        title="Password reset"
        subtitle="For customers who cannot sign in. Sets a new password and shows it once."
      />

      <Card className="max-w-xl p-5">
        <label className="block text-sm font-medium text-ink mb-1.5">Account email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setResult(null);
            reset.reset();
          }}
          placeholder="customer@example.com"
          className="w-full rounded-md border border-hairline px-3 py-2 text-sm outline-none focus:border-pink-600"
        />

        <label className="mt-4 block text-sm font-medium text-ink mb-1.5">Account type</label>
        {/* Wraps: a fourth pill overflows the row on a phone, and ops reads
            this screen on a phone while on a call. */}
        <div className="flex flex-wrap gap-2">
          {(['customer', 'rider', 'vendor', 'provider'] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRole(r);
                setResult(null);
                reset.reset();
              }}
              className={`rounded-full px-4 py-1.5 text-sm capitalize ${
                role === r ? 'bg-pink-600 text-white' : 'bg-surface text-body'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {/* The same address can hold a customer and a rider account, so the type
            is a real choice rather than a filter — picking the wrong one resets
            a different account, or none. */}
        <p className="mt-2 text-xs text-muted">
          One address can hold both a customer and a rider account. Reset the one they are
          trying to sign in to.
        </p>

        {reset.isError ? (
          <p className="mt-4 text-sm text-error">
            {reset.error instanceof ApiError
              ? reset.error.message
              : 'Could not reset that password.'}
          </p>
        ) : null}

        <div className="mt-5">
          <Button
            onClick={() => reset.mutate()}
            disabled={email.trim().length < 5 || reset.isPending}
          >
            {reset.isPending ? 'Resetting…' : 'Generate new password'}
          </Button>
        </div>
      </Card>

      {result ? (
        <Card className="mt-5 max-w-xl p-5">
          <p className="text-sm text-body">
            New password for <span className="font-semibold text-ink">{result.name}</span>{' '}
            <span className="text-muted">({result.email})</span>
          </p>

          {/* Monospace and widely spaced, because this gets read aloud down a
              phone line. The generator already avoids O/0 and l/1/I. */}
          <div className="mt-3 flex items-center gap-3">
            <code className="flex-1 rounded-md bg-surface px-4 py-3 font-mono text-lg tracking-[0.2em] text-ink">
              {result.password}
            </code>
            <Button variant="secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <p className="mt-4 text-sm text-body">
            This is shown once. Close this page and it is gone — resetting again produces a
            different password.
          </p>
          <p className="mt-2 text-sm text-body">
            Tell them to change it in the app: <strong>Profile → Change password</strong>. Until
            they do, you know a working credential to their account.
          </p>
        </Card>
      ) : null}
    </>
  );
}

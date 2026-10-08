import type { ButtonHTMLAttributes, ReactNode } from 'react';

import type { OrderStatus, RiderStatus } from '@/lib/types';

/* ─────────────────────────────────────────── buttons */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
};

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-pink-600 text-white hover:bg-pink-700 disabled:bg-pink-200',
  secondary: 'bg-white text-ink border border-hairline hover:bg-surface disabled:text-muted',
  danger: 'bg-error text-white hover:brightness-95 disabled:opacity-50',
  ghost: 'text-body hover:bg-surface disabled:text-muted',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition
        disabled:cursor-not-allowed
        ${size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm'}
        ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

/* ─────────────────────────────────────────── status pills */

/**
 * Colour carries meaning here: anything a human must act on is amber or red,
 * terminal-good is green, in-flight is blue. Text always accompanies it, so
 * colour is never the only signal.
 */
const ORDER_TONE: Record<OrderStatus, string> = {
  // Errand lane. QUOTE_REQUESTED and PRICE_PROPOSED are both waiting on
  // somebody — a rider to pick it up, a customer to accept — so both are amber.
  QUOTE_REQUESTED: 'bg-warning/10 text-warning',
  PRICE_PROPOSED: 'bg-warning/10 text-warning',
  // Paid the merchant: in flight, nothing for ops to do.
  MERCHANT_PAID: 'bg-info/10 text-info',
  // Not yet paid — nothing for ops to do, so it stays neutral rather than amber.
  PENDING_PAYMENT: 'bg-muted/15 text-body',
  PLACED: 'bg-warning/10 text-warning',
  VENDOR_ACCEPTED: 'bg-info/10 text-info',
  RIDER_ASSIGNED: 'bg-info/10 text-info',
  PICKED_UP: 'bg-info/10 text-info',
  IN_TRANSIT: 'bg-info/10 text-info',
  // At the door, waiting on the customer to come out — amber, someone is stood
  // outside.
  AT_DOORSTEP: 'bg-warning/10 text-warning',
  DELIVERED: 'bg-success/10 text-success',
  CANCELLED: 'bg-error/10 text-error',
  REFUNDED: 'bg-muted/15 text-body',
};

const RIDER_TONE: Record<RiderStatus, string> = {
  PENDING: 'bg-muted/15 text-body',
  IN_REVIEW: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-error/10 text-error',
  SUSPENDED: 'bg-error/10 text-error',
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return <Pill tone={ORDER_TONE[status] ?? 'bg-muted/15 text-body'} label={label(status)} />;
}

export function RiderPill({ status }: { status: RiderStatus }) {
  return <Pill tone={RIDER_TONE[status] ?? 'bg-muted/15 text-body'} label={label(status)} />;
}

export function Pill({ tone, label: text }: { tone: string; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${tone}`}>
      {text}
    </span>
  );
}

function label(value: string) {
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/* ─────────────────────────────────────────── surfaces */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-hairline bg-white ${className}`}>{children}</div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[15px] font-bold text-ink">{children}</h2>;
}

/* ─────────────────────────────────────────── async states */

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-pink-600 border-t-transparent" />
      {label}
    </div>
  );
}

/**
 * Error states name the actual failure. A dashboard that only says "Something
 * went wrong" costs an ops person a support ticket to find out the API is down.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="max-w-md text-sm text-error">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-16 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

/* ─────────────────────────────────────────── modal */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
        role="presentation"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-lg rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h3 className="text-[15px] font-bold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-muted hover:bg-surface"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-hairline px-5 py-4">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────── form fields */

export function Field({
  label: text,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-body">{text}</span>
      {children}
      {hint ? <span className="mt-1 block text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink ' +
  'outline-none focus:border-pink-600 focus:ring-2 focus:ring-pink-100';

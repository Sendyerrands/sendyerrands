import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import logo from '@/assets/logo.png';

import { useAuth } from '@/lib/auth';
import { useDashboard } from '@/lib/hooks';

/**
 * Grouped by what ops is doing, not alphabetically. "Payments" (money in) sits
 * next to "Payouts" (money out) deliberately — they are easy to confuse, and
 * seeing them as two rows is the point.
 */
const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/orders', label: 'Orders' },
  { to: '/customers', label: 'Customers' },
  { to: '/support', label: 'Support' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/riders', label: 'Riders' },
  { to: '/requests', label: 'Requests' },
  { to: '/vendors', label: 'Vendors' },
  { to: '/applications', label: 'Applications' },
  { to: '/payments', label: 'Payments' },
  { to: '/payouts', label: 'Payouts' },
  { to: '/services', label: 'Services' },
  { to: '/password-reset', label: 'Password reset' },
] as const;

export function Layout() {
  const { admin, signOut } = useAuth();
  // Only used for the queue badge; the dashboard page owns the real polling.
  const { data: stats } = useDashboard();

  const [open, setOpen] = useState(false);
  const location = useLocation();

  /**
   * Close on navigation.
   *
   * On mobile the drawer covers the page it just navigated to, so leaving it
   * open means every tap needs a second tap to see the result.
   */
  useEffect(() => setOpen(false), [location.pathname]);

  // Escape closes it, because a full-screen overlay with no visible way out is
  // the kind of thing ops hits at 2am on a phone.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="flex min-h-screen">
      {/* Scrim, mobile only — the sidebar is always visible from lg up. */}
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
          onClick={() => setOpen(false)}
          role="presentation"
          aria-hidden
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-none flex-col border-r border-hairline bg-white transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          {/*
            The logo sits on brand pink, not on the white sidebar.

            logo.png is a near-white line drawing — 95% of its visible pixels
            have luminance above 240, on a 63%-transparent background. Placed
            directly on white it renders perfectly and is invisible, which reads
            as a broken image rather than a contrast problem. Pink is the
            background it was drawn for.

            Imported rather than served from /public so Vite fingerprints it: an
            ops tool left open all day should not keep a stale logo after a
            rebrand.
          */}
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-pink-600 p-1">
            <img src={logo} alt="Sendy Errands" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight text-ink">Sendy Errands</p>
            <p className="text-[11px] leading-tight text-muted">Operations</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="-mr-1 rounded-lg px-2 py-1 text-muted hover:bg-surface lg:hidden"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          {NAV.map((item) => {
            const badge = item.to === '/riders' ? stats?.pendingVerifications : undefined;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) =>
                  `flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    isActive ? 'bg-pink-50 text-pink-600' : 'text-body hover:bg-surface'
                  }`
                }
              >
                {item.label}
                {badge ? (
                  <span className="rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-hairline px-5 py-4">
          <p className="truncate text-[13px] font-semibold text-ink">{admin?.name}</p>
          <p className="truncate text-[11px] text-muted">{admin?.email}</p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-pink-600">
            {admin?.role.toLowerCase()}
          </p>
          <button
            onClick={signOut}
            className="mt-3 text-[13px] font-semibold text-body hover:text-error"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden">
        {/* The only way back to navigation on a phone. */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-hairline bg-white px-4 py-3 lg:hidden">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="rounded-lg border border-hairline px-2.5 py-1.5 text-body hover:bg-surface"
          >
            ☰
          </button>
          <div className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-pink-600 p-0.5">
            <img src={logo} alt="" className="h-full w-full object-contain" />
          </div>
          <p className="text-sm font-bold text-ink">Sendy Errands Operations</p>
        </div>

        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="border-b border-hairline bg-white px-4 py-4 sm:px-8 sm:py-5">
      <h1 className="text-lg font-bold text-ink sm:text-xl">{title}</h1>
      {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
    </header>
  );
}

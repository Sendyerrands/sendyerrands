import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from '@/components/Layout';
import { UnauthorizedError } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/Login';
import { Orders } from '@/pages/Orders';
import { Requests } from '@/pages/Requests';
import { Riders } from '@/pages/Riders';
import { Applications } from '@/pages/Applications';
import { Customers } from '@/pages/Customers';
import { PasswordReset } from '@/pages/PasswordReset';
import { Payments } from '@/pages/Payments';
import { Payouts } from '@/pages/Payouts';
import { Reviews } from '@/pages/Reviews';
import { Services } from '@/pages/Services';
import { Support } from '@/pages/Support';
import { Vendors } from '@/pages/Vendors';

/**
 * A rejected token must not leave ops staring at a dead dashboard. Any 401/403
 * clears the session, which flips <Shell> back to the login screen.
 */
function handleAuthFailure(error: unknown) {
  if (error instanceof UnauthorizedError) {
    localStorage.removeItem('sendy.admin.token');
    localStorage.removeItem('sendy.admin.profile');
    // Full reload so every cached query is dropped with the session.
    if (!window.location.pathname.includes('login')) window.location.reload();
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthFailure }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Retrying a 4xx just delays showing the real problem.
      retry: (count, error) =>
        !(error instanceof UnauthorizedError) && count < 2,
    },
    mutations: { onError: handleAuthFailure },
  },
});

function Shell() {
  const { signedIn } = useAuth();

  if (!signedIn) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/services" element={<Services />} />
        <Route path="/reviews" element={<Reviews />} />
        <Route path="/support" element={<Support />} />
        <Route path="/riders" element={<Riders />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/payouts" element={<Payouts />} />
        <Route path="/password-reset" element={<PasswordReset />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

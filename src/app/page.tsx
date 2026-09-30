/** Server gate for the dashboard. QR/status polling has its own independent API checks. */
import { redirect } from 'next/navigation';
import { isAdmin } from '../server/auth';
import { Dashboard } from '../components/dashboard';

// Evaluate cookies/config at request time even when credentials are absent during a build.
export const dynamic = 'force-dynamic';

export default async function Page() {
  let authenticated = false;
  try {
    authenticated = await isAdmin();
  } catch {
    /* Login page explains missing setup. */
  }
  if (!authenticated) redirect('/login');
  return <Dashboard />;
}

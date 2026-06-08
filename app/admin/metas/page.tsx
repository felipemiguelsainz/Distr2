import { getCurrentProfile } from '@/lib/supabase/profile';
import { redirect } from 'next/navigation';
import { MetasClient } from './MetasClient';

// AppShell + tabs los provee app/admin/layout.tsx. Acá reforzamos admin-only.
export default async function MetasPage() {
  const profile = await getCurrentProfile();
  if (profile?.rol !== 'admin') redirect('/');

  const today = new Date();
  return <MetasClient defaultAnio={today.getFullYear()} defaultMes={today.getMonth() + 1} />;
}

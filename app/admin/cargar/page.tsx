import { getCurrentProfile } from '@/lib/supabase/profile';
import { redirect } from 'next/navigation';
import { CargarClient } from './CargarClient';

// AppShell + tabs los provee app/admin/layout.tsx. Acá reforzamos admin-only.
export default async function CargarPage() {
  const profile = await getCurrentProfile();
  if (profile?.rol !== 'admin') redirect('/');

  return <CargarClient />;
}

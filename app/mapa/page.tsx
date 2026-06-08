import { AppShell } from '@/components/layout/AppShell';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { MapaClientWrapper } from './MapaClientWrapper';

export default async function MapaPage() {
  // Light auth gate only — the heavy PDV payload is fetched client-side from
  // /api/mapa so the page shell (filters + empty map) paints immediately.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  return (
    <AppShell>
      {/* Negative margin to escape AppShell's content padding and fill viewport.
          Mobile padding is px-4 py-6 + a 56px (h-14) sticky top bar; desktop is
          px-6 py-8 with no top bar. Use dvh so mobile browser chrome is handled. */}
      <div className="-mx-4 -my-6 lg:-mx-6 lg:-my-8 h-[calc(100dvh-3.5rem)] lg:h-[100dvh]">
        <MapaClientWrapper />
      </div>
    </AppShell>
  );
}

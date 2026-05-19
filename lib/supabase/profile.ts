import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { Profile } from '@/lib/types';

/**
 * Returns the authenticated user's profile or null.
 * Memoized per request — duplicate calls in the same request reuse the result.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (data as Profile) ?? null;
});

/**
 * List of equipos for the admin sidebar — cached across requests
 * (vendedores rarely change). Invalidated by tag `vendedores` if needed.
 */
export const getAdminEquipos = unstable_cache(
  async (): Promise<string[]> => {
    const svc = createServiceClient();
    const { data: vRows } = await svc
      .from('vendedores')
      .select('equipo')
      .eq('activo', true)
      .not('equipo', 'is', null);

    return Array.from(
      new Set(
        (vRows ?? [])
          .map((v) => (v.equipo as string | null)?.trim())
          .filter((e): e is string => !!e && e !== 'SIN SUPERVISOR'),
      ),
    ).sort((a, b) => a.localeCompare(b));
  },
  ['adminEquipos'],
  { revalidate: 3600, tags: ['vendedores'] },
);

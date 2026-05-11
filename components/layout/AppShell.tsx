import { createClient } from '@/lib/supabase/server';
import { Sidebar } from './Sidebar';
import { Profile } from '@/lib/types';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: Profile | null = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    profile = data;
  }

  return (
    <div className="flex h-screen bg-[#060c1a]">
      {profile && (
        <Sidebar
          rol={profile.rol}
          nombre={profile.nombre}
          vendedorNombre={profile.vendedor_nombre}
        />
      )}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1280px] mx-auto px-6 py-8 animate-rise">{children}</div>
      </main>
    </div>
  );
}

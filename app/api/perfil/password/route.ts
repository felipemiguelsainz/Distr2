import { NextRequest, NextResponse } from 'next/server';
import { createClient as createRawClient } from '@supabase/supabase-js';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Cambia la contraseña del usuario logueado.
// - Flujo forzado (primer login): se llama sin currentPassword.
// - Flujo normal (/perfil): se pasa currentPassword y se verifica.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

  const { currentPassword, newPassword } = await request.json() as {
    currentPassword?: string; newPassword?: string;
  };

  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' }, { status: 400 });
  }

  // Verificación de la contraseña actual (solo flujo normal). Se usa un cliente
  // aislado sin persistencia para no tocar la sesión por cookies.
  if (currentPassword) {
    if (!user.email) {
      return NextResponse.json({ error: 'La cuenta no tiene email.' }, { status: 400 });
    }
    const verifier = createRawClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: signErr } = await verifier.auth.signInWithPassword({
      email: user.email, password: currentPassword,
    });
    if (signErr) {
      return NextResponse.json({ error: 'La contraseña actual es incorrecta.' }, { status: 400 });
    }
  }

  // Cambiar la contraseña del usuario de la sesión actual.
  const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updErr) {
    console.error('[perfil:password] updateUser', updErr);
    return NextResponse.json({ error: 'No se pudo cambiar la contraseña.' }, { status: 500 });
  }

  // Bajar el flag (RLS de profiles es self-select; el update va por service role).
  const svc = createServiceClient();
  await svc.from('profiles').update({ must_change_password: false }).eq('id', user.id);

  return NextResponse.json({ ok: true });
}

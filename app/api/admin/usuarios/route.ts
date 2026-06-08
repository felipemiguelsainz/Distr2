import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { Rol } from '@/lib/types';

/** Verifica que el usuario logueado sea admin. Devuelve null si OK. */
async function guardAdmin(): Promise<NextResponse | null> {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
  if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });
  return null;
}

// ── Listar cuentas existentes ───────────────────────────────
export async function GET() {
  const denied = await guardAdmin();
  if (denied) return denied;

  const svc = createServiceClient();
  const { data: list, error } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.error('[usuarios:GET] listUsers', error);
    return NextResponse.json({ error: 'No se pudieron leer las cuentas.' }, { status: 500 });
  }
  const { data: profiles } = await svc.from('profiles').select('id, nombre, rol, vendedor_nombre, equipo');
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const usuarios = list.users.map((u) => {
    const p = byId.get(u.id);
    return {
      id: u.id,
      email: u.email ?? '',
      nombre: p?.nombre ?? null,
      rol: (p?.rol ?? null) as Rol | null,
      vendedor_nombre: p?.vendedor_nombre ?? null,
      equipo: p?.equipo ?? null,
    };
  });

  return NextResponse.json({ usuarios });
}

// ── Crear una cuenta y linkearla ────────────────────────────
export async function POST(request: NextRequest) {
  const denied = await guardAdmin();
  if (denied) return denied;

  const { email, password, nombre, rol, target } = await request.json() as {
    email?: string; password?: string; nombre?: string; rol?: Rol; target?: string | null;
  };

  if (!email || !password || !rol) {
    return NextResponse.json({ error: 'Faltan email, contraseña o rol.' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });
  }
  if (!['admin', 'supervisor', 'vendedor'].includes(rol)) {
    return NextResponse.json({ error: 'Rol inválido.' }, { status: 400 });
  }
  if ((rol === 'supervisor' || rol === 'vendedor') && !target) {
    return NextResponse.json({ error: 'Elegí a quién linkear la cuenta.' }, { status: 400 });
  }

  const svc = createServiceClient();

  // 1) Crear el usuario en Supabase Auth (email + contraseña).
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    console.error('[usuarios:POST] createUser', createErr);
    const msg = createErr?.message?.includes('already')
      ? 'Ya existe una cuenta con ese email.'
      : 'No se pudo crear la cuenta.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 2) Crear el perfil que define rol y a quién/qué equipo ve.
  const vendedor_nombre = rol === 'vendedor' ? target! : rol === 'supervisor' ? target! : null;
  const equipo          = rol === 'supervisor' ? target! : null;

  const { error: profileErr } = await svc.from('profiles').insert({
    id: created.user.id,
    nombre: nombre || email,
    rol,
    vendedor_nombre,
    equipo,
  });

  if (profileErr) {
    // Rollback: borrar el auth user para no dejar cuentas huérfanas.
    await svc.auth.admin.deleteUser(created.user.id);
    console.error('[usuarios:POST] insert profile', profileErr);
    return NextResponse.json({ error: 'No se pudo guardar el perfil.' }, { status: 500 });
  }

  revalidateTag('vendedores', { expire: 0 });
  return NextResponse.json({ ok: true, id: created.user.id });
}

// ── Borrar una cuenta ───────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const denied = await guardAdmin();
  if (denied) return denied;

  const { id } = await request.json() as { id?: string };
  if (!id) return NextResponse.json({ error: 'Falta el id.' }, { status: 400 });

  // No permitir auto-borrado del admin logueado.
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (user?.id === id) {
    return NextResponse.json({ error: 'No podés borrar tu propia cuenta.' }, { status: 400 });
  }

  const svc = createServiceClient();
  // El perfil se borra solo por el ON DELETE CASCADE sobre auth.users.
  const { error } = await svc.auth.admin.deleteUser(id);
  if (error) {
    console.error('[usuarios:DELETE]', error);
    return NextResponse.json({ error: 'No se pudo borrar la cuenta.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

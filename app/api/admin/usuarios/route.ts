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

/** Contraseña temporal de 8 caracteres alfanuméricos (sin caracteres ambiguos). */
function genTempPassword(len = 8): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function isRol(r: unknown): r is Rol {
  return r === 'admin' || r === 'supervisor' || r === 'vendedor';
}

/** Deriva vendedor_nombre/equipo según el rol y el target elegido. */
function linkFor(rol: Rol, target: string | null) {
  return {
    vendedor_nombre: rol === 'vendedor' || rol === 'supervisor' ? target : null,
    equipo:          rol === 'supervisor' ? target : null,
  };
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
  const { data: profiles } = await svc
    .from('profiles')
    .select('id, nombre, rol, vendedor_nombre, equipo, activo, must_change_password');
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
      activo: p?.activo ?? true,
      must_change_password: p?.must_change_password ?? false,
    };
  });

  return NextResponse.json({ usuarios });
}

// ── Crear una cuenta con contraseña temporal ────────────────
export async function POST(request: NextRequest) {
  const denied = await guardAdmin();
  if (denied) return denied;

  const { email, nombre, rol, target } = await request.json() as {
    email?: string; nombre?: string; rol?: Rol; target?: string | null;
  };

  if (!email || !rol) {
    return NextResponse.json({ error: 'Faltan email o rol.' }, { status: 400 });
  }
  if (!isRol(rol)) {
    return NextResponse.json({ error: 'Rol inválido.' }, { status: 400 });
  }
  if ((rol === 'supervisor' || rol === 'vendedor') && !target) {
    return NextResponse.json({ error: 'Elegí a quién linkear la cuenta.' }, { status: 400 });
  }

  const svc = createServiceClient();
  const tempPassword = genTempPassword();

  // 1) Crear el usuario en Supabase Auth con la contraseña temporal.
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    console.error('[usuarios:POST] createUser', createErr);
    const msg = createErr?.message?.includes('already')
      ? 'Ya existe una cuenta con ese email.'
      : 'No se pudo crear la cuenta.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 2) Crear el perfil. must_change_password=true fuerza el cambio en el 1er login.
  const { vendedor_nombre, equipo } = linkFor(rol, target ?? null);
  const { error: profileErr } = await svc.from('profiles').insert({
    id: created.user.id,
    nombre: nombre || email,
    rol,
    vendedor_nombre,
    equipo,
    activo: true,
    must_change_password: true,
  });

  if (profileErr) {
    await svc.auth.admin.deleteUser(created.user.id); // rollback
    console.error('[usuarios:POST] insert profile', profileErr);
    return NextResponse.json({ error: 'No se pudo guardar el perfil.' }, { status: 500 });
  }

  revalidateTag('vendedores', { expire: 0 });
  // tempPassword se devuelve UNA sola vez para que el admin la comparta.
  return NextResponse.json({ ok: true, id: created.user.id, tempPassword });
}

// ── Actualizar cuenta: cambiar rol o activar/desactivar ─────
export async function PATCH(request: NextRequest) {
  const denied = await guardAdmin();
  if (denied) return denied;

  const { id, activo, rol, target } = await request.json() as {
    id?: string; activo?: boolean; rol?: Rol; target?: string | null;
  };
  if (!id) return NextResponse.json({ error: 'Falta el id.' }, { status: 400 });

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  const svc = createServiceClient();

  // Activar / desactivar
  if (typeof activo === 'boolean') {
    if (user?.id === id && activo === false) {
      return NextResponse.json({ error: 'No podés desactivar tu propia cuenta.' }, { status: 400 });
    }
    const { error } = await svc.from('profiles').update({ activo }).eq('id', id);
    if (error) {
      console.error('[usuarios:PATCH activo]', error);
      return NextResponse.json({ error: 'No se pudo actualizar el estado.' }, { status: 500 });
    }
    revalidateTag('vendedores', { expire: 0 });
    return NextResponse.json({ ok: true });
  }

  // Cambiar rol (relinkea vendedor/equipo según el nuevo rol)
  if (rol) {
    if (!isRol(rol)) return NextResponse.json({ error: 'Rol inválido.' }, { status: 400 });
    if ((rol === 'supervisor' || rol === 'vendedor') && !target) {
      return NextResponse.json({ error: 'Elegí a quién linkear la cuenta.' }, { status: 400 });
    }
    if (user?.id === id && rol !== 'admin') {
      return NextResponse.json({ error: 'No podés cambiar tu propio rol de admin.' }, { status: 400 });
    }
    const { vendedor_nombre, equipo } = linkFor(rol, target ?? null);
    const { error } = await svc.from('profiles').update({ rol, vendedor_nombre, equipo }).eq('id', id);
    if (error) {
      console.error('[usuarios:PATCH rol]', error);
      return NextResponse.json({ error: 'No se pudo cambiar el rol.' }, { status: 500 });
    }
    revalidateTag('vendedores', { expire: 0 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Nada para actualizar.' }, { status: 400 });
}

// ── Borrar una cuenta ───────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const denied = await guardAdmin();
  if (denied) return denied;

  const { id } = await request.json() as { id?: string };
  if (!id) return NextResponse.json({ error: 'Falta el id.' }, { status: 400 });

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (user?.id === id) {
    return NextResponse.json({ error: 'No podés borrar tu propia cuenta.' }, { status: 400 });
  }

  const svc = createServiceClient();
  const { error } = await svc.auth.admin.deleteUser(id);
  if (error) {
    console.error('[usuarios:DELETE]', error);
    return NextResponse.json({ error: 'No se pudo borrar la cuenta.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

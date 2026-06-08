'use client';

import { useEffect, useState, useCallback } from 'react';
import { Rol } from '@/lib/types';

interface Usuario {
  id: string;
  email: string;
  nombre: string | null;
  rol: Rol | null;
  vendedor_nombre: string | null;
  equipo: string | null;
  activo: boolean;
  must_change_password: boolean;
}

interface Props {
  supervisores: string[];
  vendedores: string[];
  currentUserId: string;
}

const ROL_LABEL: Record<Rol, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  vendedor: 'Vendedor',
};

const inputClass =
  'w-full px-3 py-[9px] text-[13px] bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[9px] text-[#09090b] caret-[#0c5cab] focus:outline-none focus:border-[rgba(12,92,171,0.4)] transition-all placeholder:text-[#9f9fa9]';
const labelClass =
  'block text-[11px] font-semibold text-[#71717a] mb-1.5 uppercase tracking-[0.04em]';

/** Selector de target (equipo o vendedor) según el rol. */
function TargetSelect({
  rol, value, onChange, supervisores, vendedores,
}: {
  rol: Rol; value: string; onChange: (v: string) => void;
  supervisores: string[]; vendedores: string[];
}) {
  if (rol === 'admin') return null;
  const opts = rol === 'supervisor' ? supervisores : vendedores;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">{rol === 'supervisor' ? '— Elegir equipo —' : '— Elegir vendedor —'}</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function UsuariosClient({ supervisores, vendedores, currentUserId }: Props) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<Rol>('vendedor');
  const [target, setTarget] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; pass: string } | null>(null);

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsuarios = useCallback(async () => {
    setLoadingList(true);
    const res = await fetch('/api/admin/usuarios');
    const data = await res.json();
    if (res.ok) setUsuarios(data.usuarios ?? []);
    setLoadingList(false);
  }, []);

  useEffect(() => { loadUsuarios(); }, [loadUsuarios]);
  useEffect(() => { setTarget(''); }, [rol]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTempPassword(null);

    if (!email) { setError('Completá el email.'); return; }
    if ((rol === 'supervisor' || rol === 'vendedor') && !target) {
      setError(rol === 'supervisor' ? 'Elegí el equipo/supervisor.' : 'Elegí el vendedor.');
      return;
    }

    setSaving(true);
    const res = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, nombre, rol, target: target || null }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) { setError(data.error ?? 'Error al crear la cuenta.'); return; }
    setTempPassword({ email, pass: data.tempPassword });
    setEmail(''); setNombre(''); setTarget('');
    loadUsuarios();
  }

  async function handleDelete(u: Usuario) {
    if (!confirm(`¿Borrar la cuenta de ${u.email}? Esta acción no se puede deshacer.`)) return;
    setBusyId(u.id);
    const res = await fetch('/api/admin/usuarios', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) { setError(data.error ?? 'Error al borrar.'); return; }
    loadUsuarios();
  }

  async function toggleActivo(u: Usuario) {
    setBusyId(u.id);
    const res = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, activo: !u.activo }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) { setError(data.error ?? 'Error al actualizar.'); return; }
    loadUsuarios();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-7">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">Usuarios</h1>
        <p className="text-[13px] text-[#71717a] mt-0.5">
          Crear cuentas con contraseña temporal y gestionar roles y estado
        </p>
      </div>

      {error && (
        <p className="text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[10px]">{error}</p>
      )}

      {/* Contraseña temporal — se muestra una sola vez */}
      {tempPassword && (
        <div className="bg-[#16a34a]/[0.06] border border-[#16a34a]/30 rounded-2xl px-5 py-4">
          <p className="text-[13px] font-semibold text-[#16a34a] mb-1">Cuenta creada para {tempPassword.email}</p>
          <p className="text-[12px] text-[#71717a] mb-2">
            Compartí esta contraseña temporal con el usuario. <strong>No se vuelve a mostrar.</strong> Se le pedirá cambiarla en el primer ingreso.
          </p>
          <div className="flex items-center gap-2">
            <code className="text-[16px] font-bold tracking-[0.1em] text-[#09090b] bg-[#ffffff] border border-[#e4e4e7] rounded-[8px] px-3 py-1.5" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {tempPassword.pass}
            </code>
            <button
              onClick={() => navigator.clipboard?.writeText(tempPassword.pass)}
              className="px-3 py-1.5 text-[12px] font-semibold text-[#0c5cab] border border-[#0c5cab]/25 rounded-[8px] hover:bg-[#0c5cab]/[0.08] transition-colors"
            >
              Copiar
            </button>
            <button
              onClick={() => setTempPassword(null)}
              className="px-3 py-1.5 text-[12px] font-medium text-[#71717a] hover:text-[#09090b] transition-colors ml-auto"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Formulario de alta */}
      <form
        onSubmit={handleCreate}
        className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 p-5 space-y-4"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          Nueva cuenta
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className={inputClass} placeholder="persona@candysur.com" autoComplete="off"
            />
          </div>
          <div>
            <label className={labelClass}>Nombre (opcional)</label>
            <input
              type="text" value={nombre} onChange={(e) => setNombre(e.target.value)}
              className={inputClass} placeholder="Cómo se muestra en el panel"
            />
          </div>
          <div>
            <label className={labelClass}>Rol</label>
            <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} className={inputClass}>
              <option value="vendedor">Vendedor</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          {rol !== 'admin' && (
            <div>
              <label className={labelClass}>{rol === 'supervisor' ? 'Equipo / supervisor' : 'Vendedor'}</label>
              <TargetSelect rol={rol} value={target} onChange={setTarget} supervisores={supervisores} vendedores={vendedores} />
            </div>
          )}
        </div>

        <p className="text-[11px] text-[#71717a]">
          La contraseña se genera automáticamente (8 caracteres) y se te muestra al crear la cuenta.
        </p>

        <div className="flex justify-end pt-1">
          <button
            type="submit" disabled={saving}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(12,92,171,0.3)]"
            style={{ background: '#0c5cab' }}
          >
            {saving ? 'Creando...' : 'Crear cuenta'}
          </button>
        </div>
      </form>

      {/* Listado de cuentas */}
      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e4e4e7]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Cuentas existentes
          </p>
        </div>

        {loadingList ? (
          <p className="px-5 py-4 text-[13px] text-[#71717a]">Cargando...</p>
        ) : usuarios.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-[#71717a]">No hay cuentas.</p>
        ) : (
          <div className="divide-y divide-[#e4e4e7]">
            {usuarios.map((u) => (
              <div key={u.id} className={`px-5 py-3.5 ${!u.activo ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-medium text-[#09090b] truncate">{u.email}</p>
                      {!u.activo && (
                        <span className="text-[10px] font-semibold text-[#dc2626] bg-[#dc2626]/[0.1] px-1.5 py-0.5 rounded-full">Inactivo</span>
                      )}
                      {u.must_change_password && (
                        <span className="text-[10px] font-semibold text-[#d97706] bg-[#d97706]/[0.1] px-1.5 py-0.5 rounded-full">Pass temporal</span>
                      )}
                    </div>
                    <p className="text-[12px] text-[#71717a] mt-0.5">
                      {u.rol ? ROL_LABEL[u.rol] : 'Sin perfil'}
                      {u.rol === 'supervisor' && u.equipo ? ` · ${u.equipo}` : ''}
                      {u.rol === 'vendedor' && u.vendedor_nombre ? ` · ${u.vendedor_nombre}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setEditing(editing === u.id ? null : u.id)}
                      className="px-2.5 py-[6px] text-[12px] font-semibold text-[#0c5cab] border border-[#0c5cab]/25 rounded-[8px] hover:bg-[#0c5cab]/[0.08] transition-colors"
                    >
                      Rol
                    </button>
                    {u.id !== currentUserId && (
                      <button
                        onClick={() => toggleActivo(u)} disabled={busyId === u.id}
                        className="px-2.5 py-[6px] text-[12px] font-semibold text-[#71717a] border border-[#e4e4e7] rounded-[8px] hover:bg-[rgba(0,0,0,0.03)] transition-colors disabled:opacity-50"
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                    {u.id !== currentUserId && (
                      <button
                        onClick={() => handleDelete(u)} disabled={busyId === u.id}
                        className="px-2.5 py-[6px] text-[12px] font-semibold text-[#dc2626] border border-[#dc2626]/25 rounded-[8px] hover:bg-[#dc2626]/[0.08] transition-colors disabled:opacity-50"
                      >
                        Borrar
                      </button>
                    )}
                  </div>
                </div>
                {editing === u.id && (
                  <RolEditor
                    usuario={u}
                    supervisores={supervisores}
                    vendedores={vendedores}
                    onDone={() => { setEditing(null); loadUsuarios(); }}
                    onError={setError}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RolEditor({
  usuario, supervisores, vendedores, onDone, onError,
}: {
  usuario: Usuario;
  supervisores: string[];
  vendedores: string[];
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [rol, setRol] = useState<Rol>(usuario.rol ?? 'vendedor');
  const [target, setTarget] = useState(
    usuario.rol === 'supervisor' ? (usuario.equipo ?? '') : (usuario.vendedor_nombre ?? ''),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    if (rol !== 'admin' && !target) { onError('Elegí a quién linkear la cuenta.'); return; }
    setSaving(true);
    const res = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: usuario.id, rol, target: target || null }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { onError(data.error ?? 'Error al cambiar el rol.'); return; }
    onDone();
  }

  return (
    <div className="mt-3 pt-3 border-t border-[#e4e4e7] grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
      <div>
        <label className={labelClass}>Rol</label>
        <select
          value={rol}
          onChange={(e) => { setRol(e.target.value as Rol); setTarget(''); }}
          className={inputClass}
        >
          <option value="vendedor">Vendedor</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Administrador</option>
        </select>
      </div>
      <div>
        {rol !== 'admin' && (
          <>
            <label className={labelClass}>{rol === 'supervisor' ? 'Equipo' : 'Vendedor'}</label>
            <TargetSelect rol={rol} value={target} onChange={setTarget} supervisores={supervisores} vendedores={vendedores} />
          </>
        )}
      </div>
      <button
        onClick={save} disabled={saving}
        className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:brightness-110 disabled:opacity-50 transition-all"
        style={{ background: '#0c5cab' }}
      >
        {saving ? '...' : 'Guardar'}
      </button>
    </div>
  );
}

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
  'w-full px-3 py-[9px] text-[13px] bg-[rgba(255,255,255,0.02)] border border-[#1a2d4a] rounded-[9px] text-[#f0f4ff] caret-[#3b82f6] focus:outline-none focus:border-[rgba(99,102,241,0.4)] transition-all placeholder:text-[#3a4a66]';
const labelClass =
  'block text-[11px] font-semibold text-[#6b85a8] mb-1.5 uppercase tracking-[0.04em]';

export function UsuariosClient({ supervisores, vendedores, currentUserId }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<Rol>('vendedor');
  const [target, setTarget] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const loadUsuarios = useCallback(async () => {
    setLoadingList(true);
    const res = await fetch('/api/admin/usuarios');
    const data = await res.json();
    if (res.ok) setUsuarios(data.usuarios ?? []);
    setLoadingList(false);
  }, []);

  useEffect(() => {
    loadUsuarios();
  }, [loadUsuarios]);

  // Reset del target al cambiar de rol.
  useEffect(() => {
    setTarget('');
  }, [rol]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);

    if (!email || !password) {
      setError('Completá email y contraseña.');
      return;
    }
    if ((rol === 'supervisor' || rol === 'vendedor') && !target) {
      setError(rol === 'supervisor' ? 'Elegí el equipo/supervisor.' : 'Elegí el vendedor.');
      return;
    }

    setSaving(true);
    const res = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, nombre, rol, target: target || null }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? 'Error al crear la cuenta.');
      return;
    }
    setOk(`Cuenta creada para ${email}.`);
    setEmail('');
    setPassword('');
    setNombre('');
    setTarget('');
    loadUsuarios();
  }

  async function handleDelete(u: Usuario) {
    if (!confirm(`¿Borrar la cuenta de ${u.email}? Esta acción no se puede deshacer.`)) return;
    const res = await fetch('/api/admin/usuarios', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Error al borrar.');
      return;
    }
    loadUsuarios();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-7">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#f0f4ff]">Usuarios</h1>
        <p className="text-[13px] text-[#6b85a8] mt-0.5">
          Crear cuentas y linkearlas a un supervisor o vendedor
        </p>
      </div>

      {error && (
        <p className="text-[13px] text-[#f87171] bg-[#f87171]/[0.08] border border-[#f87171]/20 px-3 py-2 rounded-[10px]">{error}</p>
      )}
      {ok && (
        <p className="text-[13px] text-[#34d399] bg-[#34d399]/[0.08] border border-[#34d399]/20 px-3 py-2 rounded-[10px]">{ok}</p>
      )}

      {/* Formulario de alta */}
      <form
        onSubmit={handleCreate}
        className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30 p-5 space-y-4"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          Nueva cuenta
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="persona@candysur.com"
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelClass}>Contraseña</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="mínimo 6 caracteres"
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelClass}>Nombre (opcional)</label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputClass}
              placeholder="Cómo se muestra en el panel"
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

          {rol === 'supervisor' && (
            <div className="sm:col-span-2">
              <label className={labelClass}>Equipo / supervisor a cargo</label>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
                <option value="">— Elegir equipo —</option>
                {supervisores.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <p className="text-[11px] text-[#6b85a8] mt-1.5">
                Verá únicamente los vendedores de este equipo.
              </p>
            </div>
          )}

          {rol === 'vendedor' && (
            <div className="sm:col-span-2">
              <label className={labelClass}>Vendedor</label>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
                <option value="">— Elegir vendedor —</option>
                {vendedores.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <p className="text-[11px] text-[#6b85a8] mt-1.5">
                Verá únicamente sus propios datos.
              </p>
            </div>
          )}

          {rol === 'admin' && (
            <div className="sm:col-span-2">
              <p className="text-[12px] text-[#6b85a8]">
                Acceso total: dashboards globales, consolidados, carga de archivos y configuración.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(99,102,241,0.3)]"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
          >
            {saving ? 'Creando...' : 'Crear cuenta'}
          </button>
        </div>
      </form>

      {/* Listado de cuentas */}
      <div className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a2d4a]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Cuentas existentes
          </p>
        </div>

        {loadingList ? (
          <p className="px-5 py-4 text-[13px] text-[#6b85a8]">Cargando...</p>
        ) : usuarios.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-[#6b85a8]">No hay cuentas.</p>
        ) : (
          <div className="divide-y divide-[#1a2d4a]">
            {usuarios.map((u) => (
              <div key={u.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-[#f0f4ff] truncate">{u.email}</p>
                  <p className="text-[12px] text-[#6b85a8] mt-0.5">
                    {u.rol ? ROL_LABEL[u.rol] : 'Sin perfil'}
                    {u.rol === 'supervisor' && u.equipo ? ` · ${u.equipo}` : ''}
                    {u.rol === 'vendedor' && u.vendedor_nombre ? ` · ${u.vendedor_nombre}` : ''}
                  </p>
                </div>
                {u.id !== currentUserId && (
                  <button
                    onClick={() => handleDelete(u)}
                    className="px-3 py-[7px] text-[12px] font-semibold text-[#f87171] border border-[#f87171]/25 rounded-[8px] hover:bg-[#f87171]/[0.08] transition-colors"
                  >
                    Borrar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

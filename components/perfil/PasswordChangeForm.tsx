'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const inputClass =
  'w-full px-3 py-[9px] text-[14px] bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[9px] text-[#09090b] caret-[#0c5cab] focus:outline-none focus:border-[rgba(12,92,171,0.4)] transition-all';
const labelClass = 'block text-[11px] font-semibold text-[#71717a] mb-1.5 uppercase tracking-[0.04em]';

export function PasswordChangeForm({
  requireCurrent,
  redirectTo,
}: {
  requireCurrent: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (nueva.length < 8) { setError('La nueva contraseña debe tener al menos 8 caracteres.'); return; }
    if (nueva !== confirmar) { setError('Las contraseñas no coinciden.'); return; }
    if (requireCurrent && !current) { setError('Ingresá tu contraseña actual.'); return; }

    setSaving(true);
    const res = await fetch('/api/perfil/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: requireCurrent ? current : undefined,
        newPassword: nueva,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? 'No se pudo cambiar la contraseña.'); return; }

    setCurrent(''); setNueva(''); setConfirmar('');
    if (redirectTo) {
      router.push(redirectTo);
      router.refresh();
    } else {
      setOk(true);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[8px]">{error}</p>
      )}
      {ok && (
        <p className="text-[13px] text-[#16a34a] bg-[#16a34a]/[0.08] border border-[#16a34a]/20 px-3 py-2 rounded-[8px]">Contraseña actualizada.</p>
      )}

      {requireCurrent && (
        <div>
          <label className={labelClass}>Contraseña actual</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} autoComplete="current-password" />
        </div>
      )}
      <div>
        <label className={labelClass}>Nueva contraseña</label>
        <input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} className={inputClass} autoComplete="new-password" placeholder="mínimo 8 caracteres" />
      </div>
      <div>
        <label className={labelClass}>Confirmar nueva contraseña</label>
        <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} className={inputClass} autoComplete="new-password" />
      </div>

      <button
        type="submit" disabled={saving}
        className="w-full py-[10px] px-4 text-white text-[14px] font-bold rounded-[9px] disabled:opacity-50 hover:brightness-110 transition-all"
        style={{ background: '#0c5cab' }}
      >
        {saving ? 'Guardando...' : 'Cambiar contraseña'}
      </button>
    </form>
  );
}

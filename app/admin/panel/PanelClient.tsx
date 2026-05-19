'use client';

import { useState } from 'react';

const MESES_NOMBRES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

interface MesConfig {
  anio: number;
  mes: number;
  dias_laborables: number | null;
}

export function PanelClient({ meses }: { meses: MesConfig[] }) {
  const today = new Date();

  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(meses.map(m => [`${m.anio}-${m.mes}`, m.dias_laborables == null ? '' : String(m.dias_laborables)]))
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [saved,  setSaved]  = useState<string | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  async function handleSave(anio: number, mes: number) {
    const key  = `${anio}-${mes}`;
    const raw  = values[key];
    const dias = raw === '' || raw == null ? NaN : parseInt(raw, 10);
    if (!Number.isFinite(dias) || dias < 1 || dias > 31) {
      setError('Ingresá un número entre 1 y 31.');
      return;
    }
    setSaving(key);
    setError(null);
    const res = await fetch('/api/admin/config-meses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anio, mes, dias_laborables: dias }),
    });
    const data = await res.json();
    setSaving(null);
    if (!res.ok) {
      setError(data.error ?? 'Error al guardar.');
      return;
    }
    setSaved(key);
    setTimeout(() => setSaved(null), 2000);
  }

  return (
    <div className="max-w-xl mx-auto space-y-7">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#f0f4ff]">Panel Admin</h1>
        <p className="text-[13px] text-[#6b85a8] mt-0.5">Configuración de días laborables por mes</p>
      </div>

      {error && (
        <p className="text-[13px] text-[#f87171] bg-[#f87171]/[0.08] border border-[#f87171]/20 px-3 py-2 rounded-[10px]">{error}</p>
      )}

      <div className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a2d4a]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>
            Días laborables
          </p>
          <p className="text-[12px] text-[#6b85a8] mt-0.5">
            Ingresá la cantidad de días hábiles de trabajo del mes. Se usa para calcular la tendencia.
          </p>
        </div>

        <div className="divide-y divide-[#1a2d4a]">
          {meses.map(({ anio, mes }) => {
            const key       = `${anio}-${mes}`;
            const isCurrent = anio === today.getFullYear() && mes === today.getMonth() + 1;
            const isSaving  = saving === key;
            const isSaved   = saved  === key;

            return (
              <div
                key={key}
                className={`flex items-center gap-4 px-5 py-3.5 ${isCurrent ? 'bg-[rgba(59,130,246,0.05)]' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] font-medium ${isCurrent ? 'text-[#3b82f6]' : 'text-[#f0f4ff]'}`}>
                    {MESES_NOMBRES[mes]} {anio}
                    {isCurrent && (
                      <span className="ml-2 text-[10px] font-semibold text-white px-1.5 py-0.5 rounded-full" style={{background: 'linear-gradient(135deg, #3b82f6, #6366f1)'}}>
                        actual
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={values[key] ?? ''}
                    placeholder="–"
                    onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-16 px-2.5 py-[7px] text-[13px] text-center font-semibold bg-[rgba(255,255,255,0.02)] border border-[#1a2d4a] rounded-[8px] text-[#f0f4ff] caret-[#3b82f6] focus:outline-none focus:border-[rgba(99,102,241,0.4)] transition-all placeholder:text-[#3a4a66]"
                  />
                  <span className="text-[12px] text-[#6b85a8] w-8">días</span>
                  <button
                    onClick={() => handleSave(anio, mes)}
                    disabled={isSaving}
                    className="px-3.5 py-[7px] text-[12px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(99,102,241,0.3)] min-w-[64px] text-center"
                    style={{background: 'linear-gradient(135deg, #3b82f6, #6366f1)'}}
                  >
                    {isSaving ? '...' : isSaved ? '✓' : 'Guardar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

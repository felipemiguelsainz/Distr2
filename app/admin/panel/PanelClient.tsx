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
    <div className="max-w-xl space-y-7">
      <div>
        <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-[#09090b]">Días laborables</h1>
        <p className="text-[13px] text-[#71717a] mt-0.5">Configuración de días laborables por mes</p>
      </div>

      {error && (
        <p className="text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[10px]">{error}</p>
      )}

      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e4e4e7]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>
            Días laborables
          </p>
          <p className="text-[12px] text-[#71717a] mt-0.5">
            Ingresá la cantidad de días hábiles de trabajo del mes. Se usa para calcular la tendencia.
          </p>
        </div>

        <div className="divide-y divide-[#e4e4e7]">
          {meses.map(({ anio, mes }) => {
            const key       = `${anio}-${mes}`;
            const isCurrent = anio === today.getFullYear() && mes === today.getMonth() + 1;
            const isSaving  = saving === key;
            const isSaved   = saved  === key;

            return (
              <div
                key={key}
                className={`flex items-center gap-4 px-5 py-3.5 ${isCurrent ? 'bg-[rgba(12,92,171,0.05)]' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] font-medium ${isCurrent ? 'text-[#0c5cab]' : 'text-[#09090b]'}`}>
                    {MESES_NOMBRES[mes]} {anio}
                    {isCurrent && (
                      <span className="ml-2 text-[10px] font-semibold text-white px-1.5 py-0.5 rounded-full" style={{background: 'linear-gradient(135deg, #0c5cab, #0c5cab)'}}>
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
                    className="w-16 px-2.5 py-[7px] text-[13px] text-center font-semibold bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[8px] text-[#09090b] caret-[#0c5cab] focus:outline-none focus:border-[rgba(12,92,171,0.4)] transition-all placeholder:text-[#9f9fa9]"
                  />
                  <span className="text-[12px] text-[#71717a] w-8">días</span>
                  <button
                    onClick={() => handleSave(anio, mes)}
                    disabled={isSaving}
                    className="px-3.5 py-[7px] text-[12px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(12,92,171,0.3)] min-w-[64px] text-center"
                    style={{background: 'linear-gradient(135deg, #0c5cab, #0c5cab)'}}
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

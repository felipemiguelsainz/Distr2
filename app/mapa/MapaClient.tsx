'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-markercluster';
import L from 'leaflet';
import type { PdvGeo } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RuteableFilter = 'todos' | 'solo';

// ---------------------------------------------------------------------------
// Recencia de compra → color
//   verde   = activo (compró hace ≤ 1 mes)
//   amarillo = sin compra hace > 1 mes
//   rojo    = sin compra hace > 3 meses (o nunca compró)
// La fecha de última venta viene pivoteada desde la base de ventas (API).
// ---------------------------------------------------------------------------
const COLOR_ACTIVO   = '#16a34a'; // verde
const COLOR_TIBIO    = '#eab308'; // amarillo
const COLOR_INACTIVO = '#dc2626'; // rojo

function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function recencyColor(ultimaVta: string | null): string {
  if (!ultimaVta) return COLOR_INACTIVO; // nunca compró
  const last = ultimaVta.slice(0, 10);
  if (last >= monthsAgoISO(1)) return COLOR_ACTIVO;   // ≤ 1 mes
  if (last >= monthsAgoISO(3)) return COLOR_TIBIO;    // > 1 mes y ≤ 3 meses
  return COLOR_INACTIVO;                              // > 3 meses
}

function makeIcon(color: string) {
  return L.divIcon({
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:${color};border:2.5px solid rgba(255,255,255,0.9);
      box-shadow:0 1px 6px rgba(0,0,0,0.5);
    "></div>`,
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -11],
  });
}

// ---------------------------------------------------------------------------
// Day abbreviation → full name mapping
// ---------------------------------------------------------------------------
const DIA_NAMES: Record<string, string> = {
  LUN: 'Lunes', MAR: 'Martes', MIE: 'Miércoles',
  JUE: 'Jueves', VIE: 'Viernes', SAB: 'Sábado', DOM: 'Domingo',
};
const DIA_ORDER = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'];

function fmtDia(dia: string | null): string {
  if (!dia) return '—';
  return dia.split(',').map(d => DIA_NAMES[d] ?? d).join(', ');
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// Utility — format date dd/mm/yyyy
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Multi-select dropdown component
// ---------------------------------------------------------------------------
function MultiSelect({
  label,
  options,
  selected,
  onChange,
  formatOption,
  searchable = false,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (v: Set<string>) => void;
  formatOption?: (v: string) => string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const count = selected.size;
  const label_display = count > 0 ? `${label} (${count})` : label;

  function toggle(val: string) {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onChange(next);
  }

  function clearAll()  { onChange(new Set()); }

  // When searchable, filter by query and cap the rendered list so a few
  // thousand options don't tank the dropdown. Selected items always show.
  const visible = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter(o => (formatOption ? formatOption(o) : o).toLowerCase().includes(q))
      : options;
    return matches.slice(0, 100);
  }, [options, query, searchable, formatOption]);

  function selectAll() { onChange(new Set(visible)); }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-[8px] border transition-all whitespace-nowrap ${
          count > 0
            ? 'bg-[rgba(12,92,171,0.15)] border-[rgba(12,92,171,0.4)] text-[#09090b]'
            : 'bg-[rgba(0,0,0,0.03)] border-[#e4e4e7] text-[#71717a] hover:text-[#09090b] hover:border-[#d4d4d8]'
        }`}
      >
        {label_display}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.6 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-[9999] min-w-[220px] max-h-72 overflow-hidden flex flex-col rounded-[12px] border border-[#e4e4e7] bg-[#ffffff] shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1">
          {searchable && (
            <div className="px-2 pt-1 pb-1.5 border-b border-[#e4e4e7]">
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar PDV…"
                className="w-full px-2 py-1.5 text-[12px] rounded-[6px] border border-[#e4e4e7] bg-[rgba(0,0,0,0.02)] text-[#09090b] placeholder:text-[#a1a1aa] focus:outline-none focus:border-[rgba(12,92,171,0.4)]"
              />
            </div>
          )}
          <div className="flex gap-2 px-3 py-1.5 border-b border-[#e4e4e7]">
            <button onClick={selectAll} className="text-[11px] text-[#0c5cab] hover:text-[#0c5cab] transition-colors">{searchable ? 'Agregar visibles' : 'Todos'}</button>
            <span className="text-[#e4e4e7]">|</span>
            <button onClick={clearAll}  className="text-[11px] text-[#71717a] hover:text-[#09090b] transition-colors">Limpiar</button>
          </div>
          <div className="overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-[#a1a1aa]">Sin resultados</p>
            ) : (
              visible.map(opt => (
                <label key={opt} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[rgba(12,92,171,0.08)] transition-colors">
                  <input
                    type="checkbox"
                    checked={selected.has(opt)}
                    onChange={() => toggle(opt)}
                    className="accent-[#0c5cab] shrink-0"
                  />
                  <span className="text-[12px] text-[#27272a] truncate">{formatOption ? formatOption(opt) : opt}</span>
                </label>
              ))
            )}
            {searchable && query.trim() === '' && options.length > visible.length && (
              <p className="px-3 py-1.5 text-[11px] text-[#a1a1aa]">Escribí para buscar entre {options.length.toLocaleString('es-AR')} PDVs…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------
const LEGEND_ITEMS = [
  { color: COLOR_ACTIVO,   label: 'Activo (≤ 1 mes)' },
  { color: COLOR_TIBIO,    label: 'Sin compra +1 mes' },
  { color: COLOR_INACTIVO, label: 'Sin compra +3 meses' },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function MapaClient() {
  // Heavy PDV payload is fetched client-side so the shell paints immediately.
  const [puntos, setPuntos]   = useState<PdvGeo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/mapa');
        if (!res.ok) throw new Error('No se pudieron cargar los PDVs.');
        const data = (await res.json()) as PdvGeo[];
        if (!cancelled) setPuntos(data);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Unique filter options derived from data
  const opts = useMemo(() => ({
    vendedores: [...new Set(puntos.map(p => p.cartera).filter(Boolean) as string[])].sort(),
    zonas:      [...new Set(puntos.map(p => p.zona).filter(Boolean) as string[])].sort(),
    partidos:   [...new Set(puntos.map(p => p.partido).filter(Boolean) as string[])].sort(),
    canales:    [...new Set(puntos.map(p => p.canal_venta).filter(Boolean) as string[])].sort(),
    dias:       DIA_ORDER.filter(d => puntos.some(p => p.dia_visita?.split(',').includes(d))),
    pdvs:       puntos.map(p => String(p.pdv_id)).sort((a, b) => Number(a) - Number(b)),
  }), [puntos]);

  // pdv_id → "#id — razón social" label for the PDV multi-select
  const pdvLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of puntos) m.set(String(p.pdv_id), `#${p.pdv_id} — ${p.razon_social ?? 's/n'}`);
    return m;
  }, [puntos]);

  const [selVendedores,  setSelVendedores]  = useState<Set<string>>(new Set());
  const [selZonas,       setSelZonas]       = useState<Set<string>>(new Set());
  const [selPartidos,    setSelPartidos]    = useState<Set<string>>(new Set());
  const [selCanales,     setSelCanales]     = useState<Set<string>>(new Set());
  const [selDias,        setSelDias]        = useState<Set<string>>(new Set());
  const [selPdvs,        setSelPdvs]        = useState<Set<string>>(new Set());
  const [ruteable,       setRuteable]       = useState<RuteableFilter>('todos');
  const [clienteActivo,  setClienteActivo]  = useState(false);

  const filtered = useMemo(() => {
    return puntos.filter(p => {
      if (selPdvs.size      > 0 && !selPdvs.has(String(p.pdv_id)))                        return false;
      if (selVendedores.size > 0 && (!p.cartera    || !selVendedores.has(p.cartera)))    return false;
      if (selZonas.size      > 0 && (!p.zona       || !selZonas.has(p.zona)))            return false;
      if (selPartidos.size   > 0 && (!p.partido    || !selPartidos.has(p.partido)))      return false;
      if (selCanales.size    > 0 && (!p.canal_venta || !selCanales.has(p.canal_venta)))  return false;
      if (selDias.size       > 0) {
        const dias = p.dia_visita?.split(',') ?? [];
        if (!dias.some(d => selDias.has(d))) return false;
      }
      if (ruteable === 'solo' && !p.ruteable) return false;
      if (clienteActivo && !p.activo_3m) return false;
      return true;
    });
  }, [puntos, selPdvs, selVendedores, selZonas, selPartidos, selCanales, selDias, ruteable, clienteActivo]);

  const hasFilters = selPdvs.size > 0 || selVendedores.size > 0 || selZonas.size > 0 || selPartidos.size > 0 || selCanales.size > 0 || selDias.size > 0 || ruteable !== 'todos' || clienteActivo;

  const clearAll = useCallback(() => {
    setSelPdvs(new Set());
    setSelVendedores(new Set());
    setSelZonas(new Set());
    setSelPartidos(new Set());
    setSelCanales(new Set());
    setSelDias(new Set());
    setRuteable('todos');
    setClienteActivo(false);
  }, []);

  // Un ícono por color de recencia (3 en total) — se reutilizan en todos los puntos
  const iconCache = useMemo(() => {
    const m = new Map<string, L.DivIcon>();
    for (const color of [COLOR_ACTIVO, COLOR_TIBIO, COLOR_INACTIVO]) {
      m.set(color, makeIcon(color));
    }
    return m;
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#fafafa]">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">Mapa de PDVs</h1>
            <p className="text-[13px] text-[#71717a] mt-0.5">
              {loadError ? (
                <span className="text-[#dc2626]">{loadError}</span>
              ) : loading ? (
                'Cargando PDVs…'
              ) : (
                <>
                  Mostrando{' '}
                  <span className="font-semibold text-[#09090b]">{filtered.length.toLocaleString('es-AR')}</span>
                  {' '}de{' '}
                  <span className="text-[#09090b]">{puntos.length.toLocaleString('es-AR')}</span>
                  {' '}PDVs
                </>
              )}
            </p>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-3">
            {LEGEND_ITEMS.map(l => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                <span className="text-[11px] text-[#71717a]">{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <MultiSelect
            label="PDV"
            options={opts.pdvs}
            selected={selPdvs}
            onChange={setSelPdvs}
            formatOption={id => pdvLabel.get(id) ?? `#${id}`}
            searchable
          />
          <MultiSelect label="Vendedor"    options={opts.vendedores} selected={selVendedores} onChange={setSelVendedores} />
          <MultiSelect label="Zona"        options={opts.zonas}      selected={selZonas}      onChange={setSelZonas} />
          <MultiSelect label="Partido"     options={opts.partidos}   selected={selPartidos}   onChange={setSelPartidos} />
          <MultiSelect label="Canal"       options={opts.canales}    selected={selCanales}    onChange={setSelCanales} />
          {opts.dias.length > 0 && (
            <MultiSelect
              label="Día de visita"
              options={opts.dias}
              selected={selDias}
              onChange={setSelDias}
              formatOption={d => DIA_NAMES[d] ?? d}
            />
          )}

          {/* Ruteable toggle */}
          <div className="flex rounded-[8px] border border-[#e4e4e7] overflow-hidden">
            {(['todos', 'solo'] as RuteableFilter[]).map(v => (
              <button
                key={v}
                onClick={() => setRuteable(v)}
                className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  ruteable === v
                    ? 'bg-[rgba(12,92,171,0.18)] text-[#09090b]'
                    : 'text-[#71717a] hover:text-[#09090b] hover:bg-[rgba(0,0,0,0.03)]'
                }`}
              >
                {v === 'todos' ? 'Todos' : 'Solo ruteables'}
              </button>
            ))}
          </div>

          {/* Cliente activo toggle */}
          <button
            onClick={() => setClienteActivo(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-[8px] border transition-all whitespace-nowrap ${
              clienteActivo
                ? 'bg-[rgba(22,163,74,0.15)] border-[rgba(22,163,74,0.4)] text-[#09090b]'
                : 'bg-[rgba(0,0,0,0.03)] border-[#e4e4e7] text-[#71717a] hover:text-[#09090b] hover:border-[#d4d4d8]'
            }`}
          >
            <span className={`flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border transition-all shrink-0 ${
              clienteActivo
                ? 'bg-[#16a34a] border-[#16a34a]'
                : 'bg-transparent border-[#d4d4d8]'
            }`}>
              {clienteActivo && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1.5 4L3.2 5.7L6.5 2.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            Cliente activo
          </button>

          {hasFilters && (
            <button
              onClick={clearAll}
              className="px-3 py-1.5 text-[12px] font-medium text-[#dc2626] bg-[rgba(220,38,38,0.08)] border border-[rgba(220,38,38,0.2)] rounded-[8px] hover:bg-[rgba(220,38,38,0.14)] transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 px-6 pb-6 min-h-0">
        <div className="relative h-full w-full rounded-2xl overflow-hidden border border-[#e4e4e7]">
          {loading && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-[#fafafa]/70 backdrop-blur-sm">
              <div className="flex items-center gap-2.5 text-[13px] text-[#71717a]">
                <span className="w-4 h-4 rounded-full border-2 border-[#e4e4e7] border-t-[#0c5cab] animate-spin" />
                Cargando PDVs…
              </div>
            </div>
          )}
          <MapContainer
            center={[-34.6, -58.4]}
            zoom={10}
            style={{ height: '100%', width: '100%', background: '#fafafa' }}
            preferCanvas
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MarkerClusterGroup chunkedLoading>
              {filtered.map(p => (
                <Marker
                  key={p.pdv_id}
                  position={[p.latitud, p.longitud]}
                  icon={iconCache.get(recencyColor(p.ultima_vta)) ?? makeIcon(COLOR_INACTIVO)}
                >
                  <Popup minWidth={220} maxWidth={280}>
                    <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', lineHeight: 1.5 }}>
                      <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#09090b' }}>
                        #{p.pdv_id} — {p.razon_social ?? '—'}
                      </p>
                      <table style={{ fontSize: 11, width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>
                          {[
                            ['Vendedor',   p.cartera   ?? '—'],
                            ['Zona',       p.zona      ?? '—'],
                            ['Canal',      p.canal_venta ?? '—'],
                            ['Partido',    p.partido   ?? '—'],
                            ['Día visita', fmtDia(p.dia_visita ?? null)],
                            ['Ruteable',   p.ruteable === true ? 'Sí' : p.ruteable === false ? 'No' : '—'],
                            ['Última vta', fmtDate(p.ultima_vta)],
                          ].map(([k, v]) => (
                            <tr key={k}>
                              <td style={{ paddingRight: 8, color: '#71717a', fontWeight: 500, paddingBottom: 2 }}>{k}</td>
                              <td style={{ color: '#09090b', fontWeight: 600, paddingBottom: 2 }}>{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

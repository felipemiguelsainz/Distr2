'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-markercluster';
import L from 'leaflet';
import type { PdvGeo, RutaResponse, RutaStop } from './types';

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
const COLOR_ACTIVO     = '#16a34a'; // verde
const COLOR_TIBIO      = '#eab308'; // amarillo
const COLOR_ENFRIANDOSE = '#f97316'; // naranja: rompió su cadencia
const COLOR_INACTIVO   = '#dc2626'; // rojo

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

// Color del marcador del mapa: naranja si rompió su cadencia (enfriándose),
// si no por recencia. El enfriándose siempre cae en verde/amarillo por fecha,
// así que el naranja solo "pisa" esos casos (nunca un rojo, que es >90 días).
function pdvColor(p: PdvGeo): string {
  return p.enfriandose ? COLOR_ENFRIANDOSE : recencyColor(p.ultima_vta);
}

function makeIcon(color: string, aproximada?: boolean) {
  // Ubicación aproximada (centro del barrio): borde punteado + semitransparente,
  // para que se vea distinto sin pisar el color de recencia.
  const border = aproximada ? '2.5px dashed rgba(255,255,255,0.95)' : '2.5px solid rgba(255,255,255,0.9)';
  return L.divIcon({
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:${color};border:${border};${aproximada ? 'opacity:0.7;' : ''}
      box-shadow:0 1px 6px rgba(0,0,0,0.5);
    "></div>`,
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -11],
  });
}

// Marcador numerado para las paradas de una ruta (color = recencia del PDV).
function makeNumberedIcon(n: number, color: string, aproximada?: boolean) {
  return L.divIcon({
    html: `<div style="
      width:26px;height:26px;border-radius:50%;background:${color};
      border:2.5px ${aproximada ? 'dashed' : 'solid'} #fff;box-shadow:0 1px 6px rgba(0,0,0,0.55);
      color:#fff;font-size:12px;font-weight:700;line-height:1;
      display:flex;align-items:center;justify-content:center;
      font-family:'Plus Jakarta Sans',sans-serif;
    ">${n}</div>`,
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

// Marcador para PDVs inactivos sugeridos "de paso" (rombo rojo punteado).
const suggestionIcon = L.divIcon({
  html: `<div style="
    width:18px;height:18px;background:#dc2626;border:2px dashed #fff;
    border-radius:4px;transform:rotate(45deg);box-shadow:0 1px 6px rgba(0,0,0,0.5);
  "></div>`,
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -10],
});

// Encuadra el mapa sobre la ruta cuando cambia (key = signature). En mobile deja
// más aire abajo para que la ruta no quede tapada por el bottom sheet de filtros.
function FitBounds({ positions, sig }: { positions: [number, number][]; sig: string }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length >= 1) {
      const mobile = typeof window !== 'undefined' && window.innerWidth < 1024;
      map.fitBounds(positions as L.LatLngBoundsExpression, {
        paddingTopLeft: [30, 30],
        paddingBottomRight: [30, mobile ? 200 : 50],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
}

// Centra el mapa en un punto puntual (al clickear un cliente apagado de la lista).
function FlyTo({ point }: { point: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.flyTo(point, Math.max(map.getZoom(), 16), { duration: 0.6 });
  }, [point, map]);
  return null;
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

// Dirección legible de una parada: "Calle 123, Localidad". Cae a partido si no
// hay calle. Devuelve '' si no hay nada que mostrar.
function fmtDireccion(s: RutaStop): string {
  const calleAltura = [s.calle, s.altura].map(v => v?.trim()).filter(Boolean).join(' ').trim();
  const partes = [calleAltura || null, s.localidad?.trim() || null].filter(Boolean) as string[];
  return partes.join(', ') || (s.partido?.trim() ?? '');
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
        <>
          {/* Backdrop — sólo mobile, donde el dropdown se vuelve bottom-sheet
              (así escapa el overflow del panel de filtros y no queda cortado). */}
          <div className="fixed inset-0 z-[9998] bg-black/30 lg:hidden" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-[9999] max-h-[75vh] rounded-t-2xl border-t border-[#e4e4e7] pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgba(0,0,0,0.2)] lg:absolute lg:inset-x-auto lg:bottom-auto lg:top-full lg:left-0 lg:mt-1 lg:min-w-[220px] lg:max-h-72 lg:rounded-[12px] lg:border lg:pb-0 lg:shadow-[0_8px_24px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col bg-[#ffffff] py-1">
            {/* Encabezado — sólo mobile: título del filtro + Listo para cerrar. */}
            <div className="flex items-center justify-between px-4 pt-1.5 pb-2 border-b border-[#e4e4e7] lg:hidden">
              <span className="text-[14px] font-semibold text-[#09090b]">{label}</span>
              <button onClick={() => setOpen(false)} className="text-[13px] font-semibold text-[#0c5cab] px-2 py-1 -mr-2">Listo</button>
            </div>
            {searchable && (
              <div className="px-2 pt-1 pb-1.5 border-b border-[#e4e4e7]">
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar PDV…"
                  className="w-full px-2 py-2 text-[13px] lg:py-1.5 lg:text-[12px] rounded-[6px] border border-[#e4e4e7] bg-[rgba(0,0,0,0.02)] text-[#09090b] placeholder:text-[#a1a1aa] focus:outline-none focus:border-[rgba(12,92,171,0.4)]"
                />
              </div>
            )}
            <div className="flex gap-2 px-3 py-2 lg:py-1.5 border-b border-[#e4e4e7]">
              <button onClick={selectAll} className="text-[12px] lg:text-[11px] text-[#0c5cab] hover:text-[#0c5cab] transition-colors">{searchable ? 'Agregar visibles' : 'Todos'}</button>
              <span className="text-[#e4e4e7]">|</span>
              <button onClick={clearAll}  className="text-[12px] lg:text-[11px] text-[#71717a] hover:text-[#09090b] transition-colors">Limpiar</button>
            </div>
            <div className="overflow-y-auto overscroll-contain">
              {visible.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-[#a1a1aa]">Sin resultados</p>
              ) : (
                visible.map(opt => (
                  <label key={opt} className="flex items-center gap-2.5 px-4 lg:px-3 py-2.5 lg:py-1.5 cursor-pointer hover:bg-[rgba(12,92,171,0.08)] transition-colors">
                    <input
                      type="checkbox"
                      checked={selected.has(opt)}
                      onChange={() => toggle(opt)}
                      className="accent-[#0c5cab] shrink-0 w-4 h-4"
                    />
                    <span className="text-[13px] lg:text-[12px] text-[#27272a] truncate">{formatOption ? formatOption(opt) : opt}</span>
                  </label>
                ))
              )}
              {searchable && query.trim() === '' && options.length > visible.length && (
                <p className="px-4 lg:px-3 py-1.5 text-[11px] text-[#a1a1aa]">Escribí para buscar entre {options.length.toLocaleString('es-AR')} PDVs…</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------
const LEGEND_ITEMS = [
  { color: COLOR_ACTIVO,      label: 'Compró hace menos de 1 mes' },
  { color: COLOR_TIBIO,       label: 'Compró hace 1 a 3 meses' },
  { color: COLOR_ENFRIANDOSE, label: 'Enfriándose: rompió su frecuencia de compra' },
  { color: COLOR_INACTIVO,    label: 'No compra hace más de 3 meses' },
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

  // Deep-link desde Insights: /mapa?pdvs=1,2,3&vendedor=NOMBRE → pre-filtra.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const pdvs = sp.get('pdvs');
    const vend = sp.get('vendedor');
    if (pdvs) setSelPdvs(new Set(pdvs.split(',').map(s => s.trim()).filter(Boolean)));
    if (vend) setSelVendedores(new Set([vend]));
  }, []);

  // --- Ruteo (Módulo 1) ---
  const [rutaOpen,    setRutaOpen]    = useState(false);
  const [rutaVend,    setRutaVend]    = useState('');
  const [rutaDia,     setRutaDia]     = useState('LUN');
  const [ruta,        setRuta]        = useState<RutaResponse | null>(null);
  const [rutaLoading, setRutaLoading] = useState(false);
  const [rutaError,   setRutaError]   = useState<string | null>(null);
  const [focusPoint,  setFocusPoint]  = useState<[number, number] | null>(null);
  const [rutaRadio,   setRutaRadio]   = useState(400); // radio apagados cercanos (m)
  const [rutaExtras,  setRutaExtras]  = useState<Set<number>>(new Set()); // PDVs sumados a mano

  // Panel de filtros colapsable (Fix 1): recuerda la preferencia en localStorage.
  const [panelColapsado, setPanelColapsado] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('mapa_panel_colapsado');
      // Con preferencia guardada, respetarla. Sin ella, en mobile (<lg) arrancar
      // COLAPSADO para que el mapa ocupe casi toda la pantalla (Fix 2).
      setPanelColapsado(stored !== null ? stored === '1' : window.innerWidth < 1024);
    } catch { /* ignore */ }
  }, []);
  const togglePanel = useCallback(() => {
    setPanelColapsado(v => {
      const next = !v;
      try { localStorage.setItem('mapa_panel_colapsado', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Bottom sheet mobile (<lg): colapsado muestra el armador de ruta; expandido
  // (~60vh) revela el resto de filtros y opciones. Fix 2 (mobile).
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // Ref al contenedor del mapa (para exportar PDF con captura — Fix 4).
  const mapaRef = useRef<HTMLDivElement>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Fetch de la ruta con extras/radio explícitos (evita estado stale al sumar).
  const fetchRutaWith = useCallback(async (extras: Set<number>, radio: number) => {
    const vend = rutaVend || (opts.vendedores.length === 1 ? opts.vendedores[0] : '');
    if (!vend) { setRutaError('Elegí un vendedor.'); return; }
    setRutaLoading(true);
    setRutaError(null);
    try {
      const params = new URLSearchParams({ vendedor: vend, dia: rutaDia, radio: String(radio) });
      if (extras.size) params.set('extra', [...extras].join(','));
      const res = await fetch(`/api/ruta?${params.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'No se pudo armar la ruta.');
      }
      const data = (await res.json()) as RutaResponse;
      setRuta(data);
      if (data.stops.length === 0) setRutaError(data.resumen);
    } catch (e) {
      setRuta(null);
      setRutaError(e instanceof Error ? e.message : String(e));
    } finally {
      setRutaLoading(false);
    }
  }, [rutaVend, rutaDia, opts.vendedores]);

  // Armar ruta desde cero: resetea los agregados manuales.
  const armarRuta = useCallback(() => {
    const fresh = new Set<number>();
    setRutaExtras(fresh);
    fetchRutaWith(fresh, rutaRadio);
  }, [fetchRutaWith, rutaRadio]);

  const sumarPdv = useCallback((pdvId: number) => {
    const next = new Set(rutaExtras); next.add(pdvId);
    setRutaExtras(next);
    // Sacarlo YA de las sugerencias (optimista): que no quede como rombo y
    // parada numerada a la vez mientras llega el refetch. El nuevo response ya
    // no lo trae en sugerencias (enRuta lo excluye) y sí como parada agregada.
    setRuta(prev => prev ? { ...prev, sugerencias: prev.sugerencias.filter(s => s.pdv_id !== pdvId) } : prev);
    fetchRutaWith(next, rutaRadio);
  }, [rutaExtras, rutaRadio, fetchRutaWith]);

  const quitarPdv = useCallback((pdvId: number) => {
    const next = new Set(rutaExtras); next.delete(pdvId);
    setRutaExtras(next);
    fetchRutaWith(next, rutaRadio);
  }, [rutaExtras, rutaRadio, fetchRutaWith]);

  const cambiarRadio = useCallback((r: number) => {
    setRutaRadio(r);
    if (ruta) fetchRutaWith(rutaExtras, r);
  }, [ruta, rutaExtras, fetchRutaWith]);

  const limpiarRuta = useCallback(() => { setRuta(null); setRutaError(null); setRutaExtras(new Set()); }, []);

  // Copiar las coordenadas en orden de visita (a prueba de errores: lat,lon).
  const [coordsCopied, setCoordsCopied] = useState(false);
  const copiarCoords = useCallback(async () => {
    if (!ruta || ruta.stops.length === 0) return;
    const txt = ruta.stops.map(s => `${s.lat},${s.lon}`).join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      setCoordsCopied(true);
      setTimeout(() => setCoordsCopied(false), 1500);
    } catch { /* clipboard no disponible */ }
  }, [ruta]);

  // Links a Google Maps con las paradas en orden, en modo CAMINANDO. Google
  // Maps acepta ~10 puntos por link, así que partimos en tramos continuos
  // (cada tramo arranca donde terminó el anterior) respetando el orden óptimo.
  const gmapsLinks = useMemo(() => {
    type Tramo = { url: string; desde: number; hasta: number };
    if (!ruta || ruta.stops.length === 0) return [] as Tramo[];
    const coords = ruta.stops.map(s => `${s.lat},${s.lon}`);
    const MAX = 10; // origen + hasta 8 intermedios + destino
    const buildUrl = (chunk: string[]) => {
      const origin = chunk[0];
      const destination = chunk[chunk.length - 1];
      const waypoints = chunk.slice(1, -1).join('|');
      const params = new URLSearchParams({ api: '1', origin, destination, travelmode: 'walking' });
      if (waypoints) params.set('waypoints', waypoints);
      return `https://www.google.com/maps/dir/?${params.toString()}`;
    };
    const links: Tramo[] = [];
    if (coords.length <= MAX) {
      links.push({ url: buildUrl(coords), desde: 1, hasta: coords.length });
    } else {
      // Tramos continuos (cada uno arranca donde terminó el anterior → solapan 1 parada).
      for (let i = 0; i < coords.length - 1; i += MAX - 1) {
        const chunk = coords.slice(i, i + MAX);
        links.push({ url: buildUrl(chunk), desde: i + 1, hasta: Math.min(i + MAX, coords.length) });
      }
    }
    return links;
  }, [ruta]);

  // Exportar la ruta a PDF: captura del mapa (html2canvas) + lista de paradas (jspdf).
  // Los libs se importan dinámicamente para no engordar el bundle inicial. El
  // TileLayer va con crossOrigin para que la captura de los tiles de OSM no
  // "taintee" el canvas (OSM manda Access-Control-Allow-Origin: *).
  const exportarPDF = useCallback(async () => {
    if (!ruta || ruta.stops.length === 0 || !mapaRef.current) return;
    setPdfLoading(true);
    setRutaError(null);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      // Dar tiempo a que terminen de cargar los tiles de OSM antes de capturar.
      await new Promise((r) => setTimeout(r, 2000));

      // Captura del mapa aislada: si falla (CORS/taint), seguimos con la lista y
      // un placeholder en vez de abortar todo el PDF.
      let imgData: string | null = null;
      let imgRatio = 0.6; // alto/ancho de la captura
      try {
        const canvas = await html2canvas(mapaRef.current, {
          useCORS: true, allowTaint: true, scale: 2, logging: false, backgroundColor: '#ffffff',
        });
        imgData = canvas.toDataURL('image/png');
        imgRatio = canvas.height / canvas.width;
      } catch { /* fallback: sin imagen del mapa */ }

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const PAGE_W = 210, MARGIN = 15, CONTENT_W = PAGE_W - MARGIN * 2;
      const diaNombre = DIA_NAMES[ruta.dia] ?? ruta.dia;
      const AZUL: [number, number, number] = [12, 92, 171];
      const GRIS: [number, number, number] = [113, 113, 122]; // #71717a
      const BORDE: [number, number, number] = [228, 228, 231]; // #e4e4e7

      // ── Header: banda azul con título blanco ──
      pdf.setFillColor(...AZUL);
      pdf.rect(0, 0, PAGE_W, 26, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(17);
      pdf.text(`RUTA — ${(ruta.vendedor ?? '').toUpperCase()}`, MARGIN, 13);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10.5);
      pdf.text(
        `${diaNombre}  ·  ${new Date().toLocaleDateString('es-AR')}  ·  ${ruta.stops.length} paradas`,
        MARGIN, 20,
      );

      // ── Mapa (o placeholder) ──
      let y = 26 + 6;
      if (imgData) {
        const imgH = Math.min(115, imgRatio * CONTENT_W);
        pdf.addImage(imgData, 'PNG', MARGIN, y, CONTENT_W, imgH);
        pdf.setDrawColor(...BORDE);
        pdf.rect(MARGIN, y, CONTENT_W, imgH); // marco fino
        y += imgH + 8;
      } else {
        const boxH = 34;
        pdf.setFillColor(244, 244, 245);
        pdf.setDrawColor(...BORDE);
        pdf.rect(MARGIN, y, CONTENT_W, boxH, 'FD');
        pdf.setTextColor(...GRIS);
        pdf.setFontSize(10);
        pdf.text('Captura de mapa no disponible', PAGE_W / 2, y + boxH / 2, { align: 'center' });
        y += boxH + 8;
      }

      // ── Separador + título de la lista ──
      pdf.setDrawColor(...BORDE);
      pdf.line(MARGIN, y - 2, PAGE_W - MARGIN, y - 2);
      pdf.setTextColor(9, 9, 11);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text('PARADAS EN ORDEN', MARGIN, y + 5);
      y += 12;

      // ── Lista de paradas: círculo numerado + nombre + dirección ──
      const ROW_H = 12;
      ruta.stops.forEach((s, i) => {
        if (y > 275) { pdf.addPage(); y = 20; }
        // Círculo azul con el número en blanco
        const cx = MARGIN + 3.2, cy = y - 1.2, r = 3.2;
        pdf.setFillColor(...AZUL);
        pdf.circle(cx, cy, r, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.text(String(i + 1), cx, cy + 1.1, { align: 'center' });
        // Nombre del PDV
        pdf.setTextColor(9, 9, 11);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        const nombre = `${s.razon_social ?? 'PDV'}${s.aproximada ? '  (ubic. aprox.)' : ''}`;
        pdf.text(pdf.splitTextToSize(nombre, CONTENT_W - 12)[0], MARGIN + 9, y);
        // Dirección en gris
        const dir = fmtDireccion(s);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...GRIS);
        pdf.setFontSize(9);
        pdf.text(pdf.splitTextToSize(dir || '—', CONTENT_W - 12)[0], MARGIN + 9, y + 4.5);
        y += ROW_H;
      });

      // ── Pie de página en todas las hojas: distr2 · Candysur + N° de página ──
      const total = pdf.getNumberOfPages();
      for (let p = 1; p <= total; p++) {
        pdf.setPage(p);
        pdf.setDrawColor(...BORDE);
        pdf.line(MARGIN, 288, PAGE_W - MARGIN, 288);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(...GRIS);
        pdf.text('distr2 · Candysur', MARGIN, 293);
        pdf.text(`Página ${p} / ${total}`, PAGE_W - MARGIN, 293, { align: 'right' });
      }

      pdf.save(`ruta_${ruta.vendedor}_${ruta.dia}.pdf`.replace(/\s+/g, '_'));
    } catch (e) {
      console.error('[exportarPDF]', e);
      setRutaError('No se pudo generar el PDF (la captura del mapa falló). Probá de nuevo.');
    } finally {
      setPdfLoading(false);
    }
  }, [ruta]);

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
    for (const color of [COLOR_ACTIVO, COLOR_TIBIO, COLOR_ENFRIANDOSE, COLOR_INACTIVO]) {
      m.set(color, makeIcon(color));
    }
    return m;
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#fafafa]">
      {/* ── Header (desktop ≥lg) — en mobile se usa el bottom sheet ── */}
      <div className="hidden lg:block flex-shrink-0 relative px-4 pt-4 pb-3 sm:px-6 sm:pt-6">
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
          {/* Legend + toggle colapsar panel */}
          <div className="flex items-center gap-3">
            <div className={`flex-wrap gap-3 ${panelColapsado ? 'hidden sm:flex' : 'flex'}`}>
              {LEGEND_ITEMS.map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                  <span className="text-[11px] text-[#71717a]">{l.label}</span>
                </div>
              ))}
            </div>
            <button
              onClick={togglePanel}
              title={panelColapsado ? 'Mostrar filtros' : 'Ocultar filtros'}
              aria-label={panelColapsado ? 'Mostrar filtros' : 'Ocultar filtros'}
              className="flex items-center gap-1 shrink-0 px-2.5 py-1.5 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#71717a] hover:text-[#09090b] hover:border-[#d4d4d8] transition-colors"
            >
              {panelColapsado ? 'Filtros' : 'Ocultar'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform duration-200 ${panelColapsado ? '' : 'rotate-180'}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Contenedor colapsable: filtros + panel de ruta (Fix 1). overflow-hidden
            SÓLO al colapsar, para no recortar los dropdowns de los MultiSelect abiertos. */}
        <div className={`transition-all duration-200 ${panelColapsado ? 'max-h-0 opacity-0 overflow-hidden pointer-events-none' : 'max-h-[2000px] opacity-100'}`}>
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

          {/* Armar ruta */}
          <button
            onClick={() => setRutaOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-[8px] border transition-all whitespace-nowrap ${
              rutaOpen || ruta
                ? 'bg-[rgba(12,92,171,0.15)] border-[rgba(12,92,171,0.4)] text-[#09090b]'
                : 'bg-[rgba(0,0,0,0.03)] border-[#e4e4e7] text-[#71717a] hover:text-[#09090b] hover:border-[#d4d4d8]'
            }`}
          >
            Armar ruta
          </button>
        </div>

        {/* ── Panel de ruta ── */}
        {rutaOpen && (
          <div className="flex flex-wrap items-end gap-2 mt-3 p-3 rounded-[12px] border border-[#e4e4e7] bg-[rgba(12,92,171,0.04)]">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a]">Vendedor</label>
              <select
                value={rutaVend || (opts.vendedores.length === 1 ? opts.vendedores[0] : '')}
                onChange={e => setRutaVend(e.target.value)}
                disabled={opts.vendedores.length === 1}
                className="px-2.5 py-1.5 text-[12px] rounded-[8px] border border-[#e4e4e7] bg-white text-[#09090b] min-w-[180px] disabled:opacity-70"
              >
                <option value="">Elegí vendedor…</option>
                {opts.vendedores.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a]">Día</label>
              <select
                value={rutaDia}
                onChange={e => setRutaDia(e.target.value)}
                className="px-2.5 py-1.5 text-[12px] rounded-[8px] border border-[#e4e4e7] bg-white text-[#09090b]"
              >
                {DIA_ORDER.map(d => <option key={d} value={d}>{DIA_NAMES[d]}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a]">Radio apagados</label>
              <select
                value={rutaRadio}
                onChange={e => cambiarRadio(Number(e.target.value))}
                className="px-2.5 py-1.5 text-[12px] rounded-[8px] border border-[#e4e4e7] bg-white text-[#09090b]"
              >
                {[200, 300, 400, 600, 800, 1000, 1500].map(r => <option key={r} value={r}>{r} m</option>)}
              </select>
            </div>
            <button
              onClick={armarRuta}
              disabled={rutaLoading}
              className="px-3.5 py-1.5 text-[12px] font-semibold rounded-[8px] bg-[#0c5cab] text-white hover:bg-[#0a4f95] transition-colors disabled:opacity-60"
            >
              {rutaLoading ? 'Calculando…' : 'Armar ruta'}
            </button>
            {ruta && ruta.stops.length > 0 && (
              <>
                {gmapsLinks.length > 1 && (
                  <p className="w-full text-[11px] text-[#71717a] leading-snug">
                    La ruta tiene <strong className="text-[#09090b]">{ruta.stops.length} paradas</strong>. Google Maps
                    admite ~10 por link, así que la dividimos en <strong className="text-[#09090b]">{gmapsLinks.length} tramos</strong>.
                    Abrí cada uno en orden.
                  </p>
                )}
                {gmapsLinks.map((t, i) => (
                  <a
                    key={t.url}
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#0c5cab] hover:border-[#d4d4d8] transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"/></svg>
                    {gmapsLinks.length === 1
                      ? 'Abrir en Google Maps'
                      : `Abrir tramo ${i + 1} en Maps (paradas ${t.desde}–${t.hasta}) →`}
                  </a>
                ))}
                <button
                  onClick={exportarPDF}
                  disabled={pdfLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#0c5cab] hover:border-[#d4d4d8] transition-colors disabled:opacity-60"
                >
                  {pdfLoading ? (
                    <>
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-[#e4e4e7] border-t-[#0c5cab] animate-spin" />
                      Generando…
                    </>
                  ) : (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                      </svg>
                      Exportar PDF
                    </>
                  )}
                </button>
                <button
                  onClick={copiarCoords}
                  className="px-3 py-1.5 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#0c5cab] hover:border-[#d4d4d8] transition-colors"
                >
                  {coordsCopied ? '✓ Copiado' : 'Copiar coords'}
                </button>
                <button
                  onClick={limpiarRuta}
                  className="px-3 py-1.5 text-[12px] font-medium text-[#dc2626] bg-[rgba(220,38,38,0.08)] border border-[rgba(220,38,38,0.2)] rounded-[8px] hover:bg-[rgba(220,38,38,0.14)] transition-colors"
                >
                  Limpiar ruta
                </button>
              </>
            )}

            {/* Resumen / estado */}
            <div className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] mt-1">
              {rutaError && <span className="text-[#dc2626]">{rutaError}</span>}
              {ruta && ruta.stops.length > 0 && (
                <>
                  <span className="text-[#09090b] font-semibold">{ruta.resumen}</span>
                  <span className="text-[#71717a]">
                    {ruta.source === 'osrm' ? 'a pie · veredas reales' : 'a pie · distancia estimada · traza por calles'}
                  </span>
                </>
              )}
            </div>

            {/* Aviso: paradas con ubicación aproximada (el pin cae en el barrio, no la puerta) */}
            {ruta && ruta.stops.some(s => s.aproximada) && (
              <div className="w-full mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px]">
                <span className="font-bold text-amber-800 shrink-0">⚠ {ruta.stops.filter(s => s.aproximada).length} parada(s) con ubicación aproximada</span>
                <span className="text-amber-700">— el pin cae en el centro del barrio, no en la puerta. Guiate por la dirección antes de navegar.</span>
              </div>
            )}

            {/* PDVs sumados a mano a la ruta */}
            {ruta && ruta.stops.some(s => s.agregado) && (
              <div className="w-full mt-2 pt-2.5 border-t border-[rgba(12,92,171,0.15)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0c5cab] mb-1.5">
                  Sumados a la ruta ({ruta.stops.filter(s => s.agregado).length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ruta.stops.filter(s => s.agregado).map(s => (
                    <span key={s.pdv_id} className="inline-flex items-center gap-1.5 text-[11px] bg-[rgba(12,92,171,0.08)] border border-[rgba(12,92,171,0.25)] text-[#09090b] pl-2 pr-1 py-0.5 rounded-full">
                      #{s.pdv_id} — {(s.razon_social ?? 's/n').slice(0, 22)}
                      <button
                        onClick={() => quitarPdv(s.pdv_id)}
                        title="Quitar de la ruta"
                        className="w-4 h-4 flex items-center justify-center rounded-full text-[#71717a] hover:text-[#dc2626] hover:bg-[rgba(220,38,38,0.1)]"
                      >×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Clientes apagados cercanos a la ruta */}
            {ruta && ruta.sugerencias.length > 0 && (
              <div className="w-full mt-2 pt-2.5 border-t border-[rgba(220,38,38,0.18)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#dc2626]">
                  Clientes apagados cercanos ({ruta.sugerencias.length}) · ≤{rutaRadio} m
                </p>
                <p className="text-[11px] text-[#71717a] mb-2">
                  Sin compra hace +3 meses, a pasos de tu recorrido — no te cuesta nada pasar.
                </p>
                <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
                  {ruta.sugerencias.map(s => (
                    <div
                      key={s.pdv_id}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[8px] bg-white border border-[rgba(220,38,38,0.2)]"
                    >
                      <button
                        onClick={() => setFocusPoint([s.lat, s.lon])}
                        className="min-w-0 text-left flex-1"
                        title="Ver en el mapa"
                      >
                        <span className="block text-[12px] font-medium text-[#09090b] truncate">
                          #{s.pdv_id} — {s.razon_social ?? 's/n'}
                        </span>
                        <span className="block text-[11px] text-[#71717a]">
                          Última vta: {fmtDate(s.ultima_vta)} · a {s.dist_m} m
                        </span>
                      </button>
                      <button
                        onClick={() => sumarPdv(s.pdv_id)}
                        disabled={rutaLoading}
                        className="shrink-0 text-[11px] font-semibold text-white bg-[#0c5cab] hover:bg-[#0a4f95] px-2.5 py-1 rounded-[7px] transition-colors disabled:opacity-60"
                      >
                        + Sumar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>{/* fin contenedor colapsable */}
      </div>

      {/* ── Map ── */}
      {/* En mobile va full-bleed (sin padding ni card) y el bottom sheet flota
          encima; en desktop mantiene el card con padding y bordes redondeados. */}
      <div className="flex-1 relative min-h-0 lg:px-6 lg:pb-6">
        <div ref={mapaRef} className="relative h-full w-full overflow-hidden border-[#e4e4e7] lg:rounded-2xl lg:border">
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
              crossOrigin="anonymous"
            />
            {!ruta && (
            <MarkerClusterGroup chunkedLoading>
              {filtered.map(p => (
                <Marker
                  key={p.pdv_id}
                  position={[p.latitud, p.longitud]}
                  icon={p.aproximada ? makeIcon(pdvColor(p), true) : (iconCache.get(pdvColor(p)) ?? makeIcon(COLOR_INACTIVO))}
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
                      {p.aproximada && (
                        <p style={{ marginTop: 6, fontSize: 10.5, color: '#b45309', fontWeight: 600, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 6px', lineHeight: 1.35 }}>
                          Ubicación aproximada (centro del barrio) — guiate por la dirección, no por el pin.
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
            )}

            {/* ── Ruta activa ── */}
            {ruta && ruta.stops.length > 0 && (
              <>
                <FitBounds
                  positions={ruta.stops.map(s => [s.lat, s.lon] as [number, number])}
                  sig={`${ruta.vendedor}|${ruta.dia}|${ruta.stops.length}`}
                />
                <FlyTo point={focusPoint} />
                {ruta.geometry.length >= 2 && (
                  <Polyline
                    positions={ruta.geometry}
                    pathOptions={{ color: '#0c5cab', weight: 4, opacity: 0.75 }}
                  />
                )}
                {/* Sugerencias (PDVs inactivos de paso) */}
                {ruta.sugerencias.map(s => (
                  <Marker key={`sug-${s.pdv_id}`} position={[s.lat, s.lon]} icon={suggestionIcon}>
                    <Popup minWidth={200}>
                      <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', lineHeight: 1.5 }}>
                        <p style={{ fontWeight: 700, fontSize: 12, marginBottom: 2, color: '#dc2626' }}>
                          Cliente apagado cercano · a {s.dist_m} m
                        </p>
                        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#09090b' }}>
                          #{s.pdv_id} — {s.razon_social ?? '—'}
                        </p>
                        <p style={{ fontSize: 11, color: '#71717a', margin: 0 }}>
                          Última vta: {fmtDate(s.ultima_vta)} · Visita: {fmtDia(s.dia_visita)}
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                ))}
                {/* Paradas numeradas */}
                {ruta.stops.map((s, i) => (
                  <Marker
                    key={`stop-${s.pdv_id}`}
                    position={[s.lat, s.lon]}
                    icon={makeNumberedIcon(i + 1, recencyColor(s.ultima_vta), s.aproximada)}
                    zIndexOffset={1000}
                  >
                    <Popup minWidth={220}>
                      <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', lineHeight: 1.5 }}>
                        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#09090b' }}>
                          {i + 1}. #{s.pdv_id} — {s.razon_social ?? '—'}
                        </p>
                        <p style={{ fontSize: 11, color: '#71717a', margin: 0 }}>
                          {s.canal_venta ?? '—'} · {s.partido ?? '—'}<br />
                          Última vta: {fmtDate(s.ultima_vta)}
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </>
            )}
          </MapContainer>
        </div>

        {/* ══════════════ Mobile (<lg): overlays sobre el mapa ══════════════ */}
        {/* Van FUERA de mapaRef para no entrar en la captura del PDF. */}

        {/* Contador de PDVs (arriba, centrado) */}
        <div className="lg:hidden absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="rounded-full bg-white/95 backdrop-blur px-3 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.14)] text-[12px] text-[#71717a] whitespace-nowrap">
            {loadError ? (
              <span className="text-[#dc2626]">Error al cargar PDVs</span>
            ) : loading ? (
              'Cargando PDVs…'
            ) : (
              <>
                <span className="font-semibold text-[#09090b]">{filtered.length.toLocaleString('es-AR')}</span>
                {' '}de {puntos.length.toLocaleString('es-AR')} PDVs
              </>
            )}
          </div>
        </div>

        {/* Bottom sheet: armador de ruta (peek) + filtros/opciones (expandido) */}
        <div className="lg:hidden absolute inset-x-0 bottom-0 z-[1100] flex flex-col bg-white rounded-t-2xl border-t border-[#e4e4e7] shadow-[0_-8px_32px_rgba(0,0,0,0.18)] pb-[env(safe-area-inset-bottom)] max-h-[85vh]">
          {/* Handle — tap para expandir/colapsar */}
          <button
            onClick={() => setSheetExpanded(v => !v)}
            aria-label={sheetExpanded ? 'Colapsar panel' : 'Expandir panel'}
            className="flex-shrink-0 w-full flex justify-center pt-2 pb-1.5 active:bg-[rgba(0,0,0,0.02)]"
          >
            <span className="w-9 h-1 rounded-full bg-[#d4d4d8]" />
          </button>

          {/* ── Peek: armador de ruta rápido ── */}
          <div className="flex-shrink-0 px-4 pb-3 space-y-2.5">
            <div className="flex items-end gap-2">
              <label className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a]">Vendedor</span>
                <select
                  value={rutaVend || (opts.vendedores.length === 1 ? opts.vendedores[0] : '')}
                  onChange={e => setRutaVend(e.target.value)}
                  disabled={opts.vendedores.length === 1}
                  className="w-full px-2.5 py-2 text-[13px] rounded-[8px] border border-[#e4e4e7] bg-white text-[#09090b] disabled:opacity-70"
                >
                  <option value="">Elegí vendedor…</option>
                  {opts.vendedores.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a]">Día</span>
                <select
                  value={rutaDia}
                  onChange={e => setRutaDia(e.target.value)}
                  className="px-2.5 py-2 text-[13px] rounded-[8px] border border-[#e4e4e7] bg-white text-[#09090b]"
                >
                  {DIA_ORDER.map(d => <option key={d} value={d}>{DIA_NAMES[d]}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-stretch gap-2">
              <button
                onClick={armarRuta}
                disabled={rutaLoading}
                className="flex-1 px-3.5 py-2.5 text-[13px] font-semibold rounded-[10px] bg-[#0c5cab] text-white hover:bg-[#0a4f95] transition-colors disabled:opacity-60"
              >
                {rutaLoading ? 'Calculando…' : ruta && ruta.stops.length > 0 ? 'Rearmar ruta' : 'Armar ruta'}
              </button>
              <button
                onClick={() => setSheetExpanded(v => !v)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium rounded-[10px] border border-[#e4e4e7] bg-white text-[#71717a] active:bg-[rgba(0,0,0,0.03)] transition-colors"
              >
                {sheetExpanded ? 'Menos' : 'Filtros'}
                {hasFilters && !sheetExpanded && <span className="w-1.5 h-1.5 rounded-full bg-[#0c5cab]" />}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform duration-200 ${sheetExpanded ? 'rotate-180' : ''}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </div>
            {rutaError && <p className="text-[12px] text-[#dc2626] leading-snug">{rutaError}</p>}
            {ruta && ruta.stops.length > 0 && !rutaError && (
              <p className="text-[12px] text-[#09090b] font-medium leading-snug">{ruta.resumen}</p>
            )}
          </div>

          {/* ── Expandido: resto de filtros + opciones de ruta (animado) ── */}
          <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${sheetExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="max-h-[52vh] overflow-y-auto overscroll-contain px-4 pt-3 pb-3 border-t border-[#e4e4e7] space-y-4">

                {/* Filtros del mapa */}
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]">Filtros del mapa</p>
                  <div className="flex flex-wrap gap-2">
                    <MultiSelect
                      label="PDV"
                      options={opts.pdvs}
                      selected={selPdvs}
                      onChange={setSelPdvs}
                      formatOption={id => pdvLabel.get(id) ?? `#${id}`}
                      searchable
                    />
                    <MultiSelect label="Vendedor" options={opts.vendedores} selected={selVendedores} onChange={setSelVendedores} />
                    <MultiSelect label="Zona"     options={opts.zonas}      selected={selZonas}      onChange={setSelZonas} />
                    <MultiSelect label="Partido"  options={opts.partidos}   selected={selPartidos}   onChange={setSelPartidos} />
                    <MultiSelect label="Canal"    options={opts.canales}    selected={selCanales}    onChange={setSelCanales} />
                    {opts.dias.length > 0 && (
                      <MultiSelect label="Día de visita" options={opts.dias} selected={selDias} onChange={setSelDias} formatOption={d => DIA_NAMES[d] ?? d} />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-[8px] border border-[#e4e4e7] overflow-hidden">
                      {(['todos', 'solo'] as RuteableFilter[]).map(v => (
                        <button
                          key={v}
                          onClick={() => setRuteable(v)}
                          className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                            ruteable === v ? 'bg-[rgba(12,92,171,0.18)] text-[#09090b]' : 'text-[#71717a] active:bg-[rgba(0,0,0,0.03)]'
                          }`}
                        >
                          {v === 'todos' ? 'Todos' : 'Solo ruteables'}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setClienteActivo(v => !v)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-[8px] border transition-all whitespace-nowrap ${
                        clienteActivo
                          ? 'bg-[rgba(22,163,74,0.15)] border-[rgba(22,163,74,0.4)] text-[#09090b]'
                          : 'bg-[rgba(0,0,0,0.03)] border-[#e4e4e7] text-[#71717a]'
                      }`}
                    >
                      <span className={`flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border transition-all shrink-0 ${clienteActivo ? 'bg-[#16a34a] border-[#16a34a]' : 'bg-transparent border-[#d4d4d8]'}`}>
                        {clienteActivo && (
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.2 5.7L6.5 2.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        )}
                      </span>
                      Cliente activo
                    </button>
                    {hasFilters && (
                      <button
                        onClick={clearAll}
                        className="px-3 py-1.5 text-[12px] font-medium text-[#dc2626] bg-[rgba(220,38,38,0.08)] border border-[rgba(220,38,38,0.2)] rounded-[8px] active:bg-[rgba(220,38,38,0.14)] transition-colors"
                      >
                        Limpiar filtros
                      </button>
                    )}
                  </div>
                </div>

                {/* Opciones de ruta (sólo con ruta armada o para elegir radio) */}
                <div className="space-y-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]">Ruta</p>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-[#71717a]">Radio de apagados cercanos</span>
                    <select
                      value={rutaRadio}
                      onChange={e => cambiarRadio(Number(e.target.value))}
                      className="px-2.5 py-1.5 text-[12px] rounded-[8px] border border-[#e4e4e7] bg-white text-[#09090b]"
                    >
                      {[200, 300, 400, 600, 800, 1000, 1500].map(r => <option key={r} value={r}>{r} m</option>)}
                    </select>
                  </label>

                  {/* Aviso: paradas con ubicación aproximada */}
                  {ruta && ruta.stops.some(s => s.aproximada) && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px]">
                      <span className="font-bold text-amber-800 shrink-0">⚠ {ruta.stops.filter(s => s.aproximada).length} aprox.</span>
                      <span className="text-amber-700">El pin cae en el centro del barrio; guiate por la dirección.</span>
                    </div>
                  )}

                  {/* Sumados a mano */}
                  {ruta && ruta.stops.some(s => s.agregado) && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0c5cab] mb-1.5">
                        Sumados a la ruta ({ruta.stops.filter(s => s.agregado).length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {ruta.stops.filter(s => s.agregado).map(s => (
                          <span key={s.pdv_id} className="inline-flex items-center gap-1.5 text-[11px] bg-[rgba(12,92,171,0.08)] border border-[rgba(12,92,171,0.25)] text-[#09090b] pl-2 pr-1 py-0.5 rounded-full">
                            #{s.pdv_id} — {(s.razon_social ?? 's/n').slice(0, 20)}
                            <button onClick={() => quitarPdv(s.pdv_id)} aria-label="Quitar de la ruta" className="w-5 h-5 flex items-center justify-center rounded-full text-[#71717a] active:bg-[rgba(220,38,38,0.1)]">×</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Clientes apagados cercanos */}
                  {ruta && ruta.sugerencias.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#dc2626]">
                        Apagados cercanos ({ruta.sugerencias.length}) · ≤{rutaRadio} m
                      </p>
                      <p className="text-[11px] text-[#71717a] mb-2">Sin compra hace +3 meses, a pasos de tu recorrido.</p>
                      <div className="flex flex-col gap-1.5">
                        {ruta.sugerencias.map(s => (
                          <div key={s.pdv_id} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-[8px] bg-white border border-[rgba(220,38,38,0.2)]">
                            <button onClick={() => { setFocusPoint([s.lat, s.lon]); setSheetExpanded(false); }} className="min-w-0 text-left flex-1" aria-label="Ver en el mapa">
                              <span className="block text-[12px] font-medium text-[#09090b] truncate">#{s.pdv_id} — {s.razon_social ?? 's/n'}</span>
                              <span className="block text-[11px] text-[#71717a]">Última vta: {fmtDate(s.ultima_vta)} · a {s.dist_m} m</span>
                            </button>
                            <button onClick={() => sumarPdv(s.pdv_id)} disabled={rutaLoading} className="shrink-0 text-[11px] font-semibold text-white bg-[#0c5cab] active:bg-[#0a4f95] px-2.5 py-1.5 rounded-[7px] transition-colors disabled:opacity-60">
                              + Sumar
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tramos de Google Maps + acciones secundarias */}
                  {ruta && ruta.stops.length > 0 && (
                    <div className="space-y-1.5">
                      {gmapsLinks.length > 1 && (
                        <p className="text-[11px] text-[#71717a] leading-snug">
                          {ruta.stops.length} paradas → {gmapsLinks.length} tramos en Maps (abrí cada uno en orden).
                        </p>
                      )}
                      {gmapsLinks.map((t, i) => (
                        <a key={t.url} href={t.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#0c5cab] active:border-[#d4d4d8] transition-colors">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" /></svg>
                          {gmapsLinks.length === 1 ? 'Abrir en Google Maps' : `Tramo ${i + 1} (paradas ${t.desde}–${t.hasta})`}
                        </a>
                      ))}
                      <div className="flex gap-2 pt-0.5">
                        <button onClick={copiarCoords} className="flex-1 px-3 py-2 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#0c5cab] active:border-[#d4d4d8] transition-colors">
                          {coordsCopied ? '✓ Copiado' : 'Copiar coords'}
                        </button>
                        <button onClick={limpiarRuta} className="flex-1 px-3 py-2 text-[12px] font-medium text-[#dc2626] bg-[rgba(220,38,38,0.08)] border border-[rgba(220,38,38,0.2)] rounded-[8px] active:bg-[rgba(220,38,38,0.14)] transition-colors">
                          Limpiar ruta
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Referencias (leyenda de colores) */}
                <div className="space-y-1.5 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]">Referencias</p>
                  {LEGEND_ITEMS.map(l => (
                    <div key={l.label} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                      <span className="text-[11.5px] text-[#71717a]">{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Barra de acción: Maps + PDF, siempre visible con ruta armada ── */}
          {ruta && ruta.stops.length > 0 && (
            <div className="flex-shrink-0 flex items-stretch gap-2 px-4 py-2.5 border-t border-[#e4e4e7] bg-white">
              {gmapsLinks.length === 1 ? (
                <a
                  href={gmapsLinks[0].url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold rounded-[10px] bg-[#0c5cab] text-white active:bg-[#0a4f95] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" /></svg>
                  Google Maps
                </a>
              ) : (
                <button
                  onClick={() => setSheetExpanded(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold rounded-[10px] bg-[#0c5cab] text-white active:bg-[#0a4f95] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" /></svg>
                  Maps · {gmapsLinks.length} tramos
                </button>
              )}
              <button
                onClick={exportarPDF}
                disabled={pdfLoading}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold rounded-[10px] border border-[#e4e4e7] bg-white text-[#0c5cab] active:border-[#d4d4d8] transition-colors disabled:opacity-60"
              >
                {pdfLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-[#e4e4e7] border-t-[#0c5cab] animate-spin" />
                    Generando…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
                    Exportar PDF
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

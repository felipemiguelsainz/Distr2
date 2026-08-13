'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { CalendarRange, Check, ChevronDown, RotateCcw, X } from 'lucide-react';
import { MAX_PERIODOS, MESES_CORTOS, MESES_LARGOS, TOTAL_EMPRESA, mesPasado, labelPeriodos } from '@/lib/periodos';

// ---------------------------------------------------------------------------
// Barra de filtros única (equipo · vendedor · meses · años · rango de fechas).
//
// A diferencia de los filtros viejos —que navegaban en cada `onChange`— acá se
// arma la selección en estado local y recién se navega al tocar **Aplicar**:
// elegir 3 meses y un vendedor es UNA sola recarga, no cuatro.
//
// Meses y años son multi-selección: los dashboards suman los períodos elegidos.
// ---------------------------------------------------------------------------

const BTN = 'inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-[8px] border transition-all';
const CTRL = `${BTN} bg-[#f4f4f5] border-[#e4e4e7] text-[#09090b] hover:border-[#d4d4d8] cursor-pointer`;
const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

export interface FilterBarProps {
  /** Meses seleccionados (1-12). */
  meses: number[];
  /** Años seleccionados. */
  anios: number[];

  // ── Equipo (opcional) ────────────────────────────────────────────────
  equipos?: string[];
  /** Equipo actual; '' = Total Empresa. */
  equipoActual?: string;
  /** Si el equipo va en el path (…/consolidado/[equipo]) en vez de en un query param. */
  equipoBasePath?: string;
  /** Nombre del query param del equipo cuando no va en el path. */
  equipoParam?: string;
  /** Habilita la opción "Total Empresa" en el selector de equipo (sólo admin). */
  permitirTotalEmpresa?: boolean;

  // ── Vendedor (opcional) ──────────────────────────────────────────────
  vendedores?: { nombre: string; equipo?: string | null }[];
  vendedorActual?: string;

  /** Un solo mes y un solo año (pantallas que editan datos de UN período). */
  periodoUnico?: boolean;

  // ── Rango de fechas aditivo (opcional) ───────────────────────────────
  mostrarRango?: boolean;
  desde?: string;
  hasta?: string;
}

// ---------------------------------------------------------------------------
// Popover con click-outside
// ---------------------------------------------------------------------------
function Popover({
  label,
  resumen,
  children,
}: {
  label: string;
  resumen: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={CTRL}
      >
        <span className="text-[#71717a]">{label}</span>
        <span className="font-semibold">{resumen}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-[#71717a] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {/* En mobile el panel es un bottom-sheet: anclado al botón se saldría de
              pantalla (los controles arrancan pegados al borde izquierdo). Mismo
              patrón que los filtros del mapa. */}
          <div className="fixed inset-0 z-[9998] bg-black/30 lg:hidden" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-[9999] max-h-[75vh] rounded-t-2xl border-t border-[#e4e4e7] pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgba(0,0,0,0.2)] bg-white flex flex-col
                          lg:absolute lg:inset-x-auto lg:bottom-auto lg:top-full lg:right-0 lg:mt-1.5 lg:min-w-[220px] lg:max-h-[70vh] lg:rounded-[12px] lg:border lg:pb-0 lg:shadow-xl lg:shadow-black/10">
            {/* Encabezado — sólo mobile */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-[#e4e4e7] lg:hidden">
              <span className="text-[14px] font-semibold text-[#09090b]">{label}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[13px] font-semibold text-[#0c5cab] px-2 py-1 -mr-2"
              >
                Listo
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain p-2">
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OpcionCheck({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[7px] text-[12.5px] text-left transition-colors ${
        activo ? 'bg-[rgba(12,92,171,0.08)] text-[#0c5cab] font-semibold' : 'text-[#27272a] hover:bg-[#f4f4f5]'
      }`}
    >
      <span
        className={`w-3.5 h-3.5 shrink-0 rounded-[4px] border flex items-center justify-center ${
          activo ? 'bg-[#0c5cab] border-[#0c5cab]' : 'border-[#d4d4d8]'
        }`}
      >
        {activo && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
      </span>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
export function FilterBar({
  meses,
  anios,
  equipos,
  equipoActual = '',
  equipoBasePath,
  equipoParam = 'equipo',
  permitirTotalEmpresa = false,
  vendedores,
  vendedorActual = '',
  periodoUnico = false,
  mostrarRango = false,
  desde = '',
  hasta = '',
}: FilterBarProps) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Estado local: nada navega hasta tocar "Aplicar".
  const mesesProp = meses.join(',');
  const aniosProp = anios.join(',');
  const firmaProps = [mesesProp, aniosProp, equipoActual, vendedorActual, desde, hasta].join('|');

  const [mesesSel,  setMeses]  = useState<number[]>(meses);
  const [aniosSel,  setAnios]  = useState<number[]>(anios);
  const [equipo,    setEquipo] = useState(equipoActual);
  const [vendedor,  setVend]   = useState(vendedorActual);
  const [dDesde,    setDesde]  = useState(desde);
  const [dHasta,    setHasta]  = useState(hasta);

  // Cuando la URL cambia (Aplicar, back/forward, un link), el estado local vuelve
  // a lo que dice la URL. Se ajusta en render —no en un efecto— para no encadenar
  // un segundo render con datos viejos.
  const [firma, setFirma] = useState(firmaProps);
  if (firma !== firmaProps) {
    setFirma(firmaProps);
    setMeses(meses);
    setAnios(anios);
    setEquipo(equipoActual);
    setVend(vendedorActual);
    setDesde(desde);
    setHasta(hasta);
  }

  const anioHoy = new Date().getFullYear();
  const aniosDisponibles = useMemo(() => {
    const base = [anioHoy - 3, anioHoy - 2, anioHoy - 1, anioHoy];
    const elegidos = aniosProp ? aniosProp.split(',').map(Number) : [];
    return [...new Set([...base, ...elegidos])].sort((a, b) => b - a);
  }, [anioHoy, aniosProp]);

  // El vendedor debe pertenecer al equipo elegido.
  const vendedoresVisibles = useMemo(() => {
    if (!vendedores) return [];
    if (!equipo) return vendedores;
    return vendedores.some((v) => v.equipo !== undefined)
      ? vendedores.filter((v) => v.equipo == null || v.equipo === equipo)
      : vendedores;
  }, [vendedores, equipo]);

  // Al cambiar de equipo, el vendedor elegido puede no pertenecer al nuevo.
  function elegirEquipo(nuevo: string) {
    setEquipo(nuevo);
    if (vendedor && nuevo && vendedores) {
      const v = vendedores.find((x) => x.nombre === vendedor);
      if (v && v.equipo != null && v.equipo !== nuevo) setVend('');
    }
  }

  // ── Navegación ────────────────────────────────────────────────────────
  const navegar = useCallback(
    (sel: {
      meses: number[]; anios: number[]; equipo: string; vendedor: string;
      desde: string; hasta: string;
    }) => {
      const params = new URLSearchParams(searchParams.toString());

      params.set('mes',  sel.meses.length > 0 ? sel.meses.join(',')  : String(new Date().getMonth() + 1));
      params.set('anio', sel.anios.length > 0 ? sel.anios.join(',') : String(new Date().getFullYear()));

      if (vendedores) {
        if (sel.vendedor) params.set('vendedor', sel.vendedor);
        else              params.delete('vendedor');
      }
      if (mostrarRango) {
        if (sel.desde) params.set('desde', sel.desde); else params.delete('desde');
        if (sel.hasta) params.set('hasta', sel.hasta); else params.delete('hasta');
      }

      let destino = pathname;
      if (equipos) {
        if (equipoBasePath) {
          // El equipo viaja en el path: /base/[equipo] (TOTAL_EMPRESA = todos).
          destino = `${equipoBasePath}/${encodeURIComponent(sel.equipo || TOTAL_EMPRESA)}`;
        } else if (sel.equipo) {
          params.set(equipoParam, sel.equipo);
        } else {
          params.delete(equipoParam);
        }
      }

      const qs = params.toString();
      startTransition(() => router.push(qs ? `${destino}?${qs}` : destino));
    },
    [router, pathname, searchParams, equipos, equipoBasePath, equipoParam, vendedores, mostrarRango],
  );

  const aplicar = () =>
    navegar({ meses: mesesSel, anios: aniosSel, equipo, vendedor, desde: dDesde, hasta: dHasta });

  const verCierreMesPasado = () => {
    const p = mesPasado();
    setMeses([p.mes]);
    setAnios([p.anio]);
    navegar({ meses: [p.mes], anios: [p.anio], equipo, vendedor, desde: '', hasta: '' });
  };

  const sinCambios =
    mesesSel.join(',') === meses.join(',') &&
    aniosSel.join(',') === anios.join(',') &&
    equipo === equipoActual &&
    vendedor === vendedorActual &&
    dDesde === desde &&
    dHasta === hasta;

  // ── Resúmenes de los popovers ─────────────────────────────────────────
  // Con muchos meses elegidos el botón se estiraba y rompía la barra: a partir
  // de 4 se resume en un contador.
  const resumenMeses = mesesSel.length === 0
    ? 'Ninguno'
    : mesesSel.length === 1
      ? MESES_LARGOS[mesesSel[0] - 1]
      : mesesSel.length === 12
        ? 'Todos'
        : mesesSel.length <= 3
          ? mesesSel.map((m) => MESES_CORTOS[m - 1]).join(', ')
          : `${mesesSel.length} meses`;

  const resumenAnios = aniosSel.length === 0
    ? 'Ninguno'
    : aniosSel.length === 1
      ? String(aniosSel[0])
      : aniosSel.join(', ');

  const toggle = (arr: number[], v: number) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v].sort((a, b) => a - b);

  const periodosPreview = useMemo(
    () => aniosSel.flatMap((a) => mesesSel.map((m) => ({ anio: a, mes: m })))
      .sort((x, y) => (x.anio * 12 + x.mes) - (y.anio * 12 + y.mes)),
    [aniosSel, mesesSel],
  );

  const inputDate =
    'px-2 py-[7px] text-[13px] bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[8px] text-[#09090b] focus:outline-none focus:border-[rgba(12,92,171,0.4)] transition-all';

  return (
    <div className="flex flex-col gap-2 items-stretch sm:items-end">
      <div className="flex items-center gap-2 flex-wrap">
        {/* ── Equipo ── */}
        {equipos && equipos.length > 0 && (
          <Popover
            label="Equipo"
            resumen={equipo || (permitirTotalEmpresa ? 'Total Empresa' : 'Todos')}
          >
            <div>
              {permitirTotalEmpresa && (
                <OpcionCheck activo={equipo === ''} onClick={() => elegirEquipo('')}>
                  Total Empresa
                </OpcionCheck>
              )}
              {equipos.map((e) => (
                <OpcionCheck key={e} activo={equipo === e} onClick={() => elegirEquipo(e)}>
                  {e}
                </OpcionCheck>
              ))}
            </div>
          </Popover>
        )}

        {/* ── Vendedor ── */}
        {vendedores && vendedores.length > 0 && (
          <Popover label="Vendedor" resumen={vendedor || 'Todos'}>
            <div>
              <OpcionCheck activo={vendedor === ''} onClick={() => setVend('')}>
                Todos los vendedores
              </OpcionCheck>
              {vendedoresVisibles.map((v) => (
                <OpcionCheck key={v.nombre} activo={vendedor === v.nombre} onClick={() => setVend(v.nombre)}>
                  {v.nombre}
                </OpcionCheck>
              ))}
            </div>
          </Popover>
        )}

        {/* ── Meses (multi salvo periodoUnico) ── */}
        <Popover label="Mes" resumen={resumenMeses}>
          {!periodoUnico && (
            <div className="flex items-center justify-between px-2 pb-1.5 mb-1 border-b border-[#e4e4e7]">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>Meses</span>
              <span className="flex items-center gap-2">
                <button type="button" onClick={() => setMeses([1,2,3,4,5,6,7,8,9,10,11,12])} className="text-[11px] text-[#0c5cab] hover:underline">Todos</button>
                <span className="text-[#e4e4e7]">·</span>
                <button type="button" onClick={() => setMeses([])} className="text-[11px] text-[#71717a] hover:underline">Ninguno</button>
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-1">
            {MESES_LARGOS.map((nombre, i) => (
              <OpcionCheck
                key={nombre}
                activo={mesesSel.includes(i + 1)}
                onClick={() => setMeses((prev) => (periodoUnico ? [i + 1] : toggle(prev, i + 1)))}
              >
                {nombre}
              </OpcionCheck>
            ))}
          </div>
        </Popover>

        {/* ── Años (multi salvo periodoUnico) ── */}
        <Popover label="Año" resumen={resumenAnios}>
          {aniosDisponibles.map((a) => (
            <OpcionCheck
              key={a}
              activo={aniosSel.includes(a)}
              onClick={() => setAnios((prev) => (periodoUnico ? [a] : toggle(prev, a)))}
            >
              {a}
            </OpcionCheck>
          ))}
        </Popover>

        {/* ── Rango de fechas ── */}
        {mostrarRango && (
          <div className="flex items-center gap-1.5" title="Ver lo vendido entre dos fechas">
            <CalendarRange className="w-4 h-4 text-[#71717a] shrink-0" />
            <input
              type="date" value={dDesde} max={dHasta || undefined}
              onChange={(e) => setDesde(e.target.value)}
              className={inputDate} aria-label="Fecha desde"
            />
            <span className="text-[#71717a] text-[13px]">→</span>
            <input
              type="date" value={dHasta} min={dDesde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              className={inputDate} aria-label="Fecha hasta"
            />
            {(dDesde || dHasta) && (
              <button
                type="button"
                onClick={() => { setDesde(''); setHasta(''); }}
                title="Limpiar rango" aria-label="Limpiar rango"
                className="p-1 text-[#a1a1aa] hover:text-[#dc2626] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* ── Aplicar ── */}
        <button
          type="button"
          onClick={aplicar}
          disabled={pending || sinCambios || mesesSel.length === 0 || aniosSel.length === 0}
          className={`${BTN} border-transparent text-white shadow-md shadow-blue-500/20 disabled:opacity-45 disabled:shadow-none disabled:cursor-default`}
          style={{ background: '#0c5cab' }}
        >
          {pending ? 'Aplicando…' : 'Aplicar'}
          {!sinCambios && !pending && <span className="w-1.5 h-1.5 rounded-full bg-white/90" />}
        </button>
      </div>

      {/* ── Atajos + preview del período ── */}
      <div className="flex items-center gap-2 flex-wrap sm:justify-end">
        <button
          type="button"
          onClick={verCierreMesPasado}
          title="Cierre del mes pasado: acumulado final contra la meta"
          className={`${BTN} bg-white border-[#e4e4e7] text-[#0c5cab] hover:border-[rgba(12,92,171,0.4)] hover:bg-[rgba(12,92,171,0.04)]`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Cierre mes pasado
        </button>
        {!sinCambios && (
          <span className="text-[11px] text-[#71717a]" style={MONO}>
            {periodosPreview.length === 0
              ? 'Elegí al menos un mes y un año'
              : periodosPreview.length > MAX_PERIODOS
                ? `${periodosPreview.length} períodos — se toman los últimos ${MAX_PERIODOS}`
                : `${labelPeriodos(periodosPreview)} — tocá Aplicar`}
          </span>
        )}
      </div>
    </div>
  );
}

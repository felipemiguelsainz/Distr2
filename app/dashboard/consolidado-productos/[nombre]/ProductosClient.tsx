'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { formatKg, formatCurrency } from '@/lib/calculations/dashboard';
import type { CatalogoItem, ConsolidadoProductoRow } from '@/lib/calculations/productos';
import type { Periodo } from '@/lib/periodos';

const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };
const CARD = 'bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 overflow-hidden';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function TH({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 py-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#71717a] whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={MONO}
    >
      {children}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Tabla genérica por vendedor
// ---------------------------------------------------------------------------
function VendedorTable({
  title,
  data,
  cols,
}: {
  title: string;
  data:  ConsolidadoProductoRow[];
  cols:  { label: string; value: (r: ConsolidadoProductoRow) => number | null; fmt: (v: number) => string }[];
}) {
  const totals = cols.map((c) => {
    const vals = data.map((r) => c.value(r));
    if (vals.every((v) => v == null)) return null;
    return vals.reduce((s: number, v) => s + (v ?? 0), 0);
  });

  return (
    <div className={CARD}>
      <p className="px-4 py-3 border-b border-[#e4e4e7] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>
        {title}
      </p>
      <div className="overflow-x-auto">
        <table className="table-fixed w-full text-[11px]" style={{ minWidth: 150 + cols.length * 110 }}>
          <thead>
            <tr className="border-b border-[#e4e4e7] bg-[#f4f4f5]/60">
              <TH>Vendedor</TH>
              {cols.map((c) => <TH key={c.label} right>{c.label}</TH>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e4e7]">
            {data.map((r) => (
              <tr key={r.vendedor} className="hover:bg-[rgba(12,92,171,0.04)]">
                <td className="px-3 py-2 text-[10px] truncate text-[#27272a]" style={MONO}>{r.vendedor}</td>
                {cols.map((c) => {
                  const v = c.value(r);
                  return (
                    <td key={c.label} className="px-3 py-2 text-right tabular-nums text-[#09090b]" style={MONO}>
                      {v == null ? '—' : c.fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {data.length > 0 && (
              <tr className="bg-[#f4f4f5] border-t-2 border-t-[#d4d4d8]">
                <td className="px-3 py-2 text-[10px] text-[#09090b] font-bold" style={MONO}>TOTAL</td>
                {cols.map((c, i) => (
                  <td key={c.label} className="px-3 py-2 text-right tabular-nums text-[#09090b] font-bold" style={MONO}>
                    {totals[i] == null ? '—' : c.fmt(totals[i] as number)}
                  </td>
                ))}
              </tr>
            )}
            {data.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="px-3 py-6 text-center text-[#71717a] text-[12px]">
                  Sin datos para los productos seleccionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buscador de productos — checkboxes agrupados por rubro
// ---------------------------------------------------------------------------
function ProductoSelector({
  catalogo,
  totalArticulos,
  seleccionados,
  onToggleArticulo,
  onToggleRubro,
  onAll,
  onNone,
}: {
  catalogo:        CatalogoItem[];
  /** Artículos distintos. No es catalogo.length: un artículo puede estar en
      varios rubros y aparece una fila por cada uno. */
  totalArticulos:  number;
  seleccionados:   Set<string>;
  onToggleArticulo: (articulo: string) => void;
  onToggleRubro:   (articulos: string[], select: boolean) => void;
  onAll:  () => void;
  onNone: () => void;
}) {
  const [search, setSearch]   = useState('');
  const [openRubros, setOpen] = useState<Set<string>>(new Set());

  const porRubro = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const { rubro, articulo } of catalogo) {
      const arr = m.get(rubro) ?? [];
      arr.push(articulo);
      m.set(rubro, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalogo]);

  const q = search.trim().toLowerCase();

  return (
    <div className={CARD}>
      <div className="px-4 py-3 border-b border-[#e4e4e7] flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>
          Productos — {seleccionados.size} de {totalArticulos}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={onAll}  className="text-[11px] text-[#0c5cab] hover:underline">Todos</button>
          <span className="text-[#e4e4e7]">·</span>
          <button onClick={onNone} className="text-[11px] text-[#71717a] hover:underline">Ninguno</button>
        </div>
      </div>

      <div className="p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto…"
          className="w-full px-3 py-2 text-[13px] bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[8px] text-[#09090b] caret-[#0c5cab] focus:outline-none focus:border-[rgba(12,92,171,0.4)] transition-all placeholder:text-[#9f9fa9] mb-2"
        />
        <div className="max-h-[280px] overflow-y-auto space-y-1">
          {porRubro.map(([rubro, articulos]) => {
            const visibles = q
              ? articulos.filter((a) => a.toLowerCase().includes(q))
              : articulos;
            if (visibles.length === 0) return null;

            const selCount = articulos.filter((a) => seleccionados.has(a)).length;
            const allSel   = selCount === articulos.length;
            const isOpen   = openRubros.has(rubro) || q.length > 0;

            return (
              <div key={rubro} className="rounded-lg border border-[#e4e4e7] overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-[#f4f4f5]/50">
                  <input
                    type="checkbox"
                    checked={allSel}
                    ref={(el) => { if (el) el.indeterminate = selCount > 0 && !allSel; }}
                    onChange={() => onToggleRubro(articulos, !allSel)}
                    className="accent-[#0c5cab]"
                  />
                  <button
                    onClick={() => setOpen((prev) => {
                      const n = new Set(prev);
                      if (n.has(rubro)) n.delete(rubro); else n.add(rubro);
                      return n;
                    })}
                    className="flex-1 flex items-center justify-between text-left"
                  >
                    <span className="text-[12px] font-semibold text-[#27272a]">{rubro}</span>
                    <span className="text-[10px] text-[#71717a]" style={MONO}>
                      {selCount}/{articulos.length}
                      <span className={`ml-2 inline-block transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                    </span>
                  </button>
                </div>
                <div className={`grid transition-all duration-200 ease-in-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="px-3 py-1.5 space-y-0.5">
                      {visibles.map((a) => (
                        <label key={a} className="flex items-center gap-2 py-0.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={seleccionados.has(a)}
                            onChange={() => onToggleArticulo(a)}
                            className="accent-[#0c5cab]"
                          />
                          <span className="text-[11.5px] text-[#27272a] truncate">{a}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function ProductosClient({
  equipo,
  periodos,
  catalogo,
  filasIniciales,
  cccCaption,
}: {
  equipo:         string;
  periodos:       Periodo[];
  catalogo:       CatalogoItem[];
  filasIniciales: ConsolidadoProductoRow[];
  cccCaption?:    string;
}) {
  // Deduplicado: un mismo artículo puede figurar bajo más de un rubro (hoy 497
  // filas de catálogo para 482 artículos distintos). Sin esto, `seleccionados`
  // —que es un Set— nunca llega al largo de la lista, así que "están todos
  // elegidos" no se detectaba nunca: no se usaba el atajo de mandar
  // `articulos: null` al RPC y el contador mostraba "482 de 497" de arranque.
  const allArticulos = useMemo(
    () => [...new Set(catalogo.map((c) => c.articulo))],
    [catalogo],
  );
  const [seleccionados, setSeleccionados] = useState<Set<string>>(() => new Set(allArticulos));
  const [filas, setFilas]   = useState<ConsolidadoProductoRow[]>(filasIniciales);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Al tocar Aplicar con otro mes/equipo, el server re-renderiza y manda
  // `filasIniciales` nuevas, pero React reusa esta misma instancia: `useState`
  // solo mira su argumento en el primer montaje, así que sin esto la tabla se
  // queda con el período anterior y hay que recargar la página a mano.
  const firmaPeriodo = `${equipo}|${periodos.map((p) => `${p.anio}-${p.mes}`).join(',')}`;
  const [firmaPrev, setFirmaPrev] = useState(firmaPeriodo);
  if (firmaPeriodo !== firmaPrev) {
    setFirmaPrev(firmaPeriodo);
    setFilas(filasIniciales);
  }

  const refetch = useCallback((sel: Set<string>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      // Si están todos seleccionados, mandamos null (= todos, más rápido en el RPC)
      const articulos = sel.size === allArticulos.length ? null : [...sel];
      try {
        const res = await fetch('/api/consolidado-productos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ equipo, periodos, articulos }),
        });
        const data = await res.json();
        if (res.ok) setFilas(data.filas ?? []);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, [equipo, periodos, allArticulos.length]);

  const apply = useCallback((next: Set<string>) => {
    setSeleccionados(next);
    refetch(next);
  }, [refetch]);

  // `filasIniciales` siempre viene con TODOS los productos: el server no conoce
  // el filtro, que vive solo en el cliente. Si había un subconjunto elegido, al
  // cambiar de período hay que volver a pedir las filas con ese filtro puesto.
  // En el primer montaje están todos seleccionados, así que no dispara.
  useEffect(() => {
    if (seleccionados.size !== allArticulos.length) refetch(seleccionados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaPeriodo]);

  const toggleArticulo = (a: string) => {
    const n = new Set(seleccionados);
    if (n.has(a)) n.delete(a); else n.add(a);
    apply(n);
  };
  const toggleRubro = (articulos: string[], select: boolean) => {
    const n = new Set(seleccionados);
    for (const a of articulos) { if (select) n.add(a); else n.delete(a); }
    apply(n);
  };

  const ordenadas = useMemo(
    () => [...filas].sort((a, b) => a.vendedor.localeCompare(b.vendedor)),
    [filas],
  );

  return (
    <div className="space-y-4">
      <ProductoSelector
        catalogo={catalogo}
        totalArticulos={allArticulos.length}
        seleccionados={seleccionados}
        onToggleArticulo={toggleArticulo}
        onToggleRubro={toggleRubro}
        onAll={() => apply(new Set(allArticulos))}
        onNone={() => apply(new Set())}
      />

      <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
        <VendedorTable
          title="Volumen (KG)"
          data={ordenadas}
          cols={[
            { label: 'Acumulado',  value: (r) => r.kilos,      fmt: (v) => formatKg(v) + ' kg' },
            { label: 'Tendencia',  value: (r) => r.tendencia,  fmt: (v) => formatKg(v) + ' kg' },
            { label: 'Media Real', value: (r) => r.media_real, fmt: (v) => formatKg(v) + ' kg' },
          ]}
        />
        <VendedorTable
          title="Volumen ($)"
          data={ordenadas}
          cols={[
            { label: 'Acumulado',  value: (r) => r.neto,            fmt: formatCurrency },
            { label: 'Tendencia',  value: (r) => r.neto_tendencia,  fmt: formatCurrency },
            { label: 'Media Real', value: (r) => r.neto_media_real, fmt: formatCurrency },
          ]}
        />
        <VendedorTable
          title={cccCaption ? `CCC — Clientes con Compra · ${cccCaption}` : 'CCC — Clientes con Compra'}
          data={ordenadas}
          cols={[
            { label: 'Clientes', value: (r) => r.ccc, fmt: (v) => String(Math.round(v)) },
          ]}
        />
      </div>
    </div>
  );
}

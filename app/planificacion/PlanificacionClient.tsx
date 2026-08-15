'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Tooltip, useMap, useMapEvents,
} from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import {
  COLORES_CUADRANTE, DIAS_HABILES, DIA_NOMBRE, LEYENDA_CANAL, colorPorCanal, contarPorCanal,
  dentroDelPoligono, diaMencionadoEn,
  type Anillo, type Cuadrante, type Dia, type GuardarResultado, type PdvPlan, type PlanificacionData,
} from './types';
import { PuntosLayer, type EstiloPunto } from './PuntosLayer';
import { ResumenPanel } from './ResumenPanel';
import { Dropdown, Segmentado } from './Dropdown';

// JetBrains Mono es la fuente de cifras del sistema y ya se carga en globals.css.
// La stack de mono del sistema (SFMono/Menlo/Consolas) renderizaba estos números
// distinto del resto de la app. Ver DESIGN.md → La Regla del Número Monoespaciado.
const MONO = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" } as const;

/** Color por día del maestro — para leer de un vistazo cómo está hoy la semana. */
const DIA_COLOR: Record<string, string> = {
  LUN: '#0c5cab', MAR: '#e11d48', MIE: '#16a34a',
  JUE: '#f59e0b', VIE: '#7c3aed', SAB: '#0891b2',
};
const COLOR_SIN_DATO = '#a1a1aa';

/** jsPDF pide los colores como tres enteros 0-255, no como hex. */
function hexARgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

type Modo = 'ver' | 'dibujando' | 'formulario';
// 'canal' entra acá y no como toggle aparte porque es otro criterio de color, y
// los criterios son excluyentes: un PDV no puede pintarse por día y por canal a
// la vez. Un toggle separado obligaría a decidir cuál gana.
type ColorearPor = 'dia' | 'plan' | 'canal';

interface Borrador {
  /** id del cuadrante que se está editando, o null si es nuevo. */
  editandoId: string | null;
  /** Localidad con la que se guardó. Se conserva al editar en vez de pisarla
      con el filtro que esté puesto en ese momento. */
  localidad: string | null;
  nombre: string;
  dia: Dia;
  vendedor: string;
  color: string;
  vertices: Anillo;
  pdvIds: number[];
}

interface Conflicto {
  pdvId: number;
  cuadrante: Cuadrante;
  /** 'vendedor' = lo tiene otro; 'dia' = el mismo vendedor ya lo visita ese día. */
  motivo: 'vendedor' | 'dia';
}

// ---------------------------------------------------------------------------
// Interacción de dibujo. Los clics sobre el mapa agregan vértices; el polígono
// se cierra clickeando el primer vértice o con el botón "Cerrar".
// ---------------------------------------------------------------------------
function CapturaClics({ activo, onVertice }: { activo: boolean; onVertice: (v: [number, number]) => void }) {
  const map = useMap();
  useMapEvents({
    click(e) {
      if (activo) onVertice([e.latlng.lat, e.latlng.lng]);
    },
  });
  useEffect(() => {
    // Sin esto, el doble clic para poner dos vértices seguidos hace zoom.
    if (activo) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    const cont = map.getContainer();
    cont.style.cursor = activo ? 'crosshair' : '';
    return () => { cont.style.cursor = ''; };
  }, [activo, map]);
  return null;
}

/**
 * Encuadra el mapa sobre un conjunto de puntos cuando cambia la firma.
 *
 * Recorta el 1% de cada extremo antes de calcular los límites: hay un puñado de
 * PDVs sueltos en Capital y Merlo que, tomados en cuenta, obligan a un zoom tan
 * abierto que la operación real (el sur del GBA) queda del tamaño de una moneda.
 */
function Encuadrar({ puntos, sig }: { puntos: PdvPlan[]; sig: string }) {
  const map = useMap();
  useEffect(() => {
    if (puntos.length === 0) return;
    const pct = (vals: number[], p: number) => vals[Math.floor((vals.length - 1) * p)];
    const lats = puntos.map((p) => p.lat).sort((a, b) => a - b);
    const lons = puntos.map((p) => p.lon).sort((a, b) => a - b);
    // Con pocos puntos no hay outliers que recortar: se usan todos.
    const q = puntos.length >= 50 ? 0.01 : 0;
    map.fitBounds(
      [[pct(lats, q), pct(lons, q)], [pct(lats, 1 - q), pct(lons, 1 - q)]],
      { padding: [40, 40] }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
}

/**
 * Capa propia para los polígonos, por DEBAJO de la de puntos.
 *
 * Sin esto el relleno del cuadrante queda arriba y se come los clics de los PDVs
 * que encierra: tocar un punto que ya está asignado abría el cuadrante en modo
 * edición en vez de mostrar la ficha del PDV.
 */
const PANE_CUADRANTES = 'cuadrantes';
function PaneCuadrantes({ children }: { children: React.ReactNode }) {
  const map = useMap();
  // En useMemo y no en useEffect: los hijos se montan en el mismo render y el
  // pane tiene que existir antes, o Leaflet los manda al pane por defecto.
  // Crear el pane es idempotente, así que repetirlo no rompe nada.
  useMemo(() => {
    if (!map.getPane(PANE_CUADRANTES)) {
      const pane = map.createPane(PANE_CUADRANTES);
      pane.style.zIndex = '390'; // overlayPane (donde van los puntos) es 400
    }
  }, [map]);
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
export default function PlanificacionClient() {
  const [data, setData]       = useState<PlanificacionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  // Los cuadrantes salen del mismo fetch pero viven aparte de `data`: son lo
  // único que se edita en vivo (crear, guardar, borrar) sin recargar los PDVs.
  const [cuadrantes, setCuadrantes] = useState<Cuadrante[]>([]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch('/api/planificacion');
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? 'No se pudo cargar la planificación.');
        }
        const json = (await res.json()) as PlanificacionData;
        if (!cancelado) {
          setData(json);
          setCuadrantes(json.cuadrantes);
        }
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  const puntos     = useMemo(() => data?.puntos ?? [], [data]);
  const vendedores = useMemo(() => data?.vendedores ?? [], [data]);

  // --- Filtros del lienzo -------------------------------------------------
  const [localidad, setLocalidad]         = useState('');
  const [soloSinPlan, setSoloSinPlan]     = useState(false);
  const [colorearPor, setColorearPor]     = useState<ColorearPor>('dia');
  const [ocultos, setOcultos]             = useState<Set<string>>(new Set());
  /** Días cuyos cuadrantes se muestran. Vacío = todos. */
  const [diasVisibles, setDiasVisibles]   = useState<Set<Dia>>(new Set());

  /** Localidad → cuántos PDVs tiene. Se muestra al costado de cada opción para
      poder elegir por tamaño sin tener que probarlas una por una. */
  const conteoPorLocalidad = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of puntos) if (p.localidad) m.set(p.localidad, (m.get(p.localidad) ?? 0) + 1);
    return m;
  }, [puntos]);

  const localidades = useMemo(
    () => [...conteoPorLocalidad.keys()].sort((a, b) => a.localeCompare(b, 'es')),
    [conteoPorLocalidad]
  );

  /** pdv_id → cuadrantes que lo contienen. Base de casi todo lo que sigue. */
  const cuadrantePorPdv = useMemo(() => {
    const m = new Map<number, Cuadrante[]>();
    for (const c of cuadrantes) {
      for (const id of c.pdv_ids) {
        const arr = m.get(id);
        if (arr) arr.push(c);
        else m.set(id, [c]);
      }
    }
    return m;
  }, [cuadrantes]);

  const planificados = cuadrantePorPdv.size;

  // --- Dibujo -------------------------------------------------------------
  const [modo, setModo]           = useState<Modo>('ver');
  const [borrador, setBorrador]   = useState<Borrador | null>(null);

  /** id del cuadrante en edicion; null si es nuevo o no hay borrador. */
  const editandoId = borrador?.editandoId ?? null;

  const puntosVisibles = useMemo(() => {
    let out = puntos;
    if (localidad) out = out.filter((p) => p.localidad === localidad);
    if (soloSinPlan) {
      // Los PDVs del cuadrante que se esta editando cuentan como "sin plan":
      // si no, al redibujar su contorno quedaban fuera de la vista y el
      // poligono no capturaba ninguno de los suyos.
      out = out.filter((p) => {
        const suyos = cuadrantePorPdv.get(p.pdv_id);
        if (!suyos || suyos.length === 0) return true;
        return editandoId != null && suyos.every((c) => c.id === editandoId);
      });
    }
    return out;
  }, [puntos, localidad, soloSinPlan, cuadrantePorPdv, editandoId]);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso]         = useState<string | null>(null);
  const [tab, setTab]             = useState<'cuadrantes' | 'resumen'>('cuadrantes');
  const [pdvSel, setPdvSel]       = useState<PdvPlan | null>(null);
  const [panelAbierto, setPanelAbierto] = useState(false); // solo mobile

  // Primer color que no este en uso. Rotar por cantidad repetia colores apenas
  // se borraba un cuadrante del medio.
  const nuevoColor = useCallback(() => {
    const usados = new Set(cuadrantes.map((c) => c.color));
    return COLORES_CUADRANTE.find((c) => !usados.has(c)) ?? COLORES_CUADRANTE[cuadrantes.length % COLORES_CUADRANTE.length];
  }, [cuadrantes]);

  const empezarNuevo = useCallback(() => {
    setBorrador({
      editandoId: null,
      localidad: localidad || null,
      nombre: '',
      dia: 'LUN',
      vendedor: '',
      color: nuevoColor(),
      vertices: [],
      pdvIds: [],
    });
    setModo('dibujando');
    setAviso(null);
    setPdvSel(null);
    setTab('cuadrantes');
    setPanelAbierto(true);
  }, [nuevoColor, localidad]);

  const agregarVertice = useCallback((v: [number, number]) => {
    setBorrador((b) => (b ? { ...b, vertices: [...b.vertices, v] } : b));
  }, []);

  const deshacerVertice = useCallback(() => {
    setBorrador((b) => (b ? { ...b, vertices: b.vertices.slice(0, -1) } : b));
  }, []);

  /** Cierra el polígono y calcula qué quedó adentro (de lo que está a la vista). */
  const cerrarPoligono = useCallback(() => {
    setBorrador((b) => {
      if (!b || b.vertices.length < 3) return b;
      const dentro = puntosVisibles.filter((p) => dentroDelPoligono(p.lat, p.lon, b.vertices));
      return { ...b, pdvIds: dentro.map((p) => p.pdv_id) };
    });
    setModo((m) => (m === 'dibujando' ? 'formulario' : m));
  }, [puntosVisibles]);

  const cancelar = useCallback(() => {
    setBorrador(null);
    setModo('ver');
    setAviso(null);
  }, []);

  /** ¿El borrador se apartó del cuadrante del que salió? Sirve para no
      descartar ediciones sin avisar cuando se salta de un cuadrante a otro. */
  const borradorTieneCambios = useCallback((b: Borrador, original: Cuadrante | undefined) => {
    if (!original) return b.vertices.length > 0; // cuadrante nuevo a medio dibujar
    return b.nombre !== original.nombre
      || b.dia !== original.dia
      || b.vendedor !== original.vendedor_nombre
      || b.color !== original.color
      || JSON.stringify(b.vertices) !== JSON.stringify(original.poligono)
      || JSON.stringify([...b.pdvIds].sort()) !== JSON.stringify([...original.pdv_ids].sort());
  }, []);

  const editar = useCallback((c: Cuadrante) => {
    setBorrador({
      editandoId: c.id,
      localidad: c.localidad,
      nombre: c.nombre,
      dia: c.dia,
      vendedor: c.vendedor_nombre,
      color: c.color,
      vertices: c.poligono,
      pdvIds: c.pdv_ids,
    });
    setModo('formulario');
    setAviso(null);
    // Sin esto, clickear un cuadrante en el mapa estando en la solapa Resumen
    // entraba en modo edicion sin mostrar el formulario: parecia que no pasaba
    // nada y ademas desaparecia el boton de dibujar.
    setTab('cuadrantes');
    setPanelAbierto(true);
  }, []);

  /**
   * Clic en la etiqueta de un cuadrante del mapa.
   *
   * Antes esto era `if (modo === 'ver') editar(c)`, así que una vez abierto el
   * primer cuadrante el modo pasaba a 'formulario' y clickear otro no hacía
   * nada — ni abría el nuevo ni avisaba por qué. Saltar de un cuadrante a otro
   * es justo lo que uno hace revisando la semana, así que ahora se permite.
   *
   * Dibujando no: ahí el clic es un vértice más, no una consulta.
   */
  const abrirCuadrante = useCallback((c: Cuadrante) => {
    if (modo === 'dibujando') return;
    if (borrador?.editandoId === c.id) return; // ya está abierto

    // Cambiar de cuadrante descarta el borrador actual. Si tiene ediciones sin
    // guardar se pregunta; si está igual que como se abrió, se salta directo.
    if (borrador) {
      const original = cuadrantes.find((q) => q.id === borrador.editandoId);
      if (borradorTieneCambios(borrador, original)) {
        // El nombre del cuadrante como estaba guardado, no el que se esté
        // tipeando: si justo lo renombraste, citarte el nombre nuevo no te
        // dice cuál de los cuadrantes del mapa estás por descartar.
        const queEs = original ? `"${original.nombre}"` : 'el cuadrante nuevo';
        if (!window.confirm(`Tenés cambios sin guardar en ${queEs}. ¿Los descartás y abrís "${c.nombre}"?`)) return;
      }
    }
    editar(c);
  }, [modo, borrador, cuadrantes, borradorTieneCambios, editar]);

  /** Vuelve a dibujar el contorno de un cuadrante que ya existe. */
  const redibujar = useCallback(() => {
    setBorrador((b) => (b ? { ...b, vertices: [], pdvIds: [] } : b));
    setModo('dibujando');
  }, []);

  // --- Conflictos ---------------------------------------------------------
  // Mismas reglas que la API (lib/planificacion/asignar.ts): choca si el PDV ya
  // es de otro vendedor, o si ese día ya está ocupado. Repetirlo acá es a
  // propósito: el usuario tiene que ver el choque ANTES de guardar. El server
  // igual lo recalcula y su veredicto es el que vale.
  const conflictos = useMemo<Conflicto[]>(() => {
    if (!borrador || !borrador.vendedor) return [];
    const out: Conflicto[] = [];
    for (const id of borrador.pdvIds) {
      for (const c of cuadrantePorPdv.get(id) ?? []) {
        if (c.id === borrador.editandoId) continue;
        if (c.vendedor_nombre !== borrador.vendedor) out.push({ pdvId: id, cuadrante: c, motivo: 'vendedor' });
        else if (c.dia === borrador.dia) out.push({ pdvId: id, cuadrante: c, motivo: 'dia' });
      }
    }
    return out;
  }, [borrador, cuadrantePorPdv]);

  const pdvsEnConflicto = useMemo(() => new Set(conflictos.map((c) => c.pdvId)), [conflictos]);

  // --- Guardar ------------------------------------------------------------
  const guardar = useCallback(async (resolver: 'robar' | 'omitir') => {
    if (!borrador) return;
    if (!borrador.nombre.trim()) { setAviso('Poné un nombre al cuadrante.'); return; }
    if (!borrador.vendedor)      { setAviso('Elegí a qué vendedor le pertenece.'); return; }
    if (borrador.vertices.length < 3) { setAviso('El polígono necesita al menos 3 puntos.'); return; }

    setGuardando(true);
    setAviso(null);
    try {
      const body = {
        nombre: borrador.nombre.trim(),
        dia: borrador.dia,
        vendedor_nombre: borrador.vendedor,
        color: borrador.color,
        poligono: borrador.vertices,
        localidad: borrador.localidad,
        pdv_ids: borrador.pdvIds,
        resolver,
      };
      const url = borrador.editandoId
        ? `/api/planificacion/cuadrantes/${borrador.editandoId}`
        : '/api/planificacion/cuadrantes';
      const res = await fetch(url, {
        method: borrador.editandoId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar.');

      const { cuadrante, robados, omitidos } = json as GuardarResultado;
      setCuadrantes((prev) => {
        // "Robar" le saca los PDVs a los otros cuadrantes: hay que reflejarlo
        // acá también, si no la lista sigue mostrando el conteo viejo.
        const robadosSet = new Set(robados);
        const sinRobados = prev.map((c) =>
          c.id === cuadrante.id ? c : { ...c, pdv_ids: c.pdv_ids.filter((id) => !robadosSet.has(id)) }
        );
        return sinRobados.some((c) => c.id === cuadrante.id)
          ? sinRobados.map((c) => (c.id === cuadrante.id ? cuadrante : c))
          : [...sinRobados, cuadrante];
      });

      const partes = [`${cuadrante.pdv_ids.length} PDVs asignados a ${cuadrante.vendedor_nombre}`];
      if (robados.length)  partes.push(`${robados.length} le sacaste a otro cuadrante`);
      if (omitidos.length) partes.push(`${omitidos.length} quedaron donde estaban`);
      setAviso(partes.join(' · '));
      setBorrador(null);
      setModo('ver');
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }, [borrador]);

  const borrar = useCallback(async (c: Cuadrante) => {
    if (!confirm(`¿Borrar el cuadrante "${c.nombre}"? Sus ${c.pdv_ids.length} PDVs quedan sin asignar.`)) return;
    const res = await fetch(`/api/planificacion/cuadrantes/${c.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setAviso(j.error ?? 'No se pudo borrar.');
      return;
    }
    setCuadrantes((prev) => prev.filter((x) => x.id !== c.id));
    setAviso(`Cuadrante "${c.nombre}" borrado.`);
  }, []);

  // --- Estilo de los puntos ----------------------------------------------
  // Set, no array: esto se evalúa una vez por cada uno de los ~7.000 puntos en
  // cada re-estilado, y un includes() sobre cientos de ids lo vuelve cuadrático.
  const pdvsDelBorrador = useMemo(() => new Set(borrador?.pdvIds ?? []), [borrador]);

  const estilo = useCallback((p: PdvPlan): EstiloPunto => {
    // Durante el armado, lo único que importa es qué cae adentro y qué choca.
    if (borrador && pdvsDelBorrador.size > 0) {
      if (pdvsDelBorrador.has(p.pdv_id)) {
        return pdvsEnConflicto.has(p.pdv_id)
          ? { color: '#dc2626', radio: 5.5, opacidad: 1 }
          : { color: borrador.color, radio: 5.5, opacidad: 1 };
      }
      return { color: COLOR_SIN_DATO, radio: 3, opacidad: 0.35 };
    }

    if (colorearPor === 'plan') {
      const cs = cuadrantePorPdv.get(p.pdv_id);
      if (!cs || cs.length === 0) return { color: COLOR_SIN_DATO, radio: 3, opacidad: 0.4 };
      return { color: cs[0].color, radio: 4.5, opacidad: 0.95 };
    }

    // Canal de venta. Acá el color no sale del cuadrante: la pregunta es qué
    // mezcla de tradicional/autoservicio tiene cada zona, así que todos los
    // puntos pesan igual y el cuadrante se lee sólo por su polígono.
    if (colorearPor === 'canal') {
      return { color: colorPorCanal(p.canal_venta), radio: 4.5, opacidad: 0.9 };
    }

    // Día del maestro. Con varios días marcados manda el primero.
    const dia = p.dia_visita?.split(',')[0];
    return { color: (dia && DIA_COLOR[dia]) || COLOR_SIN_DATO, radio: 4, opacidad: 0.85 };
  }, [borrador, pdvsDelBorrador, pdvsEnConflicto, colorearPor, cuadrantePorPdv]);

  const puntosPorId = useMemo(() => new Map(puntos.map((p) => [p.pdv_id, p])), [puntos]);

  // --- Exportar zonas a PDF -----------------------------------------------
  // Se maneja acá y no en ResumenPanel porque el mapa vive acá: para capturar
  // una zona hay que encuadrarla primero, y eso es la instancia de Leaflet.
  const mapRef = useRef<LeafletMap | null>(null);
  const mapaDomRef = useRef<HTMLDivElement>(null);
  const [exportandoPdf, setExportandoPdf] = useState<string | null>(null);
  // Cada zona cuesta ~2,5s (encuadre + espera de tiles + captura), así que un
  // vendedor con 10 zonas son ~25 segundos mirando un botón. Sin el contador
  // parece colgado.
  const [progresoPdf, setProgresoPdf] = useState<{ hecho: number; total: number } | null>(null);

  /**
   * Encuadra una zona, espera los tiles y devuelve su captura.
   * Devuelve null si la captura falla: el PDF sale igual con la lista.
   */
  const capturarZona = useCallback(async (
    c: Cuadrante,
    html2canvas: typeof import('html2canvas').default,
  ): Promise<{ data: string; ratio: number } | null> => {
    const mapa = mapRef.current;
    if (!mapa || !mapaDomRef.current || c.poligono.length === 0) return null;
    // El anillo ya es [lat, lng][], que es un LatLngBoundsExpression válido.
    mapa.fitBounds(c.poligono, { padding: [40, 40] });
    await new Promise((r) => setTimeout(r, 2000)); // que carguen los tiles
    try {
      const canvas = await html2canvas(mapaDomRef.current, {
        useCORS: true, allowTaint: true, scale: 2, logging: false, backgroundColor: '#ffffff',
      });
      // JPEG y no PNG: un mapa es una imagen fotográfica y en PNG cada hoja
      // pesaba ~10 MB, así que un vendedor con 10 zonas daba un PDF de 100 MB
      // imposible de mandar por mail. A 0.82 la diferencia no se ve impresa.
      return { data: canvas.toDataURL('image/jpeg', 0.82), ratio: canvas.height / canvas.width };
    } catch {
      return null;
    }
  }, []);

  const exportarZonas = useCallback(async (zonas: Cuadrante[], archivo: string, clave: string) => {
    if (zonas.length === 0) return;
    setExportandoPdf(clave);
    setProgresoPdf({ hecho: 0, total: zonas.length });
    // Estado del mapa antes de empezar, para devolverlo donde estaba.
    const vistaPrevia = mapRef.current
      ? { centro: mapRef.current.getCenter(), zoom: mapRef.current.getZoom() }
      : null;
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const PAGE_W = 210, MARGIN = 15, CONTENT_W = PAGE_W - MARGIN * 2;
      const AZUL: [number, number, number] = [12, 92, 171];
      const GRIS: [number, number, number] = [113, 113, 122];
      const BORDE: [number, number, number] = [228, 228, 231];

      for (let i = 0; i < zonas.length; i++) {
        const c = zonas[i];
        setProgresoPdf({ hecho: i, total: zonas.length });
        if (i > 0) pdf.addPage();
        const img = await capturarZona(c, html2canvas);
        const pdvs = c.pdv_ids.map((id) => puntosPorId.get(id)).filter((p): p is PdvPlan => !!p);
        const canales = contarPorCanal(pdvs);

        // ── Header ──
        pdf.setFillColor(...AZUL);
        pdf.rect(0, 0, PAGE_W, 26, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        pdf.text(
          pdf.splitTextToSize(`ZONA — ${c.nombre.toUpperCase()}`, CONTENT_W)[0],
          MARGIN, 13,
        );
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10.5);
        pdf.text(
          `${c.vendedor_nombre}  ·  ${DIA_NOMBRE[c.dia] ?? c.dia}  ·  ${pdvs.length} PDV`,
          MARGIN, 20,
        );

        // ── Mapa ──
        let y = 32;
        if (img) {
          const imgH = Math.min(105, img.ratio * CONTENT_W);
          pdf.addImage(img.data, 'JPEG', MARGIN, y, CONTENT_W, imgH);
          pdf.setDrawColor(...BORDE);
          pdf.rect(MARGIN, y, CONTENT_W, imgH);
          y += imgH + 7;
        } else {
          pdf.setFillColor(244, 244, 245);
          pdf.setDrawColor(...BORDE);
          pdf.rect(MARGIN, y, CONTENT_W, 30, 'FD');
          pdf.setTextColor(...GRIS);
          pdf.setFontSize(10);
          pdf.text('Captura de mapa no disponible', PAGE_W / 2, y + 17, { align: 'center' });
          y += 37;
        }

        // ── Mezcla de canales ──
        pdf.setFontSize(9.5);
        pdf.setFont('helvetica', 'normal');
        const mezcla = [
          canales.tradicional  ? `${canales.tradicional} tradicionales` : '',
          canales.autoservicio ? `${canales.autoservicio} autoservicios` : '',
          canales.otro         ? `${canales.otro} sin clasificar` : '',
        ].filter(Boolean).join('   ·   ');
        if (mezcla) {
          pdf.setTextColor(...GRIS);
          pdf.text(mezcla, MARGIN, y);
          y += 7;
        }

        // ── Lista de clientes ──
        pdf.setDrawColor(...BORDE);
        pdf.line(MARGIN, y - 2, PAGE_W - MARGIN, y - 2);
        pdf.setTextColor(9, 9, 11);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.text(`CLIENTES DE ESTA ZONA (${pdvs.length})`, MARGIN, y + 5);
        y += 12;

        for (const p of pdvs) {
          if (y > 278) { pdf.addPage(); y = 20; }
          // Punto del color de su canal: el vendedor ve en la lista lo mismo
          // que ve en el mapa de arriba.
          const [r, g, b] = hexARgb(colorPorCanal(p.canal_venta));
          pdf.setFillColor(r, g, b);
          pdf.circle(MARGIN + 1.6, y - 1.1, 1.4, 'F');
          pdf.setTextColor(9, 9, 11);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9.5);
          const linea = `${p.razon_social ?? `PDV #${p.pdv_id}`}${p.localidad ? ` — ${p.localidad}` : ''}`;
          pdf.text(pdf.splitTextToSize(linea, CONTENT_W - 8)[0], MARGIN + 5, y);
          y += 6;
        }
      }

      // ── Pie en todas las hojas ──
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

      pdf.save(`${archivo}.pdf`.replace(/\s+/g, '_'));
    } catch (e) {
      console.error('[exportarZonas]', e);
      setAviso('No se pudo generar el PDF. Probá de nuevo.');
    } finally {
      // Devolver el mapa a donde estaba: el usuario no pidió moverse.
      if (vistaPrevia) mapRef.current?.setView(vistaPrevia.centro, vistaPrevia.zoom);
      setExportandoPdf(null);
      setProgresoPdf(null);
    }
  }, [capturarZona, puntosPorId]);

  const exportarCuadrante = useCallback((c: Cuadrante) => {
    void exportarZonas([c], `zona_${c.nombre}_${c.vendedor_nombre}`, c.id);
  }, [exportarZonas]);

  const exportarVendedor = useCallback((vendedor: string) => {
    const zonas = cuadrantes
      .filter((c) => c.vendedor_nombre === vendedor)
      .sort((a, b) => DIAS_HABILES.indexOf(a.dia) - DIAS_HABILES.indexOf(b.dia)
        || a.nombre.localeCompare(b.nombre, 'es'));
    void exportarZonas(zonas, `zonas_${vendedor}`, `v:${vendedor}`);
  }, [cuadrantes, exportarZonas]);

  const estiloSig = [
    colorearPor,
    borrador?.color ?? '',
    borrador?.pdvIds.length ?? 0,
    pdvsEnConflicto.size,
    cuadrantes.map((c) => `${c.id}:${c.pdv_ids.length}:${c.color}`).join(','),
  ].join('|');

  const cuadrantesVisibles = useMemo(
    () => cuadrantes.filter((c) =>
      !ocultos.has(c.id)
      && c.id !== borrador?.editandoId
      && (diasVisibles.size === 0 || diasVisibles.has(c.dia))
    ),
    [cuadrantes, ocultos, borrador, diasVisibles]
  );

  /** La lista del panel sigue el mismo filtro que el mapa, para que lo que se
      ve a un lado y al otro sea lo mismo. */
  const cuadrantesListados = useMemo(
    () => cuadrantes.filter((c) => diasVisibles.size === 0 || diasVisibles.has(c.dia)),
    [cuadrantes, diasVisibles]
  );

  // En mobile el panel es una hoja inferior colapsable. Dibujando o llenando el
  // formulario se fuerza abierta: si no, la hoja tapa los controles justo cuando
  // hacen falta. En desktop el panel siempre está a la vista.
  const expandido = panelAbierto || modo !== 'ver';

  // ---------------------------------------------------------------------
  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="text-[13px] text-[#dc2626] text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col lg:flex-row bg-[#fafafa]">
      {/* ═══ Panel ═══ */}
      <aside
        className={`flex flex-col bg-white border-[#e4e4e7] order-2 lg:order-1 lg:w-[380px] lg:shrink-0 lg:border-r lg:h-full
          ${expandido ? 'h-[64%] border-t lg:border-t-0' : 'h-auto border-t lg:border-t-0'}`}
      >
        {/* Título — la sección no tiene encabezado propio de página porque el
            mapa ocupa todo el alto, así que el contexto va acá. */}
        <div className="flex-shrink-0 flex items-start gap-2 px-3.5 pt-3 pb-2">
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold text-[#09090b] leading-tight">Planificación</h1>
            <p className="text-[11.5px] text-[#71717a] leading-snug mt-0.5">
              Agrupá PDVs en cuadrantes y decidí a qué vendedor le pertenecen.
            </p>
          </div>
          {/* En mobile el panel es una hoja inferior; este botón la sube y baja.
              Va pegado al título y no al borde para que no lo tape el botón
              flotante del asistente, que vive en la esquina inferior derecha. */}
          <button
            onClick={() => setPanelAbierto((v) => !v)}
            className="ml-auto shrink-0 lg:hidden px-2.5 py-1 text-[11.5px] font-semibold rounded-[7px] border border-[#e4e4e7] text-[#0c5cab]"
          >
            {expandido ? 'Ocultar' : 'Abrir'}
          </button>
        </div>


        {/* Tabs */}
        <div className={`flex-shrink-0 items-center gap-1 px-3 pb-2 border-b border-[#e4e4e7] ${expandido ? 'flex' : 'hidden lg:flex'}`}>
          {(['cuadrantes', 'resumen'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setPanelAbierto(true); }}
              className={`px-2.5 py-1.5 text-[12px] font-semibold rounded-[8px] transition-colors ${
                tab === t ? 'bg-[rgba(12,92,171,0.12)] text-[#0c5cab]' : 'text-[#71717a] hover:text-[#09090b]'
              }`}
            >
              {t === 'cuadrantes' ? `Cuadrantes (${cuadrantes.length})` : 'Resumen'}
            </button>
          ))}
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto ${expandido ? '' : 'hidden lg:block'}`}>
          {tab === 'resumen' ? (
            <ResumenPanel
              cuadrantes={cuadrantes}
              puntos={puntos}
              onExportarCuadrante={exportarCuadrante}
              onExportarVendedor={exportarVendedor}
              exportandoPdf={exportandoPdf}
              progresoPdf={progresoPdf}
            />
          ) : (
            <div className="flex flex-col">
              {/* ── Filtros ── */}
              {modo === 'ver' && (
                <div className="flex flex-col gap-2.5 px-3.5 py-3 border-b border-[#e4e4e7]">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[#71717a]" style={MONO}>Localidad</span>
                    <Dropdown
                      valor={localidad}
                      onChange={setLocalidad}
                      placeholder="Todas"
                      etiquetaTodas={`Todas — ${puntos.length.toLocaleString('es-AR')} PDVs`}
                      buscable
                      opciones={localidades.map((l) => ({
                        valor: l,
                        label: l,
                        detalle: conteoPorLocalidad.get(l)?.toLocaleString('es-AR'),
                      }))}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[#71717a]" style={MONO}>Colorear</span>
                    <Segmentado
                      valor={colorearPor}
                      onChange={setColorearPor}
                      opciones={[
                        { valor: 'dia', label: 'Día actual' },
                        { valor: 'plan', label: 'Plan' },
                        { valor: 'canal', label: 'Canal' },
                      ]}
                    />
                  </div>

                  {/* Leyenda al lado de los filtros, no flotando sobre el mapa:
                      en mobile la caja flotante tapaba media pantalla. */}
                  <div className="flex flex-wrap gap-x-2.5 gap-y-1">
                    {colorearPor === 'dia' && DIAS_HABILES.map((d) => (
                      <span key={d} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: DIA_COLOR[d] }} />
                        <span className="text-[10.5px] text-[#71717a]">{DIA_NOMBRE[d]}</span>
                      </span>
                    ))}
                    {colorearPor === 'plan' && (
                      <span className="text-[10.5px] text-[#71717a] leading-relaxed">
                        Cada PDV toma el color de su cuadrante; los grises todavía no tienen.
                      </span>
                    )}
                    {colorearPor === 'canal' && LEYENDA_CANAL.map((l) => (
                      <span key={l.tipo} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
                        <span className="text-[10.5px] text-[#71717a]">{l.label}</span>
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => setSoloSinPlan((v) => !v)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] font-medium rounded-[8px] border transition-all text-left ${
                      soloSinPlan
                        ? 'bg-[rgba(12,92,171,0.1)] border-[rgba(12,92,171,0.35)] text-[#09090b]'
                        : 'bg-[rgba(0,0,0,0.02)] border-[#e4e4e7] text-[#52525b] hover:border-[#d4d4d8]'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center shrink-0 ${
                      soloSinPlan ? 'bg-[#0c5cab] border-[#0c5cab]' : 'bg-white border-[#d4d4d8]'
                    }`}>
                      {soloSinPlan && (
                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5.2L4 7.2L8 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    Solo los que todavía no tienen cuadrante
                  </button>

                  {/* Filtro por día de los cuadrantes. Con 28 cuadrantes el mapa
                      se llena de etiquetas superpuestas y no se lee nada; además
                      "mostrame el lunes" es como se planifica de verdad. */}
                  {cuadrantes.length > 0 && (
                    <div className="flex flex-col gap-1.5 border-t border-[#f4f4f5] pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[#71717a]" style={MONO}>
                          Ver cuadrantes de
                        </span>
                        {diasVisibles.size > 0 && (
                          <button
                            onClick={() => setDiasVisibles(new Set())}
                            className="text-[11px] text-[#0c5cab] hover:underline"
                          >
                            Todos
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {DIAS_HABILES.map((d) => {
                          const n = cuadrantes.filter((c) => c.dia === d).length;
                          if (n === 0) return null;
                          const activo = diasVisibles.has(d);
                          return (
                            <button
                              key={d}
                              onClick={() => setDiasVisibles((s) => {
                                const next = new Set(s);
                                if (next.has(d)) next.delete(d); else next.add(d);
                                return next;
                              })}
                              className={`px-1.5 py-0.5 text-[11px] font-semibold rounded-[5px] border transition-colors ${
                                activo ? 'text-white border-transparent' : 'bg-white border-[#e4e4e7] text-[#71717a] hover:text-[#09090b]'
                              }`}
                              style={activo ? { background: DIA_COLOR[d] } : undefined}
                            >
                              {d} <span className="opacity-70">{n}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-baseline gap-1.5 border-t border-[#f4f4f5] pt-2">
                    <span className="text-[15px] font-bold text-[#09090b] leading-none" style={MONO}>
                      {puntosVisibles.length.toLocaleString('es-AR')}
                    </span>
                    <span className="text-[11px] text-[#71717a]">PDVs en pantalla</span>
                    {planificados > 0 && (
                      <span className="ml-auto text-[11px] text-[#71717a]">
                        <strong className="text-[#09090b]">{planificados.toLocaleString('es-AR')}</strong> con cuadrante
                      </span>
                    )}
                  </div>

                </div>
              )}

              {/* ── Dibujando ── */}
              {modo === 'dibujando' && borrador && (
                <div className="flex flex-col gap-2.5 px-3 py-3 border-b border-[#e4e4e7] bg-[rgba(12,92,171,0.04)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#0c5cab]" style={MONO}>
                    Paso 1 · Elegí el día y dibujá
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {DIAS_HABILES.map((d) => (
                      <button
                        key={d}
                        onClick={() => setBorrador((b) => (b ? { ...b, dia: d } : b))}
                        className={`px-2 py-1 text-[11.5px] font-semibold rounded-[6px] border transition-colors ${
                          borrador.dia === d
                            ? 'text-white border-transparent'
                            : 'bg-white border-[#e4e4e7] text-[#71717a] hover:text-[#09090b]'
                        }`}
                        style={borrador.dia === d ? { background: DIA_COLOR[d] } : undefined}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11.5px] text-[#52525b] leading-relaxed">
                    Hacé clic en el mapa para ir marcando el contorno. Cerrá clickeando el primer punto, o con el botón de abajo.
                  </p>
                  {localidad && (
                    <p className="text-[11px] text-[#b45309] leading-relaxed">
                      Solo se van a tomar PDVs de {localidad}: los de otras localidades no están a la vista y el cuadrante no los captura.
                    </p>
                  )}
                  <p className="text-[11px] text-[#71717a]" style={MONO}>
                    {borrador.vertices.length} punto{borrador.vertices.length === 1 ? '' : 's'} marcado{borrador.vertices.length === 1 ? '' : 's'}
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={cerrarPoligono}
                      disabled={borrador.vertices.length < 3}
                      className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-[8px] bg-[#0c5cab] text-white hover:bg-[#0a4d90] disabled:opacity-40 transition-colors"
                    >
                      Cerrar polígono
                    </button>
                    <button
                      onClick={deshacerVertice}
                      disabled={borrador.vertices.length === 0}
                      className="px-3 py-2 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] text-[#52525b] hover:text-[#09090b] disabled:opacity-40 transition-colors"
                    >
                      Deshacer
                    </button>
                    <button
                      onClick={cancelar}
                      className="px-3 py-2 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] text-[#52525b] hover:text-[#09090b] transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* ── Formulario ── */}
              {modo === 'formulario' && borrador && (
                <FormularioCuadrante
                  borrador={borrador}
                  setBorrador={setBorrador}
                  vendedores={vendedores}
                  conflictos={conflictos}
                  puntosPorId={puntosPorId}
                  guardando={guardando}
                  onGuardar={guardar}
                  onRedibujar={redibujar}
                  onCancelar={cancelar}
                />
              )}

              {/* ── Aviso ── */}
              {aviso && (
                <div className="mx-3 mt-3 px-2.5 py-2 rounded-[8px] bg-[rgba(12,92,171,0.08)] border border-[rgba(12,92,171,0.2)]">
                  <p className="text-[11.5px] text-[#0c5cab] leading-relaxed">{aviso}</p>
                </div>
              )}

              {/* ── Lista de cuadrantes ── */}
              <div className="flex flex-col">
                {loading && (
                  <p className="px-3 py-4 text-[12px] text-[#71717a]">Cargando PDVs…</p>
                )}
                {!loading && cuadrantes.length === 0 && modo === 'ver' && (
                  <p className="px-3 py-4 text-[12px] text-[#71717a] leading-relaxed">
                    Todavía no dibujaste ningún cuadrante.
                  </p>
                )}
                {!loading && cuadrantes.length > 0 && cuadrantesListados.length === 0 && (
                  <p className="px-3.5 py-4 text-[12px] text-[#71717a] leading-relaxed">
                    Ningún cuadrante en {[...diasVisibles].map((d) => DIA_NOMBRE[d]).join(', ')}.
                  </p>
                )}
                {/* Los datos del cuadrante y sus acciones van en renglones
                    separados: en una sola línea el nombre del vendedor y el
                    conteo quedaban cortados a la mitad. */}
                {cuadrantesListados.map((c) => (
                  <div
                    key={c.id}
                    className={`group px-3.5 py-2 border-b border-[#f4f4f5] transition-colors hover:bg-[rgba(0,0,0,0.015)] ${
                      ocultos.has(c.id) ? 'opacity-45' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                      <p className="text-[12.5px] font-semibold text-[#09090b] truncate flex-1">{c.nombre}</p>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[5px] shrink-0"
                        style={{ background: `${DIA_COLOR[c.dia]}1a`, color: DIA_COLOR[c.dia] }}
                      >
                        {c.dia}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#71717a] truncate pl-[18px] mt-0.5">
                      {c.vendedor_nombre} · {c.pdv_ids.length} PDVs
                    </p>
                    <div className="flex items-center gap-3 pl-[18px] mt-1">
                      <button
                        onClick={() => setOcultos((s) => {
                          const n = new Set(s);
                          if (n.has(c.id)) n.delete(c.id); else n.add(c.id);
                          return n;
                        })}
                        className="text-[11px] text-[#71717a] hover:text-[#09090b]"
                      >
                        {ocultos.has(c.id) ? 'Mostrar' : 'Ocultar'}
                      </button>
                      <button
                        onClick={() => editar(c)}
                        className="text-[11px] font-medium text-[#0c5cab] hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => borrar(c)}
                        className="text-[11px] text-[#71717a] hover:text-[#dc2626] ml-auto"
                      >
                        Borrar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Acción principal al pie, fuera del área scrolleable: en desktop sigue
            a la vista por más larga que sea la lista de cuadrantes, y en mobile
            queda accesible incluso con la hoja colapsada. Un solo botón en el
            DOM — antes había uno por breakpoint y se anunciaban los dos.
            El pr-20 en mobile le deja libre la esquina inferior derecha: ahí
            vive el botón flotante del asistente (fixed, z-1100), y si el botón
            llega hasta el borde, ese pedazo abre el chat en vez de dibujar. */}
        {modo === 'ver' && tab === 'cuadrantes' && (
          <div className="flex-shrink-0 pl-3.5 pr-20 lg:pr-3.5 py-3 border-t border-[#e4e4e7] bg-white">
            <button
              onClick={empezarNuevo}
              className="w-full px-3 py-2.5 text-[12.5px] font-semibold rounded-[9px] bg-[#0c5cab] text-white hover:bg-[#0a4d90] transition-colors shadow-[0_2px_8px_rgba(12,92,171,0.25)]"
            >
              Dibujar un cuadrante
            </button>
          </div>
        )}
      </aside>

      {/* ═══ Mapa ═══ */}
      <div ref={mapaDomRef} className="relative flex-1 min-h-0 order-1 lg:order-2">
        {loading && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-[#fafafa]/70 backdrop-blur-sm">
            <div className="flex items-center gap-2.5 text-[13px] text-[#71717a]">
              <span className="w-4 h-4 rounded-full border-2 border-[#e4e4e7] border-t-[#0c5cab] animate-spin" />
              Cargando PDVs…
            </div>
          </div>
        )}

        <MapContainer
          center={[-34.72, -58.28]}
          zoom={11}
          style={{ height: '100%', width: '100%', background: '#fafafa' }}
          preferCanvas
          ref={mapRef}
        >
          {/* crossOrigin es requisito del export a PDF: sin él los tiles de OSM
              "taintean" el canvas y html2canvas no puede leerlo. OSM manda
              Access-Control-Allow-Origin: *, así que no cuesta nada. */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            crossOrigin="anonymous"
          />

          {/* Encuadra al terminar de cargar y cada vez que se cambia de
              localidad. No al filtrar por "sin cuadrante": ahí el usuario está
              mirando una zona concreta y saltarle el encuadre lo desorienta. */}
          <Encuadrar puntos={puntosVisibles} sig={`${localidad}|${puntos.length > 0}`} />
          <CapturaClics activo={modo === 'dibujando'} onVertice={agregarVertice} />

          <PuntosLayer
            puntos={puntosVisibles}
            estilo={estilo}
            estiloSig={estiloSig}
            // Dibujando, el clic sobre un PDV es un vértice más, no una consulta.
            onPuntoClick={(p) => { if (modo !== 'dibujando') setPdvSel(p); }}
          />

          {/* Cuadrantes guardados */}
          {/* El polígono NO es clickeable ni hovereable: vive en un pane por
              debajo de los puntos y el canvas de los puntos, que cubre todo el
              mapa, se queda con los eventos. Por eso lleva una etiqueta
              permanente —que va al tooltipPane, arriba de todo— y ES ella la
              que identifica el cuadrante y lo abre para editar. Además es un
              blanco preciso: el relleno del polígono compite con los PDVs. */}
          <PaneCuadrantes>
            {cuadrantesVisibles.map((c) => (
              <Polygon
                key={c.id}
                positions={c.poligono}
                pane={PANE_CUADRANTES}
                interactive={false}
                pathOptions={{ color: c.color, weight: 2, fillColor: c.color, fillOpacity: 0.1 }}
              >
                <Tooltip
                  permanent
                  direction="center"
                  interactive
                  className="etiqueta-cuadrante"
                  eventHandlers={{ click: () => abrirCuadrante(c) }}
                >
                  <span style={{ fontWeight: 700, color: c.color }}>{c.nombre}</span>
                  <br />
                  <span style={{ color: '#52525b' }}>
                    {DIA_NOMBRE[c.dia]} · {c.vendedor_nombre} · {c.pdv_ids.length} PDVs
                  </span>
                </Tooltip>
              </Polygon>
            ))}
          </PaneCuadrantes>

          {/* Borrador en curso */}
          {borrador && borrador.vertices.length > 0 && (
            <>
              {modo === 'formulario' ? (
                <Polygon
                  positions={borrador.vertices}
                  pathOptions={{ color: borrador.color, weight: 2.5, dashArray: '5 4', fillColor: borrador.color, fillOpacity: 0.12 }}
                />
              ) : (
                <Polyline
                  positions={borrador.vertices}
                  pathOptions={{ color: borrador.color, weight: 2.5, dashArray: '5 4' }}
                />
              )}
              {borrador.vertices.map((v, i) => (
                <CircleMarker
                  key={i}
                  center={v}
                  radius={i === 0 ? 7 : 5}
                  pathOptions={{ color: '#ffffff', weight: 2, fillColor: borrador.color, fillOpacity: 1 }}
                  eventHandlers={{
                    // Clickear el primer vértice cierra el contorno, como en
                    // cualquier herramienta de dibujo de mapas.
                    click: (e) => {
                      if (i === 0 && modo === 'dibujando' && borrador.vertices.length >= 3) {
                        e.originalEvent.stopPropagation();
                        cerrarPoligono();
                      }
                    },
                  }}
                >
                  {i === 0 && modo === 'dibujando' && borrador.vertices.length >= 3 && (
                    <Tooltip direction="top">Clic acá para cerrar</Tooltip>
                  )}
                </CircleMarker>
              ))}
            </>
          )}
        </MapContainer>

        {/* Ficha del PDV clickeado */}
        {pdvSel && (
          <div className="absolute bottom-3 left-3 z-[1000] max-w-[300px] rounded-[12px] border border-[#e4e4e7] bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <p className="text-[12.5px] font-bold text-[#09090b] leading-snug">
                  #{pdvSel.pdv_id} — {pdvSel.razon_social ?? 's/n'}
                </p>
                <p className="text-[11px] text-[#71717a] mt-0.5 leading-relaxed">
                  {pdvSel.localidad ?? '—'}<br />
                  Hoy: {pdvSel.cartera ?? 'sin vendedor'} · {pdvSel.dia_visita ?? 'sin día'}
                </p>
                {(cuadrantePorPdv.get(pdvSel.pdv_id) ?? []).map((c) => (
                  <p key={c.id} className="text-[11px] font-semibold mt-0.5" style={{ color: c.color }}>
                    Plan: {c.vendedor_nombre} · {DIA_NOMBRE[c.dia]} ({c.nombre})
                  </p>
                ))}
              </div>
              <button
                onClick={() => setPdvSel(null)}
                className="ml-auto shrink-0 text-[#71717a] hover:text-[#09090b] text-[14px] leading-none"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Cartel de modo dibujo sobre el mapa: en mobile el panel puede estar
            cerrado y sin esto no se entiende por qué el mapa "no hace nada". */}
        {modo === 'dibujando' && borrador && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] rounded-[10px] bg-[#09090b]/85 px-3 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.2)]">
            <p className="text-[11.5px] font-semibold text-white whitespace-nowrap">
              Marcá el contorno · {DIA_NOMBRE[borrador.dia]} · {borrador.vertices.length} punto{borrador.vertices.length === 1 ? '' : 's'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulario: nombre, vendedor, color y resolución de conflictos.
// ---------------------------------------------------------------------------
function FormularioCuadrante({
  borrador, setBorrador, vendedores, conflictos, puntosPorId,
  guardando, onGuardar, onRedibujar, onCancelar,
}: {
  borrador: Borrador;
  setBorrador: React.Dispatch<React.SetStateAction<Borrador | null>>;
  vendedores: string[];
  conflictos: Conflicto[];
  puntosPorId: Map<number, PdvPlan>;
  guardando: boolean;
  onGuardar: (resolver: 'robar' | 'omitir') => void;
  onRedibujar: () => void;
  onCancelar: () => void;
}) {
  const [verLista, setVerLista] = useState(false);

  const diaSegunNombre = useMemo(() => diaMencionadoEn(borrador.nombre), [borrador.nombre]);

  // Los conflictos se agrupan por cuadrante rival: "12 ya son de Zona Norte
  // (Juan)" se lee mucho mejor que doce líneas sueltas.
  const porCuadrante = useMemo(() => {
    const m = new Map<string, { cuadrante: Cuadrante; motivo: 'vendedor' | 'dia'; ids: number[] }>();
    for (const c of conflictos) {
      const e = m.get(c.cuadrante.id);
      if (e) e.ids.push(c.pdvId);
      else m.set(c.cuadrante.id, { cuadrante: c.cuadrante, motivo: c.motivo, ids: [c.pdvId] });
    }
    return [...m.values()];
  }, [conflictos]);

  const hayConflicto = conflictos.length > 0;
  const libres = borrador.pdvIds.length - new Set(conflictos.map((c) => c.pdvId)).size;
  // Un cuadrante sin PDVs no sirve para nada y ensucia la lista y el resumen:
  // ni el polígono vacío ni "llevarme los 0 libres" deben poder guardarse.
  const vacio = borrador.pdvIds.length === 0;

  const set = (patch: Partial<Borrador>) => setBorrador((b) => (b ? { ...b, ...patch } : b));

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3 border-b border-[#e4e4e7] bg-[rgba(12,92,171,0.04)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#0c5cab]" style={MONO}>
        Paso 2 · A quién le pertenece
      </p>

      <div className="rounded-[8px] border border-[#e4e4e7] bg-white px-2.5 py-2">
        <p className="text-[13px] font-bold text-[#09090b]">
          {borrador.pdvIds.length.toLocaleString('es-AR')} PDVs adentro
        </p>
        {vacio ? (
          <p className="text-[11px] text-[#b45309] leading-relaxed mt-0.5">
            El contorno no encierra ningún PDV. Redibujalo más amplio o cambiá de localidad.
          </p>
        ) : (
          <button
            onClick={() => setVerLista((v) => !v)}
            className="text-[11px] font-medium text-[#0c5cab] hover:underline"
          >
            {verLista ? 'Ocultar listado' : 'Ver listado'}
          </button>
        )}
        {verLista && (
          <div className="mt-1.5 max-h-40 overflow-y-auto border-t border-[#f4f4f5] pt-1.5">
            {borrador.pdvIds.map((id) => {
              const p = puntosPorId.get(id);
              return (
                <p key={id} className="text-[11px] text-[#52525b] truncate leading-relaxed">
                  <span style={MONO} className="text-[#71717a]">#{id}</span>{' '}
                  {p?.razon_social ?? 's/n'}
                  {p?.cartera ? <span className="text-[#71717a]"> · hoy {p.cartera}</span> : null}
                </p>
              );
            })}
          </div>
        )}
      </div>

      <input
        value={borrador.nombre}
        onChange={(e) => set({ nombre: e.target.value })}
        placeholder="Nombre del cuadrante (ej: Solano — Lunes)"
        className="w-full px-2.5 py-2 text-[12.5px] rounded-[8px] border border-[#e4e4e7] bg-white text-[#09090b] placeholder:text-[#71717a] focus:outline-none focus:border-[rgba(12,92,171,0.4)]"
      />

      <Dropdown
        valor={borrador.vendedor}
        onChange={(v) => set({ vendedor: v })}
        placeholder="¿A qué vendedor le pertenece?"
        buscable
        opciones={vendedores.map((v) => ({ valor: v, label: v }))}
      />

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a]" style={MONO}>Día</span>
        {DIAS_HABILES.map((d) => (
          <button
            key={d}
            onClick={() => set({ dia: d })}
            className={`px-1.5 py-0.5 text-[11px] font-semibold rounded-[5px] border transition-colors ${
              borrador.dia === d
                ? 'text-white border-transparent'
                : 'bg-white border-[#e4e4e7] text-[#71717a] hover:text-[#09090b]'
            }`}
            style={borrador.dia === d ? { background: DIA_COLOR[d] } : undefined}
          >
            {d}
          </button>
        ))}
      </div>

      {/* El día arranca siempre en LUN y es facilísimo escribir el nombre y
          olvidarse del chip. Si el nombre nombra otro día, se avisa y se ofrece
          corregirlo de una. No bloquea: quizás el nombre está mal, no el día. */}
      {diaSegunNombre && diaSegunNombre !== borrador.dia && (
        <div className="flex items-center gap-2 rounded-[8px] border border-[#fde68a] bg-[#fffbeb] px-2.5 py-2">
          <p className="text-[11px] text-[#92400e] leading-snug flex-1">
            El nombre dice <strong>{DIA_NOMBRE[diaSegunNombre].toLowerCase()}</strong> pero está en{' '}
            <strong>{DIA_NOMBRE[borrador.dia].toLowerCase()}</strong>.
          </p>
          <button
            onClick={() => set({ dia: diaSegunNombre })}
            className="shrink-0 px-2 py-1 text-[11px] font-semibold rounded-[6px] bg-[#b45309] text-white hover:bg-[#92400e] transition-colors"
          >
            Pasar a {diaSegunNombre}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[#71717a] w-full" style={MONO}>Color</span>
        {COLORES_CUADRANTE.map((c) => (
          <button
            key={c}
            onClick={() => set({ color: c })}
            className="w-6 h-6 rounded-full transition-all flex items-center justify-center"
            style={{
              background: c,
              // Anillo por fuera en vez de borde: el borde le come diámetro al
              // swatch y a 6px el color casi no se ve.
              boxShadow: borrador.color === c
                ? `0 0 0 2px #ffffff, 0 0 0 4px ${c}`
                : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
            }}
            aria-label={`Color ${c}`}
          >
            {borrador.color === c && (
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                <path d="M2 5.2L4 7.2L8 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        ))}
      </div>

      {/* Conflictos */}
      {hayConflicto && (
        <div className="rounded-[8px] border border-[#fde68a] bg-[#fffbeb] px-2.5 py-2">
          <p className="text-[11.5px] font-bold text-[#b45309] leading-snug">
            {new Set(conflictos.map((c) => c.pdvId)).size} de estos {borrador.pdvIds.length} ya están tomados
          </p>
          <div className="mt-1 flex flex-col gap-0.5">
            {porCuadrante.map((g) => (
              <p key={g.cuadrante.id} className="text-[11px] text-[#92400e] leading-relaxed">
                {g.ids.length} en <strong>{g.cuadrante.nombre}</strong> ({g.cuadrante.vendedor_nombre}
                {g.motivo === 'dia' ? `, mismo día` : ''})
              </p>
            ))}
          </div>
          <p className="text-[10.5px] text-[#a16207] mt-1.5 leading-relaxed">
            Podés quedártelos —se los saca al otro cuadrante— o dejarlos donde están y llevarte solo los {libres} libres.
          </p>
        </div>
      )}

      {/* Acciones */}
      <div className="flex flex-col gap-1.5">
        {hayConflicto ? (
          <>
            <button
              onClick={() => onGuardar('robar')}
              disabled={guardando}
              className="w-full px-3 py-2 text-[12px] font-semibold rounded-[8px] bg-[#0c5cab] text-white hover:bg-[#0a4d90] disabled:opacity-50 transition-colors"
            >
              {guardando ? 'Guardando…' : `Quedármelos todos (${borrador.pdvIds.length})`}
            </button>
            <button
              onClick={() => onGuardar('omitir')}
              // Sin PDVs libres, esta opción guardaría un cuadrante vacío.
              disabled={guardando || libres === 0}
              title={libres === 0 ? 'No queda ningún PDV libre para llevarse' : undefined}
              className="w-full px-3 py-2 text-[12px] font-semibold rounded-[8px] border border-[#0c5cab] text-[#0c5cab] hover:bg-[rgba(12,92,171,0.06)] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              {libres === 0 ? 'No queda ninguno libre' : `Llevarme solo los ${libres} libres`}
            </button>
          </>
        ) : (
          <button
            onClick={() => onGuardar('omitir')}
            disabled={guardando || vacio}
            className="w-full px-3 py-2 text-[12px] font-semibold rounded-[8px] bg-[#0c5cab] text-white hover:bg-[#0a4d90] disabled:opacity-40 transition-colors"
          >
            {guardando ? 'Guardando…' : vacio ? 'No hay PDVs para asignar' : 'Guardar cuadrante'}
          </button>
        )}
        <div className="flex gap-1.5">
          <button
            onClick={onRedibujar}
            className="flex-1 px-3 py-1.5 text-[11.5px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#52525b] hover:text-[#09090b] transition-colors"
          >
            Redibujar contorno
          </button>
          <button
            onClick={onCancelar}
            className="flex-1 px-3 py-1.5 text-[11.5px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#52525b] hover:text-[#09090b] transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools read-only para el asistente (Módulo 2). Solo server-side.
//
// Reglas (ver docs/CONTEXTO-IA.md):
//  - El LLM SOLO puede llamar estas tools; nunca SQL libre.
//  - CADA tool re-aplica el scoping por rol server-side: un vendedor no puede
//    ver datos de otra cartera ni aunque lo pida en texto.
//  - Las tools devuelven datos calculados por SQL/algoritmo; el LLM solo redacta.
// ---------------------------------------------------------------------------
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolDef } from './provider';
import { fetchVendedorKpis, fetchTotalKpis, fetchSupervisorKpis } from '@/lib/calculations/queries/kpis';

export interface UserContext {
  rol: 'admin' | 'supervisor' | 'vendedor' | string;
  vendedor_nombre: string | null;
  equipo?: string | null; // del profile; fuente canónica del equipo del supervisor
}

/**
 * Equipo del supervisor. Sale de profiles.equipo (canónico); si viene vacío se
 * intenta derivar de `vendedores` por nombre — pero OJO: el supervisor NO
 * siempre es una fila en vendedores, así que puede quedar null.
 */
export async function resolveEquipo(
  svc: SupabaseClient,
  ctx: UserContext
): Promise<string | null> {
  if (ctx.equipo) return ctx.equipo;
  if (!ctx.vendedor_nombre) return null;
  const { data: v } = await svc.from('vendedores').select('equipo').eq('nombre', ctx.vendedor_nombre).single();
  return v?.equipo ?? null;
}

/**
 * Carteras que el usuario puede ver. null = todas (admin).
 * vendedor → su cartera; supervisor → carteras activas de su equipo.
 */
export async function resolveCarteras(
  svc: SupabaseClient,
  ctx: UserContext
): Promise<string[] | null> {
  if (ctx.rol === 'admin') return null;
  if (ctx.rol === 'vendedor') return ctx.vendedor_nombre ? [ctx.vendedor_nombre] : [];
  if (ctx.rol === 'supervisor') {
    const equipo = await resolveEquipo(svc, ctx);
    if (!equipo) return [];
    const { data: eq } = await svc.from('vendedores').select('nombre').eq('equipo', equipo).eq('activo', true);
    return (eq ?? []).map((r: { nombre: string }) => r.nombre);
  }
  return [];
}

// Mapa pdv_id → última venta real (desde ventas), reutilizando el RPC.
async function ultimaVtaMap(svc: SupabaseClient): Promise<Map<number, string>> {
  const { data } = await svc.rpc('pdvs_ultima_vta');
  const m = new Map<number, string>();
  for (const r of (data as { pdv_id: number; ultima: string }[] | null) ?? []) {
    if (r?.pdv_id != null && r.ultima) m.set(r.pdv_id, r.ultima);
  }
  return m;
}

function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/** Resuelve un nombre de vendedor tipeado libre (sin acentos/casing) al nombre
 *  canónico, dentro del alcance del usuario. Null si no lo encuentra. */
async function resolveVendedor(svc: SupabaseClient, ctx: UserContext, input: string): Promise<string | null> {
  const allowed = await resolveCarteras(svc, ctx);
  let names: string[];
  if (allowed === null) {
    const { data } = await svc.from('vendedores').select('nombre').eq('activo', true);
    names = (data ?? []).map((v: { nombre: string }) => v.nombre);
  } else {
    names = allowed;
  }
  const t = normName(input);
  return names.find((n) => normName(n) === t)
      ?? names.find((n) => normName(n).includes(t) || t.includes(normName(n)))
      ?? null;
}

interface Tool {
  def: ToolDef;
  run: (args: Record<string, unknown>, ctx: UserContext, svc: SupabaseClient) => Promise<unknown>;
}

const TOOLS: Tool[] = [
  // -------- PDVs inactivos en el scope del usuario ------------------------
  {
    def: {
      name: 'get_pdvs_inactivos',
      description: 'Lista los PDVs (puntos de venta) que dejaron de comprar hace más de N meses, dentro de la cartera/equipo del usuario. Útil para "¿qué clientes perdí?", "quién no compra hace rato".',
      parameters: {
        type: 'object',
        properties: {
          meses: { type: 'number', description: 'Antigüedad mínima sin comprar, en meses. Default 3.' },
        },
      },
    },
    async run(args, ctx, svc) {
      const meses = Math.max(1, Number(args.meses) || 3);
      const cutoff = monthsAgoISO(meses);
      const carteras = await resolveCarteras(svc, ctx);
      const ultima = await ultimaVtaMap(svc);
      let q = svc.from('pdvs').select('id, razon_social, localidad, cartera').eq('activo', true);
      if (carteras !== null) q = q.in('cartera', carteras.length ? carteras : ['__none__']);
      const { data } = await q;
      const inactivos = (data ?? [])
        .map((p: { id: number; razon_social: string | null; localidad: string | null; cartera: string | null }) => ({ ...p, ultima_vta: ultima.get(p.id) ?? null }))
        .filter((p) => !p.ultima_vta || p.ultima_vta.slice(0, 10) < cutoff)
        .sort((a, b) => (a.ultima_vta ?? '').localeCompare(b.ultima_vta ?? ''));
      return {
        total: inactivos.length,
        meses,
        ejemplos: inactivos.slice(0, 20).map((p) => ({
          pdv_id: p.id, razon_social: p.razon_social, localidad: p.localidad,
          cartera: p.cartera, ultima_vta: p.ultima_vta ?? 'sin registro',
        })),
      };
    },
  },

  // -------- Detalle de un PDV puntual -------------------------------------
  {
    def: {
      name: 'get_pdv_info',
      description: 'Devuelve los datos de un PDV por su id (razón social, localidad, canal, cartera, día de visita, última venta). Respeta el scope del usuario.',
      parameters: {
        type: 'object',
        properties: { pdv_id: { type: 'number', description: 'ID del PDV.' } },
        required: ['pdv_id'],
      },
    },
    async run(args, ctx, svc) {
      const pdvId = Number(args.pdv_id);
      if (!pdvId) return { error: 'pdv_id inválido' };
      const carteras = await resolveCarteras(svc, ctx);
      const { data: p } = await svc
        .from('pdvs')
        .select('id, razon_social, localidad, zona, canal_venta, cartera, dia_visita, activo')
        .eq('id', pdvId)
        .single();
      if (!p) return { error: 'PDV no encontrado' };
      if (carteras !== null && (!p.cartera || !carteras.includes(p.cartera))) {
        return { error: 'Ese PDV no está en tu cartera.' };
      }
      const ultima = await ultimaVtaMap(svc);
      return { ...p, ultima_vta: ultima.get(pdvId) ?? 'sin registro' };
    },
  },

  // -------- Ventas / KPIs de un vendedor (o del alcance del usuario) -------
  {
    def: {
      name: 'get_ventas',
      description: 'Ventas de un vendedor en un mes: kilos (kg) y pesos ($) por rubro y total, más avance vs meta. Usar para "cuánto vendió X este mes / el mes pasado", en kg o $. Si no se especifica vendedor, da el total del alcance del usuario (empresa/equipo/su cartera). Se puede filtrar a un rubro puntual y pedir un mes/año específico.',
      parameters: {
        type: 'object',
        properties: {
          vendedor: { type: 'string', description: 'Nombre del vendedor/cartera (opcional). Si se omite, total del alcance.' },
          mes: { type: 'string', enum: ['actual', 'pasado'], description: 'Mes a consultar. Default "actual".' },
          rubro: { type: 'string', description: 'Rubro/categoría específica a consultar (ej: "Chocolates", "Gums"). Opcional; si se omite devuelve todos los rubros.' },
          mes_numero: { type: 'number', description: 'Número de mes específico (1-12). Alternativa a mes=actual/pasado cuando el usuario pide un mes puntual como "junio" o "marzo".' },
          anio: { type: 'number', description: 'Año específico. Default año actual.' },
        },
      },
    },
    async run(args, ctx, svc) {
      const today = new Date();
      let y = today.getFullYear(), m = today.getMonth() + 1;
      const mesNum = Number(args.mes_numero);
      if (mesNum >= 1 && mesNum <= 12) {
        // Mes puntual (ej. "junio"): usar mes_numero + año (default actual).
        m = mesNum;
        y = Number(args.anio) || y;
      } else if (args.mes === 'pasado') {
        const d = new Date(y, m - 2, 1); y = d.getFullYear(); m = d.getMonth() + 1;
      } else if (Number(args.anio)) {
        y = Number(args.anio);
      }

      let kpis; let label: string;
      const pedido = typeof args.vendedor === 'string' ? args.vendedor.trim() : '';

      if (pedido) {
        const vend = await resolveVendedor(svc, ctx, pedido);
        if (!vend) return { error: `No encontré un vendedor «${pedido}» en tu alcance.` };
        kpis = await fetchVendedorKpis(vend, y, m, today);
        label = vend;
      } else if (ctx.rol === 'admin') {
        kpis = await fetchTotalKpis(y, m, today); label = 'Total Empresa';
      } else if (ctx.rol === 'supervisor') {
        let equipo = ctx.equipo ?? '';
        if (!equipo && ctx.vendedor_nombre) {
          const { data: v } = await svc.from('vendedores').select('equipo').eq('nombre', ctx.vendedor_nombre).single();
          equipo = v?.equipo ?? '';
        }
        if (!equipo) return { error: 'No tenés un equipo asignado.' };
        kpis = (await fetchSupervisorKpis(equipo, y, m, today)).totales; label = `Equipo ${equipo}`;
      } else if (ctx.rol === 'vendedor' && ctx.vendedor_nombre) {
        kpis = await fetchVendedorKpis(ctx.vendedor_nombre, y, m, today); label = ctx.vendedor_nombre;
      } else {
        return { error: 'Sin alcance para consultar ventas.' };
      }

      // Filtro opcional por rubro: match exacto sin acentos/casing y, si no,
      // parcial (ej. "choco" → "Chocolates"). Si no matchea, devuelve todos.
      const rubroPedido = typeof args.rubro === 'string' ? args.rubro.trim() : '';
      let rubroNoEncontrado = false;
      if (rubroPedido) {
        const t = normName(rubroPedido);
        const exacto = kpis.filter((k) => normName(k.rubro) === t);
        const parcial = kpis.filter((k) => normName(k.rubro).includes(t) || t.includes(normName(k.rubro)));
        const match = exacto.length ? exacto : parcial;
        if (match.length) kpis = match;
        else rubroNoEncontrado = true;
      }

      const r0 = (n: number) => Math.round(n);
      return {
        alcance: label,
        periodo: `${y}-${String(m).padStart(2, '0')}`,
        ...(rubroPedido ? { rubro: rubroPedido } : {}),
        ...(rubroNoEncontrado ? { nota: `No encontré el rubro «${rubroPedido}»; devuelvo todos los rubros.` } : {}),
        total_kg: r0(kpis.reduce((a, k) => a + (k.acumulado || 0), 0)),
        total_pesos: r0(kpis.reduce((a, k) => a + (k.neto_acumulado || 0), 0)),
        por_rubro: kpis.map((k) => ({ rubro: k.rubro, kg: r0(k.acumulado), pesos: r0(k.neto_acumulado), avance_pct: r0(k.avance_pct) })),
      };
    },
  },

  // -------- Clientes (PDVs únicos) que compraron una categoría (CCC) -------
  {
    def: {
      name: 'get_ccc_por_categoria',
      description: 'Cantidad de clientes (PDVs únicos) que compraron una categoría/rubro en un período. Útil para "cuántos clientes compraron X", "penetración de X categoría", "clientes con compra de Chocolates".',
      parameters: {
        type: 'object',
        properties: {
          rubro: { type: 'string', description: 'Categoría/rubro a consultar (ej: "Chocolates", "Gums", "Beverages").' },
          vendedor: { type: 'string', description: 'Nombre del vendedor (opcional). Si se omite, aplica al alcance total del usuario.' },
          mes: { type: 'number', description: 'Mes (1-12). Default mes actual.' },
          anio: { type: 'number', description: 'Año. Default año actual.' },
        },
        required: ['rubro'],
      },
    },
    async run(args, ctx, svc) {
      const today = new Date();
      const mes = Number(args.mes) || today.getMonth() + 1;
      const anio = Number(args.anio) || today.getFullYear();
      const rubro = String(args.rubro ?? '').trim();
      if (!rubro) return { error: 'Falta el rubro/categoría a consultar.' };

      const carteras = await resolveCarteras(svc, ctx);

      // Resolver vendedor específico si se pidió (dentro del alcance del usuario).
      const vendedorArg = typeof args.vendedor === 'string' ? args.vendedor.trim() : '';
      let vendedoresFiltro: string[] | null = carteras;
      if (vendedorArg) {
        const vend = await resolveVendedor(svc, ctx, vendedorArg);
        if (!vend) return { error: `No encontré vendedor «${vendedorArg}» en tu alcance.` };
        vendedoresFiltro = [vend];
      }

      // PDVs únicos que compraron ese rubro ese mes. Hay que PAGINAR: PostgREST
      // corta cada respuesta en 1000 filas (max-rows del proyecto) y un rubro
      // popular a nivel empresa supera eso (ej. Chocolates ~2400 filas). Un
      // .range() grande NO alcanza — el tope se aplica igual. Acumulamos en un
      // Set para contar pdv_id distintos (un PDV puede aparecer bajo 2 carteras
      // si hubo reasignación en el mes).
      const PAGE = 1000;
      const pdvSet = new Set<number>();
      for (let from = 0; ; from += PAGE) {
        let q = svc
          .from('resumen_clientes_pdv')
          .select('pdv_id')
          .eq('anio', anio)
          .eq('mes', mes)
          .ilike('rubro', rubro) // case-insensitive
          .range(from, from + PAGE - 1);
        if (vendedoresFiltro !== null) {
          q = q.in('vendedor', vendedoresFiltro.length ? vendedoresFiltro : ['__none__']);
        }
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as { pdv_id: number }[];
        for (const r of rows) pdvSet.add(r.pdv_id);
        if (rows.length < PAGE) break;
      }
      const pdvsUnicos = pdvSet.size;

      const alcance =
        vendedorArg ? vendedoresFiltro![0]
        : vendedoresFiltro === null ? 'Total Empresa'
        : ctx.rol === 'vendedor' ? (ctx.vendedor_nombre ?? 'Tu cartera')
        : `Equipo (${vendedoresFiltro.length} vendedor${vendedoresFiltro.length === 1 ? '' : 'es'})`;

      return {
        rubro,
        periodo: `${anio}-${String(mes).padStart(2, '0')}`,
        alcance,
        clientes_con_compra: pdvsUnicos,
      };
    },
  },

  // -------- Qué días de un mes tienen ventas cargadas ---------------------
  {
    def: {
      name: 'get_dias_con_datos',
      description: 'Días de un mes que tienen ventas cargadas: la lista exacta de fechas, cuántos son (días trabajados) y qué días hábiles del mes faltan. Usar SIEMPRE para "¿de qué días hay info?", "¿cuántos días trabajados van?", "¿falta cargar algún día?". NUNCA deducir la cantidad de días a partir de la última fecha: hay feriados y días sin carga que solo se ven mirando los datos.',
      parameters: {
        type: 'object',
        properties: {
          mes:  { type: 'number', description: 'Mes (1-12). Default mes actual.' },
          anio: { type: 'number', description: 'Año. Default año actual.' },
        },
      },
    },
    async run(args, ctx, svc) {
      const today = new Date();
      const mes  = Number(args.mes)  || today.getMonth() + 1;
      const anio = Number(args.anio) || today.getFullYear();
      const mm    = String(mes).padStart(2, '0');
      const desde = `${anio}-${mm}-01`;
      const hasta = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;

      // Scoping por rol, igual que get_ventas.
      let p_equipo: string | null = null;
      let p_vendedor: string | null = null;
      let alcance = 'Total Empresa';
      if (ctx.rol === 'vendedor' && ctx.vendedor_nombre) {
        p_vendedor = ctx.vendedor_nombre;
        alcance = ctx.vendedor_nombre;
      } else if (ctx.rol === 'supervisor') {
        let equipo = ctx.equipo ?? '';
        if (!equipo && ctx.vendedor_nombre) {
          const { data: v } = await svc.from('vendedores').select('equipo').eq('nombre', ctx.vendedor_nombre).single();
          equipo = v?.equipo ?? '';
        }
        if (!equipo) return { error: 'No tenés un equipo asignado.' };
        p_equipo = equipo;
        alcance = `Equipo ${equipo}`;
      }

      // kpi_tendencia agrupa por fecha: devuelve exactamente un renglón por día
      // con ventas, que es la misma definición de "día trabajado" que usa el
      // dashboard (kpi_dias_trabajados = COUNT DISTINCT fecha sobre esa tabla).
      const [{ data: dias }, { data: cfg }] = await Promise.all([
        svc.rpc('kpi_tendencia', { p_desde: desde, p_hasta: hasta, p_equipo, p_vendedor }),
        svc.from('config_meses').select('dias_laborables').eq('anio', anio).eq('mes', mes).maybeSingle(),
      ]);

      const fechas = ((dias ?? []) as { fecha: string }[])
        .map((r) => String(r.fecha).slice(0, 10))
        .sort();
      const conDatos = new Set(fechas);

      // Días hábiles (lun-vie) del mes, hasta hoy si el mes está en curso, que
      // NO tienen ventas: feriados o cargas pendientes. El asistente no puede
      // inferirlos, así que se los damos calculados.
      const finDeVentana = (anio === today.getFullYear() && mes === today.getMonth() + 1)
        ? today.getDate()
        : new Date(anio, mes, 0).getDate();
      const habilesSinDatos: string[] = [];
      for (let d = 1; d <= finDeVentana; d++) {
        const dow = new Date(anio, mes - 1, d).getDay();
        if (dow === 0 || dow === 6) continue;
        const iso = `${anio}-${mm}-${String(d).padStart(2, '0')}`;
        if (!conDatos.has(iso)) habilesSinDatos.push(iso);
      }

      return {
        periodo: `${anio}-${mm}`,
        alcance,
        dias_con_datos: fechas.length,
        fechas,
        primera_fecha: fechas[0] ?? null,
        ultima_fecha: fechas[fechas.length - 1] ?? null,
        dias_laborables_del_mes: cfg?.dias_laborables ?? null,
        dias_habiles_sin_datos: habilesSinDatos,
        nota: 'dias_con_datos es el conteo real de días con ventas (lo mismo que muestra el dashboard). Los días de dias_habiles_sin_datos son hábiles sin ventas: feriados o cargas pendientes.',
      };
    },
  },

  // -------- Fecha de la última carga / hasta cuándo hay datos --------------
  {
    def: {
      name: 'get_ultima_carga',
      description: 'Devuelve la fecha más reciente de ventas cargadas en el sistema y el período (mes/año) disponible más reciente. Útil para "¿hasta cuándo hay datos?", "¿cuándo fue la última carga?".',
      parameters: { type: 'object', properties: {} },
    },
    async run(_args, _ctx, svc) {
      // La fecha exacta de la venta más reciente es la fuente de verdad; el
      // período disponible se deriva de ella (resumen_diario no tiene anio/mes).
      const { data: ultimaVenta } = await svc
        .from('ventas')
        .select('fecha')
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle();

      const fecha = ultimaVenta?.fecha ?? null;
      return {
        ultimo_periodo_disponible: fecha ? String(fecha).slice(0, 7) : null,
        fecha_ultima_venta: fecha,
        mensaje: fecha
          ? `Los datos llegan hasta el ${fecha}.`
          : 'No hay datos de ventas cargados.',
      };
    },
  },
];

/** Definiciones para pasarle al LLM. */
export function toolDefs(): ToolDef[] {
  return TOOLS.map((t) => t.def);
}

/** Ejecuta una tool por nombre, aplicando el scope. Devuelve string (JSON). */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: UserContext,
  svc: SupabaseClient
): Promise<string> {
  const tool = TOOLS.find((t) => t.def.name === name);
  if (!tool) return JSON.stringify({ error: `Tool desconocida: ${name}` });
  try {
    return JSON.stringify(await tool.run(args, ctx, svc));
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

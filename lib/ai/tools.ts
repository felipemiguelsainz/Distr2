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
  if (ctx.rol === 'supervisor' && ctx.vendedor_nombre) {
    const { data: v } = await svc.from('vendedores').select('equipo').eq('nombre', ctx.vendedor_nombre).single();
    if (!v?.equipo) return [];
    const { data: eq } = await svc.from('vendedores').select('nombre').eq('equipo', v.equipo).eq('activo', true);
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
      description: 'Ventas de un vendedor en un mes: kilos (kg) y pesos ($) por rubro y total, más avance vs meta. Usar para "cuánto vendió X este mes / el mes pasado", en kg o $. Si no se especifica vendedor, da el total del alcance del usuario (empresa/equipo/su cartera).',
      parameters: {
        type: 'object',
        properties: {
          vendedor: { type: 'string', description: 'Nombre del vendedor/cartera (opcional). Si se omite, total del alcance.' },
          mes: { type: 'string', enum: ['actual', 'pasado'], description: 'Mes a consultar. Default "actual".' },
        },
      },
    },
    async run(args, ctx, svc) {
      const today = new Date();
      let y = today.getFullYear(), m = today.getMonth() + 1;
      if (args.mes === 'pasado') { const d = new Date(y, m - 2, 1); y = d.getFullYear(); m = d.getMonth() + 1; }

      let kpis; let label: string;
      const pedido = typeof args.vendedor === 'string' ? args.vendedor.trim() : '';

      if (pedido) {
        const vend = await resolveVendedor(svc, ctx, pedido);
        if (!vend) return { error: `No encontré un vendedor «${pedido}» en tu alcance.` };
        kpis = await fetchVendedorKpis(vend, y, m, today);
        label = vend;
      } else if (ctx.rol === 'admin') {
        kpis = await fetchTotalKpis(y, m, today); label = 'Total Empresa';
      } else if (ctx.rol === 'supervisor' && ctx.vendedor_nombre) {
        const { data: v } = await svc.from('vendedores').select('equipo').eq('nombre', ctx.vendedor_nombre).single();
        if (!v?.equipo) return { error: 'No tenés un equipo asignado.' };
        kpis = (await fetchSupervisorKpis(v.equipo, y, m, today)).totales; label = `Equipo ${v.equipo}`;
      } else if (ctx.rol === 'vendedor' && ctx.vendedor_nombre) {
        kpis = await fetchVendedorKpis(ctx.vendedor_nombre, y, m, today); label = ctx.vendedor_nombre;
      } else {
        return { error: 'Sin alcance para consultar ventas.' };
      }

      const r0 = (n: number) => Math.round(n);
      return {
        alcance: label,
        periodo: `${y}-${String(m).padStart(2, '0')}`,
        total_kg: r0(kpis.reduce((a, k) => a + (k.acumulado || 0), 0)),
        total_pesos: r0(kpis.reduce((a, k) => a + (k.neto_acumulado || 0), 0)),
        por_rubro: kpis.map((k) => ({ rubro: k.rubro, kg: r0(k.acumulado), pesos: r0(k.neto_acumulado), avance_pct: r0(k.avance_pct) })),
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

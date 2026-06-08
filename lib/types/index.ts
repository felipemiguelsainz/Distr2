// ============================================================
// SHARED TYPES
// ============================================================

export type Rol = 'admin' | 'supervisor' | 'vendedor';

export interface Profile {
  id: string;
  nombre: string | null;
  rol: Rol;
  vendedor_nombre: string | null;
  equipo: string | null;
}

export interface Vendedor {
  id: string;
  nombre: string;
  supervisor: string | null;
  equipo: string | null;
  localidad: string | null;
  activo: boolean;
}

export interface Pdv {
  id: number;
  razon_social: string;
  domicilio: string | null;
  localidad: string | null;
  zona: string | null;
  canal_distribucion: string | null;
  canal_venta: string | null;
  categoria_iva: string | null;
  cuit: string | null;
  cartera: string | null;
  fecha_alta: string | null;
  ultima_vta: string | null;
  activo: boolean;
  dia_visita?: string | null;
}

export interface Meta {
  id: string;
  anio: number;
  mes: number;
  vendedor_nombre: string;
  rubro: string;
  kilos_meta: number;
}

export interface ResumenDiario {
  fecha: string;
  vendedor: string;
  supervisor: string | null;
  equipo: string | null;
  rubro: string;
  kilos: number;
  neto: number;
  pdvs_activos: number;
}

export interface Planificacion {
  id: string;
  fecha: string;
  vendedor_nombre: string;
  rubro: string;
  kilos_planificado: number;
  kilos_real: number | null;
}

// Dashboard KPIs
export interface KpiRubro {
  rubro: string;
  // KG
  meta: number | null;            // null para meses pasados
  acumulado: number;
  avance_pct: number;
  tendencia: number | null;       // null para meses pasados
  media_real: number;
  media_necesaria: number | null; // null para meses pasados
  mismo_dia_minus7: number;
  mismo_dia_minus14: number;
  acumulado_aa: number;
  avance_vs_aa_pct: number;
  // Neto ($) — mirrors the KG columns
  neto_acumulado: number;
  neto_tendencia: number | null;
  neto_meta: number | null;          // derived: meta_kg × $/kg ratio
  neto_media_real: number;
  neto_media_necesaria: number | null;
  neto_mismo_dia_minus7: number;
  neto_mismo_dia_minus14: number;
  neto_acumulado_aa: number;
  neto_vs_aa_pct: number;
}

export interface KpiVendedor extends KpiRubro {
  vendedor: string;
}

export interface CccData {
  mes_actual: number;
  mes_anterior: number;
  variacion: number;
}

export interface CoberturaItem {
  sku: string;
  articulo: string;
  objetivo_pct: number;
  pdvs_compraron: number;
  pdvs_totales: number;
  cobertura_pct: number;
}

export interface ClientesRubro {
  rubro: string;
  clientes_mes: number;
  cartera_activa_3m: number;
  penetracion_pct: number;      // clientes_mes / cartera_activa_3m * 100
  clientes_mes_anterior: number;
  vs_mes_anterior_pct: number;  // % change vs previous month
  clientes_aa: number;
  vs_aa_pct: number;            // % change vs same month last year
}

// Upload result types
export interface VentasUploadResult {
  inserted: number;
  skipped: number;
  errors: string[];
  fechas_afectadas: string[];
  resumen_warning?: string; // set when recalcularResumenDiario fails
}

export interface PdvsUploadResult {
  total: number;
  inserted: number;
  updated: number;
  deactivated: number;   // PDVs marcados como inactivos (no estaban en el archivo)
  reasignaciones: Reasignacion[];
}

export interface Reasignacion {
  pdv_id: number;
  razon_social: string;
  cartera: string;
  vendedor_anterior: string;
  vendedor_nuevo: string;
}

export interface MaestrosUploadResult {
  vendedores_upserted: number;
}

// Metas calculation types
export interface MetaPreviewVendedor {
  vendedor: string;
  peso_pct: number;        // 0-100
  kg_meta: number;
  neto_meta: number | null; // proportional share of objetivo_neto (null for non-Mondelez)
}

export interface MetaPreviewRubro {
  rubro: string;
  origen: 'mondelez' | 'estacional';
  // Mondelez-only
  objetivo_neto?: number;       // input from user, in $
  dolar_por_kilo?: number;      // calculated from last month
  // Estacional-only
  ventas_mes_anterior?: number;        // kg vendidos mes anterior (actual)
  peso_mes_target_aa_pct?: number;     // % del año pasado que pesó el mes target (0-100)
  peso_mes_ant_aa_pct?: number;        // % del año pasado que pesó el mes anterior (0-100)
  factor_estacional?: number;          // peso_target / peso_ant (= kg_target_AA / kg_ant_AA)
  // Resultado
  kg_meta_total: number;
  neto_meta_total?: number;     // $ meta (Mondelez: input; estacional: kg × $/kg mes ant)
  vendedores: MetaPreviewVendedor[];
}

// Raw Excel row shapes
export interface RawVentaRow {
  fecha: string;
  pdv_id: number;
  cartera: string;
  vendedor: string;
  razon_social: string;
  comprobante: string;
  marca: string;
  rubro: string;
  sku: string;
  articulo: string;
  neto: number;
  kilos: number;
  bultos: number;
  unidades: number;
  mes: number;
  anio: number;
}

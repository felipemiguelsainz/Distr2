import { KpiRubro, KpiVendedor } from '@/lib/types';
import { esPeriodoCerrado } from '@/lib/periodos';

interface KpiInput {
  rubro: string;
  year: number;
  month: number;
  today: Date;
  // Días
  dias_laborables: number; // de config_meses
  dias_trabajados: number; // COUNT(DISTINCT fecha) en resumen_diario
  // KG
  acumulado: number;
  meta: number;
  acumulado_minus7: number;
  acumulado_minus14: number;
  acumulado_aa: number;
  // Neto
  neto_acumulado: number;
  neto_minus7: number;
  neto_minus14: number;
  neto_acumulado_aa: number;
  neto_meta_stored?: number | null; // from DB when available (exact $ objective)
}

export function buildKpi(input: KpiInput): KpiRubro {
  const {
    rubro, year, month, today,
    dias_laborables, dias_trabajados,
    acumulado, meta, acumulado_minus7, acumulado_minus14, acumulado_aa,
    neto_acumulado, neto_minus7, neto_minus14, neto_acumulado_aa,
    neto_meta_stored,
  } = input;

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const cerrado        = esPeriodoCerrado(year, month, today);

  const media_real      = dias_trabajados > 0 ? acumulado / dias_trabajados : 0;
  const neto_media_real = dias_trabajados > 0 ? neto_acumulado / dias_trabajados : 0;

  // Tendencia y meta solo para el mes corriente
  const tendencia = isCurrentMonth && dias_trabajados > 0 && dias_laborables > 0
    ? (acumulado / dias_trabajados) * dias_laborables
    : null;

  const neto_tendencia = isCurrentMonth && dias_trabajados > 0 && dias_laborables > 0
    ? (neto_acumulado / dias_trabajados) * dias_laborables
    : null;

  // Avance: sobre tendencia en mes corriente, sobre acumulado en meses pasados
  const avance_pct = meta > 0
    ? ((isCurrentMonth && tendencia !== null ? tendencia : acumulado) / meta) * 100
    : 0;

  const diasRestantes   = Math.max(dias_laborables - dias_trabajados, 1);
  const media_necesaria = isCurrentMonth && meta > 0
    ? (meta - acumulado) / diasRestantes
    : null;

  const neto_media_necesaria = isCurrentMonth && media_necesaria !== null && acumulado > 0
    ? media_necesaria * (neto_acumulado / acumulado)
    : null;

  // Neto meta: prefer stored DB value (exact $ objective); fall back to ratio estimate.
  // Vale también para meses cerrados: sin esto no se puede ver el cierre vs la meta $.
  const neto_meta = neto_meta_stored !== undefined && neto_meta_stored !== null
    ? neto_meta_stored
    : (meta > 0 && acumulado > 0 ? meta * (neto_acumulado / acumulado) : null);

  // Cumplimiento en $: misma regla que en kilos (tendencia en el mes corriente,
  // cierre en los cerrados) pero contra la meta $ y con lo facturado. Las dos
  // columnas mostraban avance_pct —el de kilos— así que un mes con la mezcla
  // corrida (más kilos de rubro barato) informaba el mismo % en los dos lados.
  // Cuando neto_meta es el estimado por ratio y no un objetivo $ cargado, los
  // dos porcentajes coinciden por construcción: es correcto, no es el bug.
  const neto_avance_pct = neto_meta !== null && neto_meta > 0
    ? ((isCurrentMonth && neto_tendencia !== null ? neto_tendencia : neto_acumulado) / neto_meta) * 100
    : 0;

  // La meta se muestra SIEMPRE (también en meses cerrados): es lo que permite
  // mirar el cierre del mes pasado contra el objetivo. Sin meta cargada → null.
  const meta_display = meta > 0 ? meta : null;

  const avance_vs_aa_pct = acumulado_aa > 0
    ? ((acumulado - acumulado_aa) / acumulado_aa) * 100 : 0;
  const neto_vs_aa_pct = neto_acumulado_aa > 0
    ? ((neto_acumulado - neto_acumulado_aa) / neto_acumulado_aa) * 100 : 0;

  return {
    rubro,
    cerrado,
    meta: meta_display,
    acumulado,
    avance_pct,
    tendencia,
    media_real,
    media_necesaria,
    mismo_dia_minus7: acumulado_minus7,
    mismo_dia_minus14: acumulado_minus14,
    acumulado_aa,
    avance_vs_aa_pct,
    neto_acumulado,
    neto_tendencia,
    neto_meta,
    neto_avance_pct,
    neto_media_real,
    neto_media_necesaria,
    neto_mismo_dia_minus7: neto_minus7,
    neto_mismo_dia_minus14: neto_minus14,
    neto_acumulado_aa,
    neto_vs_aa_pct,
  };
}

// ---------------------------------------------------------------------------
// Agregación multi-período
//
// Cuando el filtro tiene varios meses/años, cada período se calcula por separado
// (así cada uno usa sus propios días laborables, su meta y su comparativo AA) y
// después se SUMAN. Reglas:
//   · acumulado / meta / AA / D−7 / D−14 → suma directa.
//   · tendencia → suma de "lo que va a cerrar cada mes": los cerrados aportan su
//     acumulado real y el corriente su proyección. Si ningún período proyecta
//     (todos cerrados), queda null.
//   · media real → acumulado total ÷ días trabajados totales (no es sumable).
//   · cerrado → sólo si TODOS los períodos cerraron.
// ---------------------------------------------------------------------------
export interface KpiParte {
  kpis: KpiRubro[];
  diasTrabajados: number;
}

function combinar(rows: KpiRubro[], diasTrabajados: number): KpiRubro {
  const sum = (f: (r: KpiRubro) => number) => rows.reduce((s, r) => s + f(r), 0);

  const acumulado = sum(r => r.acumulado);
  const neto      = sum(r => r.neto_acumulado);
  const acum_aa   = sum(r => r.acumulado_aa);
  const neto_aa   = sum(r => r.neto_acumulado_aa);

  const conMeta     = rows.some(r => r.meta !== null);
  const conNetoMeta = rows.some(r => r.neto_meta !== null);
  const meta        = conMeta ? sum(r => r.meta ?? 0) : null;

  const proyecta     = rows.some(r => r.tendencia !== null);
  const tendencia    = proyecta ? sum(r => r.tendencia ?? r.acumulado) : null;
  const proyectaNeto = rows.some(r => r.neto_tendencia !== null);
  const neto_tend    = proyectaNeto ? sum(r => r.neto_tendencia ?? r.neto_acumulado) : null;

  const conMediaNec     = rows.some(r => r.media_necesaria !== null);
  const conNetoMediaNec = rows.some(r => r.neto_media_necesaria !== null);

  // D−7 / D−14 son fotos de una fecha fija (hoy menos 7/14 días), iguales en todos
  // los períodos: sumarlas las multiplicaría. Se toma la del mes en curso.
  const enCurso = rows.find(r => !r.cerrado);

  return {
    rubro:                  rows[0].rubro,
    cerrado:                rows.every(r => r.cerrado),
    meta,
    acumulado,
    avance_pct:             meta && meta > 0 ? ((tendencia ?? acumulado) / meta) * 100 : 0,
    tendencia,
    media_real:             diasTrabajados > 0 ? acumulado / diasTrabajados : 0,
    media_necesaria:        conMediaNec ? sum(r => r.media_necesaria ?? 0) : null,
    mismo_dia_minus7:       enCurso?.mismo_dia_minus7  ?? 0,
    mismo_dia_minus14:      enCurso?.mismo_dia_minus14 ?? 0,
    acumulado_aa:           acum_aa,
    avance_vs_aa_pct:       acum_aa > 0 ? ((acumulado - acum_aa) / acum_aa) * 100 : 0,
    neto_acumulado:         neto,
    neto_tendencia:         neto_tend,
    neto_meta:              conNetoMeta ? sum(r => r.neto_meta ?? 0) : null,
    neto_avance_pct:        (() => {
                              const nm = conNetoMeta ? sum(r => r.neto_meta ?? 0) : 0;
                              return nm > 0 ? ((neto_tend ?? neto) / nm) * 100 : 0;
                            })(),
    neto_media_real:        diasTrabajados > 0 ? neto / diasTrabajados : 0,
    neto_media_necesaria:   conNetoMediaNec ? sum(r => r.neto_media_necesaria ?? 0) : null,
    neto_mismo_dia_minus7:  enCurso?.neto_mismo_dia_minus7  ?? 0,
    neto_mismo_dia_minus14: enCurso?.neto_mismo_dia_minus14 ?? 0,
    neto_acumulado_aa:      neto_aa,
    neto_vs_aa_pct:         neto_aa > 0 ? ((neto - neto_aa) / neto_aa) * 100 : 0,
  };
}

/** Suma varios períodos de KPIs por rubro. */
export function mergeKpis(partes: KpiParte[]): KpiRubro[] {
  if (partes.length === 1) return partes[0].kpis;

  const diasTrabajados = partes.reduce((s, p) => s + p.diasTrabajados, 0);
  const porRubro = new Map<string, KpiRubro[]>();
  for (const parte of partes) {
    for (const k of parte.kpis) {
      const arr = porRubro.get(k.rubro) ?? [];
      arr.push(k);
      porRubro.set(k.rubro, arr);
    }
  }

  return [...porRubro.values()]
    .map(rows => combinar(rows, diasTrabajados))
    .sort((a, b) => a.rubro.localeCompare(b.rubro));
}

/** Idem, pero para los KPIs desagregados por vendedor. */
export function mergeKpisVendedor(
  partes: { kpis: KpiVendedor[]; diasTrabajados: number }[],
): KpiVendedor[] {
  if (partes.length === 1) return partes[0].kpis;

  const diasTrabajados = partes.reduce((s, p) => s + p.diasTrabajados, 0);
  const porClave = new Map<string, KpiVendedor[]>();
  for (const parte of partes) {
    for (const k of parte.kpis) {
      // Separador NUL escapado, no un byte crudo. Con el NUL literal que
      // habia aca, grep y ripgrep clasificaban el archivo como binario y lo
      // salteaban en toda busqueda del repo: por eso los colores de
      // avanceColor pasaron desapercibidos en varias auditorias de esta
      // sesion. El escape produce exactamente el mismo caracter.
      const clave = `${k.vendedor}\u0000${k.rubro}`;
      const arr = porClave.get(clave) ?? [];
      arr.push(k);
      porClave.set(clave, arr);
    }
  }

  return [...porClave.values()].map(rows => ({
    ...combinar(rows, diasTrabajados),
    vendedor: rows[0].vendedor,
  }));
}

export function avanceColor(pct: number): string {
  if (pct >= 90) return 'text-[#15803d] bg-[#16a34a]/[0.1]';
  if (pct >= 70) return 'text-[#b45309] bg-[#d97706]/[0.1]';
  return 'text-[#b91c1c] bg-[#dc2626]/[0.1]';
}

export function vsAaColor(pct: number): string {
  if (pct > 0) return 'text-[#15803d]';
  if (pct < 0) return 'text-[#b91c1c]';
  return 'text-[#71717a]';
}

export function formatKg(kg: number): string {
  return kg.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

export function formatPct(pct: number): string {
  return (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
}

export function formatPctPlain(pct: number): string {
  return pct.toFixed(1) + '%';
}

export function formatCurrency(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  });
}

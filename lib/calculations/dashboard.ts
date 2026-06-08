import { KpiRubro } from '@/lib/types';

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

  // Neto meta: prefer stored DB value (exact $ objective); fall back to ratio estimate
  const neto_meta = neto_meta_stored !== undefined && neto_meta_stored !== null
    ? neto_meta_stored
    : (isCurrentMonth && meta > 0 && acumulado > 0
        ? meta * (neto_acumulado / acumulado)
        : null);

  const meta_display = isCurrentMonth ? meta : null;

  const avance_vs_aa_pct = acumulado_aa > 0
    ? ((acumulado - acumulado_aa) / acumulado_aa) * 100 : 0;
  const neto_vs_aa_pct = neto_acumulado_aa > 0
    ? ((neto_acumulado - neto_acumulado_aa) / neto_acumulado_aa) * 100 : 0;

  return {
    rubro,
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
    neto_media_real,
    neto_media_necesaria,
    neto_mismo_dia_minus7: neto_minus7,
    neto_mismo_dia_minus14: neto_minus14,
    neto_acumulado_aa,
    neto_vs_aa_pct,
  };
}

export function avanceColor(pct: number): string {
  if (pct >= 90) return 'text-[#16a34a] bg-[#16a34a]/[0.1]';
  if (pct >= 70) return 'text-[#d97706] bg-[#d97706]/[0.1]';
  return 'text-[#dc2626] bg-[#dc2626]/[0.1]';
}

export function vsAaColor(pct: number): string {
  if (pct > 0) return 'text-[#16a34a]';
  if (pct < 0) return 'text-[#dc2626]';
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

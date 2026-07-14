'use client';

import { useState, useEffect } from 'react';
import { DropZone } from '@/components/upload/DropZone';
import type { VentasPreview } from '@/lib/excel/parser';
import { Select } from '@/components/ui/Select';
import {
  VentasUploadResult,
  PdvsUploadResult,
  MaestrosUploadResult,
  Reasignacion,
} from '@/lib/types';

// Normaliza un nombre de columna para comparar sin importar mayúsculas, acentos,
// espacios, puntos ni guiones bajos. "Canal Vta." → "canalvta", "DOMICILIO" →
// "domicilio", "Razón Social" → "razonsocial". Los exports de Candysur varían el
// casing/puntuación entre archivos (ej. "Ultima Vta." con punto), así que SIEMPRE
// buscamos columnas normalizando, no por match exacto.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g'); // marcas de acento (NFD)
const normKey = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(DIACRITICS, '').replace(/[\s._]/g, '');

// Lector de columnas tolerante para una fila: g('Canal Venta', 'Canal Vta')
// prueba cada candidato normalizado y devuelve el primer valor no vacío. Blinda
// los parsers contra renombres de encabezado.
function rowGetter(r: Record<string, unknown>) {
  const map = new Map<string, unknown>();
  for (const k of Object.keys(r)) map.set(normKey(k), r[k]);
  return (...candidates: string[]): unknown => {
    for (const c of candidates) {
      const v = map.get(normKey(c));
      if (v !== undefined && v !== '') return v;
    }
    return undefined;
  };
}

// Toma el id de PDV de una fila de Excel: SIEMPRE prioriza la columna "PDV";
// sólo cae a "Cod. Cliente" si no hay PDV. Clave para que pdvs, ventas y geo
// queden indexados por la MISMA columna.
function pickPdvId(r: Record<string, unknown>): number {
  const keys = Object.keys(r);
  const pdvKey = keys.find((k) => normKey(k) === 'pdv');
  const codKey = keys.find((k) => normKey(k).includes('codcliente'));
  return parseInt(String(r[pdvKey ?? codKey ?? ''] ?? ''), 10);
}

async function parsePdvFile(buffer: ArrayBuffer) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { cellDates: false, type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  function parseDate(val: unknown): string | null {
    if (!val) return null;
    if (typeof val === 'number') {
      try {
        const d = XLSX.SSF.parse_date_code(val);
        return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      } catch { return null; }
    }
    const s = String(val).trim();
    if (!s) return null;
    const parts = s.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    return s.slice(0, 10) || null;
  }

  return raw
    .map((r) => {
      const id = pickPdvId(r);
      if (!id || isNaN(id)) return null;
      const g = rowGetter(r);
      const activoRaw = g('Activo');
      const activo = activoRaw === undefined
        ? true
        : String(activoRaw).toLowerCase() !== 'false' &&
          String(activoRaw) !== '0' &&
          String(activoRaw).toLowerCase() !== 'no';
      return {
        id,
        razon_social:       String(g('Razon Social') ?? '').trim(),
        domicilio:          String(g('Domicilio') ?? '').trim(),
        localidad:          String(g('Localidad') ?? '').trim(),
        zona:               String(g('Zona') ?? '').trim(),
        canal_distribucion: String(g('Canal Distribucion') ?? '').trim(),
        canal_venta:        String(g('Canal Venta', 'Canal Vta') ?? '').trim(),
        categoria_iva:      String(g('Categoria IVA') ?? '').trim(),
        cuit:               String(g('CUIT') ?? '').trim(),
        cartera:            String(g('Cartera') ?? '').trim(),
        fecha_alta:         parseDate(g('Fecha Alta')),
        ultima_vta:         parseDate(g('Ultima Vta')),
        activo,
        dia_visita: (['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'] as const)
          .filter(d => String(g(d) ?? '').trim().toUpperCase() === 'S')
          .join(',') || null,
      };
    })
    .filter(Boolean);
}

function VentasPreviewModal({
  preview, onConfirm, onCancel,
}: { preview: VentasPreview; onConfirm: () => void; onCancel: () => void }) {
  const missing = preview.mappings.filter(m => !m.ok);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-[0_16px_48px_rgba(0,0,0,0.18)] max-w-lg w-full flex flex-col max-h-[90vh]">
        <div className="p-6 pb-4 flex-shrink-0">
          <h3 className="text-[17px] font-semibold text-[#09090b] mb-1">Confirmar importación de ventas</h3>
          <p className="text-[13px] text-[#71717a]">
            {preview.totalRows.toLocaleString()} filas detectadas. Verificá que los campos se mapeen correctamente.
          </p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-2">

        {missing.length > 0 && (
          <div className="mb-4 px-3.5 py-2.5 rounded-[10px] bg-[#dc2626]/[0.08] border border-[#dc2626]/30 text-[12px] text-[#dc2626] font-medium">
            Campos requeridos no encontrados: {missing.map(m => m.label).join(', ')}
          </div>
        )}

        {/* Field mapping */}
        <div className="rounded-xl border border-[#e4e4e7] overflow-x-auto text-[12px] mb-4">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#f4f4f5]/80 border-b border-[#e4e4e7]">
                <th className="px-3 py-2 text-left font-semibold text-[#71717a] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Campo</th>
                <th className="px-3 py-2 text-left font-semibold text-[#71717a] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Columna Excel</th>
                <th className="px-3 py-2 text-left font-semibold text-[#71717a] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Ejemplo fila 1</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e4e7]">
              {preview.mappings.map(m => (
                <tr key={m.field} className={m.ok ? '' : 'bg-[#dc2626]/[0.05]'}>
                  <td className="px-3 py-2 font-medium text-[#27272a]">{m.label}</td>
                  <td className="px-3 py-2">
                    {m.excelCol
                      ? <span className="text-[#16a34a] font-medium">{m.excelCol}</span>
                      : <span className="text-[#dc2626]">No encontrado</span>}
                  </td>
                  <td className="px-3 py-2 text-[#71717a]">{m.value || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* All columns in the file */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a] mb-1" style={{fontFamily: "'JetBrains Mono', monospace"}}>Todas las columnas del archivo</p>
        <div className="rounded-xl border border-[#e4e4e7] overflow-x-auto text-[12px] mb-4 max-h-48 overflow-y-auto">
          <table className="min-w-full">
            <thead className="sticky top-0 bg-[#f4f4f5]">
              <tr className="border-b border-[#e4e4e7]">
                <th className="px-3 py-2 text-left font-semibold text-[#71717a] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Nombre columna</th>
                <th className="px-3 py-2 text-left font-semibold text-[#71717a] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Fila 1</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e4e7]">
              {preview.allColumns.map(c => (
                <tr key={c.name}>
                  <td className="px-3 py-1.5 text-[11px] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>{c.name}</td>
                  <td className="px-3 py-1.5 text-[#71717a]">{c.sample || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Parsed kilos/neto sample */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a] mb-1" style={{fontFamily: "'JetBrains Mono', monospace"}}>Primeras 5 filas parseadas</p>
        <div className="rounded-xl border border-[#e4e4e7] overflow-hidden text-[12px] mb-5">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#f4f4f5]/80 border-b border-[#e4e4e7]">
                <th className="px-3 py-2 text-left font-semibold text-[#71717a] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Fila</th>
                <th className="px-3 py-2 text-right font-semibold text-[#71717a] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Kilos</th>
                <th className="px-3 py-2 text-right font-semibold text-[#71717a] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Neto $</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e4e7]">
              {preview.parsedSample.map((s, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 text-[#71717a]">{i + 1}</td>
                  <td className={`px-3 py-1.5 text-right ${s.kilos < 0 ? 'text-[#dc2626]' : s.kilos === 0 ? 'text-[#71717a]' : 'text-[#27272a]'}`} style={{fontFamily: "'JetBrains Mono', monospace"}}>{s.kilos}</td>
                  <td className={`px-3 py-1.5 text-right ${s.neto  < 0 ? 'text-[#dc2626]' : s.neto  === 0 ? 'text-[#71717a]' : 'text-[#27272a]'}`} style={{fontFamily: "'JetBrains Mono', monospace"}}>{s.neto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Kilos summary */}
        <div className="rounded-xl border border-[#e4e4e7] p-3.5 mb-4 text-[12px] space-y-1.5">
          <p className="font-semibold text-[#71717a] text-[10px] uppercase tracking-[0.08em] mb-2" style={{fontFamily: "'JetBrains Mono', monospace"}}>Resumen de kilos en el archivo</p>
          <div className="flex justify-between">
            <span className="text-[#71717a]">Filas con ventas (+)</span>
            <span className="font-semibold text-[#27272a]">{preview.rowsPos.toLocaleString()} filas — {preview.kilosTotalPos.toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#71717a]">Filas con devoluciones (−)</span>
            <span className="font-semibold text-[#dc2626]">{preview.rowsNeg.toLocaleString()} filas — {preview.kilosTotalNeg.toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg</span>
          </div>
          <div className="flex justify-between border-t border-[#e4e4e7] pt-1.5">
            <span className="text-[#71717a] font-medium">Neto</span>
            <span className={`font-bold ${(preview.kilosTotalPos + preview.kilosTotalNeg) < 0 ? 'text-[#dc2626]' : 'text-[#09090b]'}`}>
              {(preview.kilosTotalPos + preview.kilosTotalNeg).toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg
            </span>
          </div>
        </div>

        </div>{/* end scrollable */}

        <div className="p-6 pt-4 flex gap-2.5 justify-end flex-shrink-0 border-t border-[#e4e4e7]">
          <button
            onClick={onCancel}
            className="px-4 py-[9px] text-[13px] font-medium text-[#71717a] bg-[rgba(0,0,0,0.04)] border border-[#e4e4e7] rounded-[8px] hover:bg-[rgba(0,0,0,0.06)] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={missing.length > 0}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 transition-all shadow-[0_4px_16px_rgba(12,92,171,0.3)] disabled:opacity-40"
            style={{background: 'linear-gradient(135deg, #0c5cab, #0c5cab)'}}
          >
            Importar {preview.totalRows.toLocaleString()} filas
          </button>
        </div>
      </div>
    </div>
  );
}

interface GeoUploadResult {
  upserted: number;
  corrected: number;
  rejected: number;
  skipped_orphans: number;
  skipped_no_coords: number;
}

async function parseGeoFile(buffer: ArrayBuffer) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { cellDates: false, type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  function parseSerialDate(val: unknown): string | null {
    if (!val) return null;
    if (typeof val === 'number' && val > 0) {
      try {
        const d = XLSX.SSF.parse_date_code(val);
        return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      } catch { return null; }
    }
    const s = String(val).trim();
    return s ? s.slice(0, 10) : null;
  }

  return raw
    .map((r) => {
      const pdv_id = pickPdvId(r);
      if (!pdv_id || isNaN(pdv_id)) return null;
      const g = rowGetter(r);
      const lat = parseFloat(String(g('LATITUD') ?? ''));
      const lng = parseFloat(String(g('LONGITUD') ?? ''));
      const ruteableRaw = String(g('Ruteable') ?? '').toLowerCase();
      return {
        pdv_id,
        partido:      String(g('Partido')      ?? '').trim() || null,
        provincia:    String(g('Provincia')    ?? '').trim() || null,
        calle:        String(g('Calle')        ?? '').trim() || null,
        altura:       String(g('Altura')       ?? '').trim() || null,
        entre1:       String(g('Entre1')       ?? '').trim() || null,
        entre2:       String(g('Entre2')       ?? '').trim() || null,
        latitud:      isNaN(lat)  || lat  === 0 ? null : lat,
        longitud:     isNaN(lng)  || lng  === 0 ? null : lng,
        ruteable:     ruteableRaw === 'si' || ruteableRaw === 's'
          ? true
          : ruteableRaw === 'no' || ruteableRaw === 'n'
          ? false
          : null,
        domicilio_geo: String(g('Domicilio_GEO') ?? '').trim() || null,
        fecha_geo:    parseSerialDate(g('Fecha_GEO')),
        hora_geo:     String(g('Hora_GEO') ?? '').trim() || null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

function ResultBanner({ result, type }: { result: unknown; type: 'ventas' | 'pdvs' | 'maestros' | 'geo' }) {
  if (!result) return null;
  const baseCard = 'mt-4 p-4 rounded-2xl border text-[13px]';
  if (type === 'ventas') {
    const r = result as VentasUploadResult;
    return (
      <div className={`${baseCard} bg-[#16a34a]/[0.06] border-[#16a34a]/20`}>
        <p className="font-semibold text-[#16a34a] mb-1">Carga completada</p>
        <p className="text-[#27272a]">Insertados: <strong>{r.inserted}</strong> | Duplicados omitidos: <strong>{r.skipped}</strong></p>
        <p className="text-[#71717a] mt-0.5">Fechas afectadas: {r.fechas_afectadas.join(', ')}</p>
        {r.resumen_warning && (
          <div className="mt-2 p-2.5 rounded-xl bg-[#d97706]/[0.08] border border-[#d97706]/20">
            <p className="text-[#d97706] font-semibold">Advertencia</p>
            <p className="text-[#27272a] mt-0.5">{r.resumen_warning}</p>
          </div>
        )}
        {r.errors.length > 0 && (
          <div className="mt-2 text-[#dc2626]">
            <p className="font-semibold">Errores:</p>
            {r.errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}
      </div>
    );
  }
  if (type === 'pdvs') {
    const r = result as PdvsUploadResult;
    return (
      <div className={`${baseCard} bg-[#16a34a]/[0.06] border-[#16a34a]/20`}>
        <p className="font-semibold text-[#16a34a] mb-1">Clientes actualizados</p>
        <p className="text-[#27272a]">
          Total: {r.total} | Nuevos: {r.inserted} | Actualizados: {r.updated}
          {r.deactivated > 0 && <> | <span className="text-[#dc2626]">Dados de baja: {r.deactivated}</span></>}
          {(r.geo_eliminada ?? 0) > 0 && <> | <span className="text-[#71717a]">geo limpiada: {r.geo_eliminada}</span></>}
        </p>
        {r.reasignaciones.length > 0 && (
          <div className="mt-2">
            <p className="font-semibold text-[#d97706]">{r.reasignaciones.length} reasignación/es de cartera:</p>
            <ul className="mt-1 space-y-0.5">
              {r.reasignaciones.map((ra, i) => (
                <li key={i} className="text-[#71717a]">
                  PDV {ra.pdv_id} ({ra.razon_social}): {ra.vendedor_anterior} → {ra.vendedor_nuevo}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (type === 'maestros') {
    const r = result as MaestrosUploadResult;
    return (
      <div className={`${baseCard} bg-[#16a34a]/[0.06] border-[#16a34a]/20`}>
        <p className="font-semibold text-[#16a34a] mb-1">Maestro actualizado</p>
        <p className="text-[#27272a]">Vendedores cargados: <strong>{r.vendedores_upserted}</strong></p>
      </div>
    );
  }
  if (type === 'geo') {
    const r = result as GeoUploadResult;
    return (
      <div className={`${baseCard} bg-[#16a34a]/[0.06] border-[#16a34a]/20`}>
        <p className="font-semibold text-[#16a34a] mb-1">Geolocalización actualizada</p>
        <p className="text-[#27272a]">
          <strong>{r.upserted}</strong> PDVs actualizados
          {r.corrected > 0 && <span className="text-[#d97706]">, {r.corrected} corregidos al centro de su localidad</span>}
          {r.skipped_no_coords > 0 && <span className="text-[#71717a]">, {r.skipped_no_coords} ignorados sin coordenadas</span>}
          {r.skipped_orphans  > 0 && <span className="text-[#71717a]">, {r.skipped_orphans} ignorados (PDV no encontrado en base)</span>}
        </p>
        {r.rejected > 0 && (
          <p className="text-[#dc2626] mt-1">
            <strong>{r.rejected}</strong> rechazados por coordenada inválida sin forma de ubicarlos (sin localidad de referencia).
          </p>
        )}
      </div>
    );
  }
  return null;
}

function ReasignacionModal({
  reasignaciones, bajas, bajaMasiva, activosAntes, onConfirm, onCancel,
}: { reasignaciones: Reasignacion[]; bajas: number; bajaMasiva: boolean; activosAntes: number; onConfirm: () => void; onCancel: () => void }) {
  const pctBaja = activosAntes > 0 ? Math.round((bajas / activosAntes) * 100) : 0;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-[0_16px_48px_rgba(0,0,0,0.18)] max-w-lg w-full p-6">
        <h3 className="text-[17px] font-semibold text-[#09090b] mb-2">Confirmar carga de clientes</h3>

        {/* Aviso de bajas masivas (guardrail) */}
        {bajaMasiva && (
          <div className="mb-4 rounded-xl border border-[#dc2626]/30 bg-[#dc2626]/[0.07] px-4 py-3 text-[13px]">
            <p className="font-semibold text-[#dc2626]">Esta carga daría de baja a {bajas} de {activosAntes} PDVs del padrón ({pctBaja}%).</p>
            <p className="text-[#71717a] mt-1">
              Dar de baja = el PDV sale del padrón y deja de aparecer en el mapa, dashboards e
              insights (NO confundir con &quot;cliente inactivo&quot;, que es el que no compró hace +3 meses
              pero sigue en el padrón). El historial de ventas se conserva. Si subiste un archivo
              parcial o equivocado, cancelá. Si la base nueva es correcta, confirmá.
            </p>
          </div>
        )}

        {reasignaciones.length > 0 && (
          <>
        <p className="text-[13px] text-[#71717a] mb-2">Cambios de cartera detectados:</p>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-[#e4e4e7] divide-y divide-[#e4e4e7] text-[13px]">
          {reasignaciones.map((r, i) => (
            <div key={i} className="px-4 py-2.5">
              <span className="font-medium text-[#09090b]">PDV {r.pdv_id}</span>
              <span className="text-[#71717a]"> — {r.razon_social}</span>
              <br />
              <span className="text-[#71717a]">{r.vendedor_anterior}</span>{' '}
              <span className="text-[#71717a]">→</span>{' '}
              <span className="font-medium text-[#0c5cab]">{r.vendedor_nuevo}</span>
            </div>
          ))}
        </div>
          </>
        )}
        <div className="mt-5 flex gap-2.5 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-[9px] text-[13px] font-medium text-[#71717a] bg-[rgba(0,0,0,0.04)] border border-[#e4e4e7] rounded-[8px] hover:bg-[rgba(0,0,0,0.06)] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 transition-all shadow-[0_4px_16px_rgba(12,92,171,0.3)]"
            style={{background: 'linear-gradient(135deg, #0c5cab, #0c5cab)'}}
          >
            Confirmar y guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function HuerfanosModal({
  huerfanos, message, onConfirm, onCancel,
}: { huerfanos: string[]; message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-[0_16px_48px_rgba(0,0,0,0.18)] max-w-lg w-full p-6">
        <h3 className="text-[17px] font-semibold text-[#09090b] mb-2">Vendedores no encontrados en el maestro</h3>
        <p className="text-[13px] text-[#71717a] mb-3">
          {message || 'Estas ventas mencionan vendedores que no están en el maestro. Si confirmás, se cargan igual.'}
        </p>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-[#e4e4e7] divide-y divide-[#e4e4e7] text-[13px]">
          {huerfanos.map((h, i) => <div key={i} className="px-4 py-2 text-[#27272a]">{h}</div>)}
        </div>
        <div className="mt-5 flex gap-2.5 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-[9px] text-[13px] font-medium text-[#71717a] bg-[rgba(0,0,0,0.04)] border border-[#e4e4e7] rounded-[8px] hover:bg-[rgba(0,0,0,0.06)] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 transition-all shadow-[0_4px_16px_rgba(12,92,171,0.3)]"
            style={{ background: 'linear-gradient(135deg, #0c5cab, #0c5cab)' }}
          >
            Cargar igual
          </button>
        </div>
      </div>
    </div>
  );
}

export function CargarClient() {
  const [ventasLoading, setVentasLoading] = useState(false);
  const [ventasResult, setVentasResult] = useState<VentasUploadResult | null>(null);
  const [ventasError, setVentasError] = useState('');
  const [ventasPreview, setVentasPreview] = useState<VentasPreview | null>(null);
  const [ventasPendingFile, setVentasPendingFile] = useState<File | null>(null);
  const [huerfanosWarning, setHuerfanosWarning] = useState<{ huerfanos: string[]; message: string } | null>(null);

  const [pdvsLoading, setPdvsLoading] = useState(false);
  const [pdvsResult, setPdvsResult] = useState<PdvsUploadResult | null>(null);
  const [pdvsError, setPdvsError] = useState('');
  const [pdvsPendingRows, setPdvsPendingRows] = useState<unknown[] | null>(null);
  const [pdvsGeoRows, setPdvsGeoRows] = useState<unknown[]>([]); // filas geo del mismo archivo, a subir tras el maestro
  const [reasignaciones, setReasignaciones] = useState<Reasignacion[]>([]);
  const [pdvsBajas, setPdvsBajas] = useState(0);
  const [pdvsBajaMasiva, setPdvsBajaMasiva] = useState(false);
  const [pdvsActivosAntes, setPdvsActivosAntes] = useState(0);

  const [maestrosLoading, setMaestrosLoading] = useState(false);
  const [maestrosResult, setMaestrosResult] = useState<MaestrosUploadResult | null>(null);
  const [maestrosError, setMaestrosError] = useState('');

  const [geoLoading, setGeoLoading] = useState(false);
  const [geoResult,  setGeoResult]  = useState<GeoUploadResult | null>(null);
  const [geoError,   setGeoError]   = useState('');

  const [borrarMes,  setBorrarMes]  = useState(new Date().getMonth() + 1);
  const [borrarAnio, setBorrarAnio] = useState(new Date().getFullYear());
  const [borrarLoading,    setBorrarLoading]    = useState(false);
  const [borrarResult,     setBorrarResult]     = useState('');
  const [borrarConfirm,    setBorrarConfirm]    = useState(false);
  const [recalcLoading,    setRecalcLoading]    = useState(false);

  // Bloquear el scroll del fondo mientras hay un modal abierto (si no, la página
  // de atrás scrollea y se ve mal).
  useEffect(() => {
    const abierto = ventasPreview !== null || pdvsPendingRows !== null || huerfanosWarning !== null;
    if (!abierto) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [ventasPreview, pdvsPendingRows, huerfanosWarning]);

  async function handleBorrarMes() {
    if (!borrarConfirm) { setBorrarConfirm(true); return; }
    setBorrarLoading(true); setBorrarResult('');
    const res = await fetch('/api/admin/borrar-mes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anio: borrarAnio, mes: borrarMes }),
    });
    const data = await res.json();
    setBorrarLoading(false); setBorrarConfirm(false);
    setBorrarResult(res.ok ? `✓ Datos de ${MESES[borrarMes - 1]} ${borrarAnio} eliminados.` : `Error: ${data.error}`);
  }

  async function handleRecalcular() {
    setRecalcLoading(true); setBorrarResult('');
    const res = await fetch('/api/admin/recalcular-resumen', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anio: borrarAnio, mes: borrarMes }),
    });
    const data = await res.json();
    setRecalcLoading(false);
    setBorrarResult(res.ok ? `✓ Resumen recalculado para ${data.fechas_procesadas} fechas.` : `Error: ${data.error}`);
  }

  async function handleVentasFile(file: File) {
    setVentasError(''); setVentasResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const { getVentasPreview } = await import('@/lib/excel/parser');
      const preview = getVentasPreview(buffer);
      if (preview.totalRows === 0) throw new Error('No se encontraron filas en el archivo.');
      setVentasPendingFile(file); // guardar el File, no el buffer consumido
      setVentasPreview(preview);
    } catch (e) { setVentasError(e instanceof Error ? e.message : String(e)); }
  }

  async function confirmVentasUpload(confirmedHuerfanos = false) {
    if (!ventasPendingFile) return;
    // Cerrar SIEMPRE los modales al confirmar; el progreso/resultado va en la sección.
    setVentasPreview(null); setHuerfanosWarning(null);
    setVentasLoading(true); setVentasError(''); setVentasResult(null);
    try {
      const formData = new FormData();
      formData.append('file', ventasPendingFile);
      if (confirmedHuerfanos) formData.append('confirmed', 'true');
      const res = await fetch('/api/admin/ventas/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar ventas.');
      // El server pide confirmar por vendedores huérfanos → mostrar ese modal.
      // NO limpiar el archivo: se reusa en el reintento confirmado.
      if (data.requires_confirmation && Array.isArray(data.huerfanos)) {
        setHuerfanosWarning({ huerfanos: data.huerfanos, message: data.message ?? '' });
        return;
      }
      setVentasResult(data);
      setVentasPendingFile(null);
    } catch (e) {
      setVentasError(e instanceof Error ? e.message : String(e));
      setVentasPendingFile(null);
    } finally { setVentasLoading(false); }
  }

  // Sube la geo (pdvs_geo) DESPUÉS del maestro: el FK exige que pdvs.id ya exista.
  // Si el archivo no traía coordenadas (ej. export "SIN GEOLOCALIZACION"), no hace nada.
  async function runGeoUpload(geoRows: unknown[]) {
    if (!geoRows || geoRows.length === 0) return;
    setGeoLoading(true); setGeoError(''); setGeoResult(null);
    try {
      const res = await fetch('/api/admin/pdvs-geo/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: geoRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar geolocalización.');
      setGeoResult(data);
    } catch (e) { setGeoError(e instanceof Error ? e.message : String(e)); }
    finally { setGeoLoading(false); }
  }

  // Carga unificada: un solo archivo alimenta el maestro (pdvs) y, si trae
  // LATITUD/LONGITUD, también la geo (pdvs_geo). El export geolocalizado es
  // superset del maestro; el "SIN GEOLOCALIZACION" cae solo → solo maestro.
  async function handlePdvsFile(file: File) {
    setPdvsLoading(true); setPdvsError(''); setPdvsResult(null); setGeoResult(null); setGeoError('');
    try {
      const buffer = await file.arrayBuffer();
      const rows = await parsePdvFile(buffer);
      if (rows.length === 0) throw new Error('No se encontraron filas válidas en el archivo.');
      // Filas geo del MISMO archivo: solo las que traen coordenadas reales.
      const geoRows = (await parseGeoFile(buffer)).filter((r) => r.latitud != null && r.longitud != null);
      const res = await fetch('/api/admin/pdvs/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, confirmed: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al procesar clientes.');
      if (data.requires_confirmation) {
        setPdvsPendingRows(rows);
        setPdvsGeoRows(geoRows); // recordar la geo para subirla tras confirmar
        setReasignaciones(data.reasignaciones ?? []);
        setPdvsBajas(data.bajas ?? 0);
        setPdvsBajaMasiva(data.baja_masiva ?? false);
        setPdvsActivosAntes(data.activos_antes ?? 0);
        setPdvsLoading(false); return;
      }
      setPdvsResult(data);
      await runGeoUpload(geoRows); // maestro OK → subir geo del mismo archivo
    } catch (e) { setPdvsError(e instanceof Error ? e.message : String(e)); }
    finally { setPdvsLoading(false); }
  }

  async function confirmPdvsUpload() {
    if (!pdvsPendingRows) return;
    // Cerrar el modal al instante (como el de ventas): el progreso y el resultado
    // se ven en la sección. Antes quedaba abierto hasta terminar la subida.
    const rows = pdvsPendingRows;
    const geoRows = pdvsGeoRows;
    setPdvsPendingRows(null); setReasignaciones([]); setPdvsBajaMasiva(false);
    setPdvsLoading(true); setPdvsError('');
    try {
      const res = await fetch('/api/admin/pdvs/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, confirmed: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar clientes.');
      setPdvsResult(data);
      await runGeoUpload(geoRows); // maestro confirmado → subir geo del mismo archivo
      setPdvsGeoRows([]);
    } catch (e) { setPdvsError(e instanceof Error ? e.message : String(e)); }
    finally { setPdvsLoading(false); }
  }

  async function handleMaestrosFile(file: File) {
    setMaestrosLoading(true); setMaestrosError(''); setMaestrosResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const { parseMaestrosFile } = await import('@/lib/excel/parser');
      const vendedores = parseMaestrosFile(buffer);
      if (vendedores.length === 0) throw new Error('No se encontraron filas de vendedores en el archivo.');
      const res = await fetch('/api/admin/maestros/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendedores }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar maestro de vendedores.');
      setMaestrosResult(data);
    } catch (e) { setMaestrosError(e instanceof Error ? e.message : String(e)); }
    finally { setMaestrosLoading(false); }
  }

  const MESES =['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const currentYear = new Date().getFullYear();

  const selectCls = [
    'px-3 py-[7px] text-[13px] font-medium w-full',
    'bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[8px]',
    'text-[#09090b] focus:outline-none focus:border-[rgba(12,92,171,0.4)] focus:bg-[rgba(0,0,0,0.03)]',
    'transition-all',
  ].join(' ');

  return (
    <div className="max-w-4xl mx-auto space-y-7">
      <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">Cargar Archivos</h1>

      <section className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 p-6">
        <h2 className="text-[15px] font-semibold text-[#09090b] mb-0.5">Ventas diarias</h2>
        <p className="text-[12px] text-[#71717a] mb-4">Archivo Excel con las ventas del día (.xlsx)</p>
        <DropZone label="Ventas diarias" accept=".xlsx,.xls,.xlsb" onFile={handleVentasFile} loading={ventasLoading}
          hint="Podés subir uno o varios meses juntos; las filas repetidas no se duplican." />
        {ventasError && <p className="mt-3 text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[10px]">{ventasError}</p>}
        <ResultBanner result={ventasResult} type="ventas" />
      </section>

      <section className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 p-6">
        <h2 className="text-[15px] font-semibold text-[#09090b] mb-0.5">Maestro de Clientes (PDVs)</h2>
        <p className="text-[12px] text-[#71717a] mb-4">Padrón de puntos de venta (.xlsx). Si el archivo trae LATITUD/LONGITUD, en la misma carga se actualiza el mapa.</p>
        <DropZone label="Maestro de Clientes" accept=".xlsx,.xls,.xlsb" onFile={handlePdvsFile} loading={pdvsLoading || geoLoading}
          hint="Columnas: PDV, Razon Social, Cartera, Zona, Canal, CUIT... (opcional: LATITUD, LONGITUD para el mapa)" />
        {pdvsError && <p className="mt-3 text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[10px]">{pdvsError}</p>}
        <ResultBanner result={pdvsResult} type="pdvs" />
        {geoError && <p className="mt-3 text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[10px]">{geoError}</p>}
        <ResultBanner result={geoResult} type="geo" />
      </section>

      <section className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 p-6">
        <h2 className="text-[15px] font-semibold text-[#09090b] mb-0.5">Maestro de Vendedores</h2>
        <p className="text-[12px] text-[#71717a] mb-4">Archivo Excel con el listado de vendedores (.xlsx / .xlsb)</p>
        <DropZone label="Maestro de Vendedores" accept=".xlsb,.xlsx,.xls"
          onFile={handleMaestrosFile} loading={maestrosLoading}
          hint="Columnas: Nombre, Supervisor, Equipo, Localidad" />
        {maestrosError && <p className="mt-3 text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[10px]">{maestrosError}</p>}
        <ResultBanner result={maestrosResult} type="maestros" />
      </section>

      <section className="bg-[#ffffff] rounded-2xl border border-[#dc2626]/30 shadow-xl shadow-black/5 p-6">
        <h2 className="text-[15px] font-semibold text-[#dc2626] mb-0.5">Zona de peligro</h2>
        <p className="text-[12px] text-[#71717a] mb-4">Borra todas las ventas y el resumen de un mes. Irreversible.</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Mes</label>
            <Select value={borrarMes} onChange={e => { setBorrarMes(Number(e.target.value)); setBorrarConfirm(false); }}>
              {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Año</label>
            <Select value={borrarAnio} onChange={e => { setBorrarAnio(Number(e.target.value)); setBorrarConfirm(false); }}>
              {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          <button
            onClick={handleBorrarMes}
            disabled={borrarLoading || recalcLoading}
            className={`px-4 py-[9px] text-[13px] font-semibold rounded-[10px] transition-colors disabled:opacity-50 ${
              borrarConfirm
                ? 'bg-[#dc2626] text-white hover:brightness-110'
                : 'bg-[#dc2626]/[0.1] text-[#dc2626] border border-[#dc2626]/20 hover:bg-[#dc2626]/[0.18]'
            }`}
          >
            {borrarLoading ? 'Borrando...' : borrarConfirm ? '¿Confirmar?' : 'Borrar mes'}
          </button>
          <button
            onClick={handleRecalcular}
            disabled={recalcLoading || borrarLoading}
            className="px-4 py-[9px] text-[13px] font-semibold text-[#0c5cab] bg-[rgba(12,92,171,0.08)] border border-[rgba(12,92,171,0.2)] rounded-[10px] hover:bg-[rgba(12,92,171,0.14)] transition-colors disabled:opacity-50"
          >
            {recalcLoading ? 'Recalculando...' : 'Recalcular resumen'}
          </button>
        </div>
        {borrarResult && (
          <p className={`mt-3 text-[13px] px-3 py-2 rounded-[10px] border ${borrarResult.startsWith('✓') ? 'text-[#16a34a] bg-[#16a34a]/[0.08] border-[#16a34a]/20' : 'text-[#dc2626] bg-[#dc2626]/[0.08] border-[#dc2626]/20'}`}>
            {borrarResult}
          </p>
        )}
      </section>

      {ventasPreview && (
        <VentasPreviewModal
          preview={ventasPreview}
          onConfirm={() => confirmVentasUpload(false)}
          onCancel={() => { setVentasPreview(null); setVentasPendingFile(null); }}
        />
      )}

      {huerfanosWarning && (
        <HuerfanosModal
          huerfanos={huerfanosWarning.huerfanos}
          message={huerfanosWarning.message}
          onConfirm={() => confirmVentasUpload(true)}
          onCancel={() => { setHuerfanosWarning(null); setVentasPendingFile(null); }}
        />
      )}

      {pdvsPendingRows !== null && (
        <ReasignacionModal
          reasignaciones={reasignaciones}
          bajas={pdvsBajas}
          bajaMasiva={pdvsBajaMasiva}
          activosAntes={pdvsActivosAntes}
          onConfirm={confirmPdvsUpload}
          onCancel={() => { setReasignaciones([]); setPdvsPendingRows(null); setPdvsGeoRows([]); setPdvsBajaMasiva(false); }}
        />
      )}
    </div>
  );
}

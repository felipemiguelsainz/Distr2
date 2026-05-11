'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { DropZone } from '@/components/upload/DropZone';
import { parseMaestrosFile, getVentasPreview, VentasPreview } from '@/lib/excel/parser';
import { Select } from '@/components/ui/Select';
import {
  VentasUploadResult,
  PdvsUploadResult,
  MaestrosUploadResult,
  Reasignacion,
} from '@/lib/types';

function parsePdvFile(buffer: ArrayBuffer) {
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
      const id = parseInt(String(r['PDV'] ?? r['Cod. Cliente'] ?? r['COD_CLIENTE'] ?? ''), 10);
      if (!id || isNaN(id)) return null;
      const activoRaw = r['Activo'] ?? r['ACTIVO'];
      const activo = activoRaw === undefined
        ? true
        : String(activoRaw).toLowerCase() !== 'false' &&
          String(activoRaw) !== '0' &&
          String(activoRaw).toLowerCase() !== 'no';
      return {
        id,
        razon_social:       String(r['Razon Social'] ?? r['Razón Social'] ?? '').trim(),
        domicilio:          String(r['Domicilio'] ?? '').trim(),
        localidad:          String(r['Localidad'] ?? '').trim(),
        zona:               String(r['Zona'] ?? '').trim(),
        canal_distribucion: String(r['Canal Distribución'] ?? r['Canal Distribucion'] ?? '').trim(),
        canal_venta:        String(r['Canal Venta'] ?? '').trim(),
        categoria_iva:      String(r['Categoría IVA'] ?? r['Categoria IVA'] ?? '').trim(),
        cuit:               String(r['CUIT'] ?? '').trim(),
        cartera:            String(r['Cartera'] ?? '').trim(),
        fecha_alta:         parseDate(r['Fecha Alta']),
        ultima_vta:         parseDate(r['Ultima Vta'] ?? r['Última Vta']),
        activo,
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
      <div className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-[0_20px_60px_rgba(0,0,0,0.6)] max-w-lg w-full flex flex-col max-h-[90vh]">
        <div className="p-6 pb-4 flex-shrink-0">
          <h3 className="text-[17px] font-semibold text-[#f0f4ff] mb-1">Confirmar importación de ventas</h3>
          <p className="text-[13px] text-[#6b85a8]">
            {preview.totalRows.toLocaleString()} filas detectadas. Verificá que los campos se mapeen correctamente.
          </p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-2">

        {missing.length > 0 && (
          <div className="mb-4 px-3.5 py-2.5 rounded-[10px] bg-[#f87171]/[0.08] border border-[#f87171]/30 text-[12px] text-[#f87171] font-medium">
            ⚠ Campos requeridos no encontrados: {missing.map(m => m.label).join(', ')}
          </div>
        )}

        {/* Field mapping */}
        <div className="rounded-xl border border-[#1a2d4a] overflow-hidden text-[12px] mb-4">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#0f1e38]/80 border-b border-[#1a2d4a]">
                <th className="px-3 py-2 text-left font-semibold text-[#6b85a8] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Campo</th>
                <th className="px-3 py-2 text-left font-semibold text-[#6b85a8] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Columna Excel</th>
                <th className="px-3 py-2 text-left font-semibold text-[#6b85a8] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Ejemplo fila 1</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2d4a]">
              {preview.mappings.map(m => (
                <tr key={m.field} className={m.ok ? '' : 'bg-[#f87171]/[0.05]'}>
                  <td className="px-3 py-2 font-medium text-[#c8d8f0]">{m.label}</td>
                  <td className="px-3 py-2">
                    {m.excelCol
                      ? <span className="text-[#14b8a6] font-medium">{m.excelCol}</span>
                      : <span className="text-[#f87171]">No encontrado</span>}
                  </td>
                  <td className="px-3 py-2 text-[#6b85a8]">{m.value || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* All columns in the file */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8] mb-1" style={{fontFamily: "'JetBrains Mono', monospace"}}>Todas las columnas del archivo</p>
        <div className="rounded-xl border border-[#1a2d4a] overflow-x-auto text-[12px] mb-4 max-h-48 overflow-y-auto">
          <table className="min-w-full">
            <thead className="sticky top-0 bg-[#0f1e38]">
              <tr className="border-b border-[#1a2d4a]">
                <th className="px-3 py-2 text-left font-semibold text-[#6b85a8] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Nombre columna</th>
                <th className="px-3 py-2 text-left font-semibold text-[#6b85a8] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Fila 1</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2d4a]">
              {preview.allColumns.map(c => (
                <tr key={c.name}>
                  <td className="px-3 py-1.5 text-[11px] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>{c.name}</td>
                  <td className="px-3 py-1.5 text-[#6b85a8]">{c.sample || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Parsed kilos/neto sample */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8] mb-1" style={{fontFamily: "'JetBrains Mono', monospace"}}>Primeras 5 filas parseadas</p>
        <div className="rounded-xl border border-[#1a2d4a] overflow-hidden text-[12px] mb-5">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#0f1e38]/80 border-b border-[#1a2d4a]">
                <th className="px-3 py-2 text-left font-semibold text-[#6b85a8] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Fila</th>
                <th className="px-3 py-2 text-right font-semibold text-[#6b85a8] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Kilos</th>
                <th className="px-3 py-2 text-right font-semibold text-[#6b85a8] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Neto $</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2d4a]">
              {preview.parsedSample.map((s, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 text-[#6b85a8]">{i + 1}</td>
                  <td className={`px-3 py-1.5 text-right ${s.kilos < 0 ? 'text-[#f87171]' : s.kilos === 0 ? 'text-[#6b85a8]' : 'text-[#c8d8f0]'}`} style={{fontFamily: "'JetBrains Mono', monospace"}}>{s.kilos}</td>
                  <td className={`px-3 py-1.5 text-right ${s.neto  < 0 ? 'text-[#f87171]' : s.neto  === 0 ? 'text-[#6b85a8]' : 'text-[#c8d8f0]'}`} style={{fontFamily: "'JetBrains Mono', monospace"}}>{s.neto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Kilos summary */}
        <div className="rounded-xl border border-[#1a2d4a] p-3.5 mb-4 text-[12px] space-y-1.5">
          <p className="font-semibold text-[#6b85a8] text-[10px] uppercase tracking-[0.08em] mb-2" style={{fontFamily: "'JetBrains Mono', monospace"}}>Resumen de kilos en el archivo</p>
          <div className="flex justify-between">
            <span className="text-[#6b85a8]">Filas con ventas (+)</span>
            <span className="font-semibold text-[#c8d8f0]">{preview.rowsPos.toLocaleString()} filas — {preview.kilosTotalPos.toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6b85a8]">Filas con devoluciones (−)</span>
            <span className="font-semibold text-[#f87171]">{preview.rowsNeg.toLocaleString()} filas — {preview.kilosTotalNeg.toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg</span>
          </div>
          <div className="flex justify-between border-t border-[#1a2d4a] pt-1.5">
            <span className="text-[#6b85a8] font-medium">Neto</span>
            <span className={`font-bold ${(preview.kilosTotalPos + preview.kilosTotalNeg) < 0 ? 'text-[#f87171]' : 'text-[#f0f4ff]'}`}>
              {(preview.kilosTotalPos + preview.kilosTotalNeg).toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg
            </span>
          </div>
        </div>

        </div>{/* end scrollable */}

        <div className="p-6 pt-4 flex gap-2.5 justify-end flex-shrink-0 border-t border-[#1a2d4a]">
          <button
            onClick={onCancel}
            className="px-4 py-[9px] text-[13px] font-medium text-[#6b85a8] bg-[rgba(255,255,255,0.04)] border border-[#1a2d4a] rounded-[8px] hover:bg-[rgba(255,255,255,0.07)] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={missing.length > 0}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 transition-all shadow-[0_4px_16px_rgba(99,102,241,0.3)] disabled:opacity-40"
            style={{background: 'linear-gradient(135deg, #3b82f6, #6366f1)'}}
          >
            Importar {preview.totalRows.toLocaleString()} filas
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultBanner({ result, type }: { result: unknown; type: 'ventas' | 'pdvs' | 'maestros' }) {
  if (!result) return null;
  const baseCard = 'mt-4 p-4 rounded-2xl border text-[13px]';
  if (type === 'ventas') {
    const r = result as VentasUploadResult;
    return (
      <div className={`${baseCard} bg-[#14b8a6]/[0.06] border-[#14b8a6]/20`}>
        <p className="font-semibold text-[#14b8a6] mb-1">Carga completada</p>
        <p className="text-[#c8d8f0]">Insertados: <strong>{r.inserted}</strong> | Duplicados omitidos: <strong>{r.skipped}</strong></p>
        <p className="text-[#6b85a8] mt-0.5">Fechas afectadas: {r.fechas_afectadas.join(', ')}</p>
        {r.errors.length > 0 && (
          <div className="mt-2 text-[#f87171]">
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
      <div className={`${baseCard} bg-[#14b8a6]/[0.06] border-[#14b8a6]/20`}>
        <p className="font-semibold text-[#14b8a6] mb-1">Clientes actualizados</p>
        <p className="text-[#c8d8f0]">Total: {r.total} | Nuevos: {r.inserted} | Actualizados: {r.updated}</p>
        {r.reasignaciones.length > 0 && (
          <div className="mt-2">
            <p className="font-semibold text-[#f59e0b]">{r.reasignaciones.length} reasignación/es de cartera:</p>
            <ul className="mt-1 space-y-0.5">
              {r.reasignaciones.map((ra, i) => (
                <li key={i} className="text-[#6b85a8]">
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
      <div className={`${baseCard} bg-[#14b8a6]/[0.06] border-[#14b8a6]/20`}>
        <p className="font-semibold text-[#14b8a6] mb-1">Maestro actualizado</p>
        <p className="text-[#c8d8f0]">Vendedores cargados: <strong>{r.vendedores_upserted}</strong></p>
      </div>
    );
  }
  return null;
}

function ReasignacionModal({
  reasignaciones, onConfirm, onCancel,
}: { reasignaciones: Reasignacion[]; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-[0_20px_60px_rgba(0,0,0,0.6)] max-w-lg w-full p-6">
        <h3 className="text-[17px] font-semibold text-[#f0f4ff] mb-2">Confirmar reasignaciones de cartera</h3>
        <p className="text-[13px] text-[#6b85a8] mb-4">Se detectaron los siguientes cambios de cartera. ¿Confirmar?</p>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-[#1a2d4a] divide-y divide-[#1a2d4a] text-[13px]">
          {reasignaciones.map((r, i) => (
            <div key={i} className="px-4 py-2.5">
              <span className="font-medium text-[#f0f4ff]">PDV {r.pdv_id}</span>
              <span className="text-[#6b85a8]"> — {r.razon_social}</span>
              <br />
              <span className="text-[#6b85a8]">{r.vendedor_anterior}</span>{' '}
              <span className="text-[#6b85a8]">→</span>{' '}
              <span className="font-medium text-[#3b82f6]">{r.vendedor_nuevo}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-2.5 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-[9px] text-[13px] font-medium text-[#6b85a8] bg-[rgba(255,255,255,0.04)] border border-[#1a2d4a] rounded-[8px] hover:bg-[rgba(255,255,255,0.07)] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 transition-all shadow-[0_4px_16px_rgba(99,102,241,0.3)]"
            style={{background: 'linear-gradient(135deg, #3b82f6, #6366f1)'}}
          >
            Confirmar y guardar
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

  const [pdvsLoading, setPdvsLoading] = useState(false);
  const [pdvsResult, setPdvsResult] = useState<PdvsUploadResult | null>(null);
  const [pdvsError, setPdvsError] = useState('');
  const [pdvsPendingRows, setPdvsPendingRows] = useState<unknown[] | null>(null);
  const [reasignaciones, setReasignaciones] = useState<Reasignacion[]>([]);

  const [maestrosLoading, setMaestrosLoading] = useState(false);
  const [maestrosResult, setMaestrosResult] = useState<MaestrosUploadResult | null>(null);
  const [maestrosError, setMaestrosError] = useState('');

  const [borrarMes,  setBorrarMes]  = useState(new Date().getMonth() + 1);
  const [borrarAnio, setBorrarAnio] = useState(new Date().getFullYear());
  const [borrarLoading,    setBorrarLoading]    = useState(false);
  const [borrarResult,     setBorrarResult]     = useState('');
  const [borrarConfirm,    setBorrarConfirm]    = useState(false);
  const [recalcLoading,    setRecalcLoading]    = useState(false);

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
      const preview = getVentasPreview(buffer);
      if (preview.totalRows === 0) throw new Error('No se encontraron filas en el archivo.');
      setVentasPendingFile(file); // guardar el File, no el buffer consumido
      setVentasPreview(preview);
    } catch (e) { setVentasError(e instanceof Error ? e.message : String(e)); }
  }

  async function confirmVentasUpload() {
    if (!ventasPendingFile) return;
    setVentasPreview(null);
    setVentasLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', ventasPendingFile);
      const res = await fetch('/api/ventas/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar ventas.');
      setVentasResult(data);
    } catch (e) { setVentasError(e instanceof Error ? e.message : String(e)); }
    finally { setVentasLoading(false); setVentasPendingFile(null); }
  }

  async function handlePdvsFile(file: File) {
    setPdvsLoading(true); setPdvsError(''); setPdvsResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const rows = parsePdvFile(buffer);
      if (rows.length === 0) throw new Error('No se encontraron filas válidas en el archivo.');
      const res = await fetch('/api/pdvs/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, confirmed: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al procesar clientes.');
      if (data.requires_confirmation) {
        setPdvsPendingRows(rows); setReasignaciones(data.reasignaciones);
        setPdvsLoading(false); return;
      }
      setPdvsResult(data);
    } catch (e) { setPdvsError(e instanceof Error ? e.message : String(e)); }
    finally { setPdvsLoading(false); }
  }

  async function confirmPdvsUpload() {
    if (!pdvsPendingRows) return;
    setPdvsLoading(true);
    try {
      const res = await fetch('/api/pdvs/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: pdvsPendingRows, confirmed: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar clientes.');
      setPdvsResult(data); setReasignaciones([]); setPdvsPendingRows(null);
    } catch (e) { setPdvsError(e instanceof Error ? e.message : String(e)); }
    finally { setPdvsLoading(false); }
  }

  async function handleMaestrosFile(file: File) {
    setMaestrosLoading(true); setMaestrosError(''); setMaestrosResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const vendedores = parseMaestrosFile(buffer);
      if (vendedores.length === 0) throw new Error('No se encontraron filas de vendedores en el archivo.');
      const res = await fetch('/api/maestros/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendedores }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar maestro de vendedores.');
      setMaestrosResult(data);
    } catch (e) { setMaestrosError(e instanceof Error ? e.message : String(e)); }
    finally { setMaestrosLoading(false); }
  }

  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const currentYear = new Date().getFullYear();

  const selectCls = [
    'px-3 py-[7px] text-[13px] font-medium w-full',
    'bg-[rgba(255,255,255,0.02)] border border-[#1a2d4a] rounded-[8px]',
    'text-[#f0f4ff] focus:outline-none focus:border-[rgba(99,102,241,0.4)] focus:bg-[rgba(255,255,255,0.03)]',
    'transition-all',
  ].join(' ');

  return (
    <div className="max-w-4xl mx-auto space-y-7">
      <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#f0f4ff]">Cargar Archivos</h1>

      <section className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30 p-6">
        <h2 className="text-[15px] font-semibold text-[#f0f4ff] mb-0.5">Ventas diarias</h2>
        <p className="text-[12px] text-[#6b85a8] mb-4">Archivo Excel con las ventas del día (.xlsx)</p>
        <DropZone label="Ventas diarias" accept=".xlsx,.xls" onFile={handleVentasFile} loading={ventasLoading}
          hint="Columnas: Fecha, PDV, Vendedor, Comprobante, SKU, Kilos, Neto..." />
        {ventasError && <p className="mt-3 text-[13px] text-[#f87171] bg-[#f87171]/[0.08] border border-[#f87171]/20 px-3 py-2 rounded-[10px]">{ventasError}</p>}
        <ResultBanner result={ventasResult} type="ventas" />
      </section>

      <section className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30 p-6">
        <h2 className="text-[15px] font-semibold text-[#f0f4ff] mb-0.5">Maestro de Clientes (PDVs)</h2>
        <p className="text-[12px] text-[#6b85a8] mb-4">Archivo Excel con el padrón de puntos de venta (.xlsx)</p>
        <DropZone label="Maestro de Clientes" accept=".xlsx,.xls" onFile={handlePdvsFile} loading={pdvsLoading}
          hint="Columnas: PDV, Razon Social, Cartera, Zona, Canal, CUIT..." />
        {pdvsError && <p className="mt-3 text-[13px] text-[#f87171] bg-[#f87171]/[0.08] border border-[#f87171]/20 px-3 py-2 rounded-[10px]">{pdvsError}</p>}
        <ResultBanner result={pdvsResult} type="pdvs" />
      </section>

      <section className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30 p-6">
        <h2 className="text-[15px] font-semibold text-[#f0f4ff] mb-0.5">Maestro de Vendedores</h2>
        <p className="text-[12px] text-[#6b85a8] mb-4">Archivo Excel con el listado de vendedores (.xlsx / .xlsb)</p>
        <DropZone label="Maestro de Vendedores" accept=".xlsb,.xlsx,.xls"
          onFile={handleMaestrosFile} loading={maestrosLoading}
          hint="Columnas: Nombre, Supervisor, Equipo, Localidad" />
        {maestrosError && <p className="mt-3 text-[13px] text-[#f87171] bg-[#f87171]/[0.08] border border-[#f87171]/20 px-3 py-2 rounded-[10px]">{maestrosError}</p>}
        <ResultBanner result={maestrosResult} type="maestros" />
      </section>

      <section className="bg-[#0b1528] rounded-2xl border border-[#f87171]/30 shadow-xl shadow-black/30 p-6">
        <h2 className="text-[15px] font-semibold text-[#f87171] mb-0.5">Zona de peligro</h2>
        <p className="text-[12px] text-[#6b85a8] mb-4">Borra todas las ventas y el resumen de un mes. Irreversible.</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Mes</label>
            <Select value={borrarMes} onChange={e => { setBorrarMes(Number(e.target.value)); setBorrarConfirm(false); }}>
              {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Año</label>
            <Select value={borrarAnio} onChange={e => { setBorrarAnio(Number(e.target.value)); setBorrarConfirm(false); }}>
              {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          <button
            onClick={handleBorrarMes}
            disabled={borrarLoading || recalcLoading}
            className={`px-4 py-[9px] text-[13px] font-semibold rounded-[10px] transition-colors disabled:opacity-50 ${
              borrarConfirm
                ? 'bg-[#f87171] text-white hover:brightness-110'
                : 'bg-[#f87171]/[0.1] text-[#f87171] border border-[#f87171]/20 hover:bg-[#f87171]/[0.18]'
            }`}
          >
            {borrarLoading ? 'Borrando...' : borrarConfirm ? '¿Confirmar?' : 'Borrar mes'}
          </button>
          <button
            onClick={handleRecalcular}
            disabled={recalcLoading || borrarLoading}
            className="px-4 py-[9px] text-[13px] font-semibold text-[#3b82f6] bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-[10px] hover:bg-[rgba(59,130,246,0.14)] transition-colors disabled:opacity-50"
          >
            {recalcLoading ? 'Recalculando...' : 'Recalcular resumen'}
          </button>
        </div>
        {borrarResult && (
          <p className={`mt-3 text-[13px] px-3 py-2 rounded-[10px] border ${borrarResult.startsWith('✓') ? 'text-[#14b8a6] bg-[#14b8a6]/[0.08] border-[#14b8a6]/20' : 'text-[#f87171] bg-[#f87171]/[0.08] border-[#f87171]/20'}`}>
            {borrarResult}
          </p>
        )}
      </section>

      {ventasPreview && (
        <VentasPreviewModal
          preview={ventasPreview}
          onConfirm={confirmVentasUpload}
          onCancel={() => { setVentasPreview(null); setVentasPendingFile(null); }}
        />
      )}

      {reasignaciones.length > 0 && (
        <ReasignacionModal
          reasignaciones={reasignaciones}
          onConfirm={confirmPdvsUpload}
          onCancel={() => { setReasignaciones([]); setPdvsPendingRows(null); }}
        />
      )}
    </div>
  );
}

/**
 * Trabajos diarios pesados que NO entran en Vercel free (límite 10s/función):
 *   1) geo-fix: re-geocodifica los PDV imprecisos nuevos (Nominatim, 1 req/seg).
 *   2) insights: genera el análisis diario PROFUNDO con Sonnet para cada scope.
 *
 * Pensado para correr en GitHub Actions (cron nocturno, sin límite de tiempo).
 * La app de Vercel sólo SIRVE lo que este job dejó cacheado en Supabase.
 *
 * Uso local:  npx ts-node -T -P tsconfig.scripts.json -r tsconfig-paths/register scripts/daily-jobs.ts
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
 *      AI_PROVIDER=anthropic. Opcional: INSIGHTS_MODEL (default claude-sonnet-5),
 *      INSIGHTS_LIMIT (para probar con pocos scopes).
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { getOrCreateInsight } from '@/lib/ai/insights';
import { fixParkedGeo } from '@/lib/geo/regeocode';

// Cargar .env.local si existe (en local; en CI las vars vienen del entorno).
try {
  for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* en CI no hay .env.local */ }

// Chequeo temprano y claro de las variables requeridas (evita el críptico
// "supabaseUrl is required" y dice EXACTAMENTE cuál falta).
const REQUERIDAS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY'] as const;
const faltan = REQUERIDAS.filter((k) => !process.env[k]);
if (faltan.length) {
  console.error(
    `\n✗ Faltan variables de entorno: ${faltan.join(', ')}.\n` +
    `  En GitHub: repo → Settings → Secrets and variables → Actions → pestaña "Secrets"\n` +
    `  (NO "Variables"), botón "New repository secret". La URL de Supabase ya viene\n` +
    `  hardcodeada en el workflow, así que sólo necesitás SUPABASE_SERVICE_ROLE_KEY y ANTHROPIC_API_KEY.\n`,
  );
  process.exit(1);
}

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const MODEL = process.env.INSIGHTS_MODEL || 'claude-sonnet-5';
const LIMIT = process.env.INSIGHTS_LIMIT ? Number(process.env.INSIGHTS_LIMIT) : Infinity;

async function geoFix() {
  console.log('=== 1. geo-fix (PDV imprecisos nuevos) ===');
  let total = 0, r;
  do { r = await fixParkedGeo(svc as never, 20); total += r.procesados; if (r.procesados) console.log('  ', r); } while (r.procesados > 0);
  console.log(`  geo-fix: ${total} procesados.\n`);
}

async function insights() {
  const today = new Date();
  // Los scopes salen de la tabla `vendedores` (activos) — la MISMA fuente que el
  // dropdown de la app (app/insights/page.tsx). Así se genera un insight por cada
  // vendedor seleccionable (no quedan vendedores sin cache). No derivar de
  // pdvs.cartera: PostgREST topa en 1000 filas y sólo veríamos unas pocas carteras.
  const { data: vends } = await svc.from('vendedores').select('nombre, equipo').eq('activo', true).order('nombre');
  const carteras = [...new Set(((vends ?? []) as { nombre: string }[]).map((v) => v.nombre))].filter(Boolean).sort();
  const equipos = new Map<string, string[]>();
  for (const v of (vends ?? []) as { nombre: string; equipo: string | null }[]) {
    if (v.equipo) equipos.set(v.equipo, [...(equipos.get(v.equipo) ?? []), v.nombre]);
  }

  const scopes: { scopeKey: string; label: string; carteras: string[] | null }[] = [
    { scopeKey: 'empresa:total', label: 'Total Empresa', carteras: null },
    ...[...equipos.entries()].map(([eq, vs]) => ({ scopeKey: `equipo:${eq}`, label: `Equipo ${eq}`, carteras: vs })),
    ...carteras.map((c) => ({ scopeKey: `vendedor:${c}`, label: c, carteras: [c] })),
  ].slice(0, LIMIT);

  console.log(`=== 2. insights: ${scopes.length} scopes con ${MODEL} ===`);
  let ok = 0, vac = 0, err = 0;
  for (const s of scopes) {
    try {
      let out = await getOrCreateInsight(svc as never, { ...s, avance: [], today, force: true, model: MODEL });
      // A veces el LLM devuelve JSON no parseable (0 cards) pese a haber datos:
      // reintentar 1 vez antes de dejar el scope sin insight del día.
      if (out.payload.cards.length === 0) {
        out = await getOrCreateInsight(svc as never, { ...s, avance: [], today, force: true, model: MODEL });
      }
      const n = out.payload.cards.length;
      if (n > 0) ok++; else vac++;
      console.log(`  ${s.scopeKey}: ${n} cards`);
    } catch (e) { err++; console.error(`  ${s.scopeKey} FALLO:`, (e as Error).message); }
  }
  console.log(`\n  insights: ${ok} con cards | ${vac} vacíos | ${err} errores | de ${scopes.length}`);
}

(async () => {
  const t0 = Date.now();
  await geoFix();
  await insights();
  console.log(`\n✓ Listo en ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
})().catch((e) => { console.error('Error fatal:', e.message); process.exit(1); });

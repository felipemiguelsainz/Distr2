# Resultados de Auditoría — Candysur Dashboard

> Auditoría ejecutada el 2026-06-08 sobre la rama `main` (commit `9f677e2`), de cara a
> **publicar la app en una URL pública**. Las áreas siguen los prompts de
> `audit/audit_prompts_candysur.md` (Seguridad, Rendimiento, Flujo, Base de Datos).
>
> Alcance: análisis estático del código (rutas API, guards de páginas, RLS, capa de
> queries, parser, migraciones). **No** se corrió `EXPLAIN` contra una base en vivo;
> los hallazgos de rendimiento/BD marcados como "(requiere verificación en vivo)"
> deben confirmarse con el query planner real.

---

## ⛔ Bloqueante para publicar — leer primero

**[CRÍTICO] Broken Access Control / IDOR en `/dashboard/supervisor/[nombre]`**
`app/dashboard/supervisor/[nombre]/page.tsx`

La página **no valida sesión ni rol**. A diferencia de `vendedor/[nombre]`,
`consolidado/[nombre]` y `consolidado-productos/[nombre]` (que sí hacen
`auth.getUser()` + chequeo de rol + redirect), esta página sólo usa el cliente para
buscar el `equipo` y renderiza los KPIs directo.

- El middleware `proxy.ts` **solo** valida rol para `/admin` y `/dashboard/total`
  (`needsRoleCheck`). `/dashboard/supervisor/*` queda sin chequeo de rol.
- Las queries (`fetchSupervisorKpis`, etc.) usan `createServiceClient()`, que
  **bypassa RLS** → no hay segunda línea de defensa.

**Impacto:** cualquier usuario autenticado —incluido un `vendedor`— puede ver los KPIs
consolidados, el desglose por vendedor y los datos de clientes de **cualquier equipo**
visitando `/dashboard/supervisor/<NombreEquipo>`. Exposición de datos comerciales entre
equipos/competencia interna.

**Fix:** replicar el guard que ya tiene `consolidado/[nombre]/page.tsx`:

```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect('/login');

const { data: profile } = await supabase
  .from('profiles').select('rol, vendedor_nombre, equipo').eq('id', user.id).single();
if (!profile) redirect('/login');

if (profile.rol === 'vendedor') {
  redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
}
if (profile.rol === 'supervisor') {
  let myEquipo = profile.equipo ?? '';
  if (!myEquipo) {
    const { data: me } = await supabase
      .from('vendedores').select('equipo').eq('nombre', profile.vendedor_nombre ?? '').single();
    myEquipo = me?.equipo ?? '';
  }
  if (myEquipo !== equipo) redirect(`/dashboard/supervisor/${encodeURIComponent(myEquipo)}`);
}
```

---

## 1 · Seguridad

| # | Severidad | Archivo | Issue |
|---|-----------|---------|-------|
| S1 | **CRÍTICO** | `app/dashboard/supervisor/[nombre]/page.tsx` | Sin guard de rol → IDOR (ver arriba) |
| S2 | **ALTO** | `lib/calculations/queries/*`, `productos.ts`, `clientes.ts` | RLS no protege el render del dashboard (service client) |
| S3 | **MEDIO** | `app/mapa/page.tsx` | Muestra todos los PDVs a cualquier rol |
| S4 | **MEDIO** | `proxy.ts` + páginas | Sin rate limiting / CSRF explícito |
| S5 | **BAJO** | `app/api/admin/{pdvs,maestros,pdvs-geo}/upload` | JSON sin validación de esquema/tamaño en runtime |

**S2 — RLS es decorativa en el camino de lectura.**
Todas las lecturas del dashboard usan `createServiceClient()` (service role, **bypassa
RLS**) con parámetros que vienen de la URL/`searchParams`. Las políticas de
`001_initial_schema.sql` (bien escritas, con `get_user_rol()`/`get_user_equipo()`
`SECURITY DEFINER`) sólo aplican al cliente anon/authenticated, que el dashboard **no
usa para leer**. Consecuencia: **el único control de acceso efectivo es el guard por
página**. Por eso S1 es explotable: cuando un guard falta, no hay red.
*Recomendación:* tratar cada guard de página como control crítico (checklist + test por
ruta), o migrar las lecturas al cliente con sesión para que RLS sea defensa real en
profundidad. Hoy `/dashboard/total` está OK porque sólo el admin llega (middleware), y
los filtros `supervisor`/`vendedor` por searchParams sólo los usa un admin.

**S3 — `/mapa`.** Valida sesión pero no filtra por rol: expone geolocalización, razón
social y cartera de **todos** los PDVs activos a cualquier usuario autenticado. Un
`vendedor` ve PDVs fuera de su cartera. Confirmar si es intencional; si no, filtrar por
`equipo`/`vendedor` según el perfil.

**S4 — Rate limiting / CSRF.** Los endpoints `/api/admin/*` y `/api/consolidado-productos`
no tienen rate limiting (un upload masivo repetido podría saturar la DB; mitigado en
parte porque requieren rol admin). Las mutaciones dependen de cookies de sesión Supabase;
con `SameSite` por defecto el riesgo CSRF es bajo, pero conviene rate limiting en el edge
antes de exponer públicamente.

### Bien hecho (no cambiar)
- `ventas/upload`: valida tamaño (25 MB → 413) y extensión (→ 415) **antes** de parsear.
- `auth/callback`: open-redirect mitigado (`safeNext` exige path relativo `/…`).
- Errores al cliente son genéricos ("Error interno del servidor."); los detalles van a
  `console.error`, no se filtran stack traces ni mensajes de DB.
- Guard admin homogéneo en **todas** las rutas `/api/admin/*` (`auth.getUser()` + lookup
  de `profiles.rol`).
- `usuarios`: rollback del auth user si falla el insert de profile; bloqueo de
  auto-borrado del admin logueado.
- `.env*` en `.gitignore`; `git ls-files` no trackea ningún `.env` → no hay secretos en
  el repo. El service role key nunca se importa en componentes client.
- `proxy.ts` correctamente nombrado para Next 16 (el convenio `middleware` está
  deprecado; runtime `nodejs`).

---

## 2 · Rendimiento

- **`unstable_cache` está OK** (no es bug): aunque la `keyParts` es estática
  (`['fetchTotalKpis']`, etc.), Next incluye automáticamente los **argumentos**
  (year/month/equipo/vendedor) en la clave → no hay datos stale ni cruce entre usuarios.
- **Query más cara:** `ccc_por_vendedor` / `clientes_compra_rubro` consultan `ventas`
  directamente con `COUNT DISTINCT pdv_id`. Ya existe pre-agregación
  (`resumen_clientes_pdv`, migr. 013/019/021). Verificar que las RPC que aún pegan a
  `ventas` usen los índices de migr. 005 *(requiere verificación en vivo con EXPLAIN)*.
- **Excel:** `XLSX.read()` carga todo el `ArrayBuffer` en memoria. En `ventas/upload` hay
  techo de 25 MB; los uploads de `pdvs`/`maestros`/`geo` parsean en el cliente y mandan
  JSON (sin techo equivalente — ver S5).
- **`recalcularResumenDiario`** corre **sincrónico** dentro del request de upload. Si es
  lento, la respuesta HTTP cuelga. Ya hay manejo: si falla, devuelve `resumen_warning` y
  existe botón manual de recalcular. Para volúmenes grandes, evaluar job en background.
- Paralelización con `Promise.all` bien aplicada en las páginas. Sin paginación en tablas
  (`ClientesTable` puede tener cientos de filas para un supervisor) — impacto de render
  medio/bajo.

---

## 3 · Flujo

- **Re-subida de ventas:** `upsert` con `onConflict: fecha,pdv_id,comprobante,sku` permite
  re-subir un mes corregido sin borrar — correcto y documentado.
- **Vendedores huérfanos:** hay paso de confirmación (`requires_confirmation`) antes de
  insertar ventas de vendedores que no están en el maestro. Bien.
- **Reasignaciones de PDV:** confirmación previa con preview de vendedor anterior/nuevo.
  Bien. *Riesgo:* si el browser se cierra entre preview y confirm, el estado se pierde (no
  hay persistencia intermedia) — menor.
- **Falla de resumen tras insertar ventas:** se informa con warning + recalculo manual.
  Bien.
- **`/dashboard/supervisor/[nombre]` sin guard** → además de seguridad (S1), rompe el
  flujo esperado de "cada rol ve lo suyo".

---

## 4 · Base de Datos (análisis de migraciones)

- **Joins por texto en vez de FK UUID:** `vendedor`/`vendedor_nombre` es `TEXT` y une
  `ventas`, `metas`, `resumen_diario`, `planificacion`, `asignaciones`. Un typo o cambio
  de casing (`"GUIDO PEREZ"` vs `"Guido Perez"`) crea filas duplicadas/huérfanas
  silenciosas. *Fix sugerido:* normalizar nombre en la escritura (trigger o app-level) y/o
  `COLLATE`/constraint.
- **`ventas_unique (fecha, pdv_id, comprobante, sku)`:** si un mismo SKU aparece dos veces
  en el mismo comprobante (dos líneas válidas), el upsert **pisa** la segunda
  silenciosamente. Confirmar que el negocio nunca tenga ese caso.
- **`asignaciones` sin UNIQUE:** se pueden insertar duplicados de
  `(cartera, vendedor_nombre, fecha_desde)` en el flujo de reasignación.
- **Sin CHECK** en `ventas.kilos`/`ventas.neto` ni `metas.kilos_meta >= 0` → un error de
  parseo (p. ej. 999999 kg) entra sin validación.
- **RLS helpers** (`get_user_rol`, `get_user_vendedor`, `get_user_equipo`) son
  `SECURITY DEFINER STABLE` → correcto.
- Acoplamiento por texto (sin FK): `vendedores.nombre` ← `ventas`, `metas`,
  `resumen_diario`, `planificacion`, `asignaciones`, `profiles.vendedor_nombre`.
  Integridad de esquema estimada: **6.5/10** (RLS y constraints básicas bien; penaliza el
  uso de texto como clave de join y la falta de CHECKs).

---

## Prioridad para publicar (orden recomendado)

1. **S1** — agregar el guard a `supervisor/[nombre]` (bloqueante, ~10 líneas).
2. **S3** — decidir/aplicar filtrado por rol en `/mapa`.
3. **S4** — rate limiting en el edge para `/api/*` antes de exponer.
4. **S2** — checklist/test de guards por página (o migrar lecturas a RLS).
5. DB: UNIQUE en `asignaciones`, CHECKs en `ventas`/`metas`, normalización de nombres.

# Contexto para Claude — Lecciones de este proyecto (Candysur / Distr2)

> **Cómo usar este archivo:** pasáselo a Claude al empezar a trabajar en esta app.
> Resume decisiones y trampas que ya nos costó descubrir, para que todo quede
> "joya" sin repetir el mismo aprendizaje. Es un documento **vivo**: cada vez que
> resolvemos algo no obvio, se agrega acá.

App de gestión de ventas para una distribuidora de Mondelez en el GBA.
Stack: **Next.js 16 (App Router, Turbopack) + Supabase (Postgres) + Vercel**.
Idioma del producto y de los textos: **español rioplatense**.
Producción: **https://distr2.vercel.app** (auto-deploy desde `main`).
_Última actualización: 2026-07-28 · migraciones hasta `040` · base nueva · IA = Claude · insights SERVE-ONLY + job en GitHub Actions (LIVE) y **admin + supervisor (su equipo), el vendedor no** (§8) · filtro de rango de fechas · metas: los SIN SUPERVISOR no reciben meta y julio-2026 ya se recalculó (§13) + **la meta $ del supervisor estaba estimada, no cargada** (§13) · **costo de IA medido: 45 llamadas/noche ≈ $30/mes** (§9) · UI sin emojis, tema claro._

---

## Estado actual (migración jul-2026: base nueva + Claude + jobs en GitHub Actions)

Cambios grandes de julio 2026. Lo esencial (varias referencias más abajo quedaron viejas):

**Base Supabase NUEVA** (proyecto `inxtqpwyicyysisicpxc`). Se migró todo: 40 migraciones +
maestros + ~1,25M ventas + geo. El password del `DATABASE_URL` va **percent-encoded** (`#`→`%23`).

**IA = Claude (Anthropic), ya no OpenAI.** `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`
(en `.env.local` y en Vercel). `lib/ai/provider.ts` sigue agnóstico; `getLLMProvider(model?)`
permite override de modelo. **Los modelos nuevos (Sonnet 5, Opus 4.6+, Fable/Mythos 5)
RECHAZAN `temperature`** y traen thinking adaptativo → el provider NO manda `temperature` y
apaga thinking (`{type:disabled}`) en esos (salida JSON: todo el `max_tokens` va al output).
Haiku / Sonnet 4.6 siguen con `temperature` como antes.

**Vercel FREE = límite 10s por función.** Sonnet (~36s) y el geo-fix por Nominatim (~17s,
1 req/seg) NO entran en una función de Vercel. → El **trabajo pesado corre en GitHub Actions**
(`.github/workflows/daily-jobs.yml` → `scripts/daily-jobs.ts`), cron nocturno, gratis, sin
límite de tiempo. La app de Vercel SÓLO sirve lo cacheado. **YA ESTÁ ANDANDO** (corre solo
~07:00 ART + `workflow_dispatch` a mano). Secrets en GitHub → Settings → Secrets and variables →
Actions → pestaña **"Secrets"** (¡NO "Variables", que `secrets.` no lee!): sólo
**`SUPABASE_SERVICE_ROLE_KEY`** y **`ANTHROPIC_API_KEY`**. La `NEXT_PUBLIC_SUPABASE_URL` va
**hardcodeada en el workflow** (no es secreta: está en el bundle público) para no depender de un
secret más. El script `daily-jobs.ts` chequea las env vars y avisa cuál falta (evita el críptico
"supabaseUrl is required").
**Regla a futuro: cualquier tarea que pase de 10s va a GitHub Actions, no a una función de Vercel.**

**Insights (Módulo 3) — la app SÓLO SIRVE, el job GENERA:**
- Generar un insight tarda ~35s (buildInsightData + LLM) → NO entra en Vercel free (10s). Por eso
  la app **nunca genera on-demand**: `getLatestInsight(scopeKey)` devuelve el análisis cacheado
  **más reciente CON cards** (saltea filas de 0 cards, que pueden ser más nuevas). Si no hay ninguno,
  la UI muestra "análisis en preparación" (nunca se cuelga generando ni tira timeout). El route
  `/api/insights` **siempre devuelve JSON** (nunca HTML de error) y no calcula KPIs en la lectura,
  para no romper el `res.json()` del cliente (era el "JSON.parse: unexpected character").
- El **job nocturno** (GitHub Actions) genera con **Sonnet 5** para todos los scopes. Los scopes
  salen de la tabla `vendedores` activos (= el dropdown), NO de `pdvs.cartera` (PostgREST topa en
  1000 filas → sólo veía ~11 de 43). Reintenta 1 vez ante 0 cards (flakiness del LLM).
- Cache **diario** por scope (`ai_insights.periodo` = `YYYY-MM-DD`); se sirve el último disponible
  con cartel **"Datos al DD/MM/AAAA"** (+ aviso azul si no es de hoy). Calidad: 5-8 acciones con
  pasos concretos, `maxTokens` 8000, `parseCards` corta en 8.
- **NO borrar `ai_insights` al guardar metas/días laborables** (rutas `metas/guardar` y
  `config-meses`): en serve-only eso los dejaba EN BLANCO hasta la corrida nocturna. El % de avance
  se refresca solo esa noche. (Fue justo la causa de "análisis no disponible" en todos lados.)

**Filtro de rango de fechas (dashboards):** ADITIVO y **convive** con el selector de mes (no lo
reemplaza). `RangeFilter` (UI) escribe params `desde`/`hasta` sin tocar el resto; cuando ambos
están, cada dashboard (Total, Vendedor, Supervisor) muestra el panel `RangoVendido`: SOLO lo
vendido (kilos/$) del período, total y por rubro, **sin metas ni proyección** (que son mensuales).
`fetchVentasRango` sobre el RPC `kpi_resumen` (que ya acepta `p_desde`/`p_hasta`).

**Cargar datos por SCRIPT saltea los hooks de la app.** En la migración, ventas/PDVs se cargaron
con scripts (no por la UI) → NO se dispararon los recomputes que la UI hace sola. Dos consecuencias
que hubo que arreglar a mano (y a tener en cuenta en cualquier carga por fuera de la UI):
- `resumen_clientes_pdv` (pre-agregado por PDV/mes) quedó sólo con el mes corriente. Se recomputa
  con la RPC `recalcular_resumen_clientes_pdv({p_periodos:['YYYY-MM']})` **período por período**
  (19 juntos → statement timeout de la DB; de a uno ~2s c/u). Ya cubre 2025-01…2026-07.
- `metas_ccc` quedó vacía → la pantalla de Metas CCC no mostraba nada. Se generan con
  `calcular_preset_ccc(mes, anio)` (hook real en `pdvs/upload/route.ts`, no pisa lo editado por el
  supervisor `es_preset=false`). **OJO al orden:** el paso 2 (metas por rubro) lee la penetración
  del **mismo mes del año pasado** desde `resumen_clientes_pdv` → sin el resumen 2025 recomputado
  da 0 filas por rubro (sólo totales). Correcto: recomputar resumen 2025 → correr `calcular_preset_ccc`.
  **CCC = "Clientes que Compraron"**; la meta es de **cobertura** (cuántos clientes deberían comprar,
  total + por rubro), distinta de la meta de kilos/$. La pantalla ahora explica esto (panel arriba).

**Login endurecido:** botón de ojo (ver/ocultar clave), el **error real** de auth se muestra (no el
genérico "incorrectos" para todo → tapaba API key mal, etc.), y `.trim()` del email (el
autocompletado mete espacios). Crear usuarios: `POST /api/admin/usuarios` → contraseña temporal +
`must_change_password=true`; supervisor → `equipo=target` (mismo valor va también en
`vendedor_nombre`). El token de sesión es **ES256** (JWKS local, `getClaims()` en `proxy.ts`).

**Geo (detalle en §4):** flag `aproximada` (centro de barrio, no dirección exacta — mig 038)
marcado en mapa (pin punteado + aviso) y rutas; `geo_verificada` (mig 039) protege los
arreglos de IA de ser pisados por un re-upload; `pdvs_geo_pendientes` (mig 040) es la cola
que consume el geo-fix. Auditoría por **point-in-polygon del partido** (partido = la verdad).
**Coordenada precisa ≠ correcta:** una coord siempre "vale" (apunta a algún lado); el problema
era que la del CSV apuntaba a la puerta equivocada. Dibujar el pin es trivial; que apunte bien
es lo difícil — un pin perfecto en el lugar equivocado es peor que no tenerlo.

**Seguridad (auditoría con Fable 5):** `proxy.ts` bloquea cuentas `activo=false` en TODA ruta
(incl. /api) y al desactivar se banea la sesión en Supabase Auth; `borrar-mes`/`recalcular-resumen`
usan rango `[mes, mes+1)` con `.lt` (el `-31` fijo rompía meses de 30 días y feb, y borrar-mes
fallaba en silencio); `/dashboard/total` re-chequea rol en la página. Archivos con PII sacados
del git (historial reescrito). Nunca pegar secretos en el chat.

---

## 0. Principios que NO se negocian

1. **Cálculo = algoritmo/SQL. Interpretación = IA.**
   Rutas (TSP), KPIs, clasificaciones, distancias, geocoding → determinístico.
   La IA (LLM) es para redactar/conversar/resumir, nunca para calcular números.
   - **Un LLM NUNCA debe producir coordenadas, distancias ni totales**: los
     inventa con seguridad. Para dirección→coords se usa un **geocoder real**
     (Nominatim/OSM, Google), no un GPT.
2. **El LLM nunca escribe SQL libre.** Si se hace un asistente, expone un set
   acotado de tools read-only que ya aplican el scoping por rol.
3. **Todo lo de IA corre server-side.** La API key vive en `.env.local` /
   variables de Vercel. Jamás llega al cliente ni a un commit.
4. **Validar contra la realidad antes de cantar victoria.** Probar queries y
   RPCs contra la DB real, correr `tsc --noEmit`, y para mutaciones de datos:
   **dry-run → backup → apply**.
5. **Respetar el scoping por rol en CADA endpoint y tool** (ver §2).

---

## 1. Trampa de Next.js (¡leer primero!)

`AGENTS.md` lo dice y es en serio: **esta versión de Next tiene breaking changes
respecto de lo que un modelo "sabe" de memoria.** Antes de escribir código de
Next, leer la guía relevante en `node_modules/next/dist/docs/`.
- Favicon: convención `app/favicon.ico` (Next inyecta el `<link>` solo).
- El mapa se carga con `dynamic(() => import(...), { ssr: false })` porque Leaflet
  necesita `window` (no corre en SSR).
- **⚠️ `useSearchParams` en un client component exige `<Suspense>` alrededor.** En dev
  no se nota (las rutas se renderizan on-demand); **el que falla es el build de
  producción**. Documentado en
  `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`.
  Cada vez que muevas estado a la URL (`?vendedor=`, `?desde=`…), envolvé el cliente en
  Suspense **en el mismo commit**, aunque `npm run dev` ande perfecto.

---

## 2. Modelo de datos y "verdades"

Tablas clave:
- `pdvs` — maestro de puntos de venta: `id, razon_social, domicilio, localidad,
  zona, canal_venta, cartera, ultima_vta, activo, dia_visita` (CSV `LUN,MAR,…`).
- `pdvs_geo` — geo: `pdv_id, latitud, longitud, partido, provincia, calle,
  altura, ruteable`.
- `ventas` — transaccional (fuente de verdad de actividad): `fecha, pdv_id,
  neto, kilos, bultos, unidades, marca, rubro, sku, cartera, vendedor`.
- `localidades_geo` — centroides por localidad (ver §4).
- `vendedores`, `profiles` — roles y equipos.

**⚠️ Dos conceptos de "activo" que NO hay que confundir:**
- **`pdvs.activo` (padrón / alta-baja):** el PDV está en la base actual. Si una
  carga de maestro no lo incluye → `activo=false` (baja): **desaparece de TODO**
  (mapa, dashboards, insights filtran `activo=true`). Es interno; en la UI se dice
  **"baja / dado de baja / padrón"**, NUNCA "inactivo".
- **"Cliente activo / inactivo" (recencia, negocio):** compró ≤3 meses (activo)
  vs +3 meses (inactivo / "en riesgo" / rojo). Sale de `ventas`
  (`pdvs_ultima_vta`), NO de `pdvs.activo`. Un PDV puede estar **en el padrón
  (`activo=true`) y a la vez ser "cliente inactivo"** (en rojo). Son ortogonales.
- Regla de naming: reservá "activo/inactivo" para la **recencia**; para el flag
  de padrón usá "alta/baja/vigente".

**Verdades aprendidas (no asumir lo contrario):**
- **La actividad/recencia se calcula desde `ventas`, NO de campos cacheados.**
  `pdvs.ultima_vta` viene **vacío** → no sirve. La última venta real se pivotea
  con el RPC `pdvs_ultima_vta()` (`MAX(fecha)` por pdv_id).
- **La ubicación verdadera de un PDV es `pdvs.localidad`** (lleno ~100%).
  `pdvs_geo.partido` viene **casi todo null** tras los uploads → no confiar.
- **Scoping por rol:** `vendedor` ve sólo su `cartera == vendedor_nombre`;
  `supervisor` ve su `equipo`; `admin` ve todo. Se aplica **server-side** en
  cada endpoint (`/api/mapa`, `/api/ruta`, etc.).
- **`avance_pct` se calcula sobre tendencia**, no acumulado (cae a acumulado
  sólo si tendencia es null = mes pasado).
- **Los datos de `ventas` van atrasados respecto del calendario** (p. ej. hoy 22
  pero la última venta cargada es del 11). Toda comparación interanual debe cortar
  AMBOS años en el **último día con datos del mes en curso** (no en "hoy"), o
  exagera caídas falsas (ver `tendencia_anual`, §8).

---

## 3. Mapa: colores por recencia de compra

Los PDVs del mapa se colorean por recencia (no por canal):
- 🟢 verde ≤1 mes · 🟡 amarillo 1–3 meses · 🟠 **naranja = enfriándose**
  (`esEnfriandose`: rompió su cadencia, ≤90 días) · 🔴 rojo >3 meses / nunca.
- La fecha sale pivoteada de `ventas` (RPC `pdvs_ultima_vta`), no del campo
  cacheado. `pdvs_cadencia.ultima` == `pdvs_ultima_vta.ultima` (MAX(fecha) de
  ventas) → **son consistentes** (verificado: 0 diferencias). El flag
  `enfriandose` lo calcula `/api/mapa` cruzando con `pdvs_cadencia`.
- `/api/mapa` **aborta (503) si `pdvs_ultima_vta` falla** (no cachear "todo
  rojo" como pasó con el timeout). Cachea por usuario 5 min
  (`private, max-age=300`): tras cambios, **Ctrl+Shift+R**.

---

## 4. Geolocalización: validación EN LA CARGA (no con scripts manuales)

**El problema:** los uploads de PDVs pisan `pdvs_geo` con las coords crudas del
CSV, que traen errores de geocoding (puntos en otras provincias, centroides de
país). Antes había que correr un script a mano cada vez. **Eso no va.**

**La solución (migración `029`):**
- Tabla `localidades_geo` (localidad normalizada → centro lat/lng). La localidad
  se normaliza: mayúsculas, trim, y `#` → `Ñ` (la Ñ viene mal codificada).
- Centroides = **mediana de los puntos sanos (dentro del GBA) por localidad**
  (`refresh_localidades_geo()`). Localidades chicas sin mediana se completan
  geocodificando el nombre: `scripts/seed-localidades-geo.cjs`.
- El RPC `bulk_upsert_pdvs_geo` valida **cada fila** con esta cascada:
  | Caso | Acción |
  |---|---|
  | En GBA y ≤10 km del centro de su localidad (o sin centroide) | guarda tal cual |
  | Lejos / fuera del GBA, con centroide | **corrige** al centro de la localidad |
  | Sin localidad de referencia | **rechaza** y reporta |
- Devuelve `{ upserted, corrected, rejected, skipped_* }` y el front lo muestra.

**Bounding box GBA** (descartar coords corruptas): lat `[-35.6, -34.2]`,
lng `[-59.2, -57.7]`.

**Limitación honesta:** corregir al centro de la localidad da precisión de
*barrio*, no de *calle* (los registros malos no traen dirección para geocodificar
fino). Está bien para no tener puntos "en cualquier lado"; precisión de calle
requiere importar direcciones reales.

**Script de emergencia** (si hace falta arreglar data ya cargada):
`scripts/fix-geo-outliers.cjs` (dry-run por defecto, `--apply` con backup).

**Re-geocoding asistido por IA (precisión de calle, no de barrio).** Para los PDV
parkeados en el centroide de su localidad, `scripts/regeocode-centroides.cjs` usa
**Claude para NORMALIZAR la dirección** (mejor que el regex: abreviaturas, `#`→Ñ,
paréntesis, "entre calles") y **Nominatim para geocodificar** — el LLM nunca produce
coords (§0). Valida por cercanía al centroide: aplica sólo los de alta confianza
(≤6 km), marca los dudosos (6-15 km) para revisión, deja el resto en el centroide.
Dry-run por defecto, `--apply` con backup. Corrida inicial (2026-07): 66 aplicados,
21 a revisar, 7 sin geocode. La IA destapó de paso un bug del regex de
`regeocode-pdvs.cjs` (`N.` se comía la N inicial: NECOCHEA→ECOCHEA), ya corregido.
Los dudosos son calles numeradas (Berazategui/Fcio. Varela) donde Nominatim no
distingue la altura; **Google Geocoding** las cerraría mejor (upgrade de un renglón).

**IMPORTANTE — qué corre solo y qué NO en cada carga:**
- **Automático (RPC `bulk_upsert_pdvs_geo`):** validación por localidad (keep/
  corrige-a-centroide/rechaza) + setea `aproximada` (mig 038).
- **NO automático:** el re-geocoding con IA (Claude+Nominatim) es **paso manual
  post-carga** — no puede correr en el upload (Nominatim = 1 req/seg, colgaría el
  request). Tras subir un maestro geo **nuevo**, correr en orden:
  `node scripts/regeocode-centroides.cjs --apply` (parkeados en centroide) y
  `node scripts/fix-geo-outliers-ai.cjs --apply` (fuera de partido). Idempotentes,
  con backup.
- **Durabilidad (mig 039):** `pdvs_geo.geo_verificada`. Los scripts marcan
  `geo_verificada=true` al arreglar; el RPC **NO pisa** lat/long/aproximada de una
  fila verificada en un re-upload (preserva el arreglo). Así el trabajo de IA NO
  se pierde al re-subir el maestro; sólo hay que correr los scripts para los PDV
  **nuevos**. Auditoría por partido (point-in-polygon): 60 mal ubicados de 6.983,
  arreglados; 33 quedaron `aproximada` (marcados en mapa/rutas).

---

## 5. Ruteo (Módulo 1): a pie, por calles

- **Optimización**: TSP determinístico (vecino más cercano + 2-opt) en
  `lib/routing/tsp.ts`, sobre matriz de distancias.
- **Es TODO A PIE.** El ruteo peatón es el **default**, sin configurar nada:
  - Router por defecto = **FOSSGIS público `routing.openstreetmap.de/routed-foot`**
    (perfil `foot` real, gratis, sin API key — el mismo que usa openstreetmap.org
    para caminar). Da **traza + distancia + tiempo peatonales de verdad** (cruza
    por donde camina un peatón, ignora sentidos únicos; ~4,5 km/h).
  - `lib/routing/osrm.ts`: `osrmTableFoot` (matriz para optimizar el orden) y
    `osrmRouteGeometry` (traza + totales). Si el foot router falla, la geometría
    cae al OSRM público de auto SOLO para no dibujar líneas rectas sobre manzanas
    (en ese caso la distancia/tiempo se estiman a pie con haversine ~5 km/h).
  - Ojo: el **demo `router.project-osrm.org` es solo auto e ignora el perfil**
    `foot` — por eso NO se usa para distancias, solo como último fallback de traza.
  - Para producción pesada o veredas propias: montar un OSRM con perfil `foot`
    y setear `OSRM_URL` (+ `OSRM_PROFILE=foot`); el sistema lo toma solo.
  - El servicio público de FOSSGIS es para uso razonable (equipo chico OK); no
    abusar.
- **Export a Google Maps**: SIEMPRE como **coordenadas** (`lat,lon`, precisión
  completa, sin nombres → no confunde comercios) y en modo **caminando**
  (`travelmode=walking`). Google acepta ~10 puntos por link → se parte en
  **tramos continuos**. Además botón "Copiar coords" (lista ordenada).
- **Clientes apagados cercanos** (sugerencias, sin IA): PDVs que cumplen TODO:
  (a) misma cartera del vendedor (garantizado: `candidatos` ya filtra cartera);
  (b) NO asignados al día de la ruta (`!diasDe(dia_visita).includes(dia)`);
  (c) inactivos (rojo, +3m); (d) a ≤ radio de alguna parada. El panel los lista
  (clickeable → `FlyTo`) y los dibuja como rombos rojos.
  - **Sumar a la ruta**: pasa a `extra`; el back recalcula con ese PDV como
    parada (flag `agregado`); el front lo saca de sugerencias **optimista** (para
    que no quede como rombo y parada a la vez) y el nuevo response ya no lo trae
    en `sugerencias` (queda en `enRuta`).
  - **Radio ajustable**: param `radio` (m, clamp 100–2000, default 400); selector
    en el panel. **Sumar a la ruta**: param `extra` (ids coma-separados) → esos
    PDVs se agregan como paradas (flag `RutaStop.agregado`) y se re-optimiza todo;
    el panel tiene botón "+ Sumar" por sugerencia y chips "Sumados" con quitar.

---

## 6. Secrets, uploads y operativa

- Archivos grandes se cargan **corriendo la app local**, no por la URL pública
  de Vercel (tope 4.5 MB + timeout).
- **Identificador de cliente = columna `PDV`** (= `pdvs.id`). Los parsers
  (`pickPdvId` en CargarClient + ventas) priorizan SIEMPRE la columna "PDV"
  sobre "Cod. Cliente". Antes el parser de geo prefería Cod. Cliente → si difería
  del PDV, la geo no matcheaba. Importante: re-subir ventas y el maestro PDVs con
  la columna PDV para que todo quede indexado igual. El maestro y la geo ahora se
  cargan **juntos en un solo archivo** (ver §14, "Carga unificada maestro + geo").
- **Carga de ventas** dispara: recálculo de resumen + invalida KPIs + **borra
  `ai_insights`** (insights se refrescan con el día). Mapa/enfriándose son en vivo.
- **Carga del maestro de PDVs (`/api/admin/pdvs/upload`) = reemplazo por baja
  lógica:** upsert de lo que viene + los que NO vienen se marcan `activo=false`
  (NO se borran: `ventas.pdv_id` es FK, se preserva el historial → los kg/$ NO
  cambian). Todo lo que filtra `activo=true` (mapa, dashboards, insights) deja de
  verlos y de contarlos. Además: limpia la geo de inactivos
  (`cleanup_pdvs_geo_inactivos`, mig. `037`) y tiene **guardrail**: si una carga
  daría de baja a >30% de los activos, pide confirmación (posible archivo
  parcial). También confirma reasignaciones de cartera.
- Credenciales (OpenAI, etc.): el usuario las pone en `.env.local`; nunca pegarlas
  en el chat ni commitearlas.
- Migraciones: numeración correlativa en `supabase/migrations/` (última: `036_*`).
  Vercel **no** corre migraciones; se aplican aparte contra la DB (mismo Supabase
  que prod). Patrón para aplicar: script .cjs con `pg` leyendo `DATABASE_URL` de
  `.env.local`.
- Funciones `SECURITY DEFINER` de escritura: `REVOKE` a public/anon/authenticated
  + `GRANT` a `service_role` (ver migración `024`).

### Env vars en Vercel (gotcha real)
- La IA hoy usa **Claude**: `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (nombres
  EXACTOS). `llmAvailable()` mira la key del proveedor activo → si falta, la IA
  "degrada" (no aparece) en vez de romper. (`OPENAI_API_KEY` quedó como fallback
  si algún día se vuelve a `AI_PROVIDER=openai`; hoy se ignora.)
- **Los mismos secrets van también en GitHub Actions** (para el job diario de
  insights/geo): `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Debe estar en scope **Production** (los 3 checkboxes: Production/Preview/Dev).
- **Vercel NO aplica una env nueva al deployment ya corriendo**: hay que
  **redeploy** después de cargarla. "no configurado" = la var no llega (nombre,
  scope o falta redeploy), no es problema del valor.

---

## 7. Disciplina de validación (lo que hicimos bien)

- Reproducir el problema con una query antes de "arreglar".
- Mutaciones de datos: **dry-run → backup JSON → apply**, y re-verificar.
- Probar RPCs en una transacción con `ROLLBACK` para no ensuciar datos.
- `npx tsc --noEmit` antes de dar por cerrado un cambio de código.
- Scripts puntuales de diagnóstico: crearlos en `scripts/`, correrlos y borrarlos.
- **Reusar el código REAL de la app en un script, no reimplementarlo** (una copia
  del cálculo diverge del que corre en la UI). Para importar de `lib/` hace falta
  **`-r tsconfig-paths/register`** o el alias `@/` no resuelve (`Cannot find module
  '@/lib/...'`) — los `npm run load:*` no lo llevan porque no usan el alias:
  `npx ts-node -r tsconfig-paths/register --project tsconfig.scripts.json scripts/x.ts`.
  `tsconfig.scripts.json` incluye `lib/**` y excluye `app/**`; importar
  `lib/supabase/server` (que trae `next/headers`) desde un script **funciona**.
- **Un script que escribe en la DB NO puede invalidar el cache de Next**
  (`revalidateTag` sólo corre dentro de la app). Los `fetch*Kpis` tienen
  `revalidate: 300` ⇒ tras un write por script los dashboards muestran lo viejo
  **hasta 5 min**. No es un bug: avisar y esperar, o hacerlo por la UI.
- Los `*-backup-*.json` de `scripts/` están **gitignoreados** (no se commitean).

---

## 8. Estado de los módulos de IA

- **Módulo 0 — capa LLM (HECHO, base):** `lib/ai/provider.ts` (interfaz
  `LLMProvider` agnóstica + OpenAI y Anthropic vía fetch, sin SDK; se elige con
  `AI_PROVIDER`, default openai; `getLLMProvider()` / `llmAvailable()`).
  `lib/ai/tools.ts` (tools read-only con scoping por rol: `get_pdvs_inactivos`,
  `get_pdv_info`, `get_ventas` [kg/$ por vendedor o alcance, mes actual/pasado,
  reusa fetch*Kpis; `resolveVendedor` matchea el nombre tipeado sin acentos/casing];
  `resolveCarteras` da las carteras visibles). La capa de DATOS
  está testeada contra la DB; la orquestación LLM se valida cuando haya key.
  - **Para activar:** `OPENAI_API_KEY` en `.env.local` (y en Vercel). Modelos:
    `OPENAI_MODEL` (default `gpt-4o-mini`). Para Claude: `AI_PROVIDER=anthropic`
    + `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, default `claude-haiku-4-5-20251001`).
- **Módulo 2 — asistente/chat (HECHO):** `POST /api/asistente` corre el loop de
  tool-calling (máx 5 turnos) sobre `lib/ai/tools.ts`; auth + scoping por rol;
  acota el historial (12 msgs) para controlar costo; degrada con 503 si no hay
  key. UI: `components/asistente/Asistente.tsx` (widget flotante), montado en
  `AppShell` solo si `llmAvailable()`. Validado end-to-end (OpenAI gpt-4o-mini +
  tools reales contra la DB): responde con números exactos, sin alucinar.
  - **OJO en producción:** hay que cargar `OPENAI_API_KEY` en las env vars de
    Vercel; si no, el widget no aparece (degrada).
  - **⚠️ Anthropic exige que el PRIMER mensaje sea `user`** (OpenAI lo tolera). El
    historial es user/assistant alternado y **siempre tiene largo impar** (termina en
    el user recién enviado), así que un `slice(-12)` pelado arranca en `assistant`
    apenas hay 13+ mensajes → **400 y el chat quedaba roto a partir del 7º turno,
    para siempre**. Fix: descartar los mensajes iniciales hasta que el primero sea
    `user`. Cuidado al tocar el recorte del historial.
  - **⚠️ Si el modelo no tiene tool para responder algo, DEDUCE en vez de admitirlo.**
    Preguntar "¿de qué días hay info?" no tenía tool: agarraba la fecha suelta de
    `get_ultima_carga` y contaba el calendario de cabeza → imposible acertar (no puede
    saber que el 9-jul es feriado). El system prompt ya decía "si ninguna tool puede
    responder, decilo" y **no alcanzó**: darle un dato parcial lo empuja a derivar.
    Fix: tool `get_dias_con_datos` (lista de fechas + conteo + hábiles sin datos),
    apoyada en los MISMOS RPCs que el dashboard (`kpi_tendencia` agrupa por fecha) para
    que asistente y dashboard no puedan discrepar. **Regla: si una pregunta razonable no
    tiene tool, agregá la tool — no alcanza con pedirle que no adivine.**
  - **⚠️ El `catch` genérico escondía la causa real.** Todo caía en
    `{ error: 'Error del asistente.' }` y el error verdadero quedaba sólo en el log del
    server (invisible en Vercel para el usuario). Nos costó una sesión entera descubrir
    que era **falta de crédito** (§9). Ahora `lib/ai/provider.ts` exporta **`LLMError`**
    (lleva `status` + cuerpo crudo) y la ruta mapea a mensaje accionable en castellano:
    sin crédito / credenciales inválidas / rate limit / proveedor caído. El cuerpo crudo
    **nunca** se manda al browser, sólo al log.
- **Módulo 3 — insights (HECHO):** página propia `/insights` (link en sidebar).
  - **⚠️ ADMIN + SUPERVISOR (desde 2026-07-28); el vendedor NO.** Historia: hasta el
    2026-07-21 lo veía cualquier rol con `vendedor_nombre`, ese día quedó solo-admin y
    el 2026-07-28 se reabrió al supervisor. El corte va en **cuatro** lugares y hay que
    tocarlos juntos: `/insights` y `/insights/enfriandose` (redirect), el `Sidebar`
    (que sólo esconde el link) **y las dos APIs** `/api/insights` +
    `/api/insights/enfriandose`. **El redirect de página sólo esconde la UI:** sin el
    chequeo en la API, cualquiera le pega a mano al endpoint y recibe los datos igual.
    Vale para cualquier restricción de rol en esta app.
  - **El supervisor ve el scope de SU equipo**, no el de la empresa: la vista agregada
    resuelve `equipo:<profiles.equipo>` (scope que el job nocturno ya genera) y el
    dropdown sólo lista las carteras de su equipo (`resolveCarteras`). El equipo sale de
    `resolveEquipo` (`profiles.equipo`, con fallback a `vendedores` por nombre) — la
    MISMA función que usa `resolveCarteras`, si no el supervisor sin `profiles.equipo`
    veía la lista de su equipo pero "Sin equipo asignado" en la agregada.
  - Consecuencia de costo: los 40 análisis por vendedor que genera el job nocturno los
    abre el admin (todos) o el supervisor (los de su equipo), de a uno → ver §9.
  - **Flujo:** por default muestra la vista AGREGADA (Total Empresa). El selector
    arranca neutro ("Filtrar por vendedor…"); elegir uno cambia a esa cartera. El scope
    igual se respeta server-side (`resolveCarteras`), no se confía en la UI.
  - **El vendedor elegido vive en la URL (`?vendedor=X`), no en `useState`** — así
    sobrevive a recargas y al botón atrás. "Ver en mapa" abre en **pestaña nueva**
    (`target="_blank"`), para no perder la vista de Insights. Ojo: `EnfriandoseClient`
    **ignoraba** el `?vendedor=` que Insights ya le pasaba (llegabas filtrado y veías
    todos) — si agregás un cliente nuevo que reciba ese param, leelo de verdad.
  - **Churn ponderado por plata:** el churn se ordena por `valor_mensual`
    ($/mes histórico que facturaba cada apagado, RPC `pdvs_valor_12m` =
    neto últ. 12m / meses con compra), no por fecha. `churn.valor_total` = $/mes
    en juego (se muestra en la KPI "En riesgo" y en la lista de clientes). El
    prompt le pide al LLM priorizar y cuantificar en $.
  - **Quiebre de cadencia (alerta temprana):** RPC `pdvs_cadencia` (mediana de
    días entre compras, últ. 12m, >=4 compras). `enfriandose` = clientes que
    compran regular (cadencia 3–35 d) pero hace >2x su cadencia que no compran y
    siguen dentro de 90 d (aún "activos" por el corte plano) → se están apagando
    AHORA. Ordenados por valor; banner ámbar + el LLM hace card para contactarlos.
  - **Cross-sell por mix:** RPC `cross_sell(p_carteras)` → rubros fuertes (top 4
    por penetración) que clientes ACTIVOS no compran: `n_no_compran`,
    `valor_estimado` ($/mes potencial), y muestra de clientes (los de mayor valor).
    El LLM hace cards CRECIMIENTO con esos clientes. Las 5 fuentes pesadas
    (ultima_vta, valor_12m, cadencia, cross_sell, tendencia_anual) + el paginado
    corren en **paralelo** (Promise.all) porque cross_sell es lento (~8-10s).
  - **⚠️ Statement timeout (nos rompió la vista):** Supabase/PostgREST cancela
    statements a los ~8s. Los RPCs que escanean toda `ventas`, sobre todo en
    paralelo, se pasaban → devolvían NULL → `pdvs_ultima_vta` vacío → los 7028
    PDVs caían como "en riesgo" (0 activos). Fix (mig. `034`): `ALTER FUNCTION …
    SET statement_timeout = '30s'` en los 4 RPCs (al hacer `CREATE OR REPLACE`
    hay que re-declarar el SET, no se hereda). Y **resiliencia**: si la recencia
    falla, `buildInsightData` ABORTA en vez de cachear un insight roto.
  - **Tendencia vs año pasado (a igual día del mes):** RPC `tendencia_anual`
    (mig. 035) corta AMBOS años en el último día con datos del mes en curso →
    apples-to-apples (evita la falsa caída por mes parcial). Campo `tendencia`
    en InsightData; strip de chips ↑/↓. El LLM hace ALERTA/CRECIMIENTO según pct.
  - **Página /insights/enfriandose:** lista COMPLETA de clientes enfriándose
    (`computeEnfriandose` + `esEnfriandose` reutilizables), filtrable por vendedor
    (dropdown). Endpoint `/api/insights/enfriandose`. Tabla: Cliente · Localidad ·
    Vendedor · Compra cada · Hace · **Zona roja en** (`90 - dias_sin` como badge:
    verde >30 / amarillo 15–30 / rojo pulsante <15 / "En zona roja" ≤0) · $/mes ·
    **Kg/mes** · Acciones (MapPin → mapa del cliente; ClipboardList "Registrar
    visita" = placeholder, no existe la función). 3 KPI cards (clientes, $/mes,
    kg/mes). `whitespace-nowrap` en th/td (la tabla scrollea, no envuelve).
    NOTA: "enfriándose" (rompió cadencia) ≠ "tibios" del mapa (compró 1–3 meses).
    Para Kg/mes hubo que agregar `kilos` al RPC `pdvs_valor_12m` (mig. `036`).
  - **Datos (SQL):** `lib/ai/insights.ts` → `buildInsightData(svc, {label,
    carteras, avance, today})`. `carteras=null` = empresa (PAGINA pdvs: ~7000
    superan el límite de 1000 de PostgREST). Avance se calcula afuera por rol:
    admin `fetchTotalKpis`, supervisor `fetchSupervisorKpis().totales`, vendedor
    `fetchVendedorKpis` → `avanceFromKpis()`.
  - **LLM** NO redacta texto: genera **action cards** en JSON (`generateCards`
    + `parseCards` defensivo, `maxTokens` alto para no truncar). Schema por card:
    `{tipo, accion, metrica, detalle, pasos[], cta, pdv_ids[]}`, máx 5, ordenadas
    por impacto. `pdv_ids` referencia los PDVs concretos (del `churn.top`) que la
    acción menciona → el expand de la card lista esos clientes reales. El LLM no
    calcula números (salen del JSON de datos).
  - Cache en `ai_insights` (mig. 030) por `scope_key` (`empresa:total` /
    `equipo:<x>` / `vendedor:<n>`) + período; payload = `{data, cards}`. GET lee
    cache. **NO hay regeneración on-demand** (se quitó el botón "Regenerar"): el
    cache `ai_insights` se **borra en la carga de ventas** (`/api/admin/ventas/
    upload`) y los insights se regeneran lazy con los datos del día. Sin cron
    (corre junto al upload = gratis). OJO: si cambiás el shape del payload, limpiá la tabla.
  - **UI:** `InsightsClient` con lucide-react. KPI cards (Users/UserCheck/Clock/
    AlertTriangle) con borde-izq de color. Debajo, **action cards** expandibles:
    ícono+color por tipo (RECUPERACIÓN/RefreshCw, CRECIMIENTO/TrendingUp,
    COBERTURA/MapPin, ALERTA/AlertTriangle), badge de métrica, CTA que despliega
    detalle+pasos y "Marcar como gestionado" (estado local). Tailwind.
  - Endpoints con `maxDuration = 60`. **Generación fría ~17s** (KPIs empresa +
    LLM); en Vercel hobby (tope 10s) puede cortar la 1ª vez → conviene Pro o
    pre-calentar el cache. Cacheado después es instantáneo.
- **Insight → terreno:** el expand de cada card tiene "Ver en mapa" que abre
  `/mapa?pdvs=<ids>&vendedor=<n>`; el mapa lee esos params al cargar y pre-filtra
  (selPdvs/selVendedores). Cierra el círculo insight → acción.
- La narración de rutas se descartó (no aporta).

## 9. Costo de la IA (medido, 2026-07-21)

**El job nocturno NO es "una consulta por día": son 45 llamadas al LLM cada noche.**
Una por cada alcance que la app puede mostrar: 1 Total Empresa + 4 equipos + 40
vendedores activos (`daily-jobs.ts` arma los scopes desde `vendedores`).

**Medición real** (sobre los payloads ya guardados en `ai_insights`, 43 scopes / 316 cards):

| | por scope |
|---|---|
| Entrada | ~7.653 chars ≈ **2.968 tokens** (incluye ~900 del system prompt) |
| Salida | ~5.965 chars ≈ **1.612 tokens** (7-8 cards) |

Precios por millón de tokens (entrada/salida): **Sonnet 5** `$2/$10` con descuento de
lanzamiento **hasta el 31-08-2026**, después `$3/$15`. **Haiku 4.5** `$1/$5` (no cambia).

→ Con Sonnet 5: **~$0,99/día ≈ $29,78/mes**; desde septiembre **$44,66/mes**.

- **La salida domina: ~73% del costo.** Las únicas dos palancas que mueven la aguja son
  **escribir menos cards por noche** y **usar un modelo más barato**. Bajar `maxTokens`
  NO ahorra (es un tope, se cobra lo generado).
- **⚠️ `daily-jobs.ts` pasa `force: true` → saltea el cache diario que YA existe** en
  `getOrCreateInsight`. Por eso regenera los 45 todas las noches, **incluidos sábados y
  domingos**, cuando no se cargaron ventas y el `data` calculado da idéntico al del día
  anterior. Saltear cuando el `data` no cambió es el único ahorro **sin contrapartida**
  (no pierde ni frescura ni calidad) y se combina con cualquier otra medida.
- **⚠️ 40 de las 45 llamadas son análisis por vendedor que se miran de a uno** (el admin
  todos, cada supervisor los de su equipo desde el 2026-07-28). Ahí está el grueso del
  desperdicio.
  Opción evaluada: empresa+equipos diarios con Sonnet + los 40 vendedores **rotando ~6
  por noche** (refresco semanal) con Haiku → **~$5,20/mes (−83%)**. La UI ya banca el
  desfasaje: muestra "Datos al DD/MM/AAAA" + aviso azul si no es de hoy.
  **Decisión pendiente de la empresa — NO implementado todavía.**
- **El reintento ciego ante 0 cards** (`daily-jobs.ts`) duplica el costo de ese scope.
  Hoy no dispara (0 scopes vacíos), pero es un 2x latente.
- **⚠️ Sin crédito en la cuenta, TODO lo de IA cae junto** (asistente + insights + job
  nocturno): la API devuelve `400 invalid_request_error` con *"Your credit balance is too
  low"*. No es un bug de código — mirar Plans & Billing antes de debuggear.
- El chat asistente se cobra aparte y es consumo variable (no entra en los números de arriba).

---

## 10. Mapa de archivos clave (dónde está cada cosa)

**IA**
- `lib/ai/provider.ts` — capa LLM agnóstica (OpenAI/Anthropic), `getLLMProvider`, `llmAvailable`,
  **`LLMError`** (status + cuerpo, con `mensajeUsuario` en castellano).
- `lib/ai/tools.ts` — tools del asistente + `resolveCarteras` / `resolveVendedor`.
  Tools: `get_pdvs_inactivos`, `get_pdv_info`, `get_ventas`, `get_ccc_por_categoria`,
  `get_dias_con_datos`, `get_ultima_carga`.
- `lib/ai/insights.ts` — datos de insights, action cards, `computeEnfriandose`, `esEnfriandose`.
- `app/api/asistente/route.ts` — chat (tool-calling). `components/asistente/Asistente.tsx` — widget.
- `app/api/insights/route.ts` + `app/insights/` — página de insights.
- `app/api/insights/enfriandose/route.ts` + `app/insights/enfriandose/` — página de enfriándose.

**Mapa / Ruteo**
- `app/mapa/MapaClient.tsx` (+ `/api/mapa`) — mapa, filtros, panel de ruta, deep-link `?pdvs=&vendedor=`.
- `lib/routing/tsp.ts` (optimización) · `lib/routing/osrm.ts` (router peatón) · `app/api/ruta/route.ts`.

**Carga / geo**
- `app/admin/cargar/CargarClient.tsx` — UI de cargas. Endpoints en `app/api/admin/{ventas,pdvs,pdvs-geo,maestros}/upload`.
- `scripts/fix-geo-outliers.cjs` · `scripts/seed-localidades-geo.cjs` — mantenimiento de geo.

**Cálculos (reusados por dashboards e insights)**
- `lib/calculations/queries/kpis.ts` — `fetchTotalKpis` / `fetchSupervisorKpis` / `fetchVendedorKpis`.

**RPCs de Supabase (en `supabase/migrations/`, todos con `SET statement_timeout='30s'` los pesados)**
- `pdvs_ultima_vta` (028) · `bulk_upsert_pdvs_geo` + `localidades_geo` (029) · `ai_insights` (030)
- `pdvs_valor_12m` (031, +kilos en 036) · `pdvs_cadencia` (032) · `cross_sell` (033)
- `tendencia_anual` (035) · `cleanup_pdvs_geo_inactivos` (037)

**Para aplicar una migración** (Vercel no las corre): script `.cjs` con `pg` leyendo `DATABASE_URL` de `.env.local`.

---

## 11. Negocio / dominio (lo que vende y cómo se mide)

- Distribuidora de **Mondelez en el GBA** (~10 partidos). Le vende a PDVs:
  kioscos, autoservicios, supermercados, tradicionales (`canal_venta`).
- **Rubros** (de `ventas.rubro`): Biscuits, Chocolates, Beverages, Gums, Candies,
  Dry Mixes, TERCEROS, GENOMA, Others. Los dashboards agrupan por rubro.
- Se mide en **KG** (volumen, base de las metas) y en **$ neto** (`ventas.neto`).
- **Cartera** = el conjunto de clientes de un vendedor (`pdvs.cartera == vendedores.nombre`).
- **CCC = "Clientes Con Compra"**: cuántos PDVs compraron en el mes vs la
  `cartera_activa_3m` (los que compraron en los últimos 3m) → **penetración**.
- **Cobertura**: % de PDVs que compraron cada **SKU** clave (no rubro, SKU puntual).

## 12. Roles, auth y cuentas

- Roles: `admin | supervisor | vendedor` (`profiles.rol`). `profiles` linkea el
  usuario con `vendedor_nombre` y `equipo`.
- **`proxy.ts` (NO `middleware.ts`)**: en **Next 16 el middleware se llama `proxy`**.
  Hace el gate de auth con **`getClaims()`** (verifica el JWT localmente, ES256,
  sin round-trip al Auth server — esto era el cuello de performance vs `getUser()`).
  Solo fast-rejecta combos obvios; cada page re-chequea el rol server-side.
- **Landing por rol** (`app/page.tsx`): admin→`/dashboard/total`,
  supervisor→`/dashboard/supervisor`, vendedor→`/dashboard/vendedor/<nombre>`.
- **`must_change_password`**: primer login con clave temporal → `AppShell`
  redirige a `/perfil/cambiar-password` (no es middleware). `profiles.activo`
  (cuenta habilitada) ≠ `pdvs.activo` (padrón) — otro "activo" más, ojo.
- Gestión de usuarios: `/admin/usuarios`. Helpers RLS reales:
  `get_user_vendedor` / `get_user_equipo`.
- **⚠️ `'SIN SUPERVISOR'` es un EQUIPO del maestro, pero no un supervisor real** —
  hay que filtrarlo de **todo** selector de equipos. Son **4 lugares** y es fácil
  olvidarse de uno (pasó: `/dashboard/total` era el único que lo mostraba):
  `app/dashboard/total/page.tsx` (`EntityFilter`), `app/dashboard/consolidado/
  [nombre]`, `app/dashboard/consolidado-productos/[nombre]` y `app/admin/metas-ccc`
  (los 3 con `SupervisorFilter`). Usar la constante `SIN_SUPERVISOR` de
  `lib/constants.ts`, no el string suelto. Ojo: sacarlo del selector NO saca sus
  ventas de los totales (son ~31% de los kilos) — sólo deja de ofrecerlo como equipo.
- **⚠️ El equipo del supervisor sale de `profiles.equipo`, NO de `vendedores`.**
  Un supervisor normalmente **NO es una fila en `vendedores`** (no vende), así
  que derivar su equipo con `vendedores.eq('nombre', vendedor_nombre)` devuelve
  vacío → el supervisor veía TODO vacío (o, en el mapa viejo, ¡veía TODA la
  empresa!). Siempre usar `profiles.equipo` y luego `vendedores.eq('equipo', …)`.
  `UserContext` lleva `equipo`; `resolveCarteras` lo usa. **Patrón correcto en
  TODOS lados:** `let eq = profile.equipo ?? ''; if (!eq) { lookup vendedores }`.
  Barrido hecho: mapa, ruta, insights, asistente (`get_ventas`), enfriándose,
  dashboard `vendedor/[nombre]`, API `consolidado-productos`, e índice
  `/dashboard/supervisor` (el segmento de esa ruta = el EQUIPO, no el vendedor).

## 13. Dashboards y KPIs

- Páginas: `/dashboard/total` (admin), `/dashboard/supervisor/[nombre]`,
  `/dashboard/vendedor/[nombre]`, `/dashboard/consolidado(/[nombre])`,
  `/dashboard/consolidado-productos(/[nombre])`.
- **`KpiRubro`** (por rubro, en KG y $): `meta`, `acumulado`, `avance_pct`,
  `tendencia` (proyección a fin de mes = acumulado/días_trab × días_laborables),
  `media_real`, `media_necesaria`, `acumulado_aa`/`avance_vs_aa_pct` (vs año
  anterior), `mismo_dia_minus7/14`. `meta`/`tendencia` = null en meses pasados.
- `config_meses` → **días laborables** del mes (base de tendencia y media necesaria).
- **Metas** (`/admin/metas`): admin carga objetivos Mondelez en $; el sistema
  calcula kg meta y los **distribuye por peso histórico** (kg de cada vendedor
  sobre el total del rubro, últ. 4 meses) vía `calcularMetasPreview`. Se pueden
  **excluir vendedores no operativos** — `vendedoresExcluidos` filtra ANTES de
  calcular el total y su parte se redistribuye entre los reales. Flujo: preview →
  guardar (persiste el preview).
- **⚠️⚠️ Tocar el CÁLCULO no cambia las metas YA GUARDADAS.** `metas` es una tabla
  persistida: un cambio en `calcularMetasPreview` sólo afecta al **próximo preview**.
  Hasta que alguien corra **Calcular preview → Guardar**, la meta vieja sigue viva
  en los dashboards. **Deployar NO alcanza** (nos pasó: se pusheó el cambio y la
  oficina seguía con 29.745 kg). Todo cambio de regla de metas = código **+**
  recálculo del mes en curso. `metas/guardar` **borra el mes entero** (`delete`
  por anio+mes) antes de insertar, así que re-guardar es idempotente y limpia
  los vendedores que dejaron de recibir meta.
- **⚠️ Los objetivos Mondelez en $ NO se persisten** — los inputs de `/admin/metas`
  arrancan vacíos cada vez, así que re-guardar un mes exige re-tipearlos. Se
  **recuperan** de lo guardado: para un rubro Mondelez, `sum(neto_meta)` sobre
  todos los vendedores **== `objetivo_neto`** (los pesos suman 1). Julio 2026 usó:
  Beverages 197.571.480 · Biscuits 393.788.626 · Candies 51.094.451 ·
  Chocolates 509.502.795 · Dry Mixes 24.838.035 · Gums 73.093.693.
- **⚠️ Los vendedores SIN SUPERVISOR no reciben meta (default, 2026-07-17).**
  `vendedores.supervisor` trae el **literal `'SIN SUPERVISOR'`** (NO `null` —
  `tieneSupervisor()` en `lib/constants.ts` cubre literal + vacío + null). Son 6:
  VENTA OFICINA LANUS, VENTA OFICINA F.VA, JEREMIAS, DEPOSITO, CLAUDIA ZALAZAR,
  VENDEDOR 28. Entran **pre-tildados** en el selector de excluidos (badge
  `sin sup.`), destildables — es preview → guardar, no regla rígida.
  - **Por qué:** son locales/oficina cuya venta no depende de la gestión
    comercial; darles meta le robaba peso a los vendedores reales.
  - **Decisión explícita del usuario: la meta TOTAL no baja.** Se reparte entre
    menos ⇒ a los supervisados les **sube**: Biscuits **+68,9%**, Beverages
    **+62%**, Chocolates **+13,3%** (medido contra la DB real). Casi todo el
    efecto es **VENTA OFICINA F.VA sola** (~31% de los kilos totales, 141k kg en
    4 meses). **Esto cascadea a las metas CCC** — mirar el preview antes de guardar.
- **⚠️ Gap de datos abierto: los nombres de `ventas` no matchean el maestro.**
  El reparto pesa por nombre EXACTO de `resumen_diario`, así que la exclusión los
  erra: ventas dice **`VENTA OFICINA LANU`** (sin la S, 12.330 kg) vs maestro
  `VENTA OFICINA LANUS`, y **`JEREMIAS - VDR`** vs `JEREMIAS`. Además venden sin
  estar en el maestro (supervisor desconocido): `Sin Vendedor`, `RAUL VAZQUEZ`,
  `ELIANA IGLESIAS`, `VICTORIA VELAZ`, `ENZO`, `NESTOR MIERA`, `CARLOS PAREDES`,
  `VENDEDOR 25`. **Julio 2026 se recalculó excluyendo también a `VENTA OFICINA
  LANU` y `JEREMIAS - VDR` a mano** (los otros quedaron CON meta: `RAUL VAZQUEZ`
  910 kg, `ELIANA IGLESIAS` 675 kg — no se sabe su supervisor, no se adivinó).
  Resultado: total 102.030 → 102.039 kg (igual, la diferencia es redondeo), los
  sin supervisor en 0 y el resto **+31% a +61%**.
  `app/admin/metas/page.tsx` los suma al selector con badge
  **`s/maestro`** (sin tildar — no se adivina el supervisor) para excluirlos a
  mano. **Arreglo de fondo: corregir los nombres en el maestro**, no en código.
  Misma familia que las carteras huérfanas del mapa.
- **⚠️⚠️ `buildKpi` ESTIMA la meta en $ si no le pasás `neto_meta_stored`** (`lib/calculations/
  dashboard.ts`). El fallback es `kilos_meta × ($/kg realizado)` — un número plausible pero
  **inventado**, que no es el objetivo cargado a mano en Configuración → Metas.
  - **Nos rompió la vista de supervisor (2026-07-21):** `fetchSupervisorKpis` guardaba en
    `metasVd` sólo `kilos_meta` y **descartaba `neto_meta`**, así que el camino `porVendedor`
    llamaba a `buildKpi` sin `neto_meta_stored` y mostraba la estimación.
    `fetchVendedorKpis` y `fetchTotalKpis` sí pasan el valor real → **la meta $ del supervisor
    no coincidía ni con la matinal de Mondelez ni con el dashboard individual del vendedor**,
    mientras que el acumulado sí coincidía (ese viene de ventas, no de metas).
  - **Afectaba a TODOS los vendedores, no a algunos.** Medido sobre 07/2026: desvíos de hasta
    **+55%**, y los vendedores **sin ventas en el mes mostraban meta $0** (sin ratio $/kg el
    fallback no puede calcular nada). Lo que varía es cuánto, no si.
  - **Regla:** cualquier camino nuevo que llame a `buildKpi` directo (sin pasar por
    `buildKpisFromRpc`) **tiene que pasar `neto_meta_stored`**. Si un número de metas "casi
    coincide" pero no exacto, sospechar de este fallback antes que de la query.
  - Ojo también con el **caché**: `fetchSupervisorKpis` está en `unstable_cache`
    (`revalidate: 300`, tag `kpis`) → el arreglo se ve recién al expirar.
- **⚠️ Dos fuentes de verdad para "quién es del equipo"** (gap abierto, hoy no rompe):
  `kpi_por_vendedor` scopea por **`resumen_diario.equipo`** (denormalizado en las ventas),
  pero las metas se filtran por **`vendedores.equipo AND activo = true`** (el maestro).
  Si alguien se da de baja del maestro con ventas del mes ya cargadas, aparece en la tabla
  del supervisor **con meta 0**. Verificado 07/2026: sólo desalinean `Sin Vendedor` y
  `VENTA OFICINA LANU`, ambos sin equipo. Misma familia que el gap de nombres de arriba.
- `metas` (kilos meta por vendedor/rubro/mes) · `metas_ccc` (objetivo de clientes;
  cascadeo con RPC `calcular_preset_ccc`, se recalcula en el upload de PDVs y NO
  pisa lo editado por el supervisor, `es_preset=false`).
- Componentes: `KpiTable`, `ClientesTable` (CCC), `CoberturaTable`, `CccCard`,
  `TrendChart` / `AvanceBarChart` (recharts, lazy en `LazyCharts`).

## 14. Pipeline de carga + recálculo (4 archivos)

`/admin/cargar` (`CargarClient`) → endpoints `app/api/admin/{ventas,pdvs,maestros,pdvs-geo}/upload`.
- **Ventas**: dedup por unique `(fecha,pdv_id,comprobante,sku)`; confirma
  "huérfanos" (vendedores en ventas que no están en el maestro). Tras cargar →
  `recalcular_resumen_diario`.
- **Maestro PDVs (unificado)**: una sola carga hace maestro + geo del mismo
  archivo (reemplazo por baja lógica + limpieza de geo + guardrail, §6). Detalle
  de la unificación y de los encabezados reales, abajo en este §14.
- **Maestro vendedores** (§4). Validación de coords en la carga geo (§4).
- Tablas materializadas que alimentan dashboards (se recalculan con RPCs
  `recalcular_*`): `resumen_diario`, `resumen_clientes_pdv`, `catalogo_productos`,
  `consolidado_productos`. **Zona de peligro**: borrar-mes + recalcular-resumen.
- Parser de Excel en `lib/excel/parser` (xlsx/exceljs); archivos grandes → cargar local.

### Formato real de los archivos de PDV (verificado 2026-07-10)

Encabezados reales de los dos exports que usa el negocio (hoja 1, fila 1):

- **`PUNTOS DE VENTAS ACTIVOS 8-07.xlsx`** — 49 columnas, **CON** geo.
- **`PUNTOS DE VENTAS ACTIVOS SIN GEOLOCALIZACION.xlsx`** — 43 columnas,
  **mismas 0-42**, sin las 6 columnas geo del final. Es literalmente el mismo
  archivo recortado.

Columnas (índice → nombre EXACTO en el Excel):
`0 Fecha Alta` · `1 Ultima Vta.` · `2 PDV` · `3 Cod. Cliente` · `4 Razón Social` ·
`5 DOMICILIO` · `6 Localidad` · `7 Partido` · `8 Provincia` · `9 Tel. Móvil` ·
`10 Otro Tel.` · `11 Cat.` · `12 Cartera` · `13 VENDEDOR` · `14 Acuerdos comerciales` ·
`15 Zona` · `16 Calle` · `17 Altura` · `18 Obs. internas` · `19 Obs. Logística` ·
`20 Obs. Facturas` · `21 Canal Distribucion` · `22 Canal Vta.` · `23 Categoría IVA` ·
`24 CUIT` · `25 Cod. Postal` · `26 Barrio` · `27 Frecuencia Visita` ·
`28 Visitar esta semana` · `29-35 LUN..DOM` (S/N) · `36-42 HS_LUN..HS_DOM` ·
**solo el CON geo:** `43 LATITUD` · `44 LONGITUD` · `45 Domicilio_GEO` ·
`46 Fecha_GEO` · `47 Hora_GEO` · `48 Prioridad del preparado`.

- **PDV (idx 2) y Cod. Cliente (idx 3) traen el mismo número** en la muestra;
  igual `pickPdvId` prioriza PDV (correcto — pueden diferir).
- **Mismatches de encabezado que había con `parsePdvFile` (CORREGIDOS 2026-07-11):**
  el parser buscaba claves exactas que NO coincidían con este export, así que
  entraban **vacías**: `Domicilio` (el archivo dice `DOMICILIO`), `Canal Venta`
  (dice `Canal Vta.`), `Ultima Vta` (dice `Ultima Vta.` con punto). `Canal Vta.`
  alimenta el filtro de canal del mapa. Verificado sobre los 6992 registros: antes
  0, ahora ~6991 con domicilio/canal y 6922 con última venta.

### Carga unificada maestro + geo (IMPLEMENTADO 2026-07-11)

El export **CON geo es superset del maestro** (todas las columnas del maestro +
LAT/LNG), así que **una sola drop-zone** ("Maestro de Clientes") alimenta `pdvs`
**y** `pdvs_geo`. En `CargarClient.tsx`:
1. `handlePdvsFile` parsea el archivo una vez → filas de maestro (siempre) +
   filas de geo (`parseGeoFile`, filtradas a las que traen LATITUD/LONGITUD).
2. **Orden obligatorio:** upsert de `pdvs` **primero** (crea el `id`), después
   `runGeoUpload` → `pdvs_geo` (FK a `pdvs.id`; `bulk_upsert_pdvs_geo` filtra
   huérfanos por JOIN). Si hay confirmación pendiente (reasignaciones/baja
   masiva), la geo espera y se sube recién en `confirmPdvsUpload`.
3. El archivo **SIN GEO** cae solo: mismas columnas sin coords ⇒ 0 filas geo ⇒
   `runGeoUpload` no hace nada, solo se carga el maestro.

**Robustez de encabezados:** `normKey` (minúsculas + sin acentos/espacios/puntos)
+ `rowGetter(r)('Canal Venta','Canal Vta')` blindan los parsers contra renombres.
La validación geo del §4 (`bulk_upsert_pdvs_geo`) y la baja lógica + guardrail del
§6 siguen igual (el geolocalizado ES el maestro). Nota: el export CON geo NO trae
columna `Ruteable` → `ruteable` queda null en `pdvs_geo`.

## 15. Diseño / UI (convenciones)

- Tema "shadcn light" **hand-rolled con hex hardcodeado** (no design tokens en la
  mayoría). Paleta: bg `#fafafa`, card `#fff`, texto `#09090b`, primario azul
  `#0c5cab`, muted `#71717a`, borde `#e4e4e7`; semánticos verde `#16a34a`,
  amarillo `#eab308`/`#d97706`, rojo `#dc2626`.
- Fuentes: **IBM Plex Sans** (body) y **JetBrains Mono** (números/labels mono).
- El dashboard usa tamaños chicos hardcodeados (`text-[11px]`..`text-[22px]`) +
  SVG inline. Las páginas nuevas (insights/enfriándose) usan **escala Tailwind +
  lucide-react** — al tocar esas, seguí ese estilo; en el resto, imitá el hex.
- Mobile: sidebar hamburguesa + top-bar (`ShellLayout`); tablas con
  `overflow-x-auto + min-w-[…]`; headers `flex-col sm:flex-row`.
- **SIN EMOJIS en la UI.** Nada de 🧭/🎉/⚠/✅ en pantalla — usar texto plano +
  color, o íconos lucide/SVG. (Regla del usuario, no negociable.)
- **Cards del sistema**: `rounded-2xl border border-[#e4e4e7] shadow-xl
  shadow-black/5 bg-white`; KPIs con `border-l-4` de color semántico.
- **Gotcha tab bar**: `overflow-x-auto` fuerza `overflow-y` a `auto`; combinado
  con `-mb-px` (subrayado de tab activa) genera una barrita de scroll de 1px.
  Para barras de pestañas usar **`flex-wrap`** (ver `AdminTabs`), no overflow-x-auto.
- **OJO**: algunos prompts traen un "design system dark `#060c1a`/`#3b82f6`" que
  NO es el de este proyecto (es claro). Seguir SIEMPRE los hex reales de arriba.

## 16. Performance / caching

- `fetch*Kpis` usan `unstable_cache`; tras una carga se invalida con
  `revalidateTag('kpis')`.
- Auth: `getClaims()` local (ES256) en `proxy.ts` en vez de `getUser()` (era el
  cuello). DB rápida (~3.5ms las queries simples).
- `/api/mapa` cachea 5 min por usuario; insights cacheados por mes en `ai_insights`.

## Comandos

- `npm run dev` (Next + Turbopack) · `npm run build` · `npm run lint` · `npx tsc --noEmit`.
- Migraciones: aplicarlas con un script `.cjs` + `pg` leyendo `DATABASE_URL` de
  `.env.local` (Vercel NO las corre). Scripts de carga: `npm run load:historical`,
  `npm run load:pdvs`.

# Contexto para Claude — Lecciones de este proyecto (Candysur / Distr2)

> **Cómo usar este archivo:** pasáselo a Claude al empezar a trabajar en esta app.
> Resume decisiones y trampas que ya nos costó descubrir, para que todo quede
> "joya" sin repetir el mismo aprendizaje. Es un documento **vivo**: cada vez que
> resolvemos algo no obvio, se agrega acá.

App de gestión de ventas para una distribuidora de Mondelez en el GBA.
Stack: **Next.js 16 (App Router, Turbopack) + Supabase (Postgres) + Vercel**.
Idioma del producto y de los textos: **español rioplatense**.
Producción: **https://distr2.vercel.app** (auto-deploy desde `main`).
_Última actualización: 2026-06-23 · migraciones hasta `037`._

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
- 🟢 verde = compró ≤ 1 mes · 🟡 amarillo = > 1 mes · 🔴 rojo = > 3 meses / nunca.
- La fecha sale pivoteada de `ventas` (RPC `pdvs_ultima_vta`), no del campo
  cacheado. `activo_3m` se deriva de esa misma fecha.
- `/api/mapa` cachea por usuario 5 min (`Cache-Control: private, max-age=300`):
  tras cambios, hace falta **Ctrl+Shift+R**.

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
- **Clientes apagados cercanos** (sin IA): PDVs en rojo (sin compra +3 meses)
  a ≤ radio de la ruta — proximidad geométrica, no LLM. El endpoint los devuelve
  en `sugerencias`; el panel los lista (clickeable → `FlyTo` centra el mapa) y
  los dibuja como rombos rojos.
  - **Radio ajustable**: param `radio` (m, clamp 100–2000, default 400); selector
    en el panel. **Sumar a la ruta**: param `extra` (ids coma-separados) → esos
    PDVs se agregan como paradas (flag `RutaStop.agregado`) y se re-optimiza todo;
    el panel tiene botón "+ Sumar" por sugerencia y chips "Sumados" con quitar.

---

## 6. Secrets, uploads y operativa

- Archivos grandes se cargan **corriendo la app local**, no por la URL pública
  de Vercel (tope 4.5 MB + timeout).
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
- La IA necesita **una sola** var: **`OPENAI_API_KEY`** (nombre EXACTO). `AI_PROVIDER`,
  `OPENAI_MODEL`, `ANTHROPIC_API_KEY` son opcionales — NO crearlas salvo que pases
  a Claude. Si `AI_PROVIDER=anthropic` por error, `llmAvailable()` mira la key de
  Anthropic y da "no configurado".
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
- **Módulo 3 — insights (HECHO):** página propia `/insights` (link en sidebar).
  - **Flujo:** por default muestra la vista AGREGADA del alcance del usuario
    (admin → "Total Empresa"; supervisor → su equipo; vendedor → su cartera).
    El selector arranca neutro ("Filtrar por vendedor…"); elegir uno cambia a
    esa cartera. El scope se respeta server-side (un vendedor NO ve la empresa).
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
    cache, POST regenera. OJO: si cambiás el shape del payload, limpiá la tabla.
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

## 9. Notas de costo/operación de IA
- Modelo default barato (`gpt-4o-mini`). Subir a `gpt-4o` solo si hace falta.
- Insights cacheados por mes (no se regeneran salvo "Regenerar").
- Asistente: historial acotado a 12 msgs y máx 5 turnos de tools.
- En Vercel: cargar `OPENAI_API_KEY` en env vars o la IA no aparece (degrada).

---

## 10. Mapa de archivos clave (dónde está cada cosa)

**IA**
- `lib/ai/provider.ts` — capa LLM agnóstica (OpenAI/Anthropic), `getLLMProvider`, `llmAvailable`.
- `lib/ai/tools.ts` — tools del asistente + `resolveCarteras` / `resolveVendedor`.
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
- **Maestro PDVs**: reemplazo por baja lógica + limpieza de geo + guardrail (§6).
- **Maestro vendedores** y **Geo** (§4).
- Tablas materializadas que alimentan dashboards (se recalculan con RPCs
  `recalcular_*`): `resumen_diario`, `resumen_clientes_pdv`, `catalogo_productos`,
  `consolidado_productos`. **Zona de peligro**: borrar-mes + recalcular-resumen.
- Parser de Excel en `lib/excel/parser` (xlsx/exceljs); archivos grandes → cargar local.

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

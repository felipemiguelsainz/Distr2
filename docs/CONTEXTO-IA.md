# Contexto para Claude — Lecciones de este proyecto (Candysur / Distr2)

> **Cómo usar este archivo:** pasáselo a Claude al empezar a trabajar en esta app.
> Resume decisiones y trampas que ya nos costó descubrir, para que todo quede
> "joya" sin repetir el mismo aprendizaje. Es un documento **vivo**: cada vez que
> resolvemos algo no obvio, se agrega acá.

App de gestión de ventas para una distribuidora de Mondelez en el GBA.
Stack: **Next.js 16 (App Router, Turbopack) + Supabase (Postgres) + Vercel**.
Idioma del producto y de los textos: **español rioplatense**.

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
- Credenciales (OpenAI, etc.): el usuario las pone en `.env.local`; nunca pegarlas
  en el chat ni commitearlas.
- Migraciones: numeración correlativa en `supabase/migrations/` (última conocida:
  `029_*`). Vercel **no** corre migraciones; se aplican aparte contra la DB.
- Funciones `SECURITY DEFINER` de escritura: `REVOKE` a public/anon/authenticated
  + `GRANT` a `service_role` (ver migración `024`).

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
- La narración de rutas se descartó (no aporta).

## 9. Notas de costo/operación de IA
- Modelo default barato (`gpt-4o-mini`). Subir a `gpt-4o` solo si hace falta.
- Insights cacheados por mes (no se regeneran salvo "Regenerar").
- Asistente: historial acotado a 12 msgs y máx 5 turnos de tools.
- En Vercel: cargar `OPENAI_API_KEY` en env vars o la IA no aparece (degrada).

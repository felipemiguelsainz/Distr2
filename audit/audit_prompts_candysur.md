# Auditorías Candysur Dashboard — Prompts para GitHub Copilot

---

## Auditoría 1 — Seguridad

```
You are a security auditor specializing in Next.js and Supabase applications.

Perform a complete security audit of this codebase. Analyze every file provided.

Check for and report on:

1. AUTHENTICATION & AUTHORIZATION
   - API routes that use the service role client without first verifying the caller's role via auth.getUser() + profiles table
   - Pages or components that assume a role based on URL params instead of the authenticated session
   - Missing or incorrect RLS policies that could allow a lower-privileged role (vendedor, supervisor) to read or write data they shouldn't
   - Any route that accepts user-supplied values (URL params, body fields) and uses them directly in DB queries without validation

2. INPUT VALIDATION
   - API routes that accept large JSON bodies without a size limit (next.config.ts bodySizeLimit)
   - File upload endpoints that don't validate file type, file size, or MIME type before parsing
   - Any field taken from request.body or searchParams that is passed directly to a Supabase query, RPC call, or SQL function without sanitization
   - Excel parser: fields that are cast with String() or parseInt() without bounds checking or max-length enforcement

3. DATA EXPOSURE
   - Server components or API routes that return more columns than the client needs (over-fetching)
   - Error messages in catch blocks that expose internal stack traces or DB error details to the client (NextResponse.json({ error: msg }))
   - Any place where the service role key might be used client-side or leaked in a client bundle

4. SUPABASE-SPECIFIC
   - RLS policies that use helper functions (get_user_rol, get_user_vendedor) — verify these functions are SECURITY DEFINER and cannot be bypassed
   - Policies that rely on text matching (vendedor name as string) instead of UUID — these are bypassable if a user can manipulate their profile
   - Service client instantiation: confirm it is never imported into any client component

5. MISSING PROTECTIONS
   - No rate limiting on upload endpoints (a user could flood the DB)
   - No CSRF protection on state-mutating POST routes
   - No audit log for admin actions (uploads, reasignaciones, meta changes)

For each issue found:
- File path and line number
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- What the risk is in plain terms
- Exact code fix

At the end, produce a summary table: Issue | File | Severity | Status (Found/Not Found).
```

---

## Auditoría 2 — Rendimiento

```
You are a performance engineer specializing in Next.js App Router, Supabase PostgreSQL, and large-scale data applications.

This app has a ventas table with 1M+ rows and a resumen_diario pre-aggregation table. Perform a complete performance audit.

Check for and report on:

1. DATABASE QUERY PATTERNS
   - Queries that hit ventas directly instead of resumen_diario (especially in dashboard pages)
   - fetchCCC and fetchCobertura both query ventas with COUNT — check if they use the correct covering indexes (idx_ventas_sku_vendedor_periodo, idx_ventas_vendedor_fecha_rubro)
   - RPCs kpi_resumen, kpi_tendencia, kpi_por_vendedor — verify their WHERE clauses align with existing indexes on resumen_diario
   - clientes_compra_rubro RPC — verify it doesn't do a full scan on ventas
   - Any query using .in('field', largeArray) where the array could have 30+ elements (supervisor team queries)

2. DATA FETCHING STRATEGY
   - Server components making sequential awaits where Promise.all() could parallelize
   - unstable_cache usage: verify cache keys are specific enough (include year, month, vendedor) to avoid stale data across users
   - react cache() usage: verify it is only used in server components and not called across requests
   - Any fetch that re-runs on every render instead of being cached

3. EXCEL PARSING
   - XLSX.read() called with the full ArrayBuffer in memory — flag any file that could be large (historical loads, full PDV master)
   - parseVentasFile loads the entire sheet into memory via sheet_to_json before chunking — this is fine for daily files but identify the memory ceiling
   - Check if the historical load script uses streaming or loads the full workbook at once

4. UPLOAD PIPELINE
   - recalcularResumenDiario is called synchronously inside the upload request — if it's slow, the HTTP response hangs. Should it be a background job?
   - Chunk size of 500 for ventas upsert: is this optimal for Supabase's HTTP API? Flag if there's no parallelism between chunks
   - PDV upload sends the full parsed JSON in the request body — for large masters (5000+ rows) this could hit Next.js body limits and cause slow serialization

5. FRONTEND
   - Any client component fetching data on mount instead of receiving it as a server-rendered prop
   - Missing loading states that cause layout shift
   - KpiTable, ClientesTable, CoberturaTable: check if they re-render unnecessarily (missing memo or stable props)
   - TrendChart: Recharts renders all data points — for monthly charts this is fine, but verify it doesn't receive unbounded datasets

6. MISSING OPTIMIZATIONS
   - No pagination on any table (ClientesTable could have hundreds of rows for a supervisor)
   - No debounce on filter changes in dashboard views
   - resumen_diario has no partial index for the current month (most frequent query target)

For each issue:
- File path and line
- Impact: HIGH / MEDIUM / LOW
- Estimated query cost or render cost if measurable
- Specific fix with code

At the end, rank the top 5 highest-impact fixes by effort/gain ratio.
```

---

## Auditoría 3 — Flujo

```
You are a UX engineer and full-stack developer auditing the user flows of a Next.js sales dashboard application.

The app has three roles: admin, supervisor, vendedor. Audit every user-facing flow end to end.

Check for and report on:

1. UPLOAD FLOW (admin)
   - What happens if the user uploads a ventas file for a date range already loaded? Is the duplicate handling communicated clearly?
   - PDV upload has a confirmation step for reasignaciones — what happens if the user closes the browser mid-confirmation? Is state lost?
   - What happens if the Excel file has a sheet name different from expected? Does the parser fail silently or show a useful error?
   - Is there feedback during the upload (progress bar, spinner)? Or does the UI freeze while parsing a large file?
   - After upload, does the dashboard auto-refresh or does the user need to navigate away and back?
   - What happens if recalcularResumenDiario fails after ventas are already inserted? The data is in ventas but resumen_diario is stale — is the user informed?

2. DASHBOARD NAVIGATION FLOW
   - Admin navigates to /dashboard/total — what is the default month/year? Is it always the current month or does it remember the last selection?
   - Supervisor navigates to their dashboard — how does the app know which equipo they belong to? Trace the full path from auth.getUser() to the equipo filter
   - Vendedor navigates to /dashboard/vendedor/[nombre] — can they change the [nombre] param in the URL to see another vendor's data? Is there a server-side guard?
   - Month filter: when the user changes the month, does the full page reload or is it a client-side update? Is there a loading state?

3. METAS FLOW (admin)
   - How are metas loaded for a new month? Trace the full flow from the xlsb file to the metas table
   - What happens if metas are loaded twice for the same month? Is there a warning?
   - If a vendor is renamed or replaced mid-month, their metas are keyed by vendedor_nombre (text). What breaks?

4. ERROR STATES
   - Map every API route to its error response. Are errors shown to the user in the UI or swallowed?
   - What does the user see if Supabase is unreachable?
   - What does the user see if their session expires mid-session?
   - Are form validation errors shown inline or only on submit?

5. MOBILE FLOW
   - The sidebar — does it collapse on mobile? Is there a hamburger menu?
   - Upload zones — can a mobile user select a file from their device (not drag and drop)?
   - KpiTable has many columns — does it scroll horizontally on mobile or does it break layout?
   - Are touch targets (buttons, dropdowns) at least 44px tall?

6. MISSING FLOWS
   - There is no flow to manually trigger resumen_diario recalculation if it gets out of sync
   - There is no flow to deactivate a vendor (set activo = false) from the UI
   - There is no flow to view or edit the asignaciones history
   - There is no empty state for a vendor with no sales data in the selected month

For each issue:
- Affected role(s)
- Flow step where it breaks
- Severity: BLOCKER / MAJOR / MINOR
- Recommended fix (UI change, API change, or both)

At the end, list the 3 flows most likely to cause data integrity issues if they fail.
```

---

## Auditoría 4 — Base de Datos

```
You are a PostgreSQL database architect auditing the schema, indexes, RPCs, and data integrity of a Supabase application that handles 1M+ rows in its main table.

Audit every migration file (001 through 005) and every RPC/query in the codebase.

Check for and report on:

1. SCHEMA INTEGRITY
   - Foreign keys: ventas.pdv_id references pdvs.id — but the upload route auto-creates missing PDVs with minimal data. Audit the side effects of this: what columns are NULL for auto-created PDVs and which queries break as a result?
   - vendedores.nombre is TEXT UNIQUE used as a join key across ventas, metas, resumen_diario, planificacion, asignaciones. There is no UUID FK. What happens on a typo or a name change? List every table and query affected.
   - metas UNIQUE constraint is on (anio, mes, vendedor_nombre, rubro) — vendedor_nombre is free text. Audit all places that write to metas and verify the name format is consistent with vendedores.nombre
   - resumen_diario has no FK to vendedores — it stores vendedor as free text. Verify resumen_diario.vendedor always matches vendedores.nombre exactly, or find where drift can occur
   - updated_at triggers exist on pdvs, vendedores, profiles — but NOT on metas, planificacion, resumen_diario. Flag tables that should have it

2. INDEX AUDIT
   - For each index in migrations 001 and 005, verify it is actually used by at least one RPC or query in the codebase
   - Identify any query or RPC that does a filter or join on a column with no index
   - resumen_diario is queried by (fecha, equipo), (fecha, vendedor), (fecha, rubro) — verify composite index coverage for all three patterns
   - ventas is queried by (vendedor, mes, anio), (sku, vendedor, mes, anio), (vendedor, fecha, rubro, pdv_id) — verify each has a covering index
   - pdvs is queried by cartera WHERE activo = true — verify idx_pdvs_cartera_activo is a partial index and covers this exact pattern
   - Identify any index that is redundant (fully covered by a wider index)

3. RPC AUDIT
   - kpi_resumen: runs on resumen_diario with optional equipo/vendedor filters. Verify the query plan uses indexes and doesn't fall back to seq scan when both params are NULL (total company query)
   - kpi_tendencia: same table, same concern — verify the GROUP BY fecha doesn't cause a sort operation without an index
   - kpi_por_vendedor: groups by vendedor and rubro — verify this doesn't scan the full resumen_diario for large date ranges
   - kpi_dias_trabajados: audit what this RPC does — if it counts distinct dates from resumen_diario or ventas, flag it as potentially slow
   - clientes_compra_rubro: this queries ventas directly (not resumen_diario) with COUNT DISTINCT pdv_id grouped by rubro. This is the most expensive query in the app. Audit its index usage and propose a pre-aggregation strategy
   - All RPCs are LANGUAGE sql STABLE — verify STABLE is correct (no side effects, same result within a transaction). Flag any that should be VOLATILE

4. DATA CONSISTENCY RISKS
   - resumen_diario is rebuilt by recalcularResumenDiario after each upload. What happens if two uploads run concurrently? Is there a race condition on the UPSERT?
   - ventas UNIQUE constraint: (fecha, pdv_id, comprobante, sku). Can two different sales lines for the same SKU on the same comprobante exist? If so, this constraint is too strict and silently drops valid rows
   - asignaciones has no UNIQUE constraint — can the same (cartera, vendedor_nombre, fecha_desde) be inserted twice? What is the effect on the PDV upload confirmation flow?
   - metas: if a vendor is loaded with slightly different name casing (e.g. "GUIDO PEREZ" vs "Guido Perez"), two rows exist for the same logical vendor. Propose a fix (COLLATE, trigger, or application-level normalization)

5. MISSING CONSTRAINTS AND SAFEGUARDS
   - No CHECK constraint on ventas.kilos or ventas.neto — negative values are valid (credit notes) but unbounded values (e.g. 999999 kg) could indicate a parse error
   - No CHECK constraint on metas.kilos_meta >= 0
   - config_meses table (referenced in queries.ts) — audit its schema, indexes, and whether dias_laborables has a valid range constraint (1–31)
   - planificacion has no UNIQUE constraint on (fecha, vendedor_nombre, rubro) — duplicate planning rows for the same day/vendor/rubro are possible
   - No archiving strategy for ventas rows older than 2 years — propose a partitioning or archiving approach

For each issue:
- Migration file or query file affected
- Risk: DATA LOSS / DATA CORRUPTION / SILENT BUG / PERFORMANCE / MISSING CONSTRAINT
- SQL fix or application fix
- Priority: P0 / P1 / P2

At the end, produce a dependency graph in text form showing which tables are coupled by text-key joins instead of FK constraints, and rate the overall schema integrity as a score out of 10 with justification.
```

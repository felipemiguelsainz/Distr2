<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Chequeos

Antes de tocar KPIs, metas o rangos de fechas: `npm run check:periodo` (no necesita
base) y, si cambiaste los RPC o cargaste datos, `npm run check:kpis -- 2026-07` (contra
la base real).

El rango de un mes se arma **siempre** con `rangoDelPeriodo(year, month, today)`.
Pasarle `hoy` a `p_hasta` con un mes pasado suma los meses siguientes: julio llegó a
mostrar 178.615 kg donde había 81.737. `check:periodo` falla si vuelve a aparecer.

# Candysur — Dashboard de Ventas

Documento de producto. Estado de lo implementado y roadmap de integración de IA.

_Última actualización: 2026-08-04_

---

## 1. Qué es

Dashboard de ventas para **Candysur Distribuidora**. Centraliza la performance
comercial de la distribuidora: ventas por equipo, vendedor, producto, cliente y
zona geográfica; carga de metas mensuales; y seguimiento de cumplimiento.

**Stack:** Next.js 16 (App Router) · Supabase (PostgreSQL) · Recharts · Tailwind v4.

---

## 2. Roles

| Rol | Acceso |
|-----|--------|
| **admin** | Todo: dashboards globales, consolidados de los 3 equipos, carga de archivos, metas, panel de configuración. |
| **supervisor** | Solo su equipo: consolidado del equipo, vista por producto del equipo, mapa. |
| **vendedor** | Solo su propio dashboard. |

El acceso está protegido en dos capas: guards server-side por ruta + Row Level
Security (RLS) en PostgreSQL.

---

## 3. Funcionalidad implementada

### 3.1 Dashboards de ventas
- **Total Empresa** (`/dashboard/total`) — KPIs globales por rubro: meta, acumulado,
  tendencia, avance %, media real, media necesaria.
- **Consolidado** (`/dashboard/consolidado/[equipo]`) — KPIs por vendedor de un equipo,
  en tres tablas: Volumen KG, Volumen $, CCC (Clientes con Compra). El admin elige
  equipo con un selector —incluida la opción **Total Empresa**, que agrega los tres
  equipos—; el supervisor ve directamente el suyo.
- **Por producto** (`/dashboard/consolidado-productos/[equipo]`) — el mismo consolidado
  pero filtrable por producto: un buscador con los ~460 artículos agrupados por rubro
  permite tildar los que se quieran y las tablas se recalculan en vivo. También
  acepta Total Empresa (sólo admin).
- **Dashboard de vendedor** (`/dashboard/vendedor/[nombre]`) — vista individual:
  KPIs, tendencia diaria, CCC, cobertura de SKUs clave, clientes por rubro.

### 3.2 Filtros
Todos los dashboards usan la misma barra (`components/ui/FilterBar.tsx`):

- **Botón Aplicar** — la selección se arma en local y se navega una sola vez. Nada
  recarga hasta tocar Aplicar.
- **Multi-mes y multi-año** — `?mes=6,7,8&anio=2026`. Los períodos elegidos (años ×
  meses) se **suman**: acumulado, meta, días laborables y comparativos AA. Los meses
  futuros se descartan. Tope: 24 períodos.
  - La **tendencia** agregada = cierre real de los meses cerrados + proyección del
    mes en curso.
  - El **CCC**, la **tendencia diaria** y la **cobertura** son mensuales y no se
    suman (los clientes se repiten entre meses): se muestran los del período más
    reciente elegido, aclarado en el encabezado de cada tabla.
- **Cierre mes pasado** — atajo que salta al mes anterior cerrado.
- **Total Empresa** — opción del selector de equipo, sólo admin (segmento
  `__total__` en la URL).

### 3.3 Cálculo de KPIs
- **Avance %** se calcula sobre la **tendencia** (proyección a fin de mes), no sobre
  el acumulado — salvo en meses cerrados, donde cae al acumulado.
- **Tendencia** = media diaria real × días laborables del mes.
- **Días trabajados** = días distintos con ventas cargadas del mes corriente.
- **Meses cerrados** — muestran **Meta / Cierre / Cumpl.**: cómo cerró el mes contra
  su objetivo. No muestran tendencia ni media necesaria (ya no hay nada que proyectar).

### 3.4 Metas
- Carga de objetivos mensuales (`/admin/metas`).
- **Rubros Mondelez:** el admin ingresa el objetivo en $; el sistema lo convierte a
  kg con el ratio $/kg del mes anterior.
- **Rubros no-Mondelez:** meta calculada por estacionalidad — peso del mes objetivo
  vs. el mes anterior en el año previo.
- La meta total de cada rubro se distribuye entre vendedores según su peso histórico.

### 3.5 Carga de datos
- **Ventas** — archivo Excel diario/mensual. Upsert por `(fecha, pdv, comprobante, sku)`;
  re-subir un archivo corregido sobrescribe. Dispara el recálculo de las tablas
  pre-agregadas.
- **PDVs** — maestro de puntos de venta. Reemplazo completo: los PDVs ausentes del
  archivo se marcan inactivos. Detecta reasignaciones de cartera y pide confirmación.
- **Vendedores** — maestro de vendedores. Al cambiar equipos, recalcula el histórico.
- **Geo PDVs** — coordenadas para el mapa.

### 3.6 Mapa de PDVs
- `/mapa` — visualización geográfica de los puntos de venta con clustering.

### 3.7 Panel admin
- Configuración de días laborables por mes (usado para tendencia y media necesaria).

---

## 4. Modelo de datos (resumen)

| Tabla | Rol |
|-------|-----|
| `ventas` | Líneas de venta crudas (~1M filas). Fuente de verdad. |
| `pdvs` / `pdvs_geo` | Maestro de puntos de venta + geolocalización. |
| `vendedores` | Maestro de vendedores con equipo y supervisor. |
| `metas` | Metas mensuales por vendedor y rubro. |
| `resumen_diario` | Pre-agregado por (fecha, vendedor, rubro) — alimenta los dashboards. |
| `resumen_clientes_pdv` | Pre-agregado por (mes, pdv, vendedor, rubro) — alimenta CCC y vistas de cliente. |
| `catalogo_productos` | Catálogo materializado de artículos para el buscador. |
| `config_meses` | Días laborables por mes. |
| `profiles` | Usuarios y su rol. |

Las tablas pre-agregadas se reconstruyen automáticamente en cada carga de ventas.

---

## 5. Roadmap — Integración de IA

La próxima fase incorpora dos capacidades de IA. **Ninguna está implementada todavía.**

### 5.1 Optimización de rutas para vendedores

**Objetivo:** generar la mejor secuencia de visita a PDVs para cada vendedor,
minimizando distancia/tiempo y respetando frecuencia de visita.

**Insumos disponibles hoy:**
- `pdvs_geo` — coordenadas (lat/long) de cada PDV.
- `ventas` — historial de compra por PDV (para priorizar clientes activos / con potencial).
- `vendedores` — asignación de carteras.

**Qué falta definir / construir:**
- Punto de partida del vendedor (depósito / domicilio) y horario de jornada.
- Frecuencia de visita objetivo por PDV (semanal, quincenal, mensual).
- Motor de optimización: resolver un problema tipo VRP (Vehicle Routing Problem).
  Opciones: servicio de routing (Google/Mapbox/OSRM) + heurística, o un modelo
  que ordene por prioridad comercial + cercanía.
- UI: vista de "ruta del día" por vendedor, integrada al mapa existente.

### 5.2 Chat de consultas a la base de datos (lenguaje natural)

**Objetivo:** una interfaz de chat donde cualquier usuario pregunta en español y el
sistema responde consultando la base de datos.

**Ejemplos de consultas esperadas:**
- _"¿Cuántas Oreo Golden vendió Guido Pérez este mes comparado al mes pasado?"_
- _"¿Qué equipo está más lejos de su meta de Chocolates?"_
- _"Top 5 clientes de Florencio Varela en abril."_

**Arquitectura propuesta (a confirmar):**
- Un modelo de lenguaje traduce la pregunta a una consulta estructurada
  (text-to-SQL acotado, o llamadas a un set de funciones/RPC predefinidas).
- **No** ejecutar SQL libre generado por el modelo contra la DB — riesgo de
  seguridad. Preferible: el modelo elige entre RPCs/herramientas seguras y
  parametrizadas (ya hay varias: `kpi_resumen`, `consolidado_por_producto`, etc.).
- La respuesta del modelo se redacta en lenguaje natural sobre los datos devueltos.
- Respetar el rol del usuario: un vendedor solo puede preguntar por sus datos.
  La RLS de PostgreSQL ya da esa garantía si la consulta corre con el rol del usuario.

**Qué falta definir / construir:**
- Proveedor de IA y modelo.
- Catálogo de herramientas/RPC que el modelo puede invocar.
- Capa de scope por rol en el chat.
- UI del chat.
- Normalización de nombres de producto/vendedor en las preguntas (hoy hay drift
  de nombres — ver auditoría de DB).

---

## 6. Deuda técnica conocida

Pendientes priorizados de las auditorías (seguridad, performance, flujo, DB):

| Prioridad | Tema |
|-----------|------|
| 🟠 Media | Drift de nombres: ~10 vendedores en `ventas` no matchean el maestro. |
| 🟠 Media | Race condition en el recálculo de `resumen_diario` ante uploads concurrentes. |
| 🟠 Media | CHECK constraints faltantes (`config_meses`, `metas`) — hoy se validan sólo en la API. |
| 🟠 Media | Un archivo de PDVs corto/mal armado da de baja al resto del maestro (sólo se valida que no venga vacío). |
| 🟡 Baja | `config_meses` se carga a mano cada mes; sin fila no hay tendencia ni contador de días. |
| 🟡 Baja | DB cerca del límite del plan Free (452/500 MB). |
| 🟡 Baja | Sin audit log de acciones admin. |

Resueltos (auditoría 2026-08-05):

- RLS de `resumen_clientes_pdv` — ya tiene políticas por equipo (`rcp_supervisor`) y
  por vendedor (`rcp_vendedor`). Verificado contra `pg_policies`.
- Validación server-side en endpoints admin — `config-meses`, `metas/preview` y
  `metas/guardar` validan rango de año/mes y tipos. `metas/guardar` además
  descarta filas sin vendedor o con kilos no numéricos: borra el mes antes de
  insertar, un año mal tipeado borraba las metas de otro período.
- Validación de archivos en el upload de ventas (25 MB + extensión). Los otros
  tres uploads reciben JSON ya parseado en el browser, acotado por
  `proxyClientMaxBodySize: 30mb`.
- El rol para los guards sale de `profiles` (no de `user_metadata`, que el propio
  usuario puede editar) y el proxy corta a las cuentas desactivadas en toda ruta,
  incluidas las `/api`.

---

## 7. Convenciones

- El `%` de avance se calcula **sobre la tendencia**, no sobre el acumulado.
- Las tablas pre-agregadas son derivadas: nunca se editan a mano, se reconstruyen.
- Toda mutación de datos pasa por endpoints `/api/*` que verifican rol admin.

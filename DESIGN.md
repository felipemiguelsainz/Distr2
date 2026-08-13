---
name: Candysur — Dashboard de Ventas
description: Tablero operativo de una distribuidora — densidad alta, números monoespaciados y un solo azul que marca lo accionable.
colors:
  azul-senal: "#0c5cab"
  azul-senal-profundo: "#0a4f95"
  azul-senal-texto: "#f8fafc"
  papel: "#fafafa"
  tarjeta: "#ffffff"
  tinta: "#09090b"
  tinta-media: "#27272a"
  tinta-suave: "#52525b"
  gris-rotulo: "#71717a"
  gris-inerte: "#a1a1aa"
  superficie-hundida: "#f4f4f5"
  borde: "#e4e4e7"
  borde-activo: "#d4d4d8"
  verde-cumple: "#16a34a"
  rojo-cae: "#dc2626"
  ambar-alerta: "#d97706"
  ambar-alerta-profundo: "#b45309"
typography:
  display:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  dense-lg:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  dense:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  dense-sm:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
  micro:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.1em"
  micro-sm:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.1em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "16px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "12px"
  lg: "20px"
components:
  card:
    backgroundColor: "{colors.tarjeta}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.xl}"
    padding: "20px"
  button-primary:
    backgroundColor: "{colors.azul-senal}"
    textColor: "{colors.azul-senal-texto}"
    rounded: "{rounded.lg}"
    padding: "9px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.azul-senal-profundo}"
    textColor: "{colors.azul-senal-texto}"
  button-soft:
    backgroundColor: "{colors.superficie-hundida}"
    textColor: "{colors.azul-senal}"
    rounded: "{rounded.lg}"
    padding: "9px 16px"
    typography: "{typography.label}"
  select:
    backgroundColor: "{colors.superficie-hundida}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.md}"
    padding: "7px 32px 7px 12px"
    typography: "{typography.label}"
  input:
    backgroundColor: "{colors.tarjeta}"
    textColor: "{colors.tinta}"
    rounded: "7px"
    padding: "4px 8px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.gris-rotulo}"
    rounded: "{rounded.lg}"
    padding: "7px 12px"
  nav-item-active:
    backgroundColor: "{colors.azul-senal}"
    textColor: "{colors.tarjeta}"
    rounded: "{rounded.lg}"
    padding: "7px 12px"
---

# Design System: Candysur — Dashboard de Ventas

## Overview

**Creative North Star: "El Tablero de Control"**

Esto no es un sitio que persuade: es una sala de operaciones. Un supervisor abre
Distr2 a las siete de la mañana para responder tres preguntas —quién cumple, quién
no, y dónde hay que ir hoy— y la interfaz existe para que esas respuestas aparezcan
sin scroll y sin interpretación. La densidad no es un defecto a corregir; es el
requisito. Cada píxel de aire decorativo es una fila de datos que el usuario tuvo
que ir a buscar a otra pantalla.

El sistema se apoya en una división de trabajo estricta entre dos tipografías y dos
familias de color. **IBM Plex Sans** lleva la prosa, los rótulos y la navegación;
**JetBrains Mono** lleva todo lo que es un número, porque las cifras tienen que
alinearse en columna y compararse de un vistazo. Del lado del color, la escala de
grises hace prácticamente todo el trabajo —fondo, texto, bordes, jerarquía— y el
azul aparece sólo donde el usuario puede actuar. Ese contraste es el motor de la
legibilidad: en una pantalla casi monocromática, un solo acento se lee como una
instrucción.

La profundidad es mínima y funcional. Las tarjetas flotan apenas sobre el papel
gris con una sombra amplia al 5% de negro, lo justo para leerse como unidades
discretas; al pasar el mouse suben dos píxeles y el borde se oscurece un paso. No
hay glassmorphism, no hay degradados decorativos, no hay color de marca en los
encabezados. El anti-referente declarado es el dashboard de SaaS moderno que
gasta media pantalla en un hero y llena las tarjetas de degradados violeta.

**Key Characteristics:**
- Densidad alta y deliberada: rótulos de 9–11px, filas de tabla compactas, cero aire decorativo.
- Un único acento (#0c5cab) reservado a lo interactivo; el resto es escala de grises.
- Todo número va en JetBrains Mono con `tabular-nums`, sin excepción.
- Profundidad sutil: sombra amplia al 5%, lift de 2px en hover, borde que se oscurece un paso.
- Tema claro fijo, sin variante oscura ni conmutador.
- Interfaz íntegramente en español rioplatense.

## Colors

Una escala de grises fría que hace todo el trabajo estructural, un solo azul que
marca la acción, y tres colores semánticos que sólo aparecen sobre datos.

### Primary
- **Azul Señal** (`#0c5cab`): el único acento del sistema. Marca navegación activa, botón primario, links, anillo de foco, caret e input activo. Aparece además en dos diluciones fijas sobre fondo: `rgba(12,92,171,0.08)` para hover y superficies suaves, `rgba(12,92,171,0.2)` para bordes de esas superficies.
- **Azul Señal Profundo** (`#0a4f95`): estado hover/pressed del botón primario.

### Neutral
- **Papel** (`#fafafa`): fondo de la aplicación. Nunca es blanco puro; el contraste con la tarjeta blanca es lo que da profundidad.
- **Tarjeta** (`#ffffff`): superficie de todo contenedor de contenido, sidebar y encabezado de tabla.
- **Superficie Hundida** (`#f4f4f5`): fondo de selects, chips y celdas de encabezado. Se lee como "campo", no como "tarjeta".
- **Tinta** (`#09090b`): texto primario y cifras.
- **Tinta Media** (`#27272a`) y **Tinta Suave** (`#52525b`): texto secundario dentro de tablas densas.
- **Gris Rótulo** (`#71717a`): el color más usado del sistema. Rótulos, encabezados de columna, iconos inactivos, unidades.
- **Gris Inerte** (`#a1a1aa`): placeholders, estados deshabilitados, pulgar del scrollbar en hover.
- **Borde** (`#e4e4e7`) y **Borde Activo** (`#d4d4d8`): un solo escalón de contraste separa el borde en reposo del borde en hover.

### Tertiary — semánticos de dato
- **Verde Cumple** (`#16a34a`): variación positiva, meta alcanzada, PDV visitado.
- **Rojo Cae** (`#dc2626`): variación negativa, error de validación, acción destructiva, cerrar sesión en hover.
- **Ámbar Alerta** (`#d97706`), profundo `#b45309`: advertencia y datos incompletos (cuadrante que nombra otro día, vendedor sin equipo).

### Named Rules

**La Regla del Azul Táctil.** Si algo es `#0c5cab`, se puede tocar. El azul nunca
titula, nunca bordea una tarjeta de contenido, nunca decora un ícono y nunca pinta
un fondo grande. Test: tapá el azul de una pantalla; todo lo que desaparezca tiene
que ser algo en lo que el usuario puede hacer clic.

**La Regla del Semáforo Sólo Sobre Datos.** Verde, rojo y ámbar son lecturas de un
número, no adornos de interfaz. Un botón nunca es verde por ser positivo; una
tarjeta nunca es roja por ser importante. El color semántico se aplica al valor
y a su ícono de tendencia, nada más.

## Typography

**Display / cifras:** JetBrains Mono (400, 500) con fallback `ui-monospace, monospace`
**Body / interfaz:** IBM Plex Sans (300, 400, 500, 600, 700) con fallback `ui-sans-serif, system-ui, sans-serif`

**Character:** IBM Plex tiene la neutralidad de una tipografía corporativa sin la
frialdad de Helvetica —sus terminales rectas y su `a` de doble piso aguantan bien
a 11px, que es donde vive la mitad de esta interfaz. JetBrains Mono aporta lo único
que importa en una columna de cifras: ancho fijo real y dígitos que no se confunden
entre sí. El emparejamiento es funcional, no expresivo: nadie debería notar las
fuentes, sólo debería poder leer la tabla.

### Hierarchy
- **Display** (JetBrains Mono, 500, 22px, 1.15): la cifra protagonista de una tarjeta KPI. Una por tarjeta, nunca dos.
- **Headline** (IBM Plex, 600, 17px, 1.3): título de pantalla.
- **Title** (IBM Plex, 600, 15px, 1.35): título de tarjeta o sección.
- **Body** (IBM Plex, 400, 15px, 1.5): base del `<body>`. En la práctica casi no aparece: la interfaz vive uno o dos escalones abajo.
- **Label** (IBM Plex, 500, 13px, 1.4): texto de interfaz por defecto — botones, selects, celdas de acción.
- **Dense LG** (IBM Plex, 400, 14px, 1.45): texto de apoyo cuando la pantalla tiene aire — panel de perfil, ayudas de administración.
- **Dense** (IBM Plex, 400, 12px, 1.4): el escalón más usado del sistema (109 apariciones). Filas de tabla y metadatos.
- **Dense SM** (IBM Plex, 400, 11px, 1.35): segunda línea de una fila, unidades, textos de contexto.
- **Micro** (JetBrains Mono, 600, 10px, `letter-spacing: 0.1em`, mayúsculas): encabezados de columna y rótulos de unidad.
- **Micro SM** (JetBrains Mono, 600, 9px, `letter-spacing: 0.1em`, mayúsculas): el piso absoluto. Sólo encabezados de tablas muy anchas. Las mayúsculas espaciadas son lo único que lo hace legible.

**La Regla de los Enteros.** El ramp sólo toma valores enteros: 22, 17, 15, 14, 13,
12, 11, 10 y 9px. Los medios-píxel que hay hoy en el código (8, 9.5, 10.5, 11.5,
12.5, 13.5px — unas 45 apariciones) son deriva, no escalones: nacieron de ajustar
un caso puntual a ojo. Al tocar un componente, llevalos al entero más cercano.

### Named Rules

**La Regla del Número Monoespaciado.** Todo dígito que el usuario pueda querer
comparar contra otro va en JetBrains Mono con `tabular-nums`. Sin excepción: kilos,
porcentajes, conteos de PDV, días trabajados, fechas. Un número en IBM Plex dentro
de una columna es un bug de diseño.

**La Regla del Rótulo en Mayúsculas.** Por debajo de 11px sólo sobrevive el texto en
mayúsculas con `letter-spacing: 0.1em`. Si un rótulo necesita ir a 9px, va en
mayúsculas espaciadas o no va.

## Layout

Shell de dos columnas: sidebar fija de 220px a altura completa (`h-dvh`, borde
derecho `#e4e4e7`, fondo blanco) y área de contenido con scroll propio. La sidebar
no colapsa en desktop; en viewports chicos el shell la reemplaza por una barra
superior, y el alto del mapa se calcula contra ese alto de barra —cualquier cambio
al padding del shell hay que replicarlo en ese cálculo.

Las tarjetas se apoyan en grillas de 2 a 4 columnas que colapsan a una en móvil,
con `gap` de 12–20px. El padding interno canónico de tarjeta es 20px (`p-5`);
16px cuando la tarjeta contiene una tabla que ya trae su propio padding de celda.

**La Regla del Ancho Mínimo.** Una tabla densa no se adapta encogiendo columnas: se
adapta desplazándose. Todo contenedor de tabla lleva `overflow-x-auto` y la tabla un
`min-width` explícito. El que manda es el `min-width`: sin él, `table-fixed w-full`
reparte el ancho disponible en partes iguales y colapsa las columnas de cifras a un
ancho ilegible. Con él, `table-fixed` es deseable —fija las columnas y evita que el
navegador las reacomode al llegar más datos—, y así lo usan hoy las seis tablas del
dashboard. Lo prohibido es `table-fixed w-full` **sin** `min-width`, no `table-fixed`.

## Elevation & Depth

Sistema híbrido con sesgo a lo plano. La profundidad base viene del contraste de
superficie —tarjeta `#ffffff` sobre papel `#fafafa`— reforzado por un borde de 1px.
La sombra no crea la separación, la suaviza: es amplia, difusa y prácticamente
invisible al 5% de negro. Lo único que usa sombra fuerte es lo que de verdad está
por encima del plano (modales, tooltips del mapa).

### Shadow Vocabulary
- **Reposo de tarjeta** (`box-shadow: 0 20px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.05)`): halo difuso que despega la tarjeta del papel sin dibujar un contorno.
- **Navegación activa** (`box-shadow: 0 4px 6px -1px rgba(59,130,246,0.2)`): sombra teñida bajo el ítem activo de la sidebar. Es el único caso donde una sombra lleva color.
- **Etiqueta de mapa** (`box-shadow: 0 2px 10px rgba(0,0,0,0.12)` → hover `0 4px 16px rgba(0,0,0,0.18)`): las etiquetas de cuadrante flotan sobre el canvas de Leaflet y necesitan separación real.
- **Modal** (`box-shadow: 0 8px 32px rgba(0,0,0,0.5)`): capa superior, sombra deliberadamente pesada.

### Named Rules

**La Regla de la Sombra que Separa.** La sombra existe para despegar una superficie
de la de atrás, nunca para darle importancia. Si dos elementos están en el mismo
plano, tienen la misma sombra, sin importar cuál es más relevante.

**La Regla del Lift de Dos Píxeles.** El hover de una tarjeta interactiva es siempre
el mismo gesto: `translateY(-2px)` más el borde de `#e4e4e7` a `#d4d4d8`, en 200ms.
No cambia el fondo, no crece la sombra, no aparece color.

## Shapes

Lenguaje de esquinas suaves y escalonadas por tamaño de superficie: cuanto más
grande el contenedor, más redondeado. Tarjetas y modales a 16px; ítems de
navegación, botones y dropdowns a 10px; selects, chips y contenedores de tabla a
8px; inputs y badges chicos a 6–7px. No hay esquinas vivas en ninguna superficie
salvo las celdas internas de tabla.

Los bordes son siempre de 1px y siempre grises: el sistema nunca usa un borde de
color para jerarquizar. La única forma circular es el avatar de la sidebar
(28px, `border-radius: 50%`) y los puntos de estado de 8px.

**La Regla de la Escala de Cuatro.** El radio sólo puede tomar cuatro valores:
6, 8, 10 y 16px. Los valores intermedios que hoy existen en el código (3, 4, 5, 7,
9, 12px) son deriva histórica, no vocabulario: al tocar un componente, redondealo
al escalón más cercano de la escala.

## Components

### Buttons
- **Shape:** esquinas suaves de 10px; el `padding` canónico es 9px vertical, 16px horizontal, con texto de 13px semibold.
- **Primary:** fondo Azul Señal sólido con texto `#f8fafc`. Hover a `#0a4f95`. Deshabilitado a `opacity: 0.5` sin cambio de color.
- **Soft (secundario):** texto Azul Señal sobre `rgba(12,92,171,0.08)` con borde `rgba(12,92,171,0.2)`; hover sube el fondo a `rgba(12,92,171,0.14)`. Es el botón por defecto de las pantallas de administración.
- **Ghost:** texto `#71717a` sin fondo ni borde; hover a `#09090b`. Para acciones terciarias e íconos.
- **Destructivo:** ghost cuyo hover va a `#dc2626`. Nunca hay un botón de fondo rojo sólido.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** `#ffffff` sobre papel `#fafafa`.
- **Border:** 1px `#e4e4e7`; en tarjetas interactivas pasa a `#d4d4d8` en hover.
- **Shadow Strategy:** "Reposo de tarjeta" (ver Elevation). Las tarjetas interactivas suman el lift de dos píxeles.
- **Internal Padding:** 20px, o 16px cuando envuelven una tabla.

### Inputs / Fields
- **Style:** fondo hundido (`rgba(0,0,0,0.02)` o `#f4f4f5`), borde 1px `#e4e4e7`, radio 6–7px, texto de 12–13px. Los campos numéricos van alineados a la derecha con `tabular-nums`.
- **Focus:** el borde pasa a `rgba(12,92,171,0.4)` y el caret es Azul Señal. El `outline` global de `:focus-visible` es 2px sólido `#0c5cab` con `outline-offset: 2px`.
- **Error:** borde y texto de ayuda en `#dc2626`; el fondo no cambia.

### Select
Select nativo con la flecha del sistema suprimida (`appearance: none`) y un chevron
SVG propio de 12px en `#71717a` posicionado a 10px del borde derecho. Fondo
`#f4f4f5`, borde `#e4e4e7`, radio 8px, padding `7px 32px 7px 12px`. Se usa el
elemento nativo a propósito: en móvil abre el selector del sistema operativo, que
es mejor que cualquier dropdown propio.

### Navigation
Ítems de 13.5px medium con ícono de 15px a la izquierda y `gap` de 10px, radio
10px, padding `7px 12px`, transición de 150ms. En reposo el texto es `#71717a`; en
hover el fondo pasa a `rgba(12,92,171,0.08)` y el texto a `#09090b`. El ítem activo
es fondo Azul Señal sólido con texto e ícono blancos más la sombra teñida. El pie
de la sidebar lleva el avatar con iniciales sobre `rgba(12,92,171,0.15)`.

### Signature: la tarjeta KPI
El componente que define el sistema. Tarjeta de 16px con la cifra protagonista en
JetBrains Mono 22px, un rótulo micro en mayúsculas espaciadas de 9–10px encima, y
la variación debajo en verde o rojo con su flecha. Una sola cifra grande por
tarjeta: si hacen falta dos, son dos tarjetas.

## Do's and Don'ts

### Do:
- **Do** poner todo dígito comparable en JetBrains Mono con `tabular-nums`.
- **Do** reservar `#0c5cab` para lo que se puede tocar; el gris hace la jerarquía.
- **Do** envolver toda tabla densa en `overflow-x-auto` y darle un `min-width` explícito.
- **Do** usar el select nativo con chevron propio; en móvil el selector del sistema gana.
- **Do** elegir el radio del escalón más cercano de la escala de cuatro (6, 8, 10, 16px).
- **Do** escribir toda la interfaz en español rioplatense, incluidos los estados de error y vacío.
- **Do** mantener el hover de tarjeta como un solo gesto: `translateY(-2px)` + borde un paso más oscuro, 200ms.

### Don't:
- **Don't** escribir un relleno plano como degradado. `linear-gradient(135deg, #0c5cab, #0c5cab)` aparece hoy en cinco pantallas: son dos paradas del mismo color, es decir un `background: #0c5cab` disfrazado. Usá el color sólido.
- **Don't** agregar valores de radio fuera de la escala de cuatro.
- **Don't** teñir sombras de color, salvo la de la navegación activa que ya existe.
- **Don't** usar verde, rojo o ámbar en cromo de interfaz: son lecturas de dato.
- **Don't** introducir un tema oscuro ni un conmutador; el sistema es de tema claro fijo y los hex están escritos literales en los componentes.
- **Don't** dejar una tabla de datos con `table-fixed w-full` y sin `min-width`: ahí sí colapsan las columnas de cifras. Con `min-width`, `table-fixed` es lo correcto.
- **Don't** meter aire decorativo entre secciones para "que respire". La densidad es el requisito, no un defecto.
- **Don't** poner dos cifras grandes en una misma tarjeta KPI.

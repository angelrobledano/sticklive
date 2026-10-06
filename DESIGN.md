---
name: Stick Live
description: Marcador en directo de hockey sobre patines, mobile-first y denso, donde el color solo aparece cuando el partido está vivo.
colors:
  rink-passion: "#991b1b"
  rink-passion-light: "#b91c1c"
  rink-passion-dark: "#7f1d1d"
  rink-accent: "#f87171"
  surface-bg: "#f8fafc"
  surface-card: "#ffffff"
  surface-bg-dark: "#0b1220"
  surface-card-dark: "#111a2e"
  text: "#0f172a"
  text-inverse: "#f8fafc"
  text-muted: "#64748b"
  text-muted-dark: "#94a3b8"
  border: "#e2e8f0"
  border-dark: "#1e293b"
  live: "#10b981"
  halftime: "#f59e0b"
  live-deep: "#047857"
  halftime-deep: "#b45309"
  premium-gold: "#fbbf24"
  relegation: "#f97316"
  card-blue: "#3b82f6"
typography:
  score:
    fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  display:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  body-sm:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
  body-xs:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
  label:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.1em"
  label-sm:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
  label-xs:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "0.5625rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.rink-passion}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.rink-passion-light}"
    textColor: "{colors.text-inverse}"
  button-primary-active:
    backgroundColor: "{colors.rink-passion-dark}"
    textColor: "{colors.text-inverse}"
  card:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
  badge-live:
    backgroundColor: "{colors.live-deep}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-halftime:
    backgroundColor: "{colors.halftime-deep}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: Stick Live

## Overview

**Creative North Star: "The Living Scoreboard"**

Stick Live se diseña como un marcador vivo de bolsillo, no como un panel de datos. Todo lo que el aficionado necesita —quién gana, en qué minuto, qué acaba de pasar— cabe en un vistazo desde la grada, con una mano y mala conexión. La densidad manda: cada pantalla está optimizada para leer el marcador rápido, con tipografía monoespaciada y cifras tabulares que no bailan cuando el resultado cambia en vivo. La decoración se reduce al mínimo porque el dato es el protagonista.

El color es deliberadamente escaso. El lienzo base es sobrio —parqué claro (slate) en modo claro, un azul-noche con leve profundidad en oscuro— y el granate intenso de la identidad del deporte (rink-passion) aparece solo en lo que de verdad importa: la marca, el estado activo de navegación, el acento de una acción. El verdadero lenguaje cromático del producto es funcional: el **verde esmeralda pulsante significa "en directo"**, el **ámbar significa "descanso"**, y ambos solo existen mientras hay un partido vivo. Esa es la promesa visual del producto hecha color: cuando la pantalla se enciende de verde, sabes que está pasando ahora.

El modo oscuro no es un negativo del claro: es un modo "premium" pensado para el sofá, con un degradado de profundidad en lugar de negro plano y tarjetas que se elevan con un highlight translúcido superior. Es la cara nocturna del mismo marcador.

**Key Characteristics:**
- Mobile-first real: bottom nav en móvil, sidebar en escritorio, áreas táctiles generosas.
- Densidad legible: cifras monoespaciadas y tabulares para marcadores y estadísticas.
- Color escaso y funcional: granate de identidad + verde/ámbar solo para estado en vivo.
- Superficies planas en reposo; profundidad tonal y sombra reservadas al estado.
- Modo oscuro de primera clase, con degradado de profundidad.

## Colors

Paleta sobria de grises azulados (slate) sobre la que el granate de identidad y los acentos de estado aparecen con intención, nunca como relleno.

### Primary
- **Rink Passion / Granate de Pista** (#991b1b): la identidad del hockey sobre patines. Logotipo, sección activa de navegación, anillo de resaltado del equipo favorito, borde de zona de playoff, botón de acción. Hover sube a **Rink Passion Light** (#b91c1c), active baja a **Rink Passion Dark** (#7f1d1d), que también es el anillo de foco.
- **Rink Accent / Acento en oscuro** (#f87171): el granate cuando el lienzo es oscuro. Sobre el azul-noche, Rink Passion se queda en ~2,1:1, así que el texto activo, los iconos de identidad y los anillos de foco (`dark:text-rink-accent`, `dark:ring-rink-accent`) suben a este paso para superar 3:1. Es identidad, no color semántico: el rojo de tarjeta/error/negativo es otro y no se toca.

### Secondary (estado en directo)
- **Live / Esmeralda** (#10b981): único color de "en juego". Punto pulsante y etiqueta de directo en la ficha y en la tarjeta; también el diferencial de goles positivo y los penaltis marcados.
- **Halftime / Ámbar** (#f59e0b): estado de descanso y avisos de partido aplazado. **Premium Gold** (#fbbf24) es su pariente cálido, reservado al badge de Premium.

### Tertiary (funcionales de dato)
- **Relegation / Naranja** (#f97316): zona de descenso en clasificaciones.
- **Card Blue / Azul** (#3b82f6): tarjeta azul en eventos de partido (la roja reutiliza el rojo de estado).

### Neutral
- **Parqué / Surface BG** (#f8fafc claro, #0b1220 oscuro): fondo principal. En oscuro, degradado #0d1426 → #0b1220 en los primeros 240px.
- **Surface Card** (#ffffff claro, #111a2e oscuro): tarjetas y barras de navegación.
- **Text** (#0f172a claro, #f8fafc oscuro): texto principal.
- **Text Muted** (#64748b claro, #94a3b8 oscuro): metadatos, etiquetas, columnas secundarias.
- **Border** (#e2e8f0 claro, #1e293b oscuro; en oscuro las tarjetas usan blanco al 6%): divisores y contornos.

### Named Rules
**The Live-Only Color Rule.** El verde esmeralda y el ámbar no son colores decorativos: solo aparecen cuando un partido está en directo o en descanso. Si la pantalla está verde, algo está pasando ahora. No usar esmeralda/ámbar como relleno estético en estados neutros.

**The Quiet Passion Rule.** El granate es la identidad, pero se usa con moderación: marca, estado activo, un acento. Un exceso de granate mata su valor como señal.

## Typography

**Display / Body Font:** Inter (con system-ui, sans-serif de respaldo), cargada con `display: swap`.
**Score / Mono Font:** fuente monoespaciada vía `var(--font-mono)` (con ui-monospace, SFMono-Regular de respaldo), siempre con `tabular-nums`.

**Character:** Inter aporta neutralidad legible y firme para la interfaz; el monoespaciado potente da a marcadores y estadísticas un aire de marcador deportivo y evita el "baile" de cifras al actualizarse en vivo.

### Hierarchy
- **Score** (mono, 700, hasta 3rem, `tracking-tighter`, `tabular-nums`): marcador principal en la ficha de partido. En tarjeta de lista baja a ~1.5rem.
- **Display** (Inter, 700, ~1.125rem): marca "Stick Live", nombres de equipo en la ficha, títulos de bloque.
- **Body** (Inter, 400–500, 0.875rem): texto general, nombres de equipo en listas, filas de ajuste.
- **Body sm** (Inter, 400–500, 0.8125rem / 13px): metadatos de fila, subtítulos de tarjeta y texto secundario denso donde `body` no cabe.
- **Body xs** (Inter, 400–600, 0.75rem / 12px, `text-xs`): el paso intermedio más usado — subtítulos, etiquetas de estado y metadatos compactos.
- **Label** (Inter, 700, MAYÚSCULAS, `tracking-wide`/`tracking-widest`): encabezados de sección, cabeceras de tabla, badges y metadatos. Es una escalera de tres pasos deliberada — `label` 0.6875rem/11px (el paso por defecto), `label-sm` 0.625rem/10px (la micro-etiqueta dominante de la densidad de tabla) y `label-xs` 0.5625rem/9px (el suelo). Por debajo solo existe una excepción: las iniciales de los avatares de escudo sin logo (7–8px), que no son texto de interfaz.

### Named Rules
**The Tabular Scoreboard Rule.** Cualquier número que pueda cambiar en vivo o alinearse en columna (marcador, reloj, clasificación, estadísticas) va en monoespaciado con `tabular-nums`. Las cifras nunca deben desplazar el layout al actualizarse.

## Layout

Modelo mobile-first con dos chasis de navegación: en móvil, **bottom nav fija** de 3 destinos (64px de alto, respeta `safe-area-inset-bottom`) y el contenido reserva `pb-20`; en `md+`, la bottom nav desaparece y aparece una **sidebar de 256px** (`w-64`) pegada a la izquierda, `sticky top-0`, con el contenido principal fluido al lado. El `<main>` usa `min-w-0` para permitir truncado correcto de nombres largos.

La densidad es alta y deliberada: tarjetas de partido compactas (`px-3 py-2.5`), clasificaciones en rejilla fija (`grid-cols-[24px_1fr_repeat(8,26px)]`) que prioriza ver toda la tabla sin scroll horizontal. Patrones recurrentes: carruseles horizontales deslizables (selector de fecha) con desvanecidos laterales como pista visual, y bloques de ajustes agrupados en tarjeta con divisores internos.

Ritmo de espaciado sobre la escala de Tailwind; los gutters laterales viven en el contenedor (`px-4`) y el espaciado vertical en utilidades `space-y`/`gap`, nunca atajos que anulen los márgenes laterales en móvil.

### Portada de escritorio — "Centro de mando del directo"

El `<main>` conserva una medida de lectura de `max-w-5xl` para las superficies de contenido; la **portada** la levanta marcándose con `data-wide` en su raíz, que el contenedor reconoce (`lg:has-[[data-wide]]:max-w-none`). A partir de ahí la home compone su propia rejilla, con tope `lg:max-w-[2200px]` centrado:

- **Barra de fecha** pegajosa (`sticky top-0`) a todo el ancho de la composición, con el carrusel centrado cuando cabe.
- **Banda "En directo ahora"** (`lg+`): los partidos `live` del día en rejilla de 1 columna (lg) → 2 (xl) → 3 (≥1700px) → 4 (≥2000px). En `lg+` los directos se retiran de las listas por competición para no repetirse; en móvil la banda no se renderiza y el orden no cambia.
- **Jornada en columnas**: las secciones por competición fluyen en masonry CSS (`xl:columns-2`, `min-[1800px]:columns-3`) con `break-inside-avoid`, de modo que una competición corta no deja un hueco vertical. El bloque "Siguiendo" usa la misma rejilla.
- **Vista de próximos** (día seleccionado sin partidos): bandas verticales a todo el ancho, una por día (`lib/upcoming` agrupa día → competición → partidos). La cabecera del día (fecha bold + recuento + hairline) abre la banda y sus competiciones fluyen en masonry horizontal (`md:columns-2` → `min-[2000px]:columns-4`), así que un día corto es una banda corta, no una columna huérfana. En **móvil** cada grupo arranca plegado —caption + recuento + chevron— y se expande al toque (índice compacto del día); en escritorio siempre desplegado. El carril de contexto oculta su sección "Próximos" para no duplicar la vista.
- **Carril de contexto** (`2xl+`, 360px): `Mi grada` (si sigues a alguien) y `Próximos` — solo días posteriores al seleccionado, porque los del día ya están en la lista —, `sticky` con scroll interno y barra temática (`.rail-scroll`).

El móvil no cambia: una sola columna, sin banda ni carril.

## Elevation & Depth

Sistema **plano por defecto, con elevación como respuesta al estado**. En modo claro las tarjetas son superficies blancas planas con borde slate-200 de 1px; la sombra (`hover:shadow-md`) y el cambio de borde aparecen solo en hover. La profundidad no se finge en reposo.

En modo oscuro la profundidad es **tonal, no de sombra dura**: el fondo es un degradado azul-noche, y las tarjetas se separan con un borde translúcido (blanco al 6%), un highlight superior interior y una sombra suave difusa, en lugar de un borde duro sobre negro plano.

### Shadow Vocabulary
- **Card hover** (`box-shadow: var(--tw-shadow-md)`): realce al pasar sobre una tarjeta enlazable.
- **Dark card lift** (`box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -16px rgba(0,0,0,0.6)`): elevación tonal de tarjeta en oscuro.
- **Toggle inset** (`box-shadow: inset 0 1px 2px rgba(0,0,0,0.25)`): hundido interior del switch.

### Named Rules
**The Flat-At-Rest Rule.** Las superficies son planas en reposo. La sombra aparece como respuesta a un estado (hover, foco, elevación), nunca como adorno permanente. En oscuro, la profundidad se consigue con tono, no con sombras negras duras.

## Shapes

Lenguaje de esquinas redondeadas medias y coherentes: tarjetas y chips de fecha con `rounded-xl` (12px), botones y enlaces de navegación con `rounded-lg` (8px), badges y elementos de estado con `rounded-full` (píldora), y el badge Premium con `rounded-2xl` (16px). Los toggles son píldoras completas con pulgar circular. Bordes finos de 1px para contornos y divisores; indicadores de zona en tabla mediante barra lateral de 2px (`border-l-2`) y líneas discontinuas para fronteras de playoff/descenso. El isotipo vive en un cuadrado redondeado granate con un punto de directo esmeralda pulsante.

## Components

### Buttons
- **Shape:** esquinas medias (`rounded-lg`, 8px).
- **Primary (`.btn-primary`):** fondo granate (#991b1b), texto blanco, `px-4 py-2`, `text-sm font-semibold`.
- **Hover / Focus:** hover #b91c1c, active #7f1d1d, transición de color 150ms, anillo de foco `ring-2` en granate oscuro (`focus-visible`).
- **Pill de acción (ver vídeo):** variante `rounded-full` granate con icono, para acciones contextuales dentro de una tarjeta.

### Badges de estado
- **Live:** `rounded-full`, fondo **esmeralda-700** (#047857, no el esmeralda brillante de los puntos), texto blanco, MAYÚSCULAS `tracking-wide`, con punto blanco `animate-pulse`. El escalón profundo es necesario para que el texto blanco de 10px supere 4,5:1.
- **Halftime:** idéntico en **ámbar-700** (#b45309), punto estático.
- **Scheduled / Finished:** píldoras neutras en slate (claro/oscuro), sin color de estado.

### Cards / Containers (`.card`)
- **Corner Style:** `rounded-xl` (12px).
- **Background:** blanco en claro; en oscuro, degradado translúcido sobre #111a2e.
- **Border:** slate-200 en claro; blanco al 6% en oscuro.
- **Shadow Strategy:** plana en reposo; ver Elevation & Depth.
- **Internal Padding:** típicamente `px-3 py-2.5` (tarjeta de lista) a `px-4 pt-4 pb-5` (ficha).

### Banda de directo (Live Board)
Tarjeta de partido `live` con jerarquía de marcador grande (mono `text-4xl` `tabular-nums`), anillo esmeralda tenue (`ring-1 ring-emerald-500/25`) y escudo + nombre oficial a ambos lados; una estrella granate marca los equipos seguidos. Solo existe para estados `live`/descanso, nunca para programados. Cuando el marcador cambia en vivo, el número hace un pulso breve hacia el acento esmeralda (`.score-flash`) que se apaga solo: es el momento firmado de la portada. `reduce-motion` lo conserva —es una señal de color, no movimiento— y solo apaga bucles y desplazamientos.

### Navigation
- **Bottom Nav (móvil):** barra fija de 64px, 5 destinos ordenados por importancia — Partidos, Competiciones, Buscar, Favoritos, Ajustes (#414) —, iconos SVG de trazo cuyo grosor sube (1.8 → 2.5) y color pasa a granate en el activo; etiqueta de 11px que pasa a `font-semibold`.
- **Sidebar (md+):** 256px, cabecera con logo e isotipo, enlaces `rounded-lg` con fondo slate-100/800 en activo; sección activa por prefijo de ruta, no por coincidencia exacta.

### Date Selector (componente de firma)
Carrusel horizontal de chips de fecha `rounded-xl`, centrado en "hoy", con desvanecidos laterales. Chip activo en granate al 10% de fondo con texto granate; "Ayer/Hoy/Mañana" como etiqueta relativa, el resto con día de semana + número + mes, todo en el idioma activo.

### Toggle + Setting Row (ajustes)
- **Toggle:** switch estilo iOS, píldora de 48×28px; ON con degradado granate→rojo y sombra interior, pulgar blanco que se desplaza 200ms; foco con anillo granate al 60% y offset.
- **Setting Row:** etiqueta + descripción a la izquierda, toggle a la derecha; agrupadas en tarjeta con divisores internos bajo un encabezado de sección en label MAYÚSCULAS.

### Standings Table (componente de firma)
Rejilla fija de columnas; zonas de clasificación señaladas con barra lateral de 2px (granate = playoff, naranja = descenso), fondo teñido muy leve y fronteras discontinuas entre zonas. Diferencial de goles coloreado (esmeralda positivo / rojo negativo). Cifras tabulares en todas las columnas numéricas.

## Do's and Don'ts

### Do:
- **Do** reservar el esmeralda y el ámbar para estado en directo/descanso; si aparecen, hay un partido vivo.
- **Do** usar monoespaciado con `tabular-nums` en todo número que cambie en vivo o se alinee en columna (marcador, reloj, clasificación, estadísticas).
- **Do** mantener las superficies planas en reposo y elevar solo con el estado (hover/foco); en oscuro, profundidad tonal, no sombras negras duras.
- **Do** diseñar para una mano en móvil: bottom nav fija, áreas táctiles amplias, densidad legible sin scroll horizontal en tablas.
- **Do** respetar `safe-area-inset` y el cambio bottom-nav (móvil) ↔ sidebar (`md+`).

### Don't:
- **Don't** usar el granate como relleno decorativo: es identidad y señal, no fondo.
- **Don't** pintar de verde/ámbar estados que no son "en vivo"/"descanso".
- **Don't** introducir fuentes nuevas; Inter para interfaz y monoespaciada para cifras es el sistema.
- **Don't** usar negro plano ni sombras duras en modo oscuro; la profundidad es tonal.
- **Don't** dejar que las cifras desplacen el layout al actualizarse: siempre tabulares.

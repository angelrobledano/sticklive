# Competición: el cuadro primero, eliminatorias en Jornadas y fase en la ficha

- **Fecha:** 2026-10-16
- **Estado:** diseño aprobado por producto (Ángel, 16/10)
- **Ámbito:** `apps/web` (página de competición, Jornadas, ficha del partido) y
  `apps/api` (`GET /matches/:id` y snapshot del SSE, campo aditivo).
- **Origen:** «cuando una competición pase de liguilla a playoff, mostrar ya el
  cuadro en la home de la competición… en el Mundial no es playoff, son
  eliminatorias… en la ficha poner si es semifinal, final, fase de grupos, 3.º y
  4.º… en Jornadas no aparecen cuartos, semis ni final».

## Problema (Mundial Masculino WSG Asunción, 16/10)

1. Al entrar en la competición se abre Clasificación (grupos ya cerrados). El
   cuadro está en una pestaña aparte llamada «Playoffs».
2. «Playoffs» es el nombre de las series al mejor de N de la OK Liga. En un
   Mundial a partido único son eliminatorias.
3. Jornadas filtra a propósito las rondas eliminatorias: su número legado
   (1=cuartos, 2=semis, 3=final) chocaba con las jornadas 1, 2 y 3.
4. `GET /matches/:id` no devuelve ronda, fase ni grupo: la ficha no puede decir
   si es una semifinal o un partido de grupos.

Los datos ya están: `season.phases` (grupos + fase final con sus `stages`),
`rounds.stage` y `rounds.phase_id` vienen de la fuente (migración 072).

## Referencia FotMob (Mundial 2022)

Pestañas Resumen · Clasificación · **Eliminatoria** · Partidos. En fase final el
cuadro es lo primero que se ve. «Partidos → por ronda» incluye cuartos, semis y
final. La ficha pone la fase en la cabecera («Copa del Mundo · Final»).

## Diseño

### Pestañas

- **Fase final en curso** cuando hay partidos eliminatorios (`roundType ===
  'playoff'`) y además alguno ya está en juego o terminado, o todos los partidos
  de liga/grupos están cerrados (terminados o cancelados). Entonces la pestaña
  del cuadro pasa a ser la **primera** y la que se abre por defecto. Antes de
  eso, orden de siempre. `?tab=` sigue mandando.
- **Nombre de la pestaña** según cómo se juega la fase por el título
  (`knockoutPhaseViews`):
  - series al mejor de N (OK Liga) → «Playoffs»
  - final four (Supercopa, o fase que empieza en semis) → «Final Four»
  - partido único o ida y vuelta (Mundial) → «Eliminatorias»
  - temporada heredada sin fases de la fuente → «Playoffs» (como hoy)

### Jornadas

- El selector de ronda incluye las rondas eliminatorias **con `stage` de la
  fuente** (cuartos, semis, 3.º y 4.º, final y colocación), también las
  declaradas aún sin partidos (se ven como «Por determinar»). Las rondas
  heredadas sin `stage` siguen fuera, como hoy.
- Orden: jornadas por número, después las eliminatorias por fecha de su primer
  partido y, sin fecha, por fase (octavos, cuartos, semis, 3.º y 4.º, final,
  colocación).
- Etiqueta: «Cuartos de final», «Semifinales», «3.er y 4.º puesto», «Final»,
  «Octavos de final» (i18n) y el nombre de la fuente para colocación
  («Puestos 5º-8º»). Se acaba el prefijo «Playoffs ·».
- URL: las jornadas siguen con `?journey=<n>` (enlaces actuales intactos). Una
  ronda eliminatoria usa `?round=<roundId>`: sin choque posible de números.
- Ronda por defecto: la del partido más cercano a hoy, sea jornada o
  eliminatoria (hoy, durante el Mundial, se abre en Semifinales).

### Ficha del partido

- `GET /matches/:id` (y el snapshot del SSE) añade `round`: `{ name, number,
  type, stage, groupName, seriesGame, phaseKind }` o `null`. Aditivo.
- Línea bajo el nombre de la competición:
  - grupos: «Fase de grupos · Grupo A · Jornada 2»
  - liga: «Jornada 12»
  - eliminatoria: «Semifinal», «Final», «3.er y 4.º puesto», «Cuartos de
    final» y, en series, «· Partido 2»
  - colocación: nombre de la fuente («Puestos 5º-8º»)
- También en el `h1` oculto (lectores de pantalla).

## Pruebas

Unit (vitest): fase final en curso, orden de pestañas y nombre, rondas
seleccionables y su orden, filtro por ronda eliminatoria y ronda por defecto,
etiqueta de fase del partido, DTO de la API con y sin ronda. Integración de la
API en verde. Capturas del Mundial (cuadro primero, Jornadas → Semifinales,
ficha de una semifinal) y de una liga (sin cambios).

## Fuera de alcance

Pestaña «Resumen» como la de FotMob. Cuadro dentro de la ficha del partido.

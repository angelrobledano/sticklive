# Home: la jornada del día, agrupada por competición (referencia FotMob)

- **Fecha:** 2026-10-16
- **Estado:** diseño aprobado por producto (Ángel, 16/10), web primero
- **Ámbito:** `apps/web` (home, favoritos, selector de días, i18n), `apps/api`
  (`GET /matches/current`, campo aditivo). La app Android (Expo) queda para una
  segunda fase con la misma lógica.
- **Origen:** «Ahora mismo no hay quien entienda la home… hay que tomar como
  referencia FotMob. La home debe dejar claros los partidos de hoy y, si no hay
  hoy, mostrar algo de los próximos y agrupar los partidos por competición.»

## Problema (observado en producción el 16/10/2026)

1. **"Mi grada" encabeza el día en móvil.** Mezcla próximos partidos y últimos
   resultados de lo que sigues, de cualquier día y sin fecha, justo debajo de
   "HOY". ESP–ARG (sábado 01:00) y los resultados de España de días anteriores
   se leen como partidos de hoy.
2. **Ningún partido en el primer pantallazo.** Sin favoritos, en móvil se ve el
   selector de días, el hueco de `home-top` (AdSense en formato `auto`, que
   crece por encima de su reserva de 50 px) y la tarjeta de onboarding.
3. **Agrupación débil.** Cada partido es una tarjeta suelta con escudos de
   32 px y la competición es un rótulo gris de 12 px. En escritorio el masonry
   (`columns-2/3`) descuadra los bloques.
4. **Directos fuera de su competición.** Tira horizontal en móvil y banda
   grande en escritorio. El mismo día se lee en tres sitios.
5. **Día vacío.** Muestra todos los días siguientes (hasta 15) con grupos
   plegados en móvil, lo que obliga a tocar para ver nada.

## Referencia FotMob (capturas del 16/10 en móvil y escritorio)

- Una tarjeta por competición: cabecera con bandera y nombre, flecha para
  plegar, filas compactas dentro separadas por filete.
- Fila: nombre local alineado a la derecha + escudo · hora o marcador · escudo +
  nombre visitante. Estado pequeño bajo el marcador.
- Los directos se quedan en su competición. Un chip "Directo" filtra la lista.
- La pantalla es del día elegido. Lo personal vive en su propia pestaña.
- Partidos de madrugada con "+1 día" (fuera de este alcance, ver al final).

## Diseño

### Estructura de la home (móvil y escritorio)

1. Selector de días (el actual) con un punto bajo cada día que tiene partidos.
2. Fila de chips, solo si aportan: **En directo (n)** cuando hay algún partido
   en juego ese día y **Siguiendo** cuando el usuario sigue algo y ese día
   juega algo suyo. Son filtros excluyentes que se activan y desactivan con un
   toque. Sin chips activos se ve la jornada completa.
3. Tarjeta **Siguiendo**: partidos del día de los equipos seguidos, por hora.
   Cada fila lleva encima el nombre corto de su competición.
4. Una tarjeta por competición con el resto de partidos del día. Orden: primero
   las competiciones seguidas (marcadas con estrella), después por importancia
   (`importanceRank`, mismo criterio que /competiciones) y, a igualdad, por
   nombre. Partidos por hora dentro de cada tarjeta. Cada partido aparece una
   sola vez en toda la página.
5. Los directos se quedan en su fila, con marcador y estado en verde (descanso
   en ámbar). Las tarjetas **no** cambian de orden cuando empieza un partido.
6. Cabecera de tarjeta: icono (bandera del país de la competición, mundo si es
   `W`, iniciales si no hay país) + nombre enlazado a la competición + recuento
   + botón de plegar. Plegado por defecto: no. El plegado es estado local de la
   sesión, no se persiste.

### Día sin partidos

- Mensaje "No hay partidos para hoy" (o "este día").
- Si el día es hoy o futuro: **solo la próxima jornada** (primer día posterior
  con partidos dentro de la ventana cargada), con sus tarjetas por competición
  desplegadas y cada hora acompañada de la fecha corta, y un botón
  "Ver el {día}" que cambia el día seleccionado.
- Si no hay próxima jornada en la ventana: "No hay próximos partidos
  programados" y enlace a Competiciones.
- Si el día es pasado: solo el mensaje (comportamiento actual).

### Lo que sale de la home

- **Mi grada** sale del flujo del día. Pasa arriba del todo en /favorites
  ("Tus próximos partidos" y "Tus últimos resultados") y al carril derecho en
  escritorio ancho. Cada fila lleva fecha corta ("sáb 17 · 01:00").
- **Tira y banda de directos** (`LiveNowStrip`, `LiveNowBand`, `LiveBoard`) se
  retiran. Los directos viven en sus tarjetas y en el chip.
- **Onboarding de favoritos**: se mantiene, pero debajo de la primera tarjeta,
  nunca antes de los partidos.

### Escritorio

- Columna central única de tarjetas (máx. ~760 px) en lugar del masonry.
- Carril derecho en `2xl` (como ahora): Mi grada (si sigue algo) y onboarding
  (si no). Se quita "Próximos" del carril: la jornada vacía ya los muestra.

### Publicidad

- `home-top` deja de ir antes de los partidos: pasa tras la primera tarjeta.
- `list-inline` se mantiene entre tarjetas con el mismo cálculo de posición.
- `home-inline` (entre favoritos y el resto) se elimina por redundante.

### Fila de partido (`MatchRow`)

- Rejilla `1fr | centro | 1fr`, alto ~52 px, escudos de 20 px.
- Nombres completos normalizados (`clubName`) en todos los anchos, hasta dos
  líneas, 13 px. Sustituye a las siglas en móvil, que eran crípticas en clubes.
- Centro: hora (`programado`), marcador + "Final" / "Final (Prórroga)" /
  penaltis, marcador verde + "En directo" o ámbar + "Descanso", "Aplazado",
  "Cancelado", "Pendiente" y "Sin resultado" con las mismas reglas que
  `MatchCard` (`matchDisplayState`).
- Enlaces: la fila entera va al partido. Accesible con `aria-label` "Ver
  partido: A - B" (clave existente).
- Equipo seguido: estrella pequeña junto al nombre.

`MatchCard` se queda como está para el resto de pantallas (equipo,
competición, etc.).

## Datos y API

- `GET /matches/current` añade `competitionCountry` (columna
  `competitions.country`, ya existente). Cambio aditivo, sin migración. La web
  lo lee como opcional.
- Toda la lógica de agrupación es pura y vive en `apps/web/src/lib/day-view.ts`
  (sin React), con tests: agrupar el día, filtros, orden, próxima jornada y
  días con partidos.

## Errores y estados

- Error de carga: `HomeLoadError` sin cambios.
- Reconexión del directo (`degraded`): aviso "Reconectando…" junto a los chips.
- Anuncio a lectores de pantalla de goles/inicio/final (`diffLiveScores`): sin
  cambios.
- Swipe horizontal para cambiar de día y persistencia del día en
  `sessionStorage`: sin cambios.

## Pruebas

- Unit (vitest): `day-view.ts` (agrupado, orden, deduplicación, filtros, próxima
  jornada, días con partidos), `MatchRow` (estados), cabecera de tarjeta
  (icono/plegado) y Mi grada en favoritos (fecha en fila).
- Se retiran los tests de componentes eliminados (`UpcomingGroup`) y de
  `groupUpcomingByDay` si deja de usarse.
- Verificación: `typecheck`, `lint`, `test` de web y api, `next build`, y
  capturas en móvil (390 px) y escritorio (1440 px) contra la API de
  producción.

## Fuera de alcance

- App Android (fase 2, misma lógica).
- "+1 día" para partidos de madrugada: requiere la zona horaria real de cada
  sede (el Mundial está como Europe/Madrid).
- Posibles duplicados de la fuente WSE (ITA–CHI y CHI–ITA el mismo día).

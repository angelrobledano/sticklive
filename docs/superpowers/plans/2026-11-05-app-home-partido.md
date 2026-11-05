# App: Partidos y ficha de partido a la altura de la web móvil (lote 3)

Estado: Implementado

## Huecos encontrados

Home (pestaña Partidos)

- MatchRow de la app solo distingue directo, final y programado. Le falta: descanso, aplazado y cancelado, final con prórroga o penaltis (etiqueta y marcador de la tanda), hora por confirmar, "Pendiente" y "Sin resultado" cuando el saque ya pasó, icono de retransmisión, estrella del equipo seguido, fecha corta bajo la hora y línea de competición encima.
- La fila de la web no pinta etiqueta de fase: la fase explícita vive en la ficha del partido, no en la lista. No se añade a la fila.
- MatchGroupCard: el recuento no dice "partidos", el aviso de directos no se lee como "N en directo" y las etiquetas de accesibilidad están fijas en español.
- MiGrada de la app es una tabla propia de dos líneas por partido. La web usa las mismas tarjetas y filas de la home con fecha en cada fila y la competición encima.
- El país preferido solo se cambia en Ajustes. La web tiene el selector en la cabecera de la jornada, junto a los chips.

Ficha de partido

- Falta la crónica de datos (MatchChronicle y lib/match-chronicle) y el último enfrentamiento (PreviousMeeting) en partidos terminados.
- MatchHeader: falta la fase o ronda («Semifinal», «Fase de grupos · Grupo A · Jornada 2»), el aviso de aplazado o cancelado, el prefijo de parte en el resumen de goles y tarjetas, y atenuar el marcador cuando no hay señal.
- MatchPreview: falta la variante "Así llegaban" plegada para partidos empezados o terminados, las fichas de últimos 5 resultados (la app no pide /teams/:id/recent), el mensaje de sin enfrentamientos, la fecha de cada enfrentamiento, "1 punto" en singular, la forma calculada desde los últimos resultados cuando no hay clasificación y no pintar nada si no hay datos.
- LineupsTab: el contenido ya coincide casi entero. Faltan las insignias traducidas (la app escribe "POR" fijo donde la web usa match_detail.badge_goalkeeper) y el botón de compartir la alineación como imagen.

## Qué se porta

1. packages/core/src/match-chronicle.ts con sus tests, subpath @sports/core/match-chronicle. La web lo importa de ahí y se borra su copia. buildPreviousMeeting ya estaba en core.
2. Interpolación de variables en el `t` de la app (`tv`), para usar las claves con {n} y matchRoundLabel de core.
3. Claves nuevas en los seis idiomas: match_chronicle.* y match_detail.previous_meeting. El texto es el de la web.
4. Home: MatchRow con todos los estados de la web, MatchGroupCard con el recuento y avisos de la web, MiGrada con tarjetas y filas de la home, y selector de país junto a los chips.
5. Ficha: MatchChronicle y PreviousMeeting tras las pestañas, hook useTeamRecent para la previa, MatchPreview con variante post y últimos 5, MatchHeader con ronda y estados, LineupsTab con insignias traducidas y compartir alineación.
6. formatTime de la app devuelve la etiqueta de hora por confirmar como la web.

## Qué sigue siendo solo de la app

- Tanda de penaltis dedicada (PenaltyShootout), quinteto inicial dibujado en la pista, imagen para compartir del partido y seguimiento en pantalla de bloqueo.
- Faltas en directo con aviso de falta directa en la fila de la home y en la cabecera, y botón de reintentar la conexión.
- Gesto lateral para cambiar de día con aviso flotante.
- Hápticos: expo-haptics no está instalado, así que no se añaden (no se instalan módulos nativos nuevos).

# Visibilidad de competiciones y partidos

Spec 2026-10-30. Qué sale por defecto en **Partidos**, qué queda en **Explorar** y
cómo manda el seguimiento del usuario. Una sola regla para web, app y API.

## Tres conceptos

| Concepto | Qué es | Dónde se define |
|---|---|---|
| **Disponible** | Todo el catálogo. Nunca se borra ni se deja de recopilar. | Toda competición con `data_quality = 'ok'` |
| **Destacada** | Lo que sale por defecto en Partidos y en la portada de Competiciones. No depende de tener directo. | `competitions.featured_rank IS NOT NULL` (migración 100, editable desde el admin: `PATCH /admin/competitions/:id/ranking`) |
| **Seguida** | Equipos y competiciones que sigue el usuario. Manda siempre. | Favoritos (localStorage / `/auth/favorites`) |

`tier` es otra cosa: nivel deportivo de **liga** (1 = máxima). Las copas no tienen
tier. Sirve para una sola excepción de país (abajo) y para ordenar.

## La regla: `feedReason`

`packages/shared-types/src/index.ts` → `feedReason(match, follows)` devuelve un
único motivo, por este orden, o `null`:

1. **`team`**: juega un equipo seguido.
2. **`league`**: es de una competición seguida.
3. **`featured`**: es de una destacada y procede para el país preferido: las
   del país, las internacionales (`W`) y las de primer nivel (`tier = 1`) de
   cualquier país. Sin país elegido, todas las destacadas.

Un partido tiene como mucho un motivo, así que **no se duplica**. Dejar de seguir
una competición la saca del feed salvo que otra razón la mantenga (un equipo
seguido, que sea destacada).

La usan:

- **API** `GET /matches/current?scope=feed|following` (`apps/api/src/lib/match-feed.ts`).
  Se aplica en memoria sobre el rango ya cacheado: no hay una segunda definición
  en SQL ni consultas nuevas.
- **Web** `buildDayView` (`apps/web/src/lib/day-view.ts`).
- **App** `buildDayView` (`apps/mobile/src/lib/day-view.ts`).

## API

`GET /matches/current` (además de `from`, `to`, `days`):

| Parámetro | Valores |
|---|---|
| `scope` | `all` (por defecto, como siempre), `feed`, `following` |
| `teams`, `leagues` | UUID separados por comas (máx. 200, los inválidos se ignoran) |
| `country` | ISO-2 (país preferido) |

Con `scope=feed|following` la respuesta añade `hiddenCount` y `hiddenByHour`
(partidos fuera, por hora UTC `"2026-10-31T16"`). El cliente pide su día con
margen de zona horaria y suma solo las horas de su día: «Ver otras
competiciones (N)» cuenta el día de quien mira.

Caché: sin `teams`/`leagues`, pública (igual que antes); con ellos, `private`.

## Partidos (web y app)

- Por defecto: «Siguiendo» (equipos seguidos) y una tarjeta por competición del
  feed (seguidas primero, luego por país e importancia).
- Al final: **«Ver otras competiciones (N)»**. Carga el día entero bajo demanda y
  pinta el resto detrás de una cabecera «Otras competiciones», plegado salvo
  directo. «Ocultar» lo vuelve a recoger.
- El chip «En directo» cuenta solo el feed. «Próxima jornada» es el primer día
  con partidos del feed.
- Día con partidos solo fuera del feed (03/11/2026): no hay estado vacío. Se
  cargan solas las otras competiciones, con el aviso «Este día no juegan tus
  equipos ni las destacadas». Si esa carga falla, vuelve el mensaje + el botón.
- «Otras competiciones» se ordenan por `tier` (migración 105 da nivel al resto
  del catálogo: 4 Primera Catalana, 5 resto sénior, 6 júnior/juvenil/sub-23,
  7 resto de base, 8 veteranos, 9 escuelas) y se abren las 3 primeras.
- Sin filtros nuevos en Partidos: con ~15 competiciones en el feed no aportan.
  El país preferido sigue mandando.

## Explorar (Competiciones)

- **Destacadas**: sale de los datos, sin listas en el front
  (`apps/web/src/lib/competitions-home.ts`): principales = destacadas tier 1 que
  no son copa; copas y torneos = copas e internacionales destacados, solo cerca
  de sus fechas; segundo nivel = el resto de destacadas, por país.
- **Países**: catálogo completo, filtros de género y categoría (Sénior / Base;
  veteranos solo en «Todas»).
- **Búsqueda**: en todas las temporadas; «Buscar «q» en equipos» lleva al
  buscador global (equipos y jugadores).
- **Mis ligas**: competiciones seguidas, con enlace a Favoritos (todo lo seguido).

## Curar

Para destacar o quitar una competición: admin → ranking (`featuredRank`, `tier`)
o una migración por slug como la 100. Rangos de `featured_rank` (solo orden):
1–9 principales · 10–19 internacionales · 20–39 segundo nivel · 40–59 copas.

## Rendimiento

| Petición | Antes | Ahora |
|---|---|---|
| Sábado 31/10, día de la home (`country=ES`) | 517 partidos, 556 KB | 56 partidos, 60 KB |
| Mi grada (Favoritos, carril de escritorio) | `/matches/current` entero: 3.158 partidos, 3,3 MB | solo lo seguido (`scope=following`) |
| Home de la app | `/matches/current` entero, ~3 MB | `scope=feed` |

El filtrado es O(n) en memoria sobre el resultado cacheado (n ≈ 500 por día):
no añade consultas a la base de datos.

## Pruebas

- Regla: `packages/shared-types/src/visibility.test.ts`.
- API: `apps/api/src/lib/match-feed.test.ts`, `tests/integration/match-feed.integration.test.ts`
  (Postgres real) y `tests/integration/featured-competitions.integration.test.ts` (migración 100).
- Web: `lib/day-view.test.ts`, `components/shared/home-day-view.test.tsx`,
  `lib/home-loading.test.ts`, `lib/competitions-home.test.ts`, `lib/competition-groups.test.ts`.
- App: `src/lib/day-view.test.ts`, `src/hooks/queries.test.ts`.

# Ocultar competiciones y temporadas con datos no fiables

- **Fecha:** 2026-10-06
- **Estado:** diseño aprobado, pendiente de plan de implementación
- **Ámbito:** `packages/db` (migración + queries), `apps/api` (rutas públicas y
  admin), `apps/web` (listado y panel admin), tests y docs.
- **Origen:** petición de producto — «dejar accesibles solo las temporadas y
  competiciones de cada competición de la que tengamos datos buenos; si no
  estamos seguros, ocultarlas para que el usuario no pueda consultarlas».

## Problema

Hoy la plataforma expone todo lo que tenga partidos, con independencia de su
fiabilidad:

- `competitions.data_quality` ya existe (migración `064`) con valores
  `ok` | `en_revision`, pero la web lo **etiqueta** ("Datos en revisión") en
  lugar de ocultarlo (`apps/web/src/components/competition/CompetitionsList.tsx:205`).
- `seasons` **no** tiene marca de fiabilidad.
- El volcado histórico dejó una temporada colapsada `'Histórico'` (solo
  marcador, `event_coverage='none'`) y temporadas importadas sin verificar que
  hoy son consultables por listado, búsqueda, URL directa, endpoints de
  temporada, ficha de partido, historial de equipo y carrera de jugador.
- Ninguna parte de la app escribe `data_quality`: no hay forma de curar el dato
  desde el producto.

Consecuencia: el usuario puede consultar y compartir datos que no son de fiar,
lo que erosiona la confianza. Principio del proyecto: «los malos datos son
peores que no tener datos».

## Objetivo

Que una competición o temporada marcada como no fiable sea **inconsultable por
cualquier vía** (listados, búsqueda, URL directa, endpoints de temporada, ficha
de partido, historial de equipo, carrera de jugador, sitemap), y dar al
administrador una forma de marcarlo desde el panel.

No entra: detección automática de qué es dudoso.

## Decisiones

1. **Flag explícito curado** como única fuente de verdad. Se reutiliza
   `competitions.data_quality` y se añade `seasons.data_quality` con el mismo
   vocabulario `'ok' | 'en_revision'`.
2. **Visible por defecto.** Todo nace `'ok'`; ocultar es una acción explícita de
   curación. La migración **no** hace backfill.
3. **Fail-closed por curación:** ante la duda, se marca `en_revision` y
   desaparece.
4. **La competición es interruptor maestro:** `competitions.data_quality <> 'ok'`
   oculta también todas sus temporadas, sin tocar el flag de cada temporada
   (desmarcar la competición restaura las que estuvieran en `ok`).
5. **`archived_at` no cambia:** sigue ocultando de listados y permitiendo la URL
   directa. Calidad y archivado son ejes independientes.
6. **Fuera la etiqueta "Datos en revisión":** ahora se oculta, así que no hay
   nada que etiquetar.
7. **El scraper/ETL nunca escribe `data_quality`.** Los `upsertCompetition` /
   `upsertSeason` no tocan esa columna, así que la curación sobrevive a
   re-scrapes.

## Diseño

### 1. Modelo de datos — migración `067_seasons_data_quality.sql`

```sql
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS data_quality TEXT NOT NULL DEFAULT 'ok'
    CHECK (data_quality IN ('ok', 'en_revision'));

COMMENT ON COLUMN seasons.data_quality IS
  'Fiabilidad de la temporada: ok (defecto) | en_revision. Si no es ok, la '
  'temporada y todo su contenido (calendario, clasificación, partidos y fichas '
  'derivadas) dejan de ser consultables por el usuario. Ver migración 067.';

COMMENT ON COLUMN competitions.data_quality IS
  'Fiabilidad de la competición: ok | en_revision. Ya no se etiqueta: un valor '
  'distinto de ok oculta la competición y todo su contenido para el usuario '
  '(migraciones 064 y 067).';
```

Idempotente (`ADD COLUMN IF NOT EXISTS`, `COMMENT ON`), aditiva y sin backfill.

### 2. Regla única de visibilidad

- **Temporada visible** ⇔ `s.data_quality = 'ok'` **y** `c.data_quality = 'ok'`.
- **Competición listada** ⇔ `c.archived_at IS NULL` **y** `c.data_quality = 'ok'`
  **y** existe ≥1 temporada visible con partidos.
- **No visible ⇒ 404** en cualquier endpoint que sirva la entidad, sin revelar
  si existe.

`archived_at` se mantiene como hoy: fuera de listados, accesible por URL directa.

### 3. API — helper compartido + superficies

Nuevo `apps/api/src/lib/visibility.ts`:

```ts
/** Predicado SQL con alias fijos `s` (seasons) y `c` (competitions). */
export const SEASON_VISIBLE_SQL = "s.data_quality = 'ok' AND c.data_quality = 'ok'";

/** ¿La temporada existe y es visible (ella y su competición)? */
export function seasonVisible(seasonId: string): Promise<boolean>;
```

No hace falta un `competitionVisible` aparte: no hay endpoint público de
competición suelta, y `GET /competitions/:id/seasons` ya devuelve vacío → 404
cuando no queda ninguna temporada visible.

Los guards van **después** de validar el UUID y **antes** de la consulta
principal, devolviendo `404 { error: 'Not found' }`. Las consultas con alias
distintos a `s`/`c` añaden la condición equivalente en línea.

| Superficie | Cambio |
|---|---|
| `GET /competitions` | Excluir comps `en_revision`; la temporada de referencia del `LATERAL` exige visibilidad (`s2.data_quality='ok'` y comp `ok`). |
| `GET /competitions/:id/seasons` | Devolver solo temporadas `ok` de competiciones `ok`; 404 si no queda ninguna. |
| `GET /seasons/:id/overview` | Guard → 404 si no visible. |
| `GET /seasons/:id/stats` | Guard → 404 si no visible. |
| `GET /seasons/:id/standings` | Guard → 404 si no visible (el 404 de "sin clasificación" solo aplica a temporadas visibles). |
| `GET /seasons/:id/matches` | Guard → 404 si no visible. |
| `GET /matches/:id` | 404 si la temporada del partido no es visible. |
| `GET /matches/:id/stream` (SSE) | 404 si la temporada del partido no es visible. |
| `GET /matches/live` | Excluir partidos de comps/temporadas ocultas. |
| `GET /search` | Excluir comps `en_revision` y las que no tengan temporada visible con partidos; la recomendación de temporada solo mira visibles. |
| `GET /teams/:id` | Filtrar el selector de temporadas (`se.data_quality='ok' AND c.data_quality='ok'`); todo lo derivado usa ese conjunto, así que queda acotado. |
| `GET /players/:id` | Filtrar equipo actual, stats por competición y carrera. |
| `GET /meta/sitemap` | Excluir comps ocultas/archivadas y partidos de temporadas ocultas. |

### 4. Curación — API admin + panel `/admin`

**API (`apps/api/src/routes/admin.ts`, token `X-Admin-Token` ya existente):**

- `GET /admin/competitions/quality` → todas las competiciones (incluidas
  archivadas y ocultas): `id`, `name`, `slug`, `dataQuality`, `archivedAt`,
  `seasonCount`, `visibleSeasonCount`.
- `GET /admin/competitions/:id/seasons/quality` → todas las temporadas:
  `id`, `name`, `slug`, `isCurrent`, `dataQuality`, `matchCount`.
- `PATCH /admin/competitions/:id/quality` body `{ dataQuality: 'ok' | 'en_revision' }`.
- `PATCH /admin/seasons/:id/quality` body `{ dataQuality: 'ok' | 'en_revision' }`.

UUID inválido → 404; valor inválido → 400; sin token → 401 (middleware).

**DB (`packages/db/src/queries/`):** funciones `listCompetitionsForQuality`,
`listSeasonsForQuality`, `setCompetitionQuality`, `setSeasonQuality`, y
`data_quality` añadido a los tipos `DbCompetition` / `DbSeason`.

**Panel web (`apps/web/src/app/[locale]/admin/page.tsx`):** pestañas
**Usuarios | Competiciones**. En Competiciones: buscador, estado por competición
y toggles por competición y por cada temporada. Las mutaciones llaman a la API
admin con el token de sesión; al terminar, recargan la lista.

### 5. Web

- `CompetitionsList.tsx`: eliminar el bloque de la etiqueta
  `dataQuality === 'en_revision'` (y su clave i18n si queda huérfana). El campo
  `dataQuality` puede seguir en el DTO (siempre `'ok'` en el público) para no
  ampliar el diff.
- La ficha de competición ya hace `notFound()` ante 404 de la API, así que
  queda cubierta por los filtros del backend.

### 6. Documentación

- `docs/database.md`: documentar `seasons.data_quality` y la semántica de
  ocultado (dónde se aplica la regla).
- `docs/RUNBOOK_COMPETICIONES.md`: sección «Ocultar competiciones/temporadas por
  calidad» con el flujo en el panel y qué se oculta.

## Flujo de datos

```
panel /admin  ──PATCH──►  /admin/{competitions,seasons}/:id/quality
                                     │
                                     ▼
                         data_quality = 'en_revision'
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
 GET /competitions            GET /seasons/:id/*          GET /matches/:id
 GET /search                  (overview/stats/             /matches/:id/stream
 GET /teams/:id               standings/matches)           GET /matches/live
 GET /players/:id             → 404 si no visible           GET /meta/sitemap
 → filtrado
```

## Testing

### Integración (Postgres real, patrón `tests/integration/*`)
Nuevo `tests/integration/visibility-quality.integration.test.ts` con las
factorías existentes (`crearCompeticion`, `crearTemporada`, `crearPartido`) y
`UPDATE` directo para marcar `data_quality`:

- Temporada `en_revision` → 404 en `overview`, `stats`, `standings`, `matches`,
  `match-detail`, `match-stream`.
- Competición `en_revision` → todas sus temporadas (aunque estén `ok`) → 404.
- `GET /competitions` excluye comps ocultas y no devuelve temporadas ocultas;
  si la comp tiene una temporada `ok` y otra `en_revision`, devuelve la `ok`.
- `GET /competitions/:id/seasons` solo devuelve `ok`; 404 si no queda ninguna.
- `GET /search` no devuelve comps ocultas.
- `GET /teams/:id` y `GET /players/:id` no exponen temporadas ocultas.
- `GET /meta/sitemap` no lista comps ni partidos ocultos.
- `PATCH /admin/.../quality` cambia el flag y la visibilidad; 400 con valor
  inválido; 404 con uuid inválido; 401 sin token.
- Un re-`upsertCompetition`/`upsertSeason` no resetea `data_quality`.

### Unitarios
- Guards de UUID y validación de `dataQuality` en las rutas admin (sin BD), al
  estilo de `admin.test.ts`.
- Ajustar/limpiar cualquier test de render que asumiera la etiqueta
  "Datos en revisión".

## Verificación

1. `npm run typecheck && npm run lint && npm run test` en verde.
2. `npm run test:integration:docker` (Postgres real + migraciones desde cero) en
   verde.
3. Migración idempotente: aplicarla dos veces no falla.
4. Manual: marcar una competición y una temporada en `/admin` y comprobar que
   desaparecen de listado/búsqueda/URL directa y que desmarcarlas las restaura.

## Fuera de alcance

- Detección automática de datos dudosos (se cura a mano).
- Revalidación forzada del caché ISR de Next desde el panel (ver límite).
- Ocultar entidades `teams`/`players` en sí: siguen accesibles; solo se filtran
  sus datos de temporadas ocultas.

## Riesgos y límites conocidos

- **Caché ISR:** las páginas de la web revalidan cada 300 s
  (`lib/api/client.ts`). Tras marcar algo, puede tardar hasta ~5 min en
  desaparecer de una página ya cacheada. La API responde 404 al instante. Se
  documenta; una revalidación forzada queda como mejora futura.
- **Regex del flag a mano en SQL crudo:** cualquier consulta nueva debe recordar
  aplicar la regla; se mitiga con el helper `SEASON_VISIBLE_SQL` y con los tests
  de integración sobre las superficies principales.
- **Interruptor maestro contundente:** marcar una competición oculta también su
  temporada en curso. Es intencionado, pero conviene ser prudente en el panel.
- **Datos ya `en_revision` en producción:** si existiera alguno, pasará a
  ocultarse con este cambio. Es el comportamiento buscado.

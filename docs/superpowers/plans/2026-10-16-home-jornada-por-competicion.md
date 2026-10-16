# Home por competición (web) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la home web enseñe con claridad los partidos del día elegido, agrupados en tarjetas por competición al estilo FotMob, y que un día vacío enseñe la próxima jornada.

**Architecture:** Toda la decisión de qué se pinta y en qué orden vive en un módulo puro (`lib/day-view.ts`) testeado sin navegador. La UI se reduce a tres piezas nuevas (`MatchRow`, `MatchGroupCard`, `DayChips`) que `MatchesView` compone. La API solo añade un campo (`competitionCountry`).

**Tech Stack:** Next.js 16 (App Router) + React 18 + Tailwind 3.4, vitest (entorno node, `renderToStaticMarkup` para componentes), API Hono + pg.

**Spec:** `docs/superpowers/specs/2026-10-16-home-jornada-por-competicion-design.md`

## Global Constraints

- "Hoy" y el día de cada partido se calculan SIEMPRE con `madridDateKey` / `madridTodayKey` (`lib/match-time.ts`).
- Orden de competiciones: seguidas primero, luego `importanceRank(slug)`, luego nombre con `localeCompare(locale)`.
- Un partido aparece una sola vez en la página.
- Los directos no reordenan las tarjetas.
- Textos visibles por i18n en los 5 idiomas (`src/locales/{es,en,pt,fr,it}.json`), con `tt(t, key, fallbackEs)` para claves nuevas.
- Cambio de API aditivo: ningún campo existente cambia de nombre ni de tipo.
- `MatchCard` no se toca salvo exportar `formatTime` (lo siguen usando otras pantallas).
- Antes de subir: `npm run typecheck && npm run lint && npm run test` en `apps/web` y `apps/api`, y `next build`.

---

## Estructura de ficheros

```
apps/api/src/routes/live.ts                 # + competition_country en /current y /live
apps/web/src/lib/api/client.ts              # + competitionCountry en RawLiveMatch/normalizeLiveMatch
apps/web/src/lib/api/types.ts               # + competitionCountry?: string | null en Match
apps/web/src/lib/day-view.ts                # NUEVO: lógica pura de la jornada
apps/web/src/lib/day-view.test.ts           # NUEVO
apps/web/src/components/home/MatchRow.tsx   # NUEVO: fila compacta
apps/web/src/components/home/MatchGroupCard.tsx  # NUEVO: tarjeta de competición / Siguiendo
apps/web/src/components/home/DayChips.tsx   # NUEVO: chips En directo / Siguiendo
apps/web/src/components/home/home-rows.test.tsx  # NUEVO: tests de fila y tarjeta
apps/web/src/components/shared/MatchesView.tsx   # reestructurado
apps/web/src/components/shared/DateSelector.tsx  # + punto en días con partidos
apps/web/src/components/home/MiGrada.tsx    # filas con fecha (MatchRow)
apps/web/src/app/[locale]/favorites/page.tsx     # + Mi grada arriba
apps/web/src/locales/*.json                 # claves home.*
BORRAR: components/home/LiveBoard.tsx, components/shared/UpcomingGroup.tsx (+ test),
        lib/upcoming.ts (+ test) si quedan sin uso
```

---

### Task 1: Lógica pura de la jornada (`lib/day-view.ts`)

**Files:**
- Create: `apps/web/src/lib/day-view.ts`, `apps/web/src/lib/day-view.test.ts`

**Interfaces (Produces):**

```ts
export type DayFilter = 'all' | 'live' | 'following';
export interface DayViewMatch { id; status; scheduledAt; startedAt?; homeTeamId; awayTeamId;
  competitionId?; competitionName?; competitionSlug?; competitionCountry? }
export interface CompetitionBlock<T> { key: string; id: string | null; name: string | null;
  slug: string | null; country: string | null; followed: boolean; matches: T[] }
export interface DayView<T> { dayKey: string; total: number; liveCount: number;
  followingCount: number; filter: DayFilter; myTeams: T[]; competitions: CompetitionBlock<T>[] }
export function buildDayView<T extends DayViewMatch>(matches: T[], opts: {
  dayKey: string; teamIds?: readonly string[]; leagueIds?: readonly string[];
  filter?: DayFilter; locale?: string }): DayView<T>;
export function nextMatchday<T extends DayViewMatch>(matches: T[], afterKey: string,
  opts?: { teamIds?; leagueIds?; locale? }): DayView<T> | null;
export function daysWithMatches(matches: readonly DayViewMatch[]): Set<string>;
```

- [ ] **Step 1: Tests que fallan.** Casos: (a) solo partidos del día (clave Madrid), (b) partidos de equipos seguidos van a `myTeams` y NO a su competición, (c) orden de bloques: seguida > importancia > nombre, (d) partidos por hora dentro del bloque, (e) filtro `live` deja solo `status==='live'`, (f) filtro `following` deja equipos y ligas seguidas, (g) filtro sin coincidencias cae a `all` y lo refleja `filter`, (h) `liveCount`/`followingCount` cuentan el día sin filtrar, (i) `nextMatchday` devuelve el primer día posterior con partidos y `null` si no hay, (j) `daysWithMatches` ignora `scheduledAt` nulo.
- [ ] **Step 2:** `npx vitest run src/lib/day-view.test.ts` → FAIL (módulo no existe).
- [ ] **Step 3:** Implementar `day-view.ts` (ver código en el commit; reglas arriba).
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `feat(home): lógica pura de la jornada por competición`.

### Task 2: `competitionCountry` en `/matches/current`

**Files:**
- Modify: `apps/api/src/routes/live.ts` (interface `LiveMatchRow`, `mapLiveRow`, los dos SELECT)
- Modify: `apps/web/src/lib/api/client.ts` (`RawLiveMatch`, `normalizeLiveMatch`), `apps/web/src/lib/api/types.ts` (`Match`)

- [ ] **Step 1:** En ambos SELECT añadir `comp.country AS competition_country` (en `/live` el alias de tabla también es `comp`).
- [ ] **Step 2:** `LiveMatchRow.competition_country: string | null` y en `mapLiveRow` `competitionCountry: row.competition_country`.
- [ ] **Step 3:** Web: `competitionCountry?: string | null` en `RawLiveMatch` y `Match`, y `competitionCountry: raw.competitionCountry ?? null` en `normalizeLiveMatch`.
- [ ] **Step 4:** `npm run typecheck` en `apps/api` y `apps/web` → PASS. Test de integración existente de `/live` sigue en verde.
- [ ] **Step 5:** Commit `feat(api): país de la competición en /matches/current`.

### Task 3: `MatchRow` y `MatchGroupCard`

**Files:**
- Create: `apps/web/src/components/home/MatchRow.tsx`, `MatchGroupCard.tsx`, `home-rows.test.tsx`
- Modify: `apps/web/src/components/shared/MatchCard.tsx` (exportar `formatTime`)

**Interfaces (Produces):**

```tsx
<MatchRow match={Match} followedTeamIds?={ReadonlySet<string>} showDate?={boolean} caption?={string|null} />
<MatchGroupCard title={string} href?={string|null} icon={ReactNode} count={number}
  followed?={boolean} action?={ReactNode} collapsible?={boolean}>{rows}</MatchGroupCard>
<CompetitionIcon country={string|null} name={string|null} />
```

- [ ] **Step 1: Tests que fallan** (`renderToStaticMarkup` + `I18nProvider`, patrón de `upcoming-group.test.tsx`): programado pinta la hora en la TZ de la competición, terminado pinta marcador y "Final", directo pinta "En directo" y marcador, descanso pinta "Descanso", `showDate` añade la fecha corta, la fila enlaza a `/matches/{id}` con `aria-label`, la tarjeta pinta título enlazado, recuento, `aria-expanded="true"` y el icono mundo para `country='W'`.
- [ ] **Step 2:** `npx vitest run src/components/home/home-rows.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar. Fila: rejilla `minmax(0,1fr) auto minmax(0,1fr)`, escudos de 20 px, `clubName(name)` en 13 px con `line-clamp-2`, centro con `font-score tabular-nums`. Directo en `text-live-deep dark:text-live` con `score-flash` al cambiar el marcador (hook movido desde `LiveBoard`). Tarjeta: `card overflow-hidden`, cabecera `bg-slate-50 dark:bg-slate-800/40` con icono, título (Link), estrella si `followed`, recuento y botón chevron (`aria-expanded`, `aria-controls`). Filas separadas con `divide-y`.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `feat(home): fila compacta y tarjeta por competición`.

### Task 4: Reestructurar `MatchesView`

**Files:**
- Modify: `apps/web/src/components/shared/MatchesView.tsx`, `DateSelector.tsx`, `src/locales/*.json`
- Create: `apps/web/src/components/home/DayChips.tsx`
- Delete: `components/home/LiveBoard.tsx`, `components/shared/UpcomingGroup.tsx`, `components/shared/upcoming-group.test.tsx`, `lib/upcoming.ts`, `lib/upcoming.test.ts` (tras comprobar con grep que no quedan imports)

- [ ] **Step 1:** Claves i18n nuevas en los 5 idiomas: `home.filter_live` ("En directo"), `home.filter_following` ("Siguiendo"), `home.next_matchday` ("Próxima jornada: {day}"), `home.go_to_day` ("Ver el {day}"), `home.collapse` ("Plegar {name}"), `home.expand` ("Desplegar {name}"), `home.filters` ("Filtrar partidos").
- [ ] **Step 2:** `MatchesView`: `buildDayView` para el día elegido con `filter` en estado local (se resetea al cambiar de día), `DayChips` bajo el selector, tarjeta Siguiendo (`myTeams`) y una `MatchGroupCard` por bloque. Onboarding tras la primera tarjeta (oculto en `2xl`, donde va al carril). `home-top` tras la primera tarjeta, `list-inline` con `listAdInsertIndex` sobre el total de filas, nunca pegado a `home-top`. Quitar `LiveNowStrip`, `LiveNowBand`, `MiGrada` del flujo móvil, `home-inline`, masonry y "Próximos" del carril.
- [ ] **Step 3:** Día vacío: mensaje + `nextMatchday` (tarjetas desplegadas, `showDate`) + botón "Ver el {día}" que llama a `setSelectedDate`. Día pasado: solo mensaje.
- [ ] **Step 4:** `DateSelector`: prop `daysWithMatches?: ReadonlySet<string>` y punto de 4 px bajo el número.
- [ ] **Step 5:** `npm run typecheck && npm run lint && npm run test` en `apps/web` → PASS.
- [ ] **Step 6:** Commit `feat(home): jornada del día agrupada por competición (estilo FotMob)`.

### Task 5: Mi grada en Favoritos

**Files:**
- Modify: `apps/web/src/components/home/MiGrada.tsx`, `apps/web/src/app/[locale]/favorites/page.tsx`
- Test: `apps/web/src/components/home/home-rows.test.tsx` (caso Mi grada con fecha)

- [ ] **Step 1: Test que falla:** `MiGrada` pinta la fecha corta en cada fila.
- [ ] **Step 2:** `MiGrada` pinta `MatchRow showDate` dentro de `MatchGroupCard` ("Próximos partidos" y "Últimos resultados").
- [ ] **Step 3:** `/favorites` carga `getCurrentMatchesFresh()` en cliente y pinta `MiGrada` arriba cuando hay favoritos. Error de carga: no pinta el bloque (la gestión de favoritos sigue funcionando).
- [ ] **Step 4:** Tests + typecheck → PASS. Commit `feat(favoritos): Mi grada con fechas sale de la home`.

### Task 6: Verificación visual y cierre

- [ ] `next build` en `apps/web`.
- [ ] Arrancar `next start` con `NEXT_PUBLIC_API_URL=https://sticklive.eu/api` y capturar con Playwright en 390 px y 1440 px: hoy, día vacío (lunes 19), filtro En directo si hay, con un favorito en `localStorage`.
- [ ] Revisar el diff completo (sin ficheros accidentales) y subir.

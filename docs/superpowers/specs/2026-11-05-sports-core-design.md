# @sports/core — tipos de API y lógica pura compartidos entre web y app

- **Fecha:** 2026-11-05
- **Estado:** Aprobado (enfoque A), pendiente de plan
- **Contexto:** `claude/app-movil-matriz-huecos.md` (proyecto). Es el lote 1 de la puesta al día de la app móvil con la web y bloquea el resto.

## 1. Problema

La web (`apps/web`) y la app (`apps/mobile`) mantienen copias separadas de:

- **Tipos de respuesta de la API**: `apps/web/src/lib/api/types.ts` (59 tipos) y `apps/mobile/src/lib/api/types.ts` (39 tipos), con solo 22 nombres comunes y equivalentes renombrados (`Match` en web, `MatchSummary` en app).
- **Lógica pura de presentación**: names, grada, player-facts, viewer-tz, day-view, season-phases, knockout, round-selection, competition-filter, content-summary, team-calendar. Todas salvo team-calendar ya divergen (de 35 a 377 líneas de diff).

Cada regla de negocio nueva se arregla en un lado y el otro se queda atrás. Esto es la causa de raíz de que la app vaya por detrás de la web.

## 2. Objetivo y no objetivos

Objetivo: una única fuente de verdad para tipos de API y lógica pura, consumida por web y app, de forma que el compilador impida que vuelvan a divergir.

No objetivos:
- No se comparte UI (React DOM y React Native siguen separados).
- No se comparte el cliente HTTP (auth, cabeceras y caché difieren por plataforma). Solo sus tipos.
- No se toca la API ni `@sports/shared-types` (modelo de dominio interno del backend). Si un tipo de `core/api` ya existe idéntico en `shared-types` (p. ej. `MatchStatus`), se reexporta, no se duplica.
- No se añaden funcionalidades nuevas. Los huecos de pantallas son lotes posteriores.

## 3. Diseño

### 3.1 Paquete

`packages/core`, nombre `@sports/core`, mismo patrón que `@sports/brand`:

- TypeScript fuente, `"type": "module"`, sin build (exports apuntan a `src`).
- Sin dependencias de React, Next, React Native ni Expo. Solo `@sports/shared-types`.
- Entradas por subruta para no arrastrar todo el paquete:
  - `@sports/core/api` → tipos de respuesta de la API.
  - `@sports/core/<modulo>` → un módulo de lógica por subruta (`@sports/core/names`, `@sports/core/day-view`…).
- Tests con vitest dentro del paquete (`src/**/*.test.ts`), integrados en `turbo run test`.

Integración:
- Web: añadir `@sports/core` a dependencias y a `transpilePackages` en `next.config.mjs`.
- App: añadir a dependencias. Metro resuelve workspaces por defecto; verificar con `expo export` que no se duplica nada (el paquete no importa React, así que el shim de `metro.config.js` no le afecta).
- `tsconfig.base.json`: nada específico si los `exports` bastan. Si TypeScript de la app no resuelve subrutas (moduleResolution), se ajusta en su tsconfig.

### 3.2 Reglas de fusión

Para cada tipo y cada módulo que exista en ambos lados:

1. **Reglas de negocio: gana la web.** Es la versión más al día (umbral, orden, estado, texto que se muestra).
2. **Funciones o tipos que solo existen en la app se conservan** (p. ej. `computeCenterOffset`, `resolveDaySwipeDelta` en day-view, `groupCompetitionsForIndex` en competition-filter, `nearestMatchDay` en round-selection, `competitionVisibleTabs` en season-phases). Las que dependan de plataforma (gestos, `Platform.OS`) NO entran en core: se quedan en la app.
3. **Si la app tiene una regla distinta que parece una mejora** (p. ej. `FORCE_TITLE` de names incluye `VIC` y la web no), se adopta en core solo si hay un test que la justifique y se apunta en el registro de decisiones (sección 5). En caso de duda, gana la web y se apunta.
4. **Tests: unión de ambos lados.** Si dos tests se contradicen, se resuelve con la regla 1 y se apunta.
5. Comentarios: se conservan los de la web (llevan el porqué y los números de issue).

### 3.3 Tipos de API (`core/api`)

- Base: `apps/web/src/lib/api/types.ts` entero.
- Se añaden los tipos solo de la app: `AdsConfig`, `ClubTeamSummary`, `CompetitionSeasonSummary`, `CompetitionSeasonsResponse`, `CompetitionsResponse`, `CurrentMatchesResponse`, `DaysIndexResponse`, `FavoritesResponse`, `FederationsResponse`, `PremiumStatus`, `SearchResults`, `SeasonOverviewMatch`, `SeasonOverviewStandingRow`, `StandingsResponse`, `StandingsRow`, `UserPreferencesResponse`, después de comprobar contra la API (`apps/api`) que no tienen ya equivalente con otro nombre en la web.
- `MatchSummary` pasa a `export type MatchSummary = Match` marcado `@deprecated`. Se elimina cuando la app deje de usarlo (fuera de este lote si hace falta).
- Si un campo difiere en opcionalidad entre web y app, se toma lo que devuelva realmente la API (se comprueba en el handler de `apps/api`), no lo que diga cualquiera de las dos copias.
- `apps/web/src/lib/api/types.ts` y `apps/mobile/src/lib/api/types.ts` quedan como `export * from '@sports/core/api'` durante la migración, para no tocar todos los imports de golpe. Se eliminan al final de la fase 3.

### 3.4 Lógica (`core/<modulo>`)

Módulos y su origen:

| Módulo | Web | App | Notas |
|---|---|---|---|
| names | lib/names.ts | lib/names.ts | web tiene teamTitleName/teamQualifiedName, app teamDisplayName |
| grada | components/home/grada.ts | lib/grada.ts | madridDateKey sale de aquí a un módulo de tiempo |
| player-facts | lib/player-facts.ts | lib/player-facts.ts | solo formato |
| viewer-tz | lib/viewer-tz-core.ts | lib/viewer-tz.ts | |
| day-view | lib/day-view.ts | lib/day-view.ts | gestos de swipe se quedan en la app |
| season-phases | lib/season-phases.ts | lib/season-phases.ts | |
| knockout | lib/knockout.ts | lib/knockout.ts | |
| round-selection | components/competition/round-selection.ts | lib/round-selection.ts | |
| competition-filter | components/search/competition-filter.ts | lib/competition-filter.ts | |
| content-summary | lib/content-summary.ts | lib/content-summary.ts | |
| team-calendar | lib/team-calendar.ts | lib/team-calendar.ts | ya idéntico |
| match-time | lib/match-time.ts | lib/time.ts (parte pura) | madridDateKey, madridTodayKey y similares en un solo sitio |

Lo que depende del idioma activo o de `Intl` con locale del usuario se pasa como parámetro (la función recibe `locale`), nunca se lee de un contexto global dentro de core.

### 3.5 Migración de imports

- Cada app sustituye `@/lib/<modulo>` (o la ruta equivalente) por `@sports/core/<modulo>` y borra su copia.
- Wrappers de plataforma se quedan en cada app (hooks que leen el locale activo, gestos, formateo que use APIs nativas).
- Afecta a unos 76 ficheros entre las dos apps.

## 4. Fases y commits

Commit directo a main al final de cada fase, con todo en verde:

1. **Esqueleto + tipos**: crear el paquete, mover tipos, reexportar desde los types.ts de cada app, integrar en Next y Metro.
2. **Lógica**: un commit por módulo (fusión + tests unidos + migración de imports de ese módulo en ambas apps + borrar copias).
3. **Limpieza**: quitar los reexports de types.ts, migrar los imports restantes, quitar el alias `MatchSummary` si ya no se usa.

## 5. Registro de decisiones de fusión

Durante la fase 2 se mantiene en este mismo fichero (apéndice A) una línea por cada conflicto resuelto: módulo, qué difería, qué se eligió y por qué. Ángel lo revisa al cerrar el lote.

## 6. Verificación (criterio de hecho)

En cada commit:
- `npx turbo run test --filter=@sports/core --filter=@sports/web --filter=@sports/mobile`
- `npx turbo run typecheck` y `lint` de los tres paquetes.
- `next build` de la web.
- `expo export --platform android` de la app (comprueba que Metro resuelve el paquete y no duplica módulos).

Al cerrar:
- `grep` sin resultados de copias de los módulos migrados en `apps/web/src` y `apps/mobile/src`.
- Ningún import de `@sports/core` desde React, Next o Expo dentro de `packages/core` (regla de lint `no-restricted-imports` en el paquete).

## 7. Riesgos

- **Cambio de comportamiento en la app** al adoptar la regla de la web: es intencionado (la web es la referencia), pero se lista en el apéndice A para revisar en el dispositivo.
- **Resolución de subrutas en Metro**: si `exports` con subrutas da problemas, alternativa: un único `index.ts` con reexports (el paquete no tiene efectos secundarios, el tree shaking lo resuelve).
- **Dos majors de React en el monorepo**: no afecta porque core no importa React.

## Apéndice A — Decisiones de fusión

(Se rellena en la fase 2.)

- api / CompetitionSummary.season: web objeto inline con campos opcionales, app CompetitionSeasonSummary con name string y fechas obligatorias → elegido el de la web, extraído como CompetitionSeasonSummary porque competitions.ts:187-207 devuelve también firstMatchAt, matchday y champion y el nombre puede ser null.
- api / CompetitionSummary.scope y nameI18n y dataQuality: web unión literal y campos opcionales, app string y obligatorios → elegido web porque es el tipo más estricto en scope y el más tolerante con payloads antiguos.
- api / SeasonPhase.kind: web 'groups', app 'group' → elegido 'groups' porque season-structure.ts:230 y la columna de BD usan 'groups'. El valor 'group' de la app nunca existe en la respuesta.
- api / SeasonPhase.stagesInferred y fromSource: web opcionales, app obligatorios → elegido opcionales porque los payloads antiguos no los traen.
- api / SeasonOverview.season.competitionShort: web competitionShort, app competitionShortName → elegido competitionShort porque season-overview.ts:238 devuelve ese nombre. La app declaraba un campo que no existe. Solo lo usaba un fixture de test, corregido.
- api / SeasonOverview.season.slug y competitionSlug: web opcionales, app obligatorios → elegido opcionales porque web los trata como ausentes en payloads antiguos y la app no los lee sin comprobar.
- api / SeasonOverview.matches y standings: web SeasonMatch y SeasonStandingRow, app SeasonOverviewMatch y SeasonOverviewStandingRow → elegidos los de la web porque el tipo del envoltorio es único. La app pasa a usar SeasonMatch y SeasonStandingRow en sus funciones y fixtures (form y penalizationPoints pasan a obligatorios en filas de clasificación). SeasonOverviewMatch y SeasonOverviewStandingRow se mantienen exportados en core sin consumidores y quedan para retirar.
- api / MatchSummary: app interfaz propia, web Match → elegido type MatchSummary = Match (@deprecated) con Match.fouls opcional añadido porque live.ts:114 lo devuelve. Match exige homeTeamId, awayTeamId, finishedAt y sourceRef, que el cliente web deriva en client.ts:122/166/419 y la API cruda de /matches/current no envía. Los fixtures de la app los incluyen ahora.
- api / Match.homeTeam y awayTeam: web opcionales, app obligatorios → elegido obligatorios porque live.ts y match-dto.ts los devuelven siempre y la web compila sin cambios con ello.
- api / MatchDetail.match.status: web MatchStatus estrecho vía Match, app string → elegido el MatchStatus de dominio de shared-types porque match-dto.ts:335 devuelve el estado de BD sin coaccionar, así que puede ser halftime, overtime o penalty_shootout. match-chronicle.ts de la web pasa a aceptar string en status, ya que solo compara con 'finished'.
- api / MatchDetail.updatedAt: web ausente, app opcional → elegido opcional porque match-stream.ts:140-143 lo añade en SSE.
- api / MatchStats.*: web campos opcionales, app obligatorios → elegido web (opcionales) porque cubre payloads antiguos y la app compila con ello.
- api / PlayerDetail.career: web ausente (tipo local en PlayerProfileClient), app inline parcial → elegido PlayerCareer completo, obligatorio, con la forma de apps/api/src/lib/player-career.ts porque player-detail.ts:332 siempre lo devuelve. Se eliminan los tipos locales de PlayerProfileClient, que además declaraban assists en los totales que la API no envía.
- api / PlayerDetail.player y currentTeam: web sourceRef, birthDate, logoUrl y seasonId obligatorios, app opcionales o ausentes → elegido web porque player-detail.ts:319-337 los devuelve todos. Los fixtures de la app los incluyen.
- api / PlayerCompStats.assists: web obligatorio, app ausente → elegido web porque player-detail.ts lo devuelve en cada fila.
- api / TeamDetail.team.sectionSuffix: web ausente, app string | null → elegido string opcional porque team-section.ts:61 devuelve siempre string y los consumidores web lo tipan así.
- api / TeamDetail.clubTeams: web ausente, app opcional → elegido opcional porque team-detail.ts:667 lo devuelve y payloads antiguos no.
- api / TeamDetail.team.city, country, logoUrl, websiteUrl, club: web obligatorios, app opcionales → elegido web porque team-detail.ts:572-586 los devuelve todos. El fixture de la app los incluye.
- api / TeamMatchSummary.phaseId, stage, seriesGame: web ausentes, app opcionales → elegido opcionales porque team-detail.ts:629 los devuelve.
- api / TeamMatchSummary.startedAt, finishedAt y venue: web obligatorios, app opcionales → elegido web porque serializeMatch los devuelve siempre.
- api / TeamSeasonInfo.competitionFormat y phases: web CompetitionFormat y SeasonPhase[], app string y forma reducida → elegido web porque es más preciso y la app compila con ello.
- api / ZoneKind: web importa de lib/standings-zones-view, app tiene copia propia → elegido copia local no exportada en core/api porque core no puede importar de las apps. Idéntica en ambas. Se unificará con el módulo de zonas.
- api / CompetitionSeasonsResponse: sin equivalente en web → conservado el de la app con forma inline igual que CompetitionSeason.

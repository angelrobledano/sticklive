# @sports/core — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un paquete `@sports/core` con los tipos de respuesta de la API y la lógica pura que hoy está duplicada (y divergida) en `apps/web` y `apps/mobile`, consumido por ambas apps.

**Architecture:** Paquete TS fuente sin build, mismo patrón que `@sports/brand`. Una subruta por módulo (`@sports/core/<modulo>`). Se migra de hojas a raíces del grafo de dependencias, un commit por tarea, con todo en verde en cada commit.

**Tech Stack:** TypeScript 5, vitest 1.6, npm workspaces + Turborepo, Next.js 16 (`transpilePackages`), Expo SDK 57 / Metro.

**Spec:** `docs/superpowers/specs/2026-11-05-sports-core-design.md`

## Global Constraints

- `packages/core` no importa React, Next, React Native, Expo ni nada con efectos de plataforma. Solo `@sports/shared-types`.
- Reglas de negocio en conflicto: gana la web. Funciones solo de la app se conservan si son puras. Cada conflicto se apunta en el Apéndice A de la spec (una línea: módulo, qué difería, qué se eligió, por qué).
- Tests: unión de los tests web y app del módulo, movidos a `packages/core/src/<modulo>.test.ts`.
- Comentarios: se conservan los de la web.
- Lo que dependa del idioma activo entra como parámetro `locale`, nunca leído de un contexto global.
- Commit directo a main al final de cada tarea. Autor: Ángel Robledano <robledano@gmail.com>. Pie del commit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017b5VgZhe268VEnyc6i6gjv
  ```
- Verificación obligatoria antes de cada commit (VERIFY):
  ```bash
  cd /home/claude/sticklive
  npx turbo run test typecheck lint --filter=@sports/core --filter=@sports/web --filter=@sports/mobile
  npm run build -w @sports/web
  (cd apps/mobile && npx expo export --platform android --output-dir /tmp/expo-export-check)
  ```
  Todo debe salir en verde. Si `next build` necesita variables de entorno, usar las de `apps/web/.env.example`.

### Procedimiento de fusión (PF)

Usado por las tareas 3 a 9 para cada módulo `<m>` con origen web `<W>` y origen app `<A>`:

1. `diff -u <W> <A>` y listar diferencias: exports solo web, exports solo app, reglas distintas en exports comunes.
2. Copiar `<W>` a `packages/core/src/<m>.ts`. Cambiar sus imports relativos/alias por imports dentro de core (`./otro-modulo`) o de `@sports/shared-types`, y los tipos de API por `./api`.
3. Añadir los exports puros que solo tiene `<A>` (lista explícita en cada tarea). Si un export solo-app usa `Platform`, `Dimensions` o similar, NO se mueve: se queda en la app.
4. Para cada export común con regla distinta: queda la de la web. Excepción: si la versión app tiene un test que demuestra un caso real que la web falla, se adopta la de la app. En ambos casos, línea en el Apéndice A.
5. Copiar los tests de web y app del módulo a `packages/core/src/<m>.test.ts` (un `describe` por origen al principio, luego fusionar duplicados). Cambiar imports a `./<m>`.
6. `npx vitest run src/<m>.test.ts` en `packages/core`: tiene que pasar. Si un test de la app falla por la regla 4, se adapta el test a la regla de la web y se apunta.
7. En ambas apps: reemplazar el contenido del fichero origen por `export * from '@sports/core/<m>';` (shim temporal, evita tocar todos los imports en esta tarea). Borrar los tests origen (ya viven en core).
8. Añadir la subruta `"./<m>": "./src/<m>.ts"` a `exports` de `packages/core/package.json`.
9. VERIFY y commit.

---

### Task 1: Esqueleto del paquete e integración en web y app

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/eslint.config.mjs`, `packages/core/src/smoke.ts`, `packages/core/src/smoke.test.ts`
- Modify: `apps/web/package.json`, `apps/web/next.config.mjs:53`, `apps/mobile/package.json`

**Interfaces:**
- Produces: paquete `@sports/core` resoluble desde web (Next + vitest + tsc) y app (Metro + vitest + tsc) por subruta.

- [ ] **Step 1: Crear `packages/core/package.json`**

```json
{
  "name": "@sports/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./smoke": "./src/smoke.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": {
    "@sports/shared-types": "*"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Crear `packages/core/tsconfig.json`** (bundler para permitir imports relativos sin extensión, igual que consumen Next y Metro)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "lib": ["ES2022"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Crear `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: 'UTC' },
  },
});
```

- [ ] **Step 4: Crear `packages/core/eslint.config.mjs`** que extiende la config raíz y prohíbe imports de plataforma

```js
import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['react', 'react-*', 'react/*', 'next', 'next/*', 'expo', 'expo-*', '@expo/*', '@/*'],
      }],
    },
  },
];
```

Si la config raíz no exporta un array usable así, copiar su forma (ver `eslint.config.mjs` en la raíz) y añadir solo la regla.

- [ ] **Step 5: Test de humo que falla**

`packages/core/src/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CORE_SMOKE } from './smoke';

describe('core smoke', () => {
  it('exporta la marca de humo', () => {
    expect(CORE_SMOKE).toBe('sports-core');
  });
});
```

Run: `cd packages/core && npx vitest run` → FAIL (no existe `./smoke`).

- [ ] **Step 6: Implementación mínima**

`packages/core/src/smoke.ts`:
```ts
export const CORE_SMOKE = 'sports-core';
```

Run: `npm install` en la raíz, luego `cd packages/core && npx vitest run` → PASS.

- [ ] **Step 7: Integrar en la web**

En `apps/web/package.json` añadir a `dependencies`: `"@sports/core": "*"`.
En `apps/web/next.config.mjs` línea 53: `transpilePackages: ['@sports/shared-types', '@sports/brand', '@sports/core'],` y actualizar el comentario de las líneas 49-52 para incluir `@sports/core`.
Añadir uso temporal en `apps/web/src/lib/core-smoke.test.ts`:
```ts
import { expect, it } from 'vitest';
import { CORE_SMOKE } from '@sports/core/smoke';
it('la web resuelve @sports/core', () => expect(CORE_SMOKE).toBe('sports-core'));
```

- [ ] **Step 8: Integrar en la app**

En `apps/mobile/package.json` añadir a `dependencies`: `"@sports/core": "*"`.
Añadir `apps/mobile/src/lib/core-smoke.test.ts` con el mismo contenido que el de la web.
Si `tsc` de la app no resuelve la subruta (expo/tsconfig.base usa moduleResolution bundler, debería), añadir en `apps/mobile/tsconfig.json` `"moduleResolution": "bundler"` bajo `compilerOptions`.
Importar `CORE_SMOKE` en `apps/mobile/app/+not-found.tsx` solo para comprobar el bundle (`void CORE_SMOKE;`), se quita en la Task 10.

- [ ] **Step 9: VERIFY**

Comprobar además en la salida de `expo export` que no hay error de resolución de `@sports/core/smoke`.

- [ ] **Step 10: Commit**

```bash
git add packages/core apps/web/package.json apps/web/next.config.mjs apps/web/src/lib/core-smoke.test.ts apps/mobile/package.json apps/mobile/src/lib/core-smoke.test.ts apps/mobile/app/+not-found.tsx package-lock.json apps/mobile/tsconfig.json
git commit -m "core: esqueleto de @sports/core integrado en web y app"
```

---

### Task 2: Tipos de API (`@sports/core/api`)

**Files:**
- Create: `packages/core/src/api.ts`, `packages/core/src/api.typecheck.ts`
- Modify: `apps/web/src/lib/api/types.ts`, `apps/mobile/src/lib/api/types.ts`, `packages/core/package.json`
- Consultar: handlers de `apps/api/src` para los campos en conflicto

**Interfaces:**
- Produces: todos los tipos de `apps/web/src/lib/api/types.ts` más los 16 solo-app (`AdsConfig`, `ClubTeamSummary`, `CompetitionSeasonSummary`, `CompetitionSeasonsResponse`, `CompetitionsResponse`, `CurrentMatchesResponse`, `DaysIndexResponse`, `FavoritesResponse`, `FederationsResponse`, `PremiumStatus`, `SearchResults`, `SeasonOverviewMatch`, `SeasonOverviewStandingRow`, `StandingsResponse`, `StandingsRow`, `UserPreferencesResponse`) y `type MatchSummary = Match` (`@deprecated`).

- [ ] **Step 1: Listar diferencias de los 22 tipos comunes**

```bash
cd apps
for t in $(comm -12 <(grep -ho "^export \(interface\|type\) [A-Za-z]*" web/src/lib/api/types.ts | awk '{print $3}' | sort) <(grep -ho "^export \(interface\|type\) [A-Za-z]*" mobile/src/lib/api/types.ts | awk '{print $3}' | sort)); do echo "== $t"; done
```
Para cada uno, comparar campos. Donde difiera la opcionalidad o el tipo de un campo, buscar el handler en `apps/api/src` (`grep -rn "<campo>" apps/api/src/routes`) y quedarse con lo que la API devuelve. Apuntar cada caso en el Apéndice A.

- [ ] **Step 2: Comparar `MatchSummary` (app) con `Match` (web)**

Si `MatchSummary` tiene campos que `Match` no tiene, comprobar en la API si existen. Los que existan se añaden a `Match` como opcionales. Luego `export type MatchSummary = Match;` con `/** @deprecated usar Match */`.

- [ ] **Step 3: Escribir `packages/core/src/api.ts`**

Contenido: el fichero web entero (con su cabecera de comentario), con los ajustes de los pasos 1 y 2, más los 16 tipos solo-app al final bajo `// ─── Solo usados por la app (de apps/mobile) ───`. El import de `MatchStatus` se hace de `@sports/shared-types` si algún tipo lo necesita.

- [ ] **Step 4: Test de tipos que falla primero**

Comprobación de compilación (no es test de vitest) en `packages/core/src/api.typecheck.ts`:
```ts
import type { Match, MatchSummary, FavoritesResponse } from './api';

const m: Match = {} as MatchSummary;
const s: MatchSummary = {} as Match;
type _HasFavs = FavoritesResponse extends object ? true : never;
const _ok: _HasFavs = true;
export { m, s, _ok };
```
Run: `cd packages/core && npx tsc --noEmit` antes de crear `api.ts` → FAIL. Después → PASS.

- [ ] **Step 5: Exportar la subruta**

`packages/core/package.json` → `exports` añade `"./api": "./src/api.ts"`.

- [ ] **Step 6: Shims en las apps**

`apps/web/src/lib/api/types.ts`:
```ts
export * from '@sports/core/api';
```
`apps/mobile/src/lib/api/types.ts`: lo mismo.
Si la web reexporta tipos también desde `apps/web/src/lib/api/client.ts` (`export type { ... } from './types'`), se mantiene tal cual.

- [ ] **Step 7: VERIFY**

Los errores de typecheck que aparezcan en la app son exactamente las divergencias reales: corregir el uso en la app (no el tipo) salvo que la API confirme lo contrario. Cada corrección no trivial al Apéndice A.

- [ ] **Step 8: Commit**

```bash
git add packages/core apps/web/src/lib/api/types.ts apps/mobile docs/superpowers/specs/2026-11-05-sports-core-design.md
git commit -m "core: tipos de respuesta de la API compartidos (web como base + tipos solo de la app)"
```

---

### Task 3: Tiempo (`match-time`, `viewer-tz`)

**Files:**
- Create: `packages/core/src/match-time.ts`, `packages/core/src/match-time.test.ts`, `packages/core/src/viewer-tz.ts`, `packages/core/src/viewer-tz.test.ts`
- Modify: `apps/web/src/lib/match-time.ts`, `apps/web/src/lib/viewer-tz-core.ts`, `apps/mobile/src/lib/viewer-tz.ts`, `apps/mobile/src/lib/time.ts`, `apps/mobile/src/lib/grada.ts` (quitar su `madridDateKey` propio e importar de core), `packages/core/package.json`
- Delete: `apps/web/src/lib/match-time.test.ts`, `apps/web/src/lib/match-time-tbd.test.ts`, `apps/web/src/lib/viewer-tz.test.ts`, `apps/mobile/src/lib/viewer-tz.test.ts`

**Interfaces:**
- Produces `@sports/core/match-time`: `APP_TZ`, `madridDateKey(iso): string`, `madridTodayKey(now?): string`, `addDaysToKey(key, delta): string`, `dayDiff(a, b): number`, `TemporalBucket`, `classifyMatch(...)`, `isTimeTbd(iso, venueTz?)`, `timeTbdLabel(locale?)` (firmas de `apps/web/src/lib/match-time.ts`).
- Produces `@sports/core/viewer-tz`: `DEFAULT_TZ`, `isValidTimeZone`, `dateKeyIn(iso, tz = DEFAULT_TZ)`, `todayKeyIn(tz = DEFAULT_TZ, now?)`, `localTimeDiffers`, `deviceTimeZone`, y de la app `formatTimeIn(iso, tz = DEFAULT_TZ)`.

- [ ] **Step 1: PF para `match-time`** con `<W>` = `apps/web/src/lib/match-time.ts`, `<A>` = la parte pura de `apps/mobile/src/lib/time.ts`. Exports solo-app que NO entran (formateo de UI de la app, se quedan en `time.ts`): `formatKickoff`, `formatDayLabel`, `formatDayShort`, `formatDayKey`, `isEffectivelyLive`, `isAdQuietTime`. Revisar si `formatDayKey` hace lo mismo que `madridDateKey`: si sí, en la app pasa a ser `export { madridDateKey as formatDayKey } from '@sports/core/match-time'` y se apunta. En la app NO se crea shim de `match-time` (la app no tenía ese fichero): `time.ts` importa de core lo que necesite. Ojo: `madridDateKey` web devuelve `string` y la de `grada.ts` de la app `string | null`. Gana la web, ajustar los llamadores de la app.
- [ ] **Step 2: PF para `viewer-tz`** con `<W>` = `apps/web/src/lib/viewer-tz-core.ts`, `<A>` = `apps/mobile/src/lib/viewer-tz.ts`. Solo-app a conservar: `formatTimeIn`. Diferencia conocida: la app tiene `tz = DEFAULT_TZ` por defecto en `dateKeyIn`/`todayKeyIn`, la web no. Adoptar el default (no rompe a la web) y apuntarlo. `deviceTimeZone` usa `Intl.DateTimeFormat().resolvedOptions()`, es puro, entra. Shim web: `apps/web/src/lib/viewer-tz-core.ts`. Shim app: `apps/mobile/src/lib/viewer-tz.ts`.
- [ ] **Step 3: VERIFY**
- [ ] **Step 4: Commit** `git commit -am "core: match-time y viewer-tz unificados"` (añadir antes con `git add packages/core` los ficheros nuevos).

---

### Task 4: Hojas de dominio (`competition-importance`, `playoff`, `stage-label`, `search-text`, `phase-keys`)

**Files:**
- Create en `packages/core/src/`: `competition-importance.ts`, `playoff.ts`, `stage-label.ts`, `search-text.ts`, `phase-keys.ts` y sus `.test.ts`
- Modify: `apps/web/src/lib/competition-importance.ts`, `apps/web/src/lib/playoff.ts`, `apps/web/src/lib/stage-label.ts`, `apps/web/src/lib/search-text.ts`, `apps/web/src/components/competition/format.ts`, `apps/mobile/src/lib/competition-importance.ts`, `apps/mobile/src/lib/playoff.ts`, `apps/mobile/src/lib/knockout.ts` (sus `matchPhaseKey`/`playoffPhaseKey` pasan a venir de core), `apps/mobile/src/lib/competition-filter.ts` (su `normalizeSearchText` sale a core), `packages/core/package.json`

**Interfaces:**
- Produces `@sports/core/phase-keys`: `matchPhaseKey`, `playoffPhaseKey` (firmas de `apps/web/src/components/competition/format.ts`) y `madridDay` del mismo fichero. El resto de `format.ts` (formateo con i18n de la web) se queda en la web y reexporta estas tres desde core.
- Produces `@sports/core/search-text`: `normalizeSearchText(s: string): string`.
- Produces `@sports/core/competition-importance`, `@sports/core/playoff`, `@sports/core/stage-label` con las firmas actuales de la web.

- [ ] **Step 1: PF para `competition-importance`** (`<W>` web/src/lib, `<A>` mobile/src/lib).
- [ ] **Step 2: PF para `playoff`** (`<W>` web/src/lib/playoff.ts, `<A>` mobile/src/lib/playoff.ts). Debe exportar `gameWinnerId`.
- [ ] **Step 3: PF para `stage-label`**: solo existe en la web, se mueve tal cual (pasos 2, 5, 6, 7, 8 del PF). Debe exportar `isKnockoutStage`.
- [ ] **Step 4: PF para `search-text`**: `<W>` = `apps/web/src/lib/search-text.ts`, `<A>` = `normalizeSearchText` de `apps/mobile/src/lib/competition-filter.ts`. En la app, `competition-filter.ts` importa `normalizeSearchText` de core y lo reexporta.
- [ ] **Step 5: PF para `phase-keys`**: `<W>` = `matchPhaseKey`, `playoffPhaseKey`, `madridDay` de `apps/web/src/components/competition/format.ts`, `<A>` = `matchPhaseKey`, `playoffPhaseKey` de `apps/mobile/src/lib/knockout.ts`. Si `madridDay` usa `APP_TZ`, importarlo de `./match-time`. En la web, `format.ts` mantiene el resto y hace `export { matchPhaseKey, playoffPhaseKey, madridDay } from '@sports/core/phase-keys';`.
- [ ] **Step 6: VERIFY**
- [ ] **Step 7: Commit** `"core: importancia de competición, playoff, stage-label, búsqueda sin tildes y claves de fase"`.

---

### Task 5: `names`, `player-facts`, `team-calendar`

**Files:**
- Create en `packages/core/src/`: `names.ts`, `player-facts.ts`, `team-calendar.ts` y tests
- Modify (shims): `apps/web/src/lib/names.ts`, `apps/web/src/lib/player-facts.ts`, `apps/web/src/lib/team-calendar.ts`, `apps/mobile/src/lib/names.ts`, `apps/mobile/src/lib/player-facts.ts`, `apps/mobile/src/lib/team-calendar.ts`

**Interfaces:**
- Produces `@sports/core/names`: todo lo de la web (`competitionName`, `clubName`, `teamTitleName`, `teamQualifiedName`, `playerDisplayName`, `playerNameFromRaw`…) más `teamDisplayName` de la app.
- Produces `@sports/core/player-facts`: `PlayerFactKind`, `PlayerFact`, la función de cálculo con la firma de la web, tipada con `PlayerDetail` de `./api`.
- Produces `@sports/core/team-calendar`: firmas actuales (idénticas en ambos lados).

- [ ] **Step 1: PF para `names`.** Diferencias conocidas: `FORCE_TITLE` app incluye `'VIC'` (regla 4 del PF: adoptar si hay test o caso real como "VIC" de Vic; añadir test `clubName('CP VIC') === 'CP Vic'` y apuntar), `clubName('')` app devuelve `''` con guarda explícita (adoptar, inocuo, apuntar). Solo-app: `teamDisplayName`. Comprobar si `teamDisplayName` equivale a `teamQualifiedName` o `teamTitleName`. Si sí, en core queda como alias `export const teamDisplayName = <equivalente>` con `@deprecated` y se apunta. Si no, entra como función propia.
- [ ] **Step 2: PF para `player-facts`.** Solo diferencias de formato. Quedarse con el texto de la web.
- [ ] **Step 3: PF para `team-calendar`.** Ya idéntico: mover el de la web y sus tests, unir los de la app.
- [ ] **Step 4: VERIFY**
- [ ] **Step 5: Commit** `"core: names, player-facts y team-calendar unificados"`.

---

### Task 6: `grada`

**Files:**
- Create: `packages/core/src/grada.ts`, `packages/core/src/grada.test.ts`
- Modify (shims): `apps/web/src/components/home/grada.ts`, `apps/mobile/src/lib/grada.ts`
- Delete: `apps/web/src/components/home/grada.test.ts`, `apps/mobile/src/lib/grada.test.ts`

**Interfaces:**
- Consumes: `madridDateKey` de `./match-time`, `Match` de `./api`.
- Produces `@sports/core/grada`: `GradaInput`, `GradaSelection` (con `Match[]`), `isUpcomingMatch(m: Match, todayKey: string): boolean`, `selectGradaMatches(matches: Match[], input: GradaInput): GradaSelection`.

- [ ] **Step 1: PF para `grada`.** Diferencias conocidas: `timeOf` web usa `m.scheduledAt ?? m.startedAt`, la app solo `scheduledAt` (gana web, apuntar). `madridDateKey` propio de la app desaparece (viene de core desde la Task 3). Comprobar con `diff` que no hay más diferencias de regla en `selectGradaMatches`.
- [ ] **Step 2: VERIFY**
- [ ] **Step 3: Commit** `"core: grada unificada"`.

---

### Task 7: `day-view`

**Files:**
- Create: `packages/core/src/day-view.ts`, `packages/core/src/day-view.test.ts`
- Create: `apps/mobile/src/lib/day-swipe.ts` (y mover a `apps/mobile/src/lib/day-swipe.test.ts` los tests de gestos)
- Modify (shims): `apps/web/src/lib/day-view.ts`, `apps/mobile/src/lib/day-view.ts`

**Interfaces:**
- Consumes: `dateKeyIn` de `./viewer-tz`, `APP_TZ`/`addDaysToKey`/`dayDiff`/`madridDateKey`/`madridTodayKey` de `./match-time`, `importanceRank` de `./competition-importance`, `feedReason` de `@sports/shared-types`.
- Produces `@sports/core/day-view`: exports de la web (incluido `DayViewMatch`) más los puros de la app: `buildDateKeys`, `computeCenterOffset`, `countryRank`, `dayAbbr`, `monthAbbr`, `getRelativeKey`, `hiddenForDay`, `labelDate` (estas tres últimas con `locale` como parámetro si usan idioma).
- Produces `apps/mobile/src/lib/day-swipe.ts` (se queda en la app, gestos): `ANDROID_APP_SWIPE`, `SWIPE`, `extractGestureStartX`, `isHorizontalSwipeGesture`, `isOutsideEdgeGuard`, `resolveDaySwipeDelta`.

- [ ] **Step 1: Separar gestos en la app.** Mover a `apps/mobile/src/lib/day-swipe.ts` los exports de gesto listados y sus tests. Actualizar imports: `grep -rln "lib/day-view'" apps/mobile/src apps/mobile/app` y cambiar los que usen esos nombres a `@/src/lib/day-swipe`. Correr `npx vitest run src/lib/day-swipe.test.ts` en la app → PASS.
- [ ] **Step 2: PF para `day-view`.** `addDaysToKey`, `dayDiff`, `madridDateKey`, `madridTodayKey` que la app define en day-view se eliminan de day-view y se reexportan desde `./match-time` (gana la web). La app tiene `isEffectivelyLive` en el filtrado: si la web usa otra regla de "en directo" (shared-types `matchDisplayState`), gana la web, apuntar.
- [ ] **Step 3: VERIFY**
- [ ] **Step 4: Commit** `"core: day-view unificado, gestos de swipe separados en la app"`.

---

### Task 8: `season-phases` y `knockout`

**Files:**
- Create en `packages/core/src/`: `season-phases.ts`, `knockout.ts` y tests
- Modify (shims): `apps/web/src/lib/season-phases.ts`, `apps/web/src/lib/knockout.ts`, `apps/mobile/src/lib/season-phases.ts`, `apps/mobile/src/lib/knockout.ts`

**Interfaces:**
- Consumes: `gameWinnerId` de `./playoff`, `matchPhaseKey`/`playoffPhaseKey` de `./phase-keys`, `STAGE_ORDER`/`KnockoutStage` de `@sports/shared-types`, tipos de `./api` (`SeasonMatch`, `SeasonPhase`, `SeasonRound`, `TeamSeasonInfo`).
- Produces `@sports/core/season-phases`: exports web más `MAIN`, `MainTab`, `CompetitionIndexTeam`, `competitionTeamsForIndex`, `competitionVisibleTabs` de la app.
- Produces `@sports/core/knockout`: exports web (`matchPhaseKey`, `playoffPhaseKey` se reexportan desde `./phase-keys`).

- [ ] **Step 1: PF para `season-phases`.**
- [ ] **Step 2: PF para `knockout`.** La web tiene 481 líneas frente a 390: buscar especialmente reglas de eliminatorias a doble partido, Final Four y desempates que la app no tenga (gana web).
- [ ] **Step 3: VERIFY**
- [ ] **Step 4: Commit** `"core: season-phases y knockout unificados"`.

---

### Task 9: `round-selection`, `competition-filter`, `content-summary`

**Files:**
- Create en `packages/core/src/`: `round-selection.ts`, `competition-filter.ts`, `content-summary.ts` y tests
- Modify (shims): `apps/web/src/components/competition/round-selection.ts`, `apps/web/src/components/search/competition-filter.ts`, `apps/web/src/lib/content-summary.ts`, `apps/mobile/src/lib/round-selection.ts`, `apps/mobile/src/lib/competition-filter.ts`, `apps/mobile/src/lib/content-summary.ts`

**Interfaces:**
- Consumes: `dayDiff` de `./match-time`, `madridDay` de `./phase-keys`, `isKnockoutStage` de `./stage-label`, `normalizeSearchText` de `./search-text`, `importanceRank`/`orderByImportance` de `./competition-importance`, `gameWinnerId` de `./playoff`, `playerDisplayName`/`playerNameFromRaw` de `./names`, tipos de `./api`.
- Produces `@sports/core/round-selection`: exports web más `FixturesFilterMode`, `NearestDay`, `RoundItem`, `dateNeighbor`, `nearestMatchDay`, `roundLabel`, `stageLabel`, `dayPillLabel` (con `locale` como parámetro si usan textos). `isKnockoutStage` y `madridDay` se reexportan desde sus módulos, no se redefinen.
- Produces `@sports/core/competition-filter`: exports web más `COUNTRY`, `CompetitionsIndex`, `countryDisplayName`, `countrySortKey`, `genderLabel`, `groupCompetitionsForIndex` (textos con `locale`).
- Produces `@sports/core/content-summary`: exports web más el tipo `CompetitionSummaryData` de la app.

- [ ] **Step 1: PF para `round-selection`.** Si `roundLabel`/`stageLabel`/`dayPillLabel` de la app dependen de su i18n (`t(...)`), NO entran en core: se quedan en la app y se apunta.
- [ ] **Step 2: PF para `competition-filter`.** Misma regla para `countryDisplayName`/`genderLabel` si dependen de i18n.
- [ ] **Step 3: PF para `content-summary`.**
- [ ] **Step 4: VERIFY**
- [ ] **Step 5: Commit** `"core: round-selection, competition-filter y content-summary unificados"`.

---

### Task 10: Limpieza de shims e imports directos

**Files:**
- Modify: todos los ficheros de web y app que importan los shims (unos 76)
- Delete: los shims de las Tasks 2 a 9, `apps/web/src/lib/core-smoke.test.ts`, `apps/mobile/src/lib/core-smoke.test.ts`, `packages/core/src/smoke.ts`, `packages/core/src/smoke.test.ts`, entrada `./smoke` de `exports`
- Modify: `apps/mobile/app/+not-found.tsx` (quitar el import de humo), `docs/superpowers/specs/2026-11-05-sports-core-design.md` (estado → Implementado)

- [ ] **Step 1: Reescribir imports.** Para cada shim, `grep -rln "<ruta del shim>" apps/web/src apps/mobile/src apps/mobile/app` y sustituir por `@sports/core/<m>` (`sed -i` por fichero, revisando el diff). Rutas web: `@/lib/<m>`, `@/lib/api/types`, `./types` dentro de `lib/api`, `@/components/home/grada`, `@/components/competition/round-selection`, `@/components/search/competition-filter`, `@/lib/viewer-tz-core`. Rutas app: `@/src/lib/<m>`, `./<m>`, `../lib/<m>`, `@/src/lib/api/types`.
- [ ] **Step 2: Borrar shims y humo.** Excepción: `apps/web/src/components/competition/format.ts` y `apps/mobile/src/lib/time.ts` no son shims puros (tienen código propio), se quedan con sus imports de core.
- [ ] **Step 3: `MatchSummary`.** `grep -rn "MatchSummary" apps/mobile` y sustituir por `Match`. Si queda en 0, borrar el alias en `packages/core/src/api.ts`.
- [ ] **Step 4: Comprobación de que no quedan copias**

```bash
cd /home/claude/sticklive/apps
for m in names grada player-facts viewer-tz viewer-tz-core day-view season-phases knockout round-selection competition-filter content-summary team-calendar competition-importance playoff stage-label search-text match-time; do find web/src mobile/src -name "$m.ts"; done
```
Expected: sin salida.

- [ ] **Step 5: Comprobación de regla de plataforma**: `cd packages/core && npx eslint src` → sin errores.
- [ ] **Step 6: Spec**: cambiar `Estado:` a `Implementado` y revisar que el Apéndice A está completo.
- [ ] **Step 7: VERIFY**
- [ ] **Step 8: Commit** `"core: imports directos a @sports/core, fuera shims y copias"` y `git push origin HEAD:main`.

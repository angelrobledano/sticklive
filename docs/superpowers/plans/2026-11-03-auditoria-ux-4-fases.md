# Auditoría UX: 4 fases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver los problemas #1–#15 y las mejoras estructurales 1–5 de la auditoría UX/UI del 03/11/2026.

**Architecture:** Lógica nueva en funciones puras con test (`lib/*.ts`), componentes que solo las consumen. Sin dependencias nuevas. Una migración aditiva (106) y un cambio de SQL en la API (carrera del jugador).

**Tech Stack:** Next.js 16 (App Router), React, Tailwind 3.4, Vitest, Hono + PostgreSQL.

**Spec:** Doc «Auditoría UX/UI de Stick Live» (https://claude.ai/artifact/Rv3bTKcZ5jEEXki6xCbVoV).

## Global Constraints

- Commits directos a `main`, sin PR (preferencia de Ángel).
- Antes de cada push: `npm run typecheck && npm run lint && npm run test` en `apps/web` (y `apps/api` si se toca).
- i18n: toda copia nueva en los 6 locales (es, ca, en, fr, it, pt).
- Sin punto y coma en la copia de usuario.
- La app móvil consume la API: no romper contratos.

---

## Fase 1 — Primer pantallazo

### Task 1: Anuncios contenidos (#1, estructural 5)

**Files:** Modify `apps/web/src/components/shared/AdBanner.tsx`, `apps/web/src/lib/ads.ts`. Test `apps/web/src/lib/ads.test.ts`.

- [ ] Test: `adSlotLayout('home-top')` → `{ fullWidthResponsive: false, maxHeightClass: 'max-h-[100px]' }`, `adSlotLayout('match-summary')` → `fullWidthResponsive: true`.
- [ ] Implementar `adSlotLayout(zone)` en `lib/ads.ts`: zonas de lista (`home-top`, `home-inline`, `list-inline`) sin full-width-responsive y con alto máximo de 100 px.
- [ ] `AdsenseUnit`: `data-full-width-responsive` según `adSlotLayout`, contenedor con `max-h` + `overflow-hidden` solo en esas zonas, y un temporizador de 3 s que oculta el contenedor si no hay `iframe` con `offsetHeight > 0`.
- [ ] Tests en verde y commit.

### Task 2: Onboarding descartable (#2)

**Files:** Modify `apps/web/src/components/shared/MatchesView.tsx`. Locales: `favorites.onboarding_strip`, `favorites.onboarding_dismiss`.

- [ ] Test en `home-day-view.test.tsx`: sin favoritos, el texto de la franja aparece ANTES del primer bloque de partidos y la tarjeta antigua (`onboarding_body`) no se pinta.
- [ ] `FavoritesOnboarding` pasa a ser una franja de una línea bajo `DayChips`, con enlace a `/favorites?onboarding=1` y un botón ✕ que guarda `rink-onboarding-dismissed=1` en localStorage (try/catch).
- [ ] Sale de `afterFirst`. Tests en verde y commit.

### Task 3: Error literal y ChunkLoadError (#7)

**Files:** Create `apps/web/src/lib/chunk-error.ts` + test. Modify `app/[locale]/error.tsx` y locales `errors.boundary_*`.

- [ ] Test: `isChunkLoadError(new Error('Loading chunk 1972 failed'))` es true. `shouldAutoReload(storage)` es true la primera vez y false la segunda en menos de 60 s.
- [ ] En `error.tsx`: si es un error de chunk y procede, `window.location.reload()`. Si no, copia literal: badge «ERROR», título «No hemos podido cargar esta página», cuerpo «Puede ser un fallo de conexión o una actualización reciente. Vuelve a intentarlo.». El enlace secundario lleva a `/competitions` («Ver competiciones») para no hacer bucle desde la home.
- [ ] Tests en verde y commit.

## Fase 2 — Confianza en el dato y ficha de partido

### Task 4: Partidos jugados coherentes en la carrera del jugador (#4)

**Files:** Modify `apps/api/src/routes/player-detail.ts` (consulta de carrera). Test `tests/integration/player-stats-lineup-only.integration.test.ts`.

- [ ] Test de integración: un jugador con 4 alineaciones y goles en 2 partidos → `career.seasons[0].totals.pj === 4 === seasonTotals.pj`.
- [ ] En la carrera, `pj` = partidos DISTINCT con alineación (mismo equipo y temporada) ∪ con evento, igual que `pj_real`. En la rama de `team_players` y en la de solo eventos.
- [ ] Integración en verde contra Postgres local y commit.

### Task 5: «Así llegaban» plegado tras el final (#6)

**Files:** Modify `apps/web/src/components/match/MatchPreview.tsx`, `app/[locale]/matches/[id]/page.tsx`. Test nuevo `components/match/match-preview-post.test.tsx`.

- [ ] Test: con `variant="post"`, renderiza `<details>` sin `open` y con el título «Así llegaban». Con `pre`, la sección actual.
- [ ] Implementación y uso en la página para `!isPreMatch`. Copia en los 6 idiomas dentro de `COPY`.
- [ ] Commit.

### Task 6: Cronología con dos niveles (estructural 3)

**Files:** Modify `apps/web/src/components/match/TimelineTab.tsx`. Test en `timeline-window.test.ts`.

- [ ] Test: `keyEvents(timeline)` quita `foul` y `timeout`, pero mantiene goles, penaltis, faltas directas, tarjetas, divisores y faltas acumuladas.
- [ ] Interruptor «Lo importante / Todo»: por defecto «Lo importante» si el partido ha terminado y «Todo» si está en directo. El `aria-live` sigue calculándose sobre el timeline completo.
- [ ] Commit.

### Task 7: Accesibilidad (#8, #10, #11)

**Files:** Modify `components/competition/CompetitionsList.tsx` (estrella), tabs de equipo y de Ajustes, `tailwind.config` si hace falta. Test `team/tabs-overflow.test.ts` (ya existe).

- [ ] Estrella de la lista de competiciones con 44×44 px de área.
- [ ] Indicador de scroll (máscara con degradado) en las filas de pestañas que desbordan.
- [ ] Clases `text-[9px]` y `text-[10px]` en texto con información → `text-[11px]`.
- [ ] Commit.

## Fase 3 — Personalización

### Task 8: Favoritos agrupados (#3)

**Files:** Create `apps/web/src/lib/favorites-groups.ts` + test. Modify `app/[locale]/favorites/page.tsx`.

- [ ] Test de `groupFavoriteLeagues(leagues, { followed, country })` → `[{ key: 'following' }, { key: 'featured' }, { key: 'ES', federations: [{ code: 'RFEP' }, { code: 'FECAPA' }, …] }, …]`. Seguidas fuera del resto. Destacadas por `featuredRank`. Federaciones por `importanceRank` de sus ligas. País preferido primero.
- [ ] Página: sin búsqueda, se pintan las seguidas, las destacadas y después un acordeón por país con federaciones dentro. Equipos: solo los seguidos, más la indicación de buscar. Con búsqueda, el comportamiento actual.
- [ ] Logo de la competición o bandera en lugar de las siglas.
- [ ] Commit.

### Task 9: Notificaciones desde la estrella y copia según dispositivo (estructural 1)

**Files:** Modify `components/shared/FavoriteStar.tsx`, locales `favorites.manage_help`.

- [ ] Al pasar a seguido con `variant="button"` (cabecera de equipo o competición), abrir `NotificationPresetSheet` si el push está disponible. Si no, solo el toast.
- [ ] `manage_help` sin la promesa de alertas automáticas: «Sus partidos saldrán primero en Partidos. Puedes activar avisos desde Ajustes».
- [ ] Commit.

## Fase 4 — Escritorio y navegación

### Task 10: Escritorio a dos columnas (#5, estructural 2)

**Files:** Modify `app/[locale]/matches/[id]/page.tsx`, `components/shared/MatchesView.tsx`.

- [ ] Partido: contenedor `lg:max-w-5xl` con `lg:grid-cols-[minmax(0,1fr)_340px]`. A la izquierda, centro del partido. A la derecha, crónica, último enfrentamiento y «Así llegaban». En móvil, el mismo orden apilado.
- [ ] Home: el carril «Mi grada» pasa de `2xl` a `xl` (1.280 px).
- [ ] Commit.

### Task 11: Cuatro destinos en la barra inferior (estructural 4)

**Files:** Modify `components/layout/BottomNav.tsx`, cabecera de `app/[locale]/favorites/page.tsx`.

- [ ] Comprobar en PostHog el peso de `/settings` en las páginas vistas de los últimos 30 días. Si es menor del 5 %, seguir. Si no, saltar la tarea y anotarlo.
- [ ] BottomNav sin Ajustes. Icono de engranaje (44 px, `aria-label` «Ajustes») en la cabecera de Favoritos. El Sidebar de escritorio no cambia.
- [ ] Actualizar el test de BottomNav. Commit.

## Pequeños (#12–#15)

### Task 12: Plurales, Volver, categorías y siglas

- [ ] Plurales con `{n}`: `search.results_count` y puntos de la previa (`1 punto` / `N puntos`) mediante el helper `plural(n, one, other)` en `lib/format` + test.
- [ ] Ficha de jugador: «Volver» con `currentTeam.name` completo.
- [ ] Migración `106_tiers_categorias_numericas.sql`: competiciones con tier 5 y nombre `\m1[0-7]\M` (p. ej. «Femení 13 OR») → tier 7. Idempotente.
- [ ] `MatchHeader`: nombre completo desde `md`, siglas por debajo.
- [ ] Commit.

## Verificación final

- [ ] `npm run typecheck && npm run lint && npm run test` en web y api, integración de la Task 4 y migraciones desde cero en Postgres local.
- [ ] Push a main. Tras el despliegue, revisar en el navegador real (móvil y escritorio) home, competiciones, partido, jugador y favoritos.

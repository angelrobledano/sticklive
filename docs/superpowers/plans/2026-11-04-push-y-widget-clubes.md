# Push al seguir y widget para clubes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** (1) Que seguir un equipo lleve a activar los avisos desde cualquier sitio (no solo la estrella) y medir dónde se pierde. (2) Que los clubes puedan llevarse Stick Live a su web (widget incrustable) y encuentren la imagen de resultado que ya existe.

**Architecture:** (1) Función pura `pushOfferMode` + componente `PushOfferCard` reutilizado en la hoja de presets y en Favoritos, con eventos `push_offer_shown` / `push_offer_result`. (2) Route handler `/{locale}/embed/team/{id}` que devuelve HTML autocontenido (sin la app), generado por una función pura `renderTeamWidget` con escapado. Caddy permite incrustar solo `/*/embed/*`. Bloque «Para el club» plegado en la ficha de equipo con el código y la imagen.

**Contexto (datos 03/11/2026):** VAPID presente en producción. `push_subscribed` = 0 en 60 días. 30 `favorite_added` en 30 días, la mayoría sin hoja de presets (Favoritos). En iPhone sin instalar la oferta desaparece sin explicación.

## Global Constraints
- Commit directo a `main`. Copia en los 6 locales. Sin punto y coma en la copia.
- El widget no lleva JS, ni cookies, ni analítica de terceros (va en webs ajenas, sin consentimiento). Se mide por `utm_source=widget` al llegar a Stick Live.
- `noindex` en el widget (contenido duplicado).

## Task 1: `pushOfferMode` (TDD) — `lib/push.ts`
- [ ] Test: iOS sin instalar → `install_ios`. Soportado + permiso `default` → `activate`. Concedido, denegado o sin VAPID → `none`.
- [ ] Implementar reutilizando `shouldOfferPushActivation`.

## Task 2: `PushOfferCard` + eventos
- [ ] Componente con dos modos: botón «Activar avisos» (gesto → `enablePush`) o pasos de iPhone (Compartir → Añadir a pantalla de inicio).
- [ ] `push_offer_shown {source, mode}` al montar (una vez por montaje) y `push_offer_result {source, result: granted|denied|error}`.
- [ ] Sustituye el bloque inline de `NotificationPresetSheet` (source `preset_sheet`).
- [ ] En Favoritos, arriba, cuando hay ≥1 favorito (source `favorites`), descartable (localStorage 7 días).

## Task 3: `renderTeamWidget` (TDD) — `lib/embed/team-widget.ts`
- [ ] Test: escapa HTML de nombres. Próximo partido + últimos 3 resultados + clasificación con la fila del equipo resaltada. Enlaces con `target="_blank"` y UTM. Sin `<script>`.
- [ ] Implementar (hora en la zona de la competición).

## Task 4: Ruta `/{locale}/embed/team/[id]/route.ts`
- [ ] `getTeamDetail` + `getSeasonOverview(selectedSeasonId)` para la tabla completa. Errores → HTML mínimo con enlace a Stick Live.
- [ ] Cabeceras: `Content-Type: text/html`, `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`, `X-Robots-Tag: noindex`.
- [ ] Middleware: no redirigir `/embed`.

## Task 5: Caddy
- [ ] `@embed path_regexp ^/[a-z]{2}/embed/` → quitar `X-Frame-Options` y `frame-ancestors *` en la CSP report-only.

## Task 6: «Para el club» en la ficha de equipo
- [ ] `<details>` al final: imagen del último resultado (diálogo existente) y código del iframe con «Copiar» (`embed_code_copied {team_id}`).

## Task 7: Docs y verificación
- [ ] TRACKING_POSTHOG.md: eventos nuevos y funnel de push por `source`.
- [ ] typecheck, lint, tests. Push. Tras desplegar web y recargar Caddy, probar el iframe desde un HTML externo.

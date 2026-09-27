# Plan técnico — Presets de notificaciones

> **ESTADO: IMPLEMENTADO.** Los presets por entidad (`complete | key_events | results | silent`) viven en `apps/web/src/lib/notif-prefs.ts` y el emisor segmenta por ellos. El comportamiento as-built está en [NOTIFICACIONES.md](./NOTIFICACIONES.md). Este documento se conserva como registro de las decisiones.

*Borrador de implementación. Mapea el spec de presets al código actual de Stick Live, fija las decisiones abiertas y lo trocea en fases.*

---

## 1. Punto de partida (lo que hay hoy)

- **Seguir** = arrays planos en localStorage por dispositivo (`rink-favorites`, `rink-fav-leagues`, `rink-fav-players`), espejados a la nube (`user_favorites`, columnas `kind`/`ref_id`) solo si hay sesión (`reconcileCloud`).
- **Notificar** = lista de exclusión `rink-notif-disabled` (notif-prefs.ts) + un objeto **`config` global por dispositivo** (`favMatchStart`, `favGoals`, `favRedCards`, `favMatchEnd`, `globalMatchStart`, `quietNight`, `master`). El cliente sube a `push_subscriptions` (`fav_teams UUID[]`, `fav_leagues`, `fav_players`, `config JSONB`).
- **Emisor** (`apps/etl/src/push-dispatcher.ts`): segmenta por los arrays + los booleanos globales. Hoy emite: inicio, gol (jugador+minuto), expulsión (roja), descanso/2ª parte, final, jornada.
- **Acta** (`fep-ficha.scraper.ts`): ya parsea y persiste en `match_events` los tipos `goal`, `penalty`, `blue_card`, `red_card`, `direct_foul`, `foul`, `timeout`, `period_end`. → **tarjeta azul y falta directa ya están disponibles en BD.**

**Brecha central:** el spec pide un **preset por cada follow**; hoy la configuración de eventos es **global por dispositivo**. Eso es un cambio de modelo, no un ajuste. Y el catálogo de eventos del spec (azul + falta directa, sin roja) no coincide con lo que emite hoy el dispatcher.

---

## 2. Decisiones (con recomendación)

**D1 · Dónde vive el preset.** Recomendado: columna `presets JSONB` en `push_subscriptions`, con clave `"<tipo>:<id>"` → preset (ej. `{"team:ccc…":"key_events"}`), más una columna `preset` en `user_favorites` para roaming con sesión. No hace falta tabla nueva: el sync ya sube el bloque entero de favoritos, añadimos el mapa de presets al mismo payload.

**D2 · Default y migración.** Recomendado: los follows **existentes** se migran a `COMPLETE` (no cambia lo que la gente recibe hoy). Para follows **nuevos**, el modal preselecciona `KEY_EVENTS` (es el punto dulce anti-ruido del spec). Así nadie pierde avisos de golpe y los nuevos entran ya filtrados.

**D3 · Tarjeta roja.** El spec no la lista, pero una expulsión es más relevante que una azul. Recomendado: incluir `red_card` en `COMPLETE` y `KEY_EVENTS`. Confírmame si la quieres fuera.

**D4 · Descanso / 2ª parte.** El spec no los incluye. Recomendado: sacarlos de las notificaciones push (reduce ruido; el crono/descanso ya se ve en el directo y en la lista con el badge "Descanso" que acabamos de meter).

**D5 · Por dispositivo vs cuenta.** Recomendado para v1: mantener el modelo actual (localStorage por dispositivo + espejo a `user_favorites` con sesión). No bloqueamos esta feature en construir cuentas. Se documenta que sin login el preset no viaja entre móviles.

**D6 · "Seguir" ≠ "notificar".** El follow (estrella/favorito) controla visibilidad en listas; el preset controla el push. `SILENT` = lo sigo pero no me avisa. Esto, además de cumplir el spec, **arregla de raíz la confusión estrella↔notificación** que provocó que no te llegara el Liceo (seguías por estrella pero el backend no tenía el equipo activado).

**D7 · Bundling azul→falta directa.** Va en fase propia (Fase 3): depende de relacionar los dos eventos del acta por instante/jugador, que es la parte más frágil.

---

## 3. Modelo de datos

**Migración `028_notification_presets.sql`:**

```sql
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS presets jsonb NOT NULL DEFAULT '{}';
ALTER TABLE user_favorites      ADD COLUMN IF NOT EXISTS preset  text;  -- NULL = COMPLETE (compat)

-- Backfill: todo lo ya seguido pasa a COMPLETE para no cambiar comportamiento.
UPDATE push_subscriptions SET presets = (
  SELECT COALESCE(jsonb_object_agg(k, 'complete'), '{}'::jsonb) FROM (
    SELECT 'team:'||t        AS k FROM unnest(fav_teams)   t
    UNION ALL SELECT 'competition:'||l FROM unnest(fav_leagues) l
    UNION ALL SELECT 'player:'||p      FROM unnest(fav_players) p
  ) s
) WHERE presets = '{}'::jsonb;
```

**Tipos compartidos** (`packages/shared-types`): `type NotificationPreset = 'complete' | 'key_events' | 'results' | 'silent'`.

**Cliente** (`notif-prefs.ts` / `push.ts`): nuevo store `rink-notif-presets` (`Record<"<tipo>:<id>", NotificationPreset>`). `gather()` deja de mandar `enabledTeams(...)` filtrado por exclusión y pasa a mandar el mapa `presets`. Los arrays `fav_*` siguen subiéndose como "lo que sigo" (para que el emisor sepa la entidad), pero el gate de eventos lo decide `presets[clave]`.

---

## 4. Catálogo de eventos → preset

Eventos canónicos: `start`, `goal`, `blue_card`, `direct_foul`, `red_card`, `final`.

| Preset | Equipo / Competición | Jugador (solo si participa) |
|---|---|---|
| **COMPLETE** | start · goal · blue · falta directa · red · final | start · su gol · su azul · su FD · su roja · final |
| **KEY_EVENTS** | goal · blue · falta directa · red · final | su gol · su azul · su FD · su roja · final |
| **RESULTS** | start · final | start · final |
| **SILENT** | — | — |

Implementación interna como **colección de tipos de evento por preset** (no booleanos sueltos), para poder añadir eventos futuros sin rediseñar:

```ts
const PRESET_EVENTS: Record<NotificationPreset, EventType[]> = {
  complete:  ['start','goal','blue_card','direct_foul','red_card','final'],
  key_events:['goal','blue_card','direct_foul','red_card','final'],
  results:   ['start','final'],
  silent:    [],
};
```

---

## 5. Fases

### Fase 0 · Modelo + plumbing de sync (sin cambio de UX) — *S/M*
- Migración 028 + backfill a COMPLETE. Tipo `NotificationPreset` en shared-types.
- `push.ts` `gather()` envía `presets`; `/push/subscribe` (api) persiste `presets`. `user_favorites` admite `preset`.
- **Criterios:** suscribir/seguir guarda `presets` en BD; los follows existentes quedan en `complete`; el emisor sigue funcionando igual (compat). Sin regresión en lo actual.

### Fase 1 · Emisor por preset — *M* (núcleo)
- Reescribir la segmentación de `push-dispatcher.ts`: para cada evento y cada suscripción, resolver la(s) entidad(es) que la hacen seguidora (equipo local/visitante, competición, jugador), leer `presets["tipo:id"]` y comprobar `PRESET_EVENTS[preset].includes(evento)`. `master`/`quietNight` siguen siendo globales.
- Añadir snapshot/diff de `blue_card` y `direct_foul` (mismo patrón que `red_card`); mantener `red_card` (D3). Quitar descanso/2ª parte (D4).
- Copias en `notification-copy.ts`: ya existe `cardAlert('azul'|'roja',…)`; añadir `directFoulAlert(...)`. Dedup por `matchTag` (ya existe).
- **Criterios:** un follow `RESULTS` recibe solo inicio+final; `KEY_EVENTS` no recibe inicio; `SILENT` no recibe nada; un seguidor de jugador solo recibe eventos donde participa. Tests del mapeo evento↔preset.

### Fase 2 · UX (modal + gestión) — *M*
- Bottom sheet "¿Qué quieres recibir?" al pulsar seguir, con las 4 opciones (KEY_EVENTS preseleccionado). Escribe `rink-notif-presets` + `syncPushConfig()`.
- "Gestionar notificaciones" en pantallas de equipo, jugador, competición y en "Siguiendo"/favoritos, reabriendo el mismo selector.
- **Criterios:** seguir abre el selector; cambiar preset se refleja en BD en <1s; SILENT mantiene la estrella pero corta el push.

### Fase 3 · Bundling + prioridad — *M/L*
- Agrupar azul→falta directa del mismo instante/jugador en una sola notificación ("🔵 Azul para X. El equipo dispone de falta directa."). Reusar la lógica de agrupación por instante que ya relaciona gol↔FD en el ficha-scraper.
- Prioridad (alta: gol/azul/FD/roja/final; media: inicio) para ordenar el colapso por `matchTag`.
- **Criterios:** azul+FD contiguas = 1 push; nunca dos push idénticas para el mismo evento.

### Fase 4 · Analítica — *S/M*
- `follow_created` (entity_type, entity_id, preset_selected), `notification_preset_changed` (… previous/new). Ya tienes `track()` en `useFavorites`.
- `notification_opened` (notification_type, entity_type, entity_id): handler `notificationclick` en `sw.js` → beacon a un endpoint nuevo `/push/opened` que emite el evento server-side a PostHog (en el SW no hay PostHog).
- **Criterios:** los 3 eventos llegan a PostHog; dashboard con adopción (% follows con preset), distribución de presets y open rate.

---

## 6. Riesgos / cosas a vigilar

- **Fragmentación por dispositivo (D5):** sin login el preset no viaja; el usuario puede tener Liceo en `COMPLETE` en un móvil y nada en otro. Mitiga: empujar el login suave; documentarlo.
- **Bundling depende del acta:** relacionar azul→FD por instante puede fallar si la fuente no los coloca contiguos; por eso va aislado en Fase 3 y degrada a dos push si no se puede agrupar (nunca peor que hoy).
- **`notification_opened` en el SW:** requiere beacon a la API; sin red en el click se pierde (aceptable).
- **Migración:** el backfill a COMPLETE es la red de seguridad para no recortar avisos a usuarios actuales sin avisar.

---

## 7. Siguiente paso recomendado

Empezar por **Fase 0 + Fase 1** juntas (modelo + emisor), que es donde está el valor y el riesgo; la UX (Fase 2) puede ir detrás reusando el sync. Antes de codificar, cierra **D3 (roja)** y **D4 (descanso)** — son las dos que cambian el catálogo de eventos.

**Resumen de decisiones clave:** preset por-entidad en `push_subscriptions.presets` (D1); default COMPLETE para lo existente y KEY_EVENTS para lo nuevo (D2); incluir roja (D3) y quitar descanso (D4); per-dispositivo en v1 (D5); seguir≠notificar con SILENT (D6); bundling en fase aparte (D7).

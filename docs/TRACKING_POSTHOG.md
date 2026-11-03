# Tracking de producto en PostHog — Stick Live

*Documento vivo · mantener junto al código · última revisión: 3 de noviembre de 2026*
*Complementa el [Plan de medición](./ANALITICA_PLAN_MEDICION.md) (v1.0, junio): aquel define el «qué medir y por qué». Este documenta el «qué está medido hoy, dónde verlo y qué falta». Cuando discrepan, manda este.*

---

## 0. Revisión del 3 de noviembre de 2026: qué ha cambiado

La revisión parte de los cambios de las últimas semanas: URL legibles, zona de Competiciones (hubs de federación y país), fichas de club, home con «Otras competiciones», favoritos agrupados, «¿De qué equipo eres?», cronología con niveles y barra de navegación de cuatro destinos. He contrastado el código con lo que llega de verdad a PostHog (proyecto 199175, últimos 30 y 60 días).

**Fallos de medición encontrados y corregidos** (commit del 03/11/2026):

| Fallo | Evidencia | Efecto en los datos | Arreglo |
|---|---|---|---|
| `competition_view` no se emitía desde las URL legibles | 252 eventos en 30 días = exactamente las 252 visitas a `/competitions/:id`. Las visitas por slug (`/competitions/ok-liga-masculina`, `campeonato-de-andalucia-alevin`…) no generaban evento | **Infravalorado**: el consumo de competiciones es mayor que lo que muestra cualquier panel anterior al 03/11 | Detecta también slug y lo manda como `competition_slug` |
| El `$pageview` guardaba cada slug como ruta distinta | `route` con decenas de valores `/competitions/<slug>` | Tendencias por pantalla partidas en muchas series | Las fichas por slug se agregan como `/competitions/:id` y `/clubs/:id`. Los hubs (`/competitions/federation/x`, `/country/ES`) conservan su ruta |
| El catalán no estaba en el prefijo de idioma | La regex era `es|en|pt|fr|it` | Visitas en `/ca/...` sin `locale` y sin vistas de entidad | Se usa `SUPPORTED_LOCALES` |
| Clubes sin evento de vista | `/clubs/*`: 6 páginas vistas y ningún evento de entidad | No se puede saber qué clubes interesan | Nuevo `club_view` |

**Eventos documentados que no llegan** (60 días, sin ninguna ocurrencia): `notification_sent`, `notification_opened`, `push_subscribed`, `push_unsubscribed`, `onboarding_started`, `onboarding_completed`, `login_failed`, `premium_viewed`, `locale_changed`, `image_shared`. Sin los tres primeros **no se puede medir el bucle de push, que es el que mueve la North Star**. Ver §9, acción P0.

---

## 1. Para qué medimos (y para qué no)

Medimos **lo que el usuario hace, no lo que dice**, y todo evento nace de una pregunta de negocio. El valor no está en capturar eventos en bruto sino en **agrupar, comparar y segmentar** alrededor de las tres miradas de producto: *tendencias*, *funnels* y *paths*.

Frontera: la **analítica de producto** vive en PostHog y es lo que cubre este documento. La analítica web (SEO, tráfico) va en Search Console y la de marketing queda fuera.

**North Star Metric:** *seguimientos de partido en vivo por usuario activo semanal* (`live_match_followed` / WAU). Es leading de la retención y se mueve con cobertura de directo, notificaciones y velocidad del scraping.

**Línea base** (semanas ISO, lunes a domingo):

| Semana | WAU | `live_match_followed` | Usuarios con `favorite_added` | Usuarios con `match_view` |
|---|---|---|---|---|
| 26 oct | 24 | 9 | 4 | 6 |
| 19 oct | 35 | 2 | 1 | 10 |
| 12 oct | 52 | 21 | 3 | 13 |
| 5 oct | 18 | 4 | 3 | 6 |

Con este volumen, vigilar **tendencia y forma**, no valores absolutos. PostHog solo cuenta a quien acepta la analítica en el aviso de consentimiento, así que el volumen real es mayor. Para comparar periodos no importa: el sesgo es el mismo.

Herramienta: **PostHog (EU)**, organización «Stick Live», proyecto `199175`. Ojo: la conexión de PostHog en Claude puede abrir por defecto otra organización (la de Plántate). Si una consulta no encuentra `$pageview`, es que estás en el proyecto equivocado.

---

## 2. Identidad y propiedades

El usuario es anónimo por `device_id` hasta que inicia sesión (magic link o Google), momento en que se hace `identify` con el email. Con `person_profiles: 'identified_only'` los anónimos no tienen perfil, así que **todos los eventos llevan** `device_id`, `locale`, `theme`, `platform`, `pwa_installed` y `notifications_enabled` (#245).

| Propiedad de persona | Origen | Para qué |
|---|---|---|
| `auth_method` | login | Segmentar por método |
| `locale`, `theme` | preferencias | Internacionalización y UX |
| `favorite_teams` / `favorite_leagues` / `favorite_players` | favoritos | Profundidad de personalización |
| `notifications_enabled`, `push_platform` | push | Cohorte con o sin push |
| `pwa_installed` | `appinstalled` | Cohorte instalados o navegador |

---

## 3. Superficies (pantallas) y su evento

| Ruta | Pantalla | Evento de vista | Notas |
|---|---|---|---|
| `/` | Partidos (home por día) | `$pageview` | Feed: seguidas + destacadas. Día sin feed → «Otras competiciones» automáticas |
| `/competitions` | Competiciones (destacadas, países, mis ligas) | `$pageview` | |
| `/competitions/federation/:code` | Hub de federación | `$pageview` (ruta legible) | 41 visitas a FAP en 30 días |
| `/competitions/country/:code` | Hub de país | `$pageview` (ruta legible) | |
| `/competitions/:slug\|:id` | Ficha de competición | `competition_view` (`competition_id` o `competition_slug`) | En escritorio, clasificación y jornada a la vez |
| `/matches/:id` | Ficha de partido | `match_view`, `live_match_followed`, `live_match_dwell` | Cronología con «Lo importante / Todo» |
| `/teams/:id` | Ficha de equipo | `team_view` | |
| `/clubs/:slug\|:id` | Ficha de club | `club_view` **(nuevo)** | |
| `/players/:id` | Ficha de jugador | `player_view` | |
| `/search` | Buscar | `search_performed`, `search_result_clicked` | El club enseña su primer equipo |
| `/favorites` | Favoritos | `$pageview` | Seguidas, destacadas, sugeridos y países plegados. `?onboarding=1` = «¿De qué equipo eres?» |
| `/settings` | Ajustes | `$pageview` | Fuera de la barra inferior desde el 03/11 (2,7 % de las páginas vistas) |
| `/login` | Login | `login_*` | |

---

## 4. Catálogo de eventos

**LIVE** = llega a PostHog (30 días). **NUEVO** = añadido el 03/11/2026, sin histórico. **MUDO** = documentado e instrumentado pero sin ocurrencias en 60 días.

### 4.1 Consumo

| Evento | Estado | Cuándo | Propiedades | Para qué |
|---|---|---|---|---|
| `$pageview` | LIVE (1.438) | Cambio de ruta | `route` (normalizada), `locale` | Tendencias por pantalla, WAU |
| `competition_view` | LIVE (252, infravalorado) | Ficha de competición | `competition_id` **o** `competition_slug` | Qué competiciones interesan |
| `team_view` | LIVE (114) | Ficha de equipo | `team_id` | |
| `player_view` | LIVE (54) | Ficha de jugador | `player_id` | |
| `club_view` | NUEVO | Ficha de club | `club_id` o `club_slug` | ¿Se usa la ficha de club como puerta a sus equipos? |
| `match_view` | LIVE (212) | Ficha de partido | `match_id`, `status`, `previous_status` | |
| `live_match_followed` | LIVE (36) | Ficha en `live` | `match_id`, `season_id`, `source` (open/push) | **NSM** |
| `live_match_dwell` | LIVE (15) | Al salir de un directo | `match_id`, `seconds_watched` | Profundidad del directo |
| `live_stream_status_changed` | LIVE (123) | Estado del SSE | `match_id`, `status` | Fiabilidad del tiempo real |
| `timeline_detail_changed` | NUEVO | Toca «Lo importante» o «Todo» | `match_id`, `detail` (key/all), `status` | ¿El nivel por defecto es el correcto? Si «Todo» supera el 30 % en terminados, cambiar el default |
| `fixtures_filter_applied` | LIVE (153) | Toolbar de jornadas | `filter_type`, `value` | |
| `share`, `lineup_shared` | LIVE (12, 1) | Compartir | `kind` / `match_id`, `outcome` | Viralidad |

### 4.2 Home

| Evento | Estado | Cuándo | Propiedades | Para qué |
|---|---|---|---|---|
| `home_filter_changed` | LIVE (19) | Chip En directo / Siguiendo | `filter` | |
| `home_country_changed` | LIVE (11) | Selector de país | `country`, `from` (chip/field) | |
| `home_others_opened` | LIVE (6) | Se abren «Otras competiciones» | `hidden`, `auto` **(nuevo: true si es automático)** | Con `auto=false`, interés real en el catálogo. Con `auto=true`, días sin feed |
| `home_next_matchday_opened` | LIVE (3) | Día vacío → próxima jornada | `days_ahead` | |
| `home_onboarding_dismissed` | NUEVO | Cierra la franja «Sigue a tu equipo» | — | Rechazo del onboarding. Comparar con clics en la franja (`$pageview` de `/favorites` con `?onboarding=1`) |

### 4.3 Personalización

| Evento | Estado | Cuándo | Propiedades | Para qué |
|---|---|---|---|---|
| `favorite_added` / `favorite_removed` | LIVE (30 / 9) | Seguir o dejar de seguir | `kind`, `ref_id`, `total_favorites`, `preset_selected`, `source` **(nuevo)** | Activación. `source`: `star` (estrella en fichas), `favorites`, `favorites_onboarding`, `favorites_suggested` (equipos de la liga principal) |
| `notification_preset_changed` | LIVE (4) | Cambia el preset | `entity_type`, `entity_id`, `previous_preset`, `new_preset` | |
| `onboarding_started` / `onboarding_completed` | MUDO | `/favorites?onboarding=1` y su botón final | `entry`, `favorites_selected`, `skipped` | Desde el 03/11 la franja de la home lleva aquí: debería empezar a llegar |

### 4.4 Búsqueda

| Evento | Estado | Cuándo | Propiedades |
|---|---|---|---|
| `search_performed` | LIVE (24) | Búsqueda | `surface`, `query_length`, `query_terms`, `result_count`, `has_results` (sin el texto: puede contener nombres) |
| `search_result_clicked` | LIVE (13) | Clic en resultado | `surface`, `kind` (club/team/player/competition), `ref_id`. Desde el 03/11, el enlace «Primer equipo» del club emite `kind=team` |

### 4.5 Notificaciones (push)

| Evento | Estado | Cuándo | Propiedades | Para qué |
|---|---|---|---|---|
| `push_subscribed` / `push_unsubscribed` | MUDO | Alta o baja del maestro | `platform`, `reason` | Adopción |
| `notification_toggle` | LIVE (6) | Toggle de un tipo | `key`, `enabled` | |
| `notification_sent` | MUDO | El ETL entrega un push (servidor) | `notification_type` | **Denominador del CTR** |
| `notification_opened` | MUDO | Se abre la notificación (SW → API) | `notification_type`, `url` | **CTR** |

### 4.6 Identidad, instalación y conversión

| Evento | Estado | Propiedades |
|---|---|---|
| `login_started` / `login_link_requested` / `login_completed` / `login_failed` / `logout` | LIVE salvo `login_failed` (MUDO: puede ser que no haya fallos) | `method`, `reason` |
| `install_banner_shown` → `install_cta_clicked` → `app_install_prompt_shown` → `app_install_prompt_result` → `app_installed` | LIVE (30 → 7 → 4 → … → 4) | `platform`, `source`, `mode`, `page`, `outcome` |
| `install_banner_dismissed`, `install_ios_steps_shown`, `app_opened_standalone` | LIVE | |
| `premium_viewed` → `premium_checkout_started` → `premium_purchase_completed` / `_failed` | MUDO (cobro tras flag) | `from_screen`, `plan`, `reason` |
| `locale_changed`, `theme_changed` | `theme_changed` LIVE (9), `locale_changed` MUDO | `from`, `to` / `dark` |

### 4.7 Publicidad

| Evento | Estado | Propiedades | Nota |
|---|---|---|---|
| `ad_impression` | LIVE (495) | `zone` | Desde el 03/11, las unidades sin creatividad se colapsan a los 3 s y no deberían contar. Si `ad_impression` cae, es lo esperado |
| `ad_click` | LIVE (7) | `zone` | Best-effort (el iframe no siempre propaga) |
| `ad_interstitial_shown` / `_closed` | — | | |

La app móvil tiene su propio catálogo (`apps/mobile/src/lib/analytics.ts`: AdMob, checkout web). No cambia en esta revisión.

---

## 5. Funnels

1. **Activación del usuario nuevo**: `$pageview` (primera) → `favorite_added` → `push_subscribed` → `app_installed`. Desglosar `favorite_added` por `source`. Bloqueado en el paso 3 mientras `push_subscribed` esté mudo.
2. **Onboarding «¿De qué equipo eres?»** *(nuevo)*: franja de la home → `$pageview /favorites?onboarding=1` → `favorite_added` con `source=favorites_suggested` o `favorites_onboarding` → `onboarding_completed`. La alternativa de salida es `home_onboarding_dismissed`.
3. **Búsqueda útil**: `search_performed` (`has_results=true`) → `search_result_clicked` → vista de entidad (`team_view`/`club_view`/`competition_view`). Fuga: `has_results=false`.
4. **Re-engagement por push**: `notification_sent` → `notification_opened` → `live_match_followed` (`source=push`). **Bloqueado**: los dos primeros eventos están mudos.
5. **Login por método**: `login_started` → `login_completed` por `method`.
6. **Instalación PWA**: `install_banner_shown` → `install_cta_clicked` → `app_install_prompt_result` (accepted) → `app_installed`.
7. **Premium**: listo para cuando se active el cobro.

---

## 6. Dashboards

Paneles en PostHog (proyecto 199175): [Ejecutivo](https://eu.posthog.com/project/199175/dashboard/771080), [Producto](https://eu.posthog.com/project/199175/dashboard/771081), [Operacional](https://eu.posthog.com/project/199175/dashboard/771082) y [Notificaciones · Presets](https://eu.posthog.com/project/199175/dashboard/771051).

**Añadido el 03/11/2026:**

- *Producto*: [Favoritos por origen](https://eu.posthog.com/project/199175/insights/G30PPPKv), [Onboarding «¿De qué equipo eres?»](https://eu.posthog.com/project/199175/insights/DWwltsoQ), [Búsqueda útil](https://eu.posthog.com/project/199175/insights/h4RAgREt), [Resultados de búsqueda por tipo](https://eu.posthog.com/project/199175/insights/RqeLnCbb), [Vistas de fichas por tipo](https://eu.posthog.com/project/199175/insights/VeKtXRoF), [Competiciones más vistas](https://eu.posthog.com/project/199175/insights/qkvRkyC2), [Cronología: nivel elegido](https://eu.posthog.com/project/199175/insights/3SkamWAc) y [Home: otras competiciones y franja](https://eu.posthog.com/project/199175/insights/pKIXTG4e).
- *Operacional*: [Eventos clave: esta semana frente a la anterior](https://eu.posthog.com/project/199175/insights/3UqaAC2s). Una fila a 0 que antes tenía datos es instrumentación rota.
- Anotación de proyecto el 03/11/2026: no comparar `competition_view` a través de esa fecha.

El funnel de activación antiguo (`match_view → favorite_added → push_subscribed → app_installed`) se queda, pero se corta en el paso 3 mientras `push_subscribed` siga mudo (P0 del §9).

---

## 7. Cohortes y segmentaciones

Por **semana de alta**, **activados** (≥1 `favorite_added`), **con o sin push**, **instalados o navegador**, **por método de login**, **por país preferido** (`home_country_changed` y `locale`) y, desde ahora, **por origen del primer favorito** (`source`).

La pregunta que más mueve la estrategia sigue siendo: **¿qué tipo y origen del primer favorito predicen mejor la retención D30?** Con `source` ya se puede responder si los sugeridos de «¿De qué equipo eres?» retienen igual que los elegidos a mano.

---

## 8. Gobernanza

- **Ningún feature sin su evento.** Cada PR que añade una pantalla o acción relevante añade su `track` y lo documenta aquí en la misma PR.
- **Una verdad por nombre.** Un evento es una intención y los matices van en propiedades (`kind`, `source`, `auto`, `detail`). Por eso el origen del favorito es `source` y no un evento nuevo.
- **No renombrar en caliente** eventos con histórico. Al cambiar URL o rutas, revisar `normalizeRoute` y `entityViewFromPath` con sus tests (`lib/analytics.test.ts`, `lib/analytics-entity.test.ts`). Las URL legibles rompieron `competition_view` en silencio durante semanas.
- **Revisión mensual de eventos mudos**: consulta de §9 contra este catálogo.
- **Privacidad**: sin texto de búsqueda ni nombres en propiedades. El `identify` usa el email.

---

## 9. Acciones priorizadas

| Prioridad | Acción | Por qué | Cómo comprobarlo |
|---|---|---|---|
| **P0** | Verificar el push de extremo a extremo: ¿hay suscripciones? ¿está `POSTHOG_API_KEY` en `.env.prod` del servidor para `api` y `etl`? | `push_subscribed`, `notification_sent` y `notification_opened` no han llegado ni una vez en 60 días. O nadie se suscribe, o la analítica de servidor está apagada. Sin esto no hay CTR ni funnel de re-engagement | En el servidor: `grep -c POSTHOG_API_KEY .env.prod` y `$DC exec postgres psql -U sports_user -d sports_results -c "SELECT (SELECT count(*) FROM push_subscriptions) AS web, (SELECT count(*) FROM push_tokens) AS app"`. Si hay suscripciones y la clave existe, revisar los logs del `etl` al enviar |
| **P1** | Desplegar los arreglos del 03/11 y añadir la anotación en PostHog | `competition_view` y `club_view` correctos desde ese día | En 24 h, `competition_view` con `competition_slug` presente |
| **P2** | Medir el onboarding a los 14 días del despliegue | Saber si «¿De qué equipo eres?» aumenta los activados | % de visitas nuevas con ≥1 `favorite_added`, antes y después |
| **P2** | `onboarding_*` y `locale_changed` mudos: comprobar que se emiten tras el despliegue | Pueden estar bien pero sin uso | Aparición en 7 días |
| **P3** | Group analytics por competición | Solo si el análisis por competición se vuelve recurrente | — |

**Consulta de eventos mudos** (HogQL, proyecto 199175):

```sql
SELECT event, count() AS n, max(timestamp) AS last_seen
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
GROUP BY event
ORDER BY n DESC
```

Comparar el resultado con el §4. Todo evento documentado que no aparezca está MUDO y hay que investigarlo.

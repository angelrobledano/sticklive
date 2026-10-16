# Tracking de producto en PostHog — Stick Live

*Documento vivo · mantener junto al código · última actualización: 8 de octubre de 2026*
*Complementa el [Plan de medición](./ANALITICA_PLAN_MEDICION.md): aquel define el "qué medir y por qué"; este documenta el "qué está medido hoy y dónde verlo".*

---

## 1. Para qué medimos (y para qué no)

Medimos **lo que el usuario hace, no lo que dice**, y todo evento nace de una pregunta de negocio. El valor no está en capturar eventos en bruto sino en **agrupar, comparar y segmentar** alrededor de las tres miradas de producto: *tendencias* (cómo evoluciona algo), *funnels* (dónde se cae la gente) y *paths* (qué camino siguen de verdad).

Frontera, para no medir lo que no toca: la **analítica de producto** (qué pasa dentro de la app) vive en PostHog y es lo que cubre este documento. La analítica web (SEO, tráfico) y la de marketing (CAC, campañas) quedan fuera.

**North Star Metric:** *seguimientos de partido en vivo por usuario activo semanal*. Es el valor central del producto —enterarte de tu partido mientras pasa— y es leading de la retención. Se mide con el evento `live_match_followed` y se mueve con cobertura de directo, notificaciones y velocidad del scraping.

Herramienta: **PostHog (EU)**, proyecto `199175`. Identidad por `device_id` (anónimo) que pasa a email al identificarse.

---

## 2. Identidad y propiedades de persona

El usuario es anónimo por `device_id` hasta que inicia sesión (magic link o Google), momento en que se hace `identify` con el email. Estas propiedades viajan **pegadas a la persona** (no a cada evento) y permiten segmentar sin ensuciar los payloads:

| Propiedad | Origen | Para qué |
|---|---|---|
| `auth_method` | login (`magic_link`/`google`) | Segmentar identificados por método; ya no está hardcodeada |
| `locale`, `theme` | cambios de idioma/tema | Internacionalización y preferencia UX |
| `favorite_teams` / `favorite_leagues` / `favorite_players` | toggles de favorito | Profundidad de personalización |
| `notifications_enabled` | alta/baja de push | Cohorte "con push vs sin push" |
| `push_platform` (`ios`/`android`/`desktop`) | suscripción push | Segmentar adopción/CTR por plataforma |
| `pwa_installed` | `appinstalled` | Cohorte "instalados vs navegador" |

---

## 3. Catálogo de eventos

Estado: **LIVE** = emitiéndose; los marcados **(F4)** se añadieron al instrumentar el catálogo nuevo del plan.

### 3.1 Consumo y personalización

| Evento | Cuándo se dispara | Propiedades | Para qué |
|---|---|---|---|
| `$pageview` | Cada cambio de ruta | `route`, `locale` | Tendencias por pantalla, base de WAU/MAU |
| `match_view` | Al abrir una ficha de partido | `match_id`, `status` | Consumo de partidos; separa calendario/resultado de directo |
| `live_match_followed` **(F4)** | Al abrir/llegar a una ficha con `status=live` | `match_id`, `season_id`, `source` (open/push) | **NSM**: el valor central del producto |
| `favorite_added` / `favorite_removed` | Al marcar/quitar favorito | `kind` (team/league/player), `ref_id`, `total_favorites` | Activación; los removed son señal de fricción |
| `share` | Al compartir (Web Share/copiar) | `kind`, `title` | Viralidad |
| `lineup_shared` **(F4)** | Al compartir la imagen de alineación | `match_id`, `outcome` (shared/download/failed) | Viralidad de la feature estrella |
| `fixtures_filter_applied` **(F4)** | Al usar la toolbar de jornadas | `filter_type` (round/date/team), `value` | Usabilidad del filtro |
| `home_filter_changed` | Al tocar un chip de la home (En directo / Siguiendo) | `filter` (all/live/following) | ¿Se usa el filtro del directo? Base para decidir si gana protagonismo |
| `home_next_matchday_opened` | Día vacío → botón «Ver el {día}» | `days_ahead` | ¿La próxima jornada resuelve el día vacío? |

### 3.2 Notificaciones (push)

| Evento | Cuándo | Propiedades | Para qué |
|---|---|---|---|
| `push_subscribed` **(F4)** | Al conceder permiso y suscribir | `platform` | Adopción de push |
| `push_unsubscribed` **(F4)** | Al revocar el maestro | `reason`, `platform` | Salud: opt-out |
| `notification_toggle` | Al activar/desactivar un toggle | `key`, `enabled` | Configuración de push |
| `notification_sent` **(F4)** | El emisor (ETL) entrega un push | `notification_type` | **Denominador del open rate** |
| `notification_opened` **(F4)** | Se abre la notificación (Service Worker) | `notification_type`, `url` | **CTR de push** y re-engagement |
| `favorite_added` **(F4, #243)** | Al empezar a seguir una entidad (evento ÚNICO; `follow_created` quedó deprecado) | `kind`, `ref_id`, `preset_selected` | Adopción de presets |
| `notification_preset_changed` **(F4)** | Al cambiar el preset de una entidad | `entity_type`, `entity_id`, `previous_preset`, `new_preset` | Uso del control de presets |

> Nota: el plan original hablaba de `push_notification_received/clicked`. En la práctica se implementaron como `notification_sent` (servidor) y `notification_opened` (Service Worker), que cumplen la misma función (denominador y CTR). Además, `follow_created` se unificó en `favorite_added` con `preset_selected` (#243) para no contar dos veces la misma activación.

### 3.3 Identidad, instalación y conversión

| Evento | Cuándo | Propiedades | Para qué |
|---|---|---|---|
| `login_started` **(F4)** | Al iniciar cualquier método | `method` (magic_link/google) | Top del funnel de login |
| `login_link_requested` | Al pedir el magic link | — | Entrada del funnel email |
| `login_completed` | Al verificarse la sesión | `method` (real) | Conversión a cuenta |
| `login_failed` **(F4)** | Verificación falla (link caducado / OAuth) | `method`, `reason` | Tasa de error del login |
| `logout` | Al cerrar sesión | — | Salud de cuenta |
| `install_banner_shown` | Aviso inferior de instalar la PWA visible (1 vez por sesión). Solo móvil, tras 2 páginas vistas y con el aviso de cookies contestado | `platform` (ios/android), `mode` (native/ios_steps), `page` | Top del embudo de instalación |
| `install_cta_clicked` | Toca «Instalar» (aviso inferior o Ajustes) | `platform`, `source` (banner/settings), `mode`, `page` | CTR del aviso: clicks / shown |
| `install_ios_steps_shown` | iPhone: se despliegan los pasos Compartir → Añadir a inicio | `platform`, `page` | En iOS no hay evento de instalación: este es el último paso medible |
| `install_banner_dismissed` | «Ahora no» o cerrar (lo silencia 14 días) | `platform`, `mode`, `step` (banner/ios_steps), `page` | Rechazo del aviso |
| `app_install_prompt_shown` **(F4)** | Se abre el diálogo nativo (Android/Chrome) | `platform`, `source` | Mitad del embudo |
| `app_install_prompt_result` | El usuario contesta el diálogo nativo | `platform`, `source`, `outcome` (accepted/dismissed) | Conversión del botón |
| `app_installed` **(F4)** | Instalación confirmada (`appinstalled`) | `platform`, `source` (banner/settings/browser) | Adopción PWA atribuida al botón |
| `app_opened_standalone` | Sesión abierta desde la app instalada (1 vez por sesión) | `platform` | Uso real de la PWA instalada (incluido iPhone, donde no hay `appinstalled`) |
| `onboarding_started` / `onboarding_completed` **(F4)** | Selección inicial de favoritos | `entry`, `favorites_selected`, `skipped` | Activación guiada |
| `premium_viewed` **(F4)** | Ve el bloque premium (Ajustes) | `from_screen` | Top del funnel de ingresos |
| `premium_checkout_started` | Inicia el pago | — | Mitad del funnel |
| `premium_purchase_completed` / `premium_purchase_failed` **(F4)** | Página de éxito / error | `plan`, `reason` | Conversión / fricción de pago |

### 3.4 Monetización de la app (AdMob / checkout en web)

Eventos de la **app móvil** (catálogo tipado en
`apps/mobile/src/lib/analytics.ts`). Las impresiones y clicks los mide AdMob;
aquí solo el hecho de negocio.

| Evento | Cuándo | Propiedades | Para qué |
|---|---|---|---|
| `ads_rewarded_completed` | El reward se concede (contrato AdMob cumplido) | `minutes` (adfree regalado) | Valor real del formato recompensado |
| `ads_rewarded_failed` | El reward no se concede (reward no coincidente, show rechazado, storage) | `reason` | Fricción del formato recompensado |
| `ads_app_open_shown` | App open mostrado de verdad (consumió el presupuesto compartido) | — | Presión publicitaria en el arranque |
| `ads_interstitial_shown` | Interstitial mostrado al salir de ficha no-live | — | Presión publicitaria en la salida de ficha |
| `premium_web_checkout_started` | La app abre sticklive.eu para pagar | — | Salida de la app al funnel de compra (web) |

---

## 4. Funnels

1. **Activación del nuevo usuario** — `match_view → favorite_added → push_subscribed → app_installed`. El peldaño que más pierde es la prioridad de producto.
2. **Login por método** — `login_started → login_completed`, desglosado por `method`, con `login_failed` como fuga. Responde "¿convierte mejor Google o el magic link, y dónde falla?".
3. **Instalación PWA** — `install_banner_shown → install_cta_clicked → app_install_prompt_result (accepted) → app_installed` por `platform` y `source`. En iPhone el último paso medible es `install_ios_steps_shown` y el uso real se ve con `app_opened_standalone`.
4. **Re-engagement por push** — `notification_sent → notification_opened → live_match_followed`: el bucle completo de notificación a valor.
5. **Conversión premium** — `premium_viewed → premium_checkout_started → premium_purchase_completed`, con `premium_purchase_failed` como fuga. Listo para cuando se active el cobro.

---

## 5. Dashboards

Cuatro paneles en PostHog (proyecto 199175):

**[Ejecutivo](https://eu.posthog.com/project/199175/dashboard/771080)** (semanal, dirección) — NSM (`live_match_followed` por source), WAU, stickiness DAU/MAU, retención D7/D30, nuevos por semana, % activados y el funnel premium. Una pantalla para decidir foco.

**[Producto](https://eu.posthog.com/project/199175/dashboard/771081)** (PM/diseño) — funnel de activación, favoritos por tipo, favoritos quitados (salud), profundidad de favoritos, toggles de notificación (adopción/opt-out), compartir por tipo y funnel de instalación PWA.

**[Operacional](https://eu.posthog.com/project/199175/dashboard/771082)** (ingeniería/datos) — calidad de datos (volumen por evento; una caída brusca = instrumentación rota), consistencia de enum `match_view.status`, errores JS y funnel de login por método.

**[Notificaciones · Presets](https://eu.posthog.com/project/199175/dashboard/771051)** — distribución de preset al seguir, cambios de preset, aperturas por tipo, open rate (aperturas/enviadas) y retención tras seguir.

---

## 6. Cohortes y segmentaciones

Cohortes que cuentan la historia de un producto de consumo recurrente: por **semana de alta**, **activados vs no activados** (≥1 `favorite_added`), **con push vs sin push**, **instalados vs navegador**, **por método de login** y **por competición seguida**. Segmentaciones recurrentes: `auth_method`, `locale`, `push_platform`, `notifications_enabled`, `pwa_installed`, nuevos vs recurrentes.

La pregunta que más mueve la estrategia: **¿qué tipo de favorito (equipo/liga/jugador) y qué método de entrada predicen mejor la retención D30?** Eso decide qué empujar en el onboarding.

---

## 7. Métricas de salud y cómo leerlas

- **NSM** (seguidores de directo / WAU): si cae, diagnosticar por las input metrics (cobertura de directo, % con push, nº favoritos) antes que por demanda.
- **Retención D1/D7/D30** por cohorte: la métrica de verdad. Comparar entre releases.
- **% activados** (≥1 favorito) y **profundidad de favoritos**.
- **CTR de push** = `notification_opened / notification_sent`, por tipo: decide qué notificaciones mantener o silenciar por defecto.
- **Ratio de opt-out** (`push_unsubscribed` / suscritos): si un tipo de push lo dispara, ajustar defaults (de ahí los presets).
- **Calidad de datos**: volumen por evento y % sin propiedades obligatorias; un evento que deja de llegar es un bug invisible.

Targets numéricos (umbrales de alerta) están pendientes de fijar con volumen real; mientras tanto, vigilar **tendencia y forma**, no valores absolutos.

---

## 8. Gobernanza

- **Ningún feature sin su evento**: cada PR que añade una pantalla o acción relevante añade su `track` y lo documenta aquí.
- **Una verdad por nombre**: un evento = una intención; los matices van en propiedades (`kind`, `notification_type`, `method`), no en eventos nuevos.
- **No renombrar en caliente** eventos con histórico (rompe series); planificar alias/migración.
- **Privacidad**: el `identify` usa el email; la analítica de notificaciones server-side usa el `device_id` como distinctId. Revisar base legal/consentimiento antes de ampliar PII.
- Este documento y el plan de medición son el **tracking plan versionado**; se revisan en cada feature nueva.

---

## 9. Estado y pendientes

**Cubierto end-to-end:** consumo de partidos y directo (NSM), favoritos y presets, notificaciones (adopción, CTR, opt-out, presets), login por método con fallos, instalación PWA, onboarding, compartir, filtro de jornadas y funnel premium (listo aunque el cobro siga tras flag).

**Pendiente / consciente:**

- `competition_filter_applied`: la lista de competiciones no tiene filtro discreto (solo buscador + agrupación), así que no se instrumentó.
- El prompt de instalación en **iOS** es manual (sin evento del navegador): el funnel PWA refleja sobre todo Android.
- **Targets por KPI** sin fijar hasta tener volumen para significancia.
- **Group analytics por competición**: hoy se usa propiedad de evento; migrar a grupos solo si el análisis "por competición" se vuelve recurrente.

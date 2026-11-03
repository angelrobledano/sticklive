# Plan de medición de producto — Stick Live

*Documento de analítica de producto · listo para ingeniería y producto*
*Versión 1.0 · 18 de junio de 2026 · Autor: Product Analytics*

> **Nota (03/11/2026):** el inventario de pantallas (§3.1) y el catálogo de eventos (§7) de este documento están desactualizados. La versión vigente, con las pantallas nuevas (hubs de federación y país, clubes, favoritos agrupados), los eventos nuevos y los fallos de medición corregidos, está en [TRACKING_POSTHOG.md](./TRACKING_POSTHOG.md). Este documento sigue valiendo para el porqué: North Star, preguntas de negocio y método.

---

## 0. Cómo leer este documento y alineación con el método

Este plan sigue el enfoque de analítica de producto del [curso de Ángel Robledano](https://angelrobledano.com/que-es-la-analitica-de-producto/): **medir lo que el usuario hace, no lo que dice**, y organizar todo el análisis alrededor de las **tres miradas básicas** — *tendencias* (cómo evoluciona algo en el tiempo), *funnels* (dónde se cae la gente en una secuencia) y *paths* (qué camino real siguen los usuarios). Capturar eventos en bruto no aporta valor: el valor aparece al **agrupar, comparar, segmentar y hacer preguntas concretas**. Por eso cada evento de este plan nace de una pregunta de negocio, no al revés.

Frontera de analíticas (importante para no medir lo que no toca):

- **Analítica web** (sitio público, SEO, tráfico, rebote) → GA4 / Search Console. *No* es objeto de este plan salvo como fuente de adquisición.
- **Analítica de marketing** (campañas, CAC, ROI por canal) → fuera de alcance; se conecta vía UTMs.
- **Analítica de producto** (qué pasa *dentro* de la app: qué features cogen tracción, dónde se atasca la gente, quién vuelve) → **es el objeto de este documento**, instrumentado en PostHog.

Herramienta de referencia: **PostHog (EU)**, ya integrado. El plan es portable a Mixpanel/Amplitude sin cambios de fondo (mismo modelo evento + propiedades + identidad).

---

## 1. Resumen ejecutivo y North Star

**Stick Live** es un producto de consumo (B2C) de resultados de hockey patines en tiempo real: el usuario consulta partidos, sigue equipos/ligas/jugadores, recibe notificaciones push del directo y puede instalar la app (PWA). La monetización (premium) está implementada pero **desactivada tras flag**, así que hoy el juego es de **adopción, engagement y retención**, no de ingresos.

### North Star Metric (NSM) propuesta

> **Seguimientos de partido en vivo por usuario activo semanal (WAU).**
> Un "seguimiento en vivo" = una sesión en la que el usuario abre la ficha de un partido en estado `live` o interactúa con una notificación de directo.

**Por qué esta y no otra.** El valor central que entrega el producto es *enterarte de lo que pasa en tu partido mientras pasa*. Una métrica de vanidad como "pageviews" o "usuarios registrados" no captura ese valor; el seguimiento de directo sí correlaciona con el motivo real por el que alguien vuelve. Es accionable (se puede mover con notificaciones, cobertura de competiciones y velocidad del directo) y es leading de la retención.

**Métricas de entrada (input metrics) que mueven la NSM:** cobertura de partidos en vivo, % de usuarios con notificaciones activas, nº de favoritos por usuario, latencia del directo. Si la NSM cae, se diagnostica por estas.

*Alternativa a validar con datos una vez haya volumen:* "usuarios que vuelven ≥3 días distintos por semana" (frecuencia pura). Se recomienda instrumentar ambas y quedarse con la que mejor correlacione con retención D30 (ver §10).

---

## 2. Alcance, supuestos y lo que NO existe

Para no medir entidades inexistentes, se fija el dominio real del producto (verificado contra el esquema de BD y las rutas de la app):

| Entidad del enunciado genérico | ¿Existe en Stick Live? | Mapeo real |
|---|---|---|
| Usuario | Sí | `user` con **auth progresiva** (anónimo por `device_id` → identificado por email) |
| Cuenta / organización | **No** | El producto es B2C individual; no hay cuentas multi-usuario |
| Equipo (como org de trabajo) | **No** | "Equipo" aquí es un **club deportivo** (`team`), entidad de contenido, no de cuenta |
| Reserva / booking | **No** | No hay reservas; no aplica ningún funnel de reserva |
| Competición | Sí | `competition` (con taxonomía organizer/scope/region/age_category) |
| Partido | Sí | `match` (estados scheduled/live/finished) |
| Jugador | Sí | `player` |

**Consecuencia:** todo lo que en un SaaS B2B sería "activación de cuenta", "invitar compañeros" o "funnel de reserva" **no aplica**. La activación aquí es individual y gira en torno a *favoritos + notificaciones + instalación*.

---

## 3. Inventario de producto

### 3.1 Pantallas (rutas reales)

| Ruta | Pantalla | Función |
|---|---|---|
| `/` | Home | Partidos por día + sección "Siguiendo" (favoritos) |
| `/competitions` | Buscador de competiciones | Listado con filtros (edad, ámbito) |
| `/competitions/:id` | Ficha de competición | Clasificación, jornadas (toolbar de filtros), playoffs/bracket, estadísticas |
| `/matches/:id` | Ficha de partido (Match Center) | Timeline en directo, alineaciones + pista 5 inicial, estadísticas |
| `/teams/:id` | Ficha de equipo | Resumen, calendario, plantilla, estadísticas |
| `/players/:id` | Ficha de jugador | Datos y rendimiento del jugador |
| `/favorites` | Favoritos | Gestión de equipos/ligas/jugadores seguidos |
| `/login` | Login | Magic link (email) o Google OAuth |
| `/settings` | Ajustes | Notificaciones, tema, idioma, instalar app, premium |
| `/settings/notifications/:kind` | Ajustes notif. por entidad | On/off por equipo/liga/jugador |
| `/premium/success`, `/premium/error` | Resultado de pago | Retorno de Stripe (flag off) |
| `/privacy` | Privacidad | Legal |
| `/admin` | Admin | Operación interna (no usuario final) |

*Ruta no-UI:* `/matches/:id/lineup-image` genera la imagen compartible server-side (no es pantalla; sí es relevante para el evento `share`).

### 3.2 Flujos de usuario clave

1. **Descubrimiento → primer valor (anónimo):** primera visita → ver partidos del día → abrir ficha de partido → (opcional) seguir un equipo/liga/jugador.
2. **Activación:** marcar el primer favorito → (onboarding de selección la primera vez) → activar notificaciones → instalar PWA.
3. **Identidad / multi-dispositivo:** login por magic link o Google → fusión de favoritos anónimos → sincronización entre dispositivos.
4. **Engagement recurrente:** recibir push (inicio jornada / gol / final) → abrir directo → seguir el partido en vivo.
5. **Conversión (latente, hoy off):** ver premium en Ajustes → iniciar checkout → pago → retorno success/error.

---

## 4. Modelo de entidades y propiedades persistentes

Estas son las propiedades que viajan **pegadas a la entidad** (person properties / group properties), no a cada evento. Permiten segmentar sin ensuciar el payload de los eventos.

### 4.1 Usuario (`person` en PostHog)

| Propiedad | Tipo | Origen | Notas |
|---|---|---|---|
| `auth_state` | enum `anonymous`/`identified` | derivada | Anónimos no crean perfil (`identified_only`) |
| `auth_method` | enum `magic_link`/`google` | login | **Hoy hardcodeado a `magic_link`** (ver §15, gap) |
| `email` (interno) | string | login | Identificador; PII, tratar según política |
| `locale` | enum es/en/pt/fr/it | `locale_changed` | Ya instrumentado |
| `theme` | enum dark/light | `theme_changed` | Ya instrumentado |
| `favorite_teams` | int | favoritos | Ya instrumentado (recuento) |
| `favorite_leagues` | int | favoritos | **Propuesto** (hoy solo se setea teams) |
| `favorite_players` | int | favoritos | **Propuesto** |
| `notifications_enabled` | bool | maestro push | **Propuesto** como person prop |
| `push_platform` | enum ios/android/desktop | suscripción | **Propuesto** |
| `pwa_installed` | bool | install | **Propuesto** |
| `is_premium` | bool | `orders.premium_until` | Derivable; **propuesto** sincronizar a person prop |
| `signup_date` | date | primer login | **Propuesto** para cohortes |

### 4.2 Entidades de contenido (group analytics opcional)

No son cuentas, pero conviene modelarlas como **grupos** en PostHog para análisis "por competición/equipo" sin recalcular joins:

- **Competición** (`group_type: competition`): `competition_slug`, `organizer` (RFEP/FEP/autonómica), `scope` (national/regional), `region`, `age_category` (senior/juvenil…), `is_current` (temporada vigente), `gender` (masc/fem), `archived` (bool).
- **Partido** (no grupo, pero sus props se adjuntan a eventos de partido): `match_id`, `status`, `competition_slug`, `round_type` (regular/playoff/cup/friendly), `is_live`, `is_derby` (si se llega a calcular).
- **Equipo** (`group_type: team` opcional): `team_slug`, `competition_slugs`.
- **Jugador**: `player_id`, `team_slug`.

> Recomendación: empezar **sin** group analytics (coste/complejidad) y adjuntar `competition_slug`/`round_type` como propiedades de evento. Migrar a grupos solo si el análisis "por competición" se vuelve recurrente.

---

## 5. Convención de nomenclatura

- **Eventos:** `snake_case`, patrón `objeto_acción` en pasado o sustantivo+acción (`favorite_added`, `match_view`, `login_completed`). Se respeta lo ya desplegado.
- **Propiedades:** `snake_case`, sin UUIDs en rutas (ya se normaliza `/matches/:id`).
- **Valores enumerados** explícitos y estables (`status: scheduled|live|finished`).
- **Una verdad por nombre:** un evento = una intención. No reutilizar `share` para cosas distintas; se distingue por `kind`.
- **Deuda detectada:** `match_view` rompe levemente el patrón pasado/participio del resto (`*_added`, `*_completed`). Se documenta como inconsistencia menor; **no** se renombra en caliente para no partir series históricas (ver §13 y §15).

---

## 6. Objetivos, preguntas y KPIs por funcionalidad

Para cada bloque: objetivo de negocio · objetivo de usuario · preguntas que la analítica debe responder · KPIs (NSM/adopción/activación/engagement/retención/conversión cuando aplican).

### 6.1 Home y consumo de partidos

- **Negocio:** maximizar usuarios que encuentran valor inmediato (ver su partido) → base de la retención.
- **Usuario:** ver de un vistazo qué se juega hoy y lo de mis favoritos.
- **Preguntas:** ¿cuántos usuarios llegan a abrir una ficha de partido en su primera sesión? ¿la sección "Siguiendo" aumenta el consumo frente a no tener favoritos? ¿qué día/hora concentra el directo?
- **KPIs:** *Adopción* = % de sesiones que abren ≥1 ficha de partido. *Engagement* = fichas de partido por sesión; **NSM** = seguimientos de partido en vivo / WAU. *Tendencia* de partidos vistos por día.

### 6.2 Favoritos (equipos / ligas / jugadores)

- **Negocio:** el favorito es el **acto de activación** y el combustible de las notificaciones; sin favoritos no hay retención.
- **Usuario:** personalizar la app para ver solo lo mío.
- **Preguntas:** ¿qué % de nuevos llega a marcar su primer favorito (y en cuánto tiempo)? ¿qué tipo de favorito (equipo/liga/jugador) predice mejor la retención? ¿cuántos favoritos marca un usuario "sano"?
- **KPIs:** *Activación* = % de nuevos con ≥1 favorito en la primera sesión / en D1. *Adopción* por tipo. *Profundidad* = nº medio de favoritos. *Correlación* favoritos↔retención D7/D30.

### 6.3 Notificaciones push

- **Negocio:** principal palanca de re-engagement (traer de vuelta a la app sin coste de medios).
- **Usuario:** enterarme del gol/inicio/final sin estar mirando.
- **Preguntas:** ¿qué % activa el maestro de notificaciones? ¿qué CTR tienen por tipo (inicio/gol/final/jornada/jugador)? ¿las notificaciones suben la NSM? ¿qué tipos generan opt-out?
- **KPIs:** *Adopción* = % con notificaciones activas. *Engagement* = CTR de push, sesiones originadas por push. *Salud* = ratio opt-out. *Impacto* = retención de usuarios con push vs sin push.

### 6.4 Identidad y multi-dispositivo (login)

- **Negocio:** la cuenta permite persistir favoritos y medir retención real cross-device; reduce pérdida por cambio de dispositivo.
- **Usuario:** que mis favoritos me sigan en el móvil y el PC.
- **Preguntas:** ¿qué % de activos llega a identificarse? ¿magic link vs Google, cuál convierte y cuál falla más? ¿cuántos favoritos se fusionan al hacer login?
- **KPIs:** *Conversión a cuenta* = % de WAU identificados. *Funnel de login* por método. *Tasa de error* de verificación (magic link / OAuth).

### 6.5 Instalación de la app (PWA)

- **Negocio:** el usuario instalado retiene mucho más y es prerequisito de push en iOS.
- **Usuario:** acceso directo tipo app y notificaciones en iPhone.
- **Preguntas:** ¿qué % instala? ¿la instalación sube la retención y la activación de push? ¿iOS vs Android, dónde se cae el prompt?
- **KPIs:** *Adopción* = % de usuarios que instalan. *Impacto* = retención instalados vs no. *Funnel* de instalación por plataforma.

### 6.6 Premium (conversión — hoy latente)

- **Negocio:** futura línea de ingresos; preparar la medición aunque esté off.
- **Usuario:** funciones premium / quitar anuncios (a definir).
- **Preguntas:** cuando se active, ¿qué % de activos ve premium, inicia checkout y paga? ¿desde qué pantalla convierte mejor?
- **KPIs:** *Conversión* = funnel ver→checkout→pago. *ARPU/MRR* (cuando exista cobro). Hoy solo se instrumenta `premium_checkout_started`.

### 6.7 Idioma y tema (preferencias)

- **Negocio:** señal de internacionalización (qué locales crecen) y de UX.
- **Preguntas:** ¿qué locales tienen tracción real (no solo tráfico)? ¿el dark mode es mayoritario?
- **KPIs:** distribución de `locale`/`theme` (person props, ya instrumentadas). Más informativas que accionables; **prioridad baja**.

---

## 7. Plan de tracking (catálogo de eventos)

Estado: **[LIVE]** ya instrumentado en el código · **[NUEVO]** propuesto para cerrar huecos del plan. "Aplica a" = tipo de usuario.

### 7.1 Eventos ya instrumentados

| Evento | Estado | Cuándo se dispara | Props obligatorias | Props opcionales | Aplica a | Objetivo |
|---|---|---|---|---|---|---|
| `$pageview` | LIVE | Cada cambio de ruta (manual, App Router) | `route` (normalizada, sin UUID), `locale` | `$current_url` | Todos | Tendencias de uso por pantalla |
| `match_view` | LIVE | Al abrir una ficha de partido | `match_id`, `status` (scheduled/live/finished) | — | Todos | Consumo de partidos; base de la NSM |
| `favorite_added` | LIVE | Al marcar un favorito | `kind` (team/league/player), `ref_id`, `total_favorites` | — | Todos | Activación y personalización |
| `favorite_removed` | LIVE | Al quitar un favorito | `kind`, `ref_id`, `total_favorites` | — | Todos | Salud (señal de churn/ruido de notif.) |
| `locale_changed` | LIVE | Al cambiar idioma | `from`, `to` | — | Todos | Internacionalización real |
| `theme_changed` | LIVE | Al cambiar tema | `dark` (bool) | — | Todos | Preferencia UX |
| `notification_toggle` | LIVE | Al activar/desactivar un toggle de notif. | `key`, `enabled` (bool) | — | Todos | Adopción y configuración de push |
| `login_link_requested` | LIVE | Al pedir el magic link | — | `has_device_id` | Anónimo | Entrada al funnel de identidad |
| `login_completed` | LIVE | Al verificarse la sesión | `method` | — | Identificado | Conversión a cuenta |
| `logout` | LIVE | Al cerrar sesión | — | — | Identificado | Salud de cuenta |
| `share` | LIVE | Al compartir (Web Share/copiar) | `kind`, `title` | — | Todos | Viralidad/loops de crecimiento |

### 7.2 Eventos propuestos (huecos del plan)

| Evento | Estado | Cuándo se dispara | Props obligatorias | Props opcionales | Aplica a | Objetivo |
|---|---|---|---|---|---|---|
| `live_match_followed` | NUEVO | Al abrir/permanecer en una ficha con `status=live`, o llegar desde push de directo | `match_id`, `competition_slug`, `source` (open/push/notification), `round_type` | `seconds_watched` | Todos | **Núcleo de la NSM** |
| `push_subscribed` | NUEVO | Al conceder permiso y crear suscripción | `platform` (ios/android/desktop) | `from_screen` | Todos | Adopción de push (palanca de re-engagement) |
| `push_unsubscribed` | NUEVO | Al revocar el maestro o caducar la suscripción | `reason` (user/expired) | `platform` | Todos | Salud: opt-out |
| `push_notification_received` | NUEVO | Service Worker recibe la push | `type` (match_start/goal/match_end/round_start/round_end/player_goal), `match_id` | `competition_slug` | Suscrito | Denominador del CTR de push |
| `push_notification_clicked` | NUEVO | El usuario toca la notificación | `type`, `match_id` | `competition_slug` | Suscrito | **CTR de push** y re-engagement |
| `app_install_prompt_shown` | NUEVO | Se muestra el prompt (Android) o instrucciones iOS | `platform` | — | Anónimo/Ident. | Funnel de instalación |
| `app_installed` | NUEVO | Instalación confirmada (`appinstalled`) | `platform` | — | Todos | Adopción PWA; impacto en retención |
| `onboarding_started` | NUEVO | Primera vez que se muestra la selección de favoritos | — | `entry` | Nuevo | Activación guiada |
| `onboarding_completed` | NUEVO | El usuario termina/omite la selección inicial | `favorites_selected` (int), `skipped` (bool) | — | Nuevo | Activación guiada |
| `login_started` | NUEVO | Al iniciar cualquier método (incluye Google) | `method` (magic_link/google) | — | Anónimo | Funnel de login por método |
| `login_failed` | NUEVO | Verificación falla (link caducado, error OAuth) | `method`, `reason` | — | Anónimo | Tasa de error del login |
| `lineup_shared` | NUEVO | Al compartir la imagen de alineación | `match_id`, `outcome` (shared/download/failed) | `platform` | Todos | Viralidad de la feature estrella |
| `fixtures_filter_applied` | NUEVO | Al usar la toolbar de filtros en competición | `filter_type` (round/date/team), `competition_slug` | `value` | Todos | Usabilidad/fricción del nuevo filtro |
| `competition_filter_applied` | NUEVO | Al filtrar el buscador de competiciones | `filter_type` (age/scope) | `value` | Todos | Descubrimiento de competiciones |
| `premium_viewed` | NUEVO | Al ver el bloque/landing premium | `from_screen` | — | Todos | Tope del funnel de conversión |
| `premium_purchase_completed` | NUEVO | Página de éxito de pago | `plan` | `amount`, `currency` | Identificado | Conversión / ingresos |
| `premium_purchase_failed` | NUEVO | Página de error de pago | `reason` | — | Identificado | Fricción de pago |

**Enriquecimiento de `$pageview` / eventos de entidad (propuesto):** adjuntar a las vistas de ficha las props de la entidad para poder segmentar sin joins: en competición `competition_slug`, `organizer`, `age_category`, `is_current`; en equipo `team_slug`; en jugador `player_id`, `team_slug`. Alternativa: eventos dedicados `competition_viewed`/`team_viewed`/`player_viewed`. *Recomendación:* enriquecer `$pageview` (menos eventos, mismo poder de análisis).

### 7.3 Por qué medimos cada evento (justificación → decisión que habilita)

- **`live_match_followed`** — es la NSM operacionalizada. Sin él no se puede responder "¿estamos entregando el valor central?" ni priorizar cobertura de competiciones vs. velocidad del directo.
- **`match_view` + `status`** — separa consumo de calendario/resultado vs. directo; permite la *tendencia* de partidos vistos por día y detectar caídas (como el ejemplo del curso: una caída del 30% se ve antes que el primer ticket).
- **`favorite_added/removed` + `kind`** — el favorito es el acto de activación; comparar retención por *tipo* de favorito dice qué empujar en el onboarding. Los `removed` son señal temprana de fricción/churn.
- **`push_*`** — el CTR por `type` decide qué notificaciones mantener, cuáles silenciar por defecto y si alguna genera opt-out (retirar features con datos, no por intuición).
- **`app_installed`** — si instalados retienen mucho más, instalar pasa a ser objetivo de activación y se justifica empujar el prompt.
- **`onboarding_*`** — mide el funnel de activación guiada y dónde se cae; es el paso "más rentable de pelear".
- **`login_started/failed` + `method`** — hoy no se distingue Google de magic link ni se miden fallos; sin esto no se puede diagnosticar por qué la conversión a cuenta es baja.
- **`lineup_shared`** — la feature de compartir alineación (recién arreglada en iOS) es un loop de crecimiento; medir su `outcome` valida si la inversión retorna.
- **`fixtures_filter_applied`** — valida si la nueva toolbar reduce fricción o si nadie la usa (candidata a simplificar/retirar).
- **`premium_*`** — deja el funnel de ingresos listo para el día que se active el flag; medir desde el principio evita decisiones a ciegas en el lanzamiento.

---

## 8. Funnels principales

1. **Activación del nuevo usuario** (el más importante): `primera sesión` → `match_view` → `favorite_added` → `push_subscribed` → `app_installed`. Cada peldaño que pierde gente es prioridad de producto; el primer paso roto suele ser el que más daña la retención.
2. **Identidad / cuenta:** `login_started` → (`login_link_requested` | inicio OAuth) → `login_completed`, con rama de fuga `login_failed`. Desglosar por `method` (magic_link vs google) para ver cuál convierte y cuál falla.
3. **Re-engagement por push:** `push_notification_received` → `push_notification_clicked` → `live_match_followed`. Mide el bucle completo de notificación a valor.
4. **Instalación PWA:** `app_install_prompt_shown` → `app_installed`, segmentado por `platform` (esperamos caída fuerte en iOS por el flujo manual).
5. **Conversión premium (cuando se active):** `premium_viewed` → `premium_checkout_started` → `premium_purchase_completed`, con fuga `premium_purchase_failed`.

---

## 9. Análisis de paths

- **Tras `favorite_added`:** ¿el usuario activa notificaciones, sigue viendo partidos, o se va? Valida si el favorito desemboca en el bucle de valor o muere ahí (réplica del ejemplo del curso "tras el signup").
- **Antes de `live_match_followed`:** ¿llega por push, por la home o desde la ficha de competición/equipo? Dice qué superficie genera más seguimiento en vivo y dónde invertir.
- **Tras `login_completed`:** ¿vuelve a favoritos, a la home, o abandona? Señala si la identidad aporta valor percibido inmediato.
- **Primeras 3 acciones de la primera sesión:** descubre caminos reales de los nuevos (no los que asumimos) para rediseñar la primera pantalla.
- **Tras `notification_toggle (enabled=false)`:** ¿qué precede al opt-out? (p. ej. exceso de pushes de una jornada) para ajustar defaults.

---

## 10. Cohortes

- **Por semana de alta** (`signup_date`) → curvas de retención D1/D7/D30 comparables entre releases.
- **Activados vs no activados** (≥1 `favorite_added` en la primera sesión).
- **Con push vs sin push** → impacto real de las notificaciones en retención.
- **Instalados (PWA) vs navegador.**
- **Por método de login** (magic_link vs google).
- **Por competición seguida** (seguidores OK Liga masc. vs fem. vs copas) → qué audiencia retiene mejor.
- **Power users** (≥3 días activos/semana o ≥N `live_match_followed`/semana) → perfilar al usuario sano y buscar más como él.

---

## 11. Segmentaciones recomendadas

`auth_state` (anónimo/identificado) · `auth_method` · `locale` · `platform`/dispositivo · `notifications_enabled` · `pwa_installed` · `is_premium` · `age_category`/`organizer` de las competiciones consumidas · temporada vigente (`is_current`) · país (vía IP, para expansión) · nuevos vs recurrentes.

---

## 12. Métricas de salud del producto

- **DAU / WAU / MAU** y **stickiness** (DAU/MAU): pulso de uso.
- **Retención** D1/D7/D30 por cohorte (la métrica de verdad de un producto de consumo recurrente).
- **% de usuarios activados** (con ≥1 favorito).
- **NSM**: seguimientos de partido en vivo / WAU.
- **Cobertura de directo**: partidos en vivo cubiertos vs. jugados (fuente ETL) — si baja, la NSM cae por oferta, no por demanda.
- **Latencia del directo** (segundos desde gol real → visible/push) — fuente técnica (ETL/logs), no PostHog; clave para la calidad percibida.
- **Ratio de opt-out** de notificaciones.
- **Tasa de error de login** (magic link caducado / OAuth).
- **JS/errores** (PostHog Error Tracking, opcional) como salud de la experiencia.

---

## 13. Métricas de calidad de datos

La instrumentación se mide a sí misma; un evento que deja de llegar es un bug invisible. Se vigila con *tendencias* (igual que una feature):

- **Volumen por evento vs. esperado** → una caída brusca de `match_view` o `$pageview` = instrumentación rota o release que la partió.
- **% de eventos sin propiedades obligatorias** (p. ej. `match_view` sin `status`).
- **Eventos fuera de convención / huérfanos** (nombres no catalogados aquí).
- **Consistencia de enums** (`status`, `kind`, `method`, `platform`) — valores inesperados = bug.
- **Duplicados de `$pageview`** (ya hay guard `last.current`; vigilar regresiones).
- **% de identificados con email válido** y sin colisiones de identidad.
- **Cobertura de instrumentación**: % de pantallas con ≥1 evento intencional.

---

## 14. Dashboards propuestos

### 14.1 Ejecutivo (semanal, para dirección)

NSM y su tendencia · WAU/MAU + stickiness · retención D7/D30 por cohorte · % activados · crecimiento de nuevos · (cuando aplique) conversión premium y MRR. Una pantalla, sin ruido, para decidir foco.

### 14.2 Producto (para PM/diseño)

Funnel de activación (con caídas por paso) · adopción de favoritos por `kind` · CTR de push por `type` y ratio de opt-out · funnel e impacto de instalación PWA · paths clave (post-favorito, pre-directo) · profundidad de favoritos · uso del filtro de fixtures.

### 14.3 Operacional (para ingeniería/datos)

Cobertura y latencia del directo · errores de login por método · salud de notificaciones (entregadas/clic) · **calidad de datos** (volumen por evento, eventos sin props, valores de enum anómalos) · errores JS. Alertas sobre caídas de volumen de eventos críticos.

---

## 15. Estado actual vs. propuesto (gap analysis)

**Ya cubierto (12 eventos + person props `locale`, `theme`, `favorite_teams`):** consumo de partidos, favoritos, preferencias, login (parcial), compartir, inicio de checkout.

**Huecos a cerrar (prioridad alta → baja):**

1. **`live_match_followed`** — sin él no hay NSM. *(alta)*
2. **CTR de push** (`push_notification_received` / `_clicked`, desde el Service Worker) — la principal palanca de re-engagement hoy es ciega. *(alta)*
3. **Login por método y fallos** — `login_completed.method` está **hardcodeado a `magic_link`**; Google OAuth no se distingue y los fallos no se miden. *(alta)*
4. **Instalación PWA** (`app_installed`) y **onboarding** de favoritos. *(media)*
5. **`lineup_shared`** — la imagen de alineación se comparte con `navigator.share` directo, **sin** `track`. *(media)*
6. **Props de entidad en vistas** (competición/equipo/jugador) para segmentar. *(media)*
7. **Funnel premium completo** (`premium_viewed`, `_completed`, `_failed`) — listo para cuando se active el flag. *(baja hasta activar cobro)*
8. **Person props ampliadas** (`favorite_leagues`, `favorite_players`, `notifications_enabled`, `pwa_installed`, `is_premium`). *(media)*
9. **Deuda de nomenclatura**: `match_view` no sigue el patrón participio del resto; no renombrar en caliente (rompe histórico) — planificar alias/migración. *(baja)*

---

## 16. Información adicional necesaria (para completar el plan)

No se asume lo que no consta. Para cerrar el plan al 100% haría falta:

1. **Definición de "sesión"** deseada (timeout de inactividad) para normalizar métricas por sesión.
2. **Modelo de premium**: qué incluye, precio y planes → necesario para KPIs de conversión, ARPU y MRR.
3. **¿Hay publicidad?** Si se sirven anuncios, definir eventos `ad_impression`/`ad_click` y su frontera con analítica de marketing.
4. **Consentimiento y PII (RGPD/EU)**: ¿hay banner de consentimiento? El `identify` usa el email como id; hay que confirmar base legal y si se requiere modo *cookieless*/anonimización antes de identificar.
5. **Viabilidad técnica de medir desde el Service Worker** (`push_received`/`clicked`): confirmar que el SW puede emitir a PostHog (o vía endpoint propio) para no perder el CTR de push.
6. **Lista exacta de `key` de `notification_toggle`** (catálogo de toggles) para nombrar y documentar cada uno.
7. **Volumen de usuarios actual** → para dimensionar cohortes y saber cuándo los funnels tienen significancia.
8. **Targets por KPI** (objetivos numéricos) para fijar umbrales y alertas en los dashboards.
9. **¿Se desea group analytics por competición?** (coste vs. valor) para decidir entre grupos o props de evento.

---

## 17. Roadmap de implementación

- **Fase 0 — Cimientos (1 sprint):** consentimiento/PII resuelto · `live_match_followed` · `login_started/failed` + `method` real (incl. Google) · CTR de push desde el SW. Habilita NSM y diagnóstico de los dos bucles críticos (directo y notificaciones).
- **Fase 1 — Activación (1 sprint):** `app_installed` + prompt · `onboarding_*` · `lineup_shared` · props de entidad en vistas · person props ampliadas. Habilita el funnel de activación completo.
- **Fase 2 — Ingresos y profundidad:** funnel premium al activar el flag · group analytics por competición si se justifica · cohortes/segmentos avanzados.
- **Gobernanza:** mantener este catálogo como **tracking plan versionado** (este documento) junto al código; revisar en cada feature nueva ("ningún feature sin su evento") y vigilar calidad de datos (§13) como parte del operacional.

---

*Fin del plan de medición v1.0. Cambios sustanciales se versionan en la cabecera y, si afectan a operación/datos, se reflejan en [CHANGELOG.md](./CHANGELOG.md).*

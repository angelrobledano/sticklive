# 08 · Recomendaciones

**Fecha:** 21/10/2026
**Base:** hallazgos de [01](./01-inventario-producto.md)–[07](./07-analisis-competitivo-stick-live.md) y estado real del repositorio de Stick Live.
**Principio:** no copiar la arquitectura de OKMob. Copiar solo lo que mejora cobertura, confianza, identidad o distribución, con el cambio más pequeño posible.

---

## 1. Prioridades

| Prioridad | Horizonte | Objetivo | Por qué ahora |
|---|---|---|---|
| **P0** | 0–30 días | Cerrar las brechas que bloquean la propuesta: FECAPA, catalán, fidelidad de actas, validación de IDs. | Son las diferencias que un usuario catalán nota hoy. |
| **P1** | 1–3 meses | Construir las capas que OKMob ya tiene: identidad de jugador, reglas, comparador, `.ics`. | Crean retención y diferenciación duradera. |
| **P2** | 3–6 meses | Distribución móvil, pabellones, caché y búsqueda. | Sostienen el crecimiento y la retención. |
| **P3** | 6–12 meses | Asistente determinista, previsión calibrada, notificaciones inteligentes. | Opcionales; no deben distraer de P0/P1. |

**Regla de secuencia:** P0 no se negocia. P1 puede empezar en paralelo solo si P0 tiene responsable y fecha. P3 no empieza hasta que la app esté publicada y las actas sean verificables.

---

## 2. P0 — 0 a 30 días

### P0.1 Activar FECAPA en producción

**Problema:** OKMob cubre 159 competiciones FECAPA (110 vigentes); Stick Live tiene parser y registro, pero la documentación interna lo sitúa como pendiente. Es la brecha de producto más grande.

**Archivos/áreas:**

- `apps/etl/src/federations.ts` (registro existente: `FECAPA`, prefijo `fecapa`).
- `apps/scraper/src/scrapers/fep/sidgad-client.ts` (cliente PHP/HTML con cookies).
- `apps/etl` (jobs de catálogo, calendario, clasificación, actas).
- `apps/api/src/routes/competitions.ts`, `standings.ts`, `matches.ts`, `match-detail.ts`.
- `apps/web/src/app/[locale]/competitions`, `teams`, `matches`.
- Migraciones en `packages/db/migrations` si falta el mapeo de fuente.

**Pasos:**

1. Sembrar `data_sources` / mapeo de competición para FECAPA; validar que `source_ref` sea el `idc` numérico y que el prefijo se preserve en la capa de fuente.
2. Importar catálogo y comprobar 159 competiciones, 110 vigentes y 2.106 filas de equipo.
3. Cargar el fixture real `4858`: clasificación, calendario, equipos y un acta.
4. Activar el directo para FECAPA con la misma cadencia que RFEP; medir latencia y errores.
5. Resolver equipos duplicados con el ER existente (`team_aliases`, `source_ref`); no crear un equipo nuevo por cada variante de nombre.
6. Añadir un flag de activación por federación para poder desactivar sin deploy.
7. Monitorizar: última ingesta, partidos vivos, actas, errores por endpoint, duplicados.

**Criterios de aceptación:**

- `/competitions` muestra FECAPA y sus 159 competiciones; 110 marcadas como vigentes.
- `/competitions/4858` (o el slug equivalente) muestra clasificación y calendario correctos.
- Un partido FECAPA en vivo actualiza el marcador en la web y en SSE.
- El acta `164291` se muestra con marcador 0–1, árbitros, pabellón, goleador y faltas.
- No hay equipos duplicados en la competición de prueba.
- Tests de integración contra Postgres real; migraciones desde cero en verde.
- Dashboard/alerta si FECAPA deja de ingerir más de X minutos.

**Métricas:**

- Competiciones FECAPA visibles / 159.
- Partidos con marcador y acta.
- Freshness p95 del directo.
- Tasa de duplicados de equipo.
- Errores de ingesta por 1.000 requests.

**Riesgos:** carga sobre Sidgad, HTML cambiante, permisos. Mitigación: rate limit (la política de OKMob es 12/min, burst 6, concurrencia 3; Stick Live ya tiene reintentos y timeout), caché, flag de apagado y acuerdo/consulta con FECAPA si corresponde.

---

### P0.2 Añadir catalán a la web y a la app

**Problema:** OKMob es catalán primero; Stick Live tiene `es,en,pt,fr,it` y **no `ca`**. En el mercado de FECAPA es una brecha directa.

**Archivos/áreas:**

- `apps/web/src/lib/locales.ts`: añadir `ca` a `SUPPORTED_LOCALES`, `LOCALE_NAMES`, fallback (mantener `es`).
- `apps/web/src/lib/i18n.tsx` y diccionarios de mensajes.
- `apps/web/src/lib/locale-links.ts`, `apps/web/src/components/shared/LocaleLink.tsx`, `apps/web/src/components/layout/LocaleHint.tsx`.
- `apps/web/src/lib/sitemap.ts` y `apps/web/src/app/sitemap.ts`: hreflang por locale, `lastmod` de datos.
- `apps/web/src/components/**` (textos de navegación, partido, clasificación, errores, vacíos, legales).
- `apps/mobile/src/i18n/locales.ts` y diccionarios; selector en `apps/mobile/app/settings`.
- Tests: `locale-links-guard.test.ts`, `locales.test.ts`, `lineups-i18n.test.tsx`, `competitions-list-i18n.test.tsx`.

**Pasos:**

1. Traducir primero las rutas de mayor uso: navegación, directo, competición, partido, clasificación, equipo, jugador, búsqueda, errores y estados vacíos.
2. Revisar terminología de hockey sobre patines con una persona nativa (no solo traducción automática): «acta», «faltes», «targetes», «play-off», «descens», «porter».
3. Añadir `hreflang` `ca-ES` y el resto de locales; canonical por locale.
4. Añadir el selector de idioma en web y app; no cambiar el idioma por geolocalización sin consentimiento.
5. Tests de claves completas y de rutas; el test actual de la app exige que todos los diccionarios tengan las mismas claves.
6. Medir SEO y uso; no bloquear el resto de locales.

**Criterios de aceptación:**

- `/ca/...` funciona en todas las rutas públicas; no hay claves sin traducir.
- `hreflang` correcto y recíproco; canonical no apunta a otro idioma.
- La app permite elegir catalán y persiste la preferencia.
- Los tests de i18n y de enlaces pasan.
- Una persona nativa revisa una muestra de 50 cadenas críticas.

**Métricas:** sesiones en `ca`, impresiones/CTR en catalán, rebote, finalización de flujo, tickets de traducción.

**Riesgo:** traducción literal o incorrecta. Mitigación: glosario de términos y revisión humana.

---

### P0.3 Contrato de fidelidad de actas

**Problema:** OKMob publica 4 eventos donde el acta oficial tiene decenas; los contadores de jugador están a cero. Stick Live no debe repetir ese error ni prometer «acta completa» sin medirla.

**Archivos/áreas:**

- `apps/scraper/src/scrapers/fep/*` (parser de acta).
- `apps/etl` (normalización de eventos).
- `apps/api/src/routes/match-detail.ts`, `match-stream.ts`.
- `packages/db/migrations`: `match_events` + campos de exhaustividad.
- `apps/web/src/components/match/TimelineTab.tsx`, `MatchChronicle.tsx`, `MatchHeader.tsx`.
- Fixtures de test con el acta `164291`.

**Pasos:**

1. Añadir a `match_events` los tipos que faltan: `yellow_card` (jugador y banquillo) y, si el acta los trae, eventos de banquillo/equipo. Revisar el check actual: admite `goal`, `penalty`, `blue_card`, `red_card`, `timeout`, `period_end`, `foul`, `direct_foul`; **no `yellow_card`**.
2. Parsear la secuencia completa del acta: expulsiones de 2 minutos, tiempos muertos, faltas directas, goles, penaltis, tarjetas y banquillo.
3. Guardar `source_detail_level` (`summary`, `digital`, `full`), `events_complete` y `source_url`/`source_fetched_at`.
4. Ordenar los eventos por periodo y reloj en el servidor; no confiar en el orden de la fuente.
5. Mostrar un badge «acta resumida» cuando `events_complete = false`; enlazar al acta oficial.
6. Test de fidelidad con `164291`: marcador, 2 FD, 1 gol, 1 penalti, faltas 12/10, amarillas 1/1, `P10`, orden cronológico.
7. Test de regresión: si el parser deja de encontrar un tipo, el test falla; no se silencia.

**Criterios de aceptación:**

- El acta `164291` muestra todas las acciones que el acta oficial publica (o marca explícitamente las que faltan).
- Los eventos están ordenados.
- Las tarjetas de banquillo y jugador se muestran con el tipo correcto.
- `events_complete` y `source_detail_level` están presentes en la API.
- La UI muestra el badge y el enlace oficial.
- El test de fixture pasa en CI.

**Métricas:** % de actas con `events_complete=true`, eventos por acta, cobertura de tarjetas/faltas, quejas por cronología.

**Riesgo:** el parser no pueda obtener el 100 % de la fuente. Mitigación: no inventar; marcar lo que falta y priorizar las competiciones con acta digital.

---

### P0.4 Validación de namespace y observabilidad de fuentes

**Problema:** `idc=260` devuelve FECAPA 2021 y `W260` devuelve World Skate. Un cliente que omita el prefijo obtiene datos válidos de otra federación. Stick Live debe validar el espacio de IDs en la frontera.

**Archivos/áreas:**

- `apps/etl/src/federations.ts` y el parser de `source_ref`.
- `apps/api/src/routes/*` (validación de parámetros).
- `apps/api/src/routes/health.ts`.
- Dashboard/alertas (Sentry/PostHog o el sistema interno).
- Tests de integración.

**Pasos:**

1. Definir un tipo `FederationSourceId` con prefijo obligatorio (`R`, `W`, `I`) y FECAPA numérico explícito.
2. Rechazar `idc` ambiguo o sin prefijo cuando la federación no sea FECAPA; devolver 400, no datos de otra federación.
3. Añadir un test que compare `idc=260` vs `W260` y falle si se cruzan.
4. Exponer en `/health` el estado de la última ingesta por federación (sin secretos).
5. Alertar si una fuente deja de actualizar, si el número de competiciones cae o si aparecen IDs fuera de rango.
6. Documentar el namespace en `docs/pipeline-datos.md` y corregir la frase «APIs JSON internas»: el cliente usa PHP/HTML con cookies y devuelve texto.

**Criterios de aceptación:**

- Un `idc` ambiguo no devuelve datos de otra federación.
- `/health` informa de la última ingesta por federación.
- Hay alerta por fuente caída y por caída de cobertura.
- El test de colisión está en CI.
- La documentación coincide con el cliente real.

---

## 3. P1 — 1 a 3 meses

### P1.1 Crosswalk de jugadores entre federaciones

**Problema:** OKMob tiene 1.004 personas cruzadas (85,2 % multi-federación); Stick Live tiene `players.source_ref` por fuente y no un mapa entre fuentes. Sin esto no hay carrera, palmarés ni comparación fiables.

**Archivos/áreas:**

- `packages/db/migrations`: nuevas tablas `person` (o `canonical_players`) y `player_source_map`.
- `apps/etl` (matching y revisión).
- `apps/api/src/routes/player-detail.ts`, `player-insights.ts`.
- `apps/web/src/app/[locale]/players`, `components/player`.
- Admin para merge/split y revisión.

**Modelo propuesto:**

```sql
-- Persona canónica
CREATE TABLE persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id UUID NOT NULL REFERENCES sports(id),
  display_name TEXT NOT NULL,
  birth_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mapa de IDs de fuente
CREATE TABLE player_source_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES data_sources(id),
  source_player_id TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  method TEXT NOT NULL,              -- exact_id, name_club_dob, manual, ...
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, source_player_id)
);
```

**Pasos:**

1. Empezar por los jugadores que aparecen en RFEP + FECAPA + World Skate; usar `source_ref` estable cuando exista.
2. Matching determinista por ID de fuente; después por nombre normalizado + club + fecha de nacimiento, con umbral y revisión.
3. Guardar `confidence`, `method` y `reviewed_at`; no fusionar sin revisión los casos dudosos.
4. Soportar merge/split y redirecciones; no borrar IDs antiguos.
5. Exponer la persona canónica en la ficha de jugador y en la comparación.
6. Test de precisión con una muestra revisada; cero fusiones falsas en tests.

**Criterios de aceptación:**

- Un jugador con IDs en FECAPA y RFEP muestra una sola ficha con secciones de ambas federaciones.
- La ficha muestra `source` y `confidence` (o una nota de identidad).
- Merge/split funciona y deja redirección.
- Precisión ≥99 % en una muestra revisada de 200 pares; recall ≥80 % en los cruces conocidos.
- No se expone `birth_date` sin decisión de privacidad.

**Métricas:** pares cruzados, precisión, cobertura, fusiones revertidas.

---

### P1.2 Reglamento como datos

**Problema:** OKMob tiene 43 reglas 2025/26 y 23 en 2026/27, con zonas, cascadas y fuentes. Stick Live no tiene un modelo equivalente; la clasificación no explica ascensos/descensos.

**Archivos/áreas:**

- `packages/db/migrations`: `competition_rules`, `rule_zones`, `rule_sources`, `rule_cascades`.
- `apps/etl` o admin para cargar reglas.
- `apps/api/src/routes/standings.ts`, `season-overview.ts`.
- `apps/web/src/components/competition/StandingsTab.tsx`, `apps/web/src/app/[locale]/competitions`.
- Tests de zonas y cascadas.

**Modelo propuesto:**

```sql
CREATE TABLE competition_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id),
  season_id UUID NOT NULL REFERENCES seasons(id),
  version INT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  published_at DATE,
  notes TEXT,
  UNIQUE(competition_id, season_id, version)
);

CREATE TABLE rule_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES competition_rules(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('champion','promotion','promotion_playoff','relegation','relegation_playoff','final_phase','placement')),
  position_from INT,
  position_to INT,
  destination TEXT,
  eligibility JSONB,
  note TEXT
);

CREATE TABLE rule_cascades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES competition_rules(id) ON DELETE CASCADE,
  source_pattern TEXT,
  by_n INT NOT NULL,
  zones JSONB NOT NULL
);
```

**Pasos:**

1. Cargar 2025/26 y 2026/27 de FECAPA; empezar por Nacional Catalana, Primera Catalana y categorías base.
2. Usar `competition_id` + `season_id`, no regex sobre el nombre.
3. Guardar `source`/`source_url` y una nota de versión.
4. Exponer en `standings` la zona aplicada (`zone_kind`, `zone_label`, `rule_id`) calculada en servidor.
5. UI: leyenda y explicación; no solo colores.
6. Tests: cada zona coincide con la base oficial; cascada por número de ascensos; cambio de nombre no rompe la regla.

**Criterios de aceptación:**

- La clasificación de `4858` muestra campeón, play-off y descenso correctos.
- La zona se calcula en servidor y viaja en la API.
- Cada zona tiene fuente y versión.
- Un cambio de nombre de competición no elimina la zona.
- Tests de cascada para 1 y 2 ascensos.

---

### P1.3 Comparador/H2H dedicado

**Problema:** OKMob tiene `/compara` para equipos y jugadores; Stick Live solo tiene `PreviousMeeting` dentro del partido.

**Archivos/áreas:**

- `apps/web/src/app/[locale]/compare` (nueva ruta) o `comparar`.
- `apps/api/src/routes` (nuevo endpoint `/compare` o reutilizar `team-recent`, `player-insights`, `match-detail`).
- `apps/web/src/components/match/PreviousMeeting.tsx` (reutilizar).
- `apps/web/src/components/team`, `components/player`.
- SEO: `generateMetadata`, sitemap si se indexa.

**Pasos:**

1. Definir el alcance: dos equipos de la misma competición y dos jugadores de la misma federación o crosswalk.
2. Datos: forma, últimos partidos, H2H, goles, tarjetas, porteros, títulos/palmarés si existe.
3. SSR para SEO y compartibilidad; no hacerlo solo cliente.
4. Tests de datos y de render; estados vacíos.
5. Enlaces desde equipo, jugador y partido.

**Criterios de aceptación:**

- `/compare?teamA=...&teamB=...` funciona en SSR.
- Muestra forma, H2H y estadísticas; sin datos inventados.
- Funciona con dos jugadores crosswalk.
- Tests de render y de datos; metadatos sociales.

---

### P1.4 Calendario `.ics`

**Problema:** OKMob tiene `team.ics` con 60 eventos, timezone, GEO y URL; Stick Live no tiene suscripción de calendario.

**Archivos/áreas:**

- `apps/api/src/routes` (nuevo `calendar.ts` o `team-calendar.ts`).
- `apps/api/src/index.ts`.
- `apps/web` botón «suscriptar» en equipo/competición.
- Tests de iCalendar.

**Pasos:**

1. Implementar `GET /teams/:id/calendar.ics` y `GET /competitions/:id/calendar.ics`.
2. `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: inline`, `Cache-Control` 1 h.
3. `PRODID`, `CALSCALE`, `METHOD:PUBLISH`, `X-WR-CALNAME`, `X-WR-TIMEZONE`, `VTIMEZONE`, `VEVENT` con `UID` estable, `DTSTAMP`, `DTSTART`/`DTEND`, `SUMMARY`, `LOCATION`, `GEO`, `URL`, `DESCRIPTION`.
4. No incluir datos personales; solo partidos y sede.
5. `VALARM` opcional (recordatorio 1 h antes); si se añade, hacerlo configurable.
6. Cache y rate limit; no auth para calendarios públicos.
7. Tests: 60 eventos, timezone, actualización, importación en Apple/Google.

**Criterios de aceptación:**

- El `.ics` se importa en Apple Calendar y Google Calendar.
- Los eventos tienen UID estable y hora correcta en Europe/Madrid.
- El calendario se actualiza al cambiar un partido (mismo UID, `SEQUENCE`).
- No hay `VALARM` por defecto si no se decide lo contrario.

---

## 4. P2 — 3 a 6 meses

### P2.1 Publicar la app y Live Activities

**Problema:** OKMob está en tiendas y tiene Live Activities; Stick Live tiene paridad en código pero release pendiente.

**Archivos/áreas:**

- `apps/mobile` (Expo SDK 57, expo-router, NativeWind).
- `apps/mobile/app.config.ts`, `eas.json`.
- `apps/mobile/src/lib/push.ts`, `session.ts`, `analytics.ts`.
- Fichas de App Store/Google Play; ASO en catalán.
- Live Activities: módulo nativo/Expo config plugin; iOS ActivityKit.

**Pasos:**

1. Cerrar `eas init`, `extra.eas.projectId`, token de Sentry y credenciales de tienda.
2. Build interno TestFlight/Play; probar login, SSE, push, favoritos, offline y deep links.
3. Ficha de tienda en catalán y castellano; capturas con directo, clasificación y Live Activity.
4. Push por equipo/tema; preferencias y deduplicación.
5. Deep links `sticklive.eu/matches/...` → app.
6. Live Activities iOS para el partido seguido: marcador, reloj, faltas; actualización por SSE/push.
7. Android: notificación persistente; evaluar widget después.
8. Medir crash-free, arranque, push y retención.

**Criterios de aceptación:**

- App en TestFlight/Play interno; luego producción.
- Crash-free ≥99,5 % (objetivo inicial; ajustar tras baseline).
- Push entregado en <60 s desde el evento.
- Deep link abre el partido correcto.
- Live Activity se actualiza y se cierra al final.

**Riesgo:** el release depende de credenciales humanas; empezar ya, no al final.

---

### P2.2 Pabellones y geolocalización

**Problema:** OKMob tiene `/pv/:venue`, GEO y meteorología; Stick Live solo guarda `venue_name`/`venue_city` en `matches`.

**Archivos/áreas:**

- `packages/db/migrations`: `venues` y `matches.venue_id`.
- `apps/etl` (normalización/geocodificación).
- `apps/api` (venue detail).
- `apps/web/src/app/[locale]/venues/[id]`.
- Mapa: Leaflet/MapLibre + OpenStreetMap; no añadir Google Maps si no es necesario.

**Pasos:**

1. Crear `venues` con `name`, `address`, `city`, `lat`, `lon`, `source`, `source_ref`, `geocoded_at`.
2. Migrar `matches.venue_name` a `venue_id` cuando haya match; dejar el texto como fallback.
3. Geocodificar solo sedes con dirección fiable; no inventar coordenadas.
4. Página de pabellón con mapa, partidos y cómo llegar.
5. Meteorología opcional (MET Norway) solo si hay coordenadas y partido próximo; cachear.
6. Tests de normalización y de página; no romper partidos sin sede.

**Criterios de aceptación:**

- Las sedes de RFEP/FECAPA con dirección tienen `venue_id`.
- La página muestra mapa y partidos; si no hay coordenadas, muestra dirección y un aviso.
- No se geocodifica a ciegas ni se muestran coordenadas falsas.

---

### P2.3 Caché de lectura y ETag

**Problema:** Stick Live ya tiene `read-cache` (30–300 s + SWR), pero el SEO y las fichas de entidad se benefician de caché CDN/ETag. OKMob demuestra que los históricos pueden cachearse mucho.

**Archivos/áreas:**

- `apps/api/src/lib/read-cache.ts`.
- `apps/api/src/routes/competitions.ts`, `standings.ts`, `team-detail.ts`, `player-detail.ts`, `season-*`.
- `apps/web` fetch/SSR.

**Pasos:**

1. Añadir `ETag`/`If-None-Match` y `CDN-Cache-Control`/`Cache-Control` con `stale-while-revalidate` a recursos de lectura no vivos.
2. TTLs: competiciones/temporadas 5–15 min; históricos 1–24 h; directo 5–10 s o SSE.
3. Invalidación por versión/`updated_at`; no cachear datos de usuario.
4. Medir hit ratio y p95; no cachear en exceso el directo.

**Criterios de aceptación:**

- Las fichas de competición/equipo/jugador devuelven `ETag`.
- `If-None-Match` devuelve 304.
- El directo no se sirve con caché mayor de 10 s.
- p95 de lectura histórica mejora; no hay quejas de datos viejos.

---

### P2.4 Búsqueda global

**Problema:** OKMob limita la búsqueda de equipos a la temporada actual; Stick Live puede hacerlo mejor con su histórico y su modelo de entidades.

**Archivos/áreas:**

- `apps/api/src/routes/search.ts`.
- `apps/web/src/app/[locale]/search`.
- Índices/trigramas en Postgres.

**Pasos:**

1. Buscar por equipo, jugador, competición, temporada y partido.
2. Normalizar acentos y catalán (`ç`, `à`, `è`, `í`, `ï`, `ò`, `ó`, `ú`, `ü`); alias de equipo.
3. Priorizar resultados por relevancia y popularidad; incluir históricos.
4. Tests de consultas y de ranking; estados vacíos.

**Criterios de aceptación:**

- «Barça» encuentra equipos y jugadores aunque el nombre tenga patrocinador.
- «Nacional Catalana» encuentra la competición y sus temporadas.
- Resultados relevantes en <300 ms p95 (objetivo inicial).

---

## 5. P3 — 6 a 12 meses (experimental)

### P3.1 Asistente determinista, con fuentes

**Problema:** OKMob tiene un asistente con LLM; Stick Live no necesita copiarlo, pero puede ofrecer respuestas útiles sin coste/riesgo.

**Alcance inicial:**

- Preguntas sobre reglas, clasificación, próximo partido, H2H y resultados.
- Respuestas desde la base de datos, con enlace a la fuente.
- Sin LLM; plantillas + búsqueda.
- Rate limit y opt-in.

**Criterios de aceptación:**

- 50 preguntas de evaluación con respuesta correcta y cita.
- 0 respuestas inventadas en la muestra.
- Latencia <1 s para consultas deterministas.
- Si se añade LLM, coste por consulta y límites definidos.

### P3.2 Previsión calibrada

**Problema:** OKMob tiene un motor Poisson sin calibración publicada. Stick Live no debe lanzar otro sin validar.

**Alcance:**

- Backtesting con temporadas históricas.
- Métricas: Brier, log-loss, calibración, cobertura.
- Etiqueta «estimación»; incertidumbre; sin apuestas.
- A/B test y kill switch.

**Criterios de aceptación:**

- Informe de calibración reproducible.
- La UI no presenta la previsión como certeza.
- No hay enlaces ni incentivos de apuestas.

### P3.3 Notificaciones inteligentes

- Resumen de highlights, quiet hours, deduplicación, preferencias.
- Empezar sin LLM; el copy se puede generar con plantillas.
- Medir opt-in, apertura y unsubscribe.

---

## 6. Roadmap resumido

| Trimestre | Entregables | Dependencias | Métricas |
|---|---|---|---|
| **Q4 2026** | FECAPA, catalán, acta fidelity, namespace/health | Parser FECAPA, revisión nativa, fixture 164291 | Cobertura, freshness, claves i18n, actas completas |
| **Q1 2027** | Player crosswalk, rules-as-data, compare, `.ics` | FECAPA + RFEP + WSE, revisión de datos | Precisión crosswalk, zonas correctas, suscripciones |
| **Q2 2027** | App release, Live Activities, venues, caché, search | EAS/credenciales, geocodificación | Instalaciones, crash-free, p95, CTR |
| **Q3 2027** | Asistente determinista, previsión calibrada, notificaciones | Datos históricos, evaluación | Precisión, calibración, retención |

---

## 7. Qué no hacer

- No reescribir el backend como CDN estática.
- No convertir la web en SPA/CSR.
- No copiar el modelo ads-only ni eliminar premium.
- No ingerir OKMob como fuente.
- No lanzar un chatbot generalista antes de tener respuestas deterministas.
- No publicar previsiones sin calibración.
- No añadir meteorología antes de tener pabellones.
- No publicar fechas de nacimiento sin revisión de privacidad.
- No hacer un `big bang` de FECAPA + catalán + reglas + app en un solo release; secuenciar con flags.

---

## 8. Verificación y definition of done

Para cada entrega:

- `npm run typecheck && npm run lint && npm run test` en verde.
- Tests de integración contra Postgres real cuando haya migraciones o queries.
- Migraciones desde cero y build de la imagen en verde.
- Fixtures de datos reales (FECAPA 4858, acta 164291, RFEP R3575).
- Prueba manual en web y móvil (si aplica).
- Dashboard/alertas para la nueva fuente o función.
- Documentación actualizada (`docs/pipeline-datos.md`, `docs/api.md`, `docs/app.md`).
- Sin cambios no relacionados; diff revisado.

**Evidencia antes de afirmar:** no decir «FECAPA activa» hasta que `/competitions` la muestre y un partido en vivo se actualice. No decir «acta completa» hasta que el fixture 164291 pase. No decir «app publicada» hasta que esté en la tienda.

---

## 9. Métricas de éxito (primeros 90 días)

| Área | Métrica | Objetivo inicial |
|---|---|---|
| Cobertura | Competiciones FECAPA visibles | 159 |
| Cobertura | Competiciones FECAPA vigentes | 110 |
| Cobertura | Equipos FECAPA con ficha | ≥95 % |
| Directo | Freshness p95 | <60 s |
| Actas | Actas con `events_complete` | ≥80 % en competiciones con acta digital |
| Actas | Errores de cronología reportados | 0 |
| i18n | Claves catalanas sin traducir | 0 |
| SEO | Errores de `hreflang` | 0 |
| SEO | Páginas de entidad indexadas | Baseline + 30 % |
| Crosswalk | Precisión en muestra revisada | ≥99 % |
| Reglas | Zonas correctas en competiciones piloto | 100 % |
| `.ics` | Suscripciones activas | Baseline |
| App | Crash-free | ≥99,5 % |
| App | Push entregado en <60 s | ≥95 % |
| Operación | Alertas de fuente caída | 100 % de federaciones |

Los objetivos son puntos de partida; se ajustan después de medir la línea base. No se deben presentar como compromisos comerciales sin validación.

---

## 10. Decisión recomendada

**Ejecutar P0 en paralelo con el release de la app.** Son las dos palancas que más reducen la ventaja de OKMob:

1. FECAPA + catalán → eliminan su diferenciación local.
2. Acta verificable → convierte su debilidad en la fortaleza de Stick Live.
3. App publicada → elimina su ventaja de distribución.
4. Player crosswalk + reglas → construyen la ventaja que OKMob ya tiene y que es más difícil de copiar.

El resto (asistente, previsión, meteorología) puede esperar. No es lo que decide el producto.

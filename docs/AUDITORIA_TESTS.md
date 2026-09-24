# Auditoría de TDD y cobertura de tests — Stick Live

_Fecha: 2026-09-24 · Alcance: análisis de solo lectura. Espejo de la auditoría del proyecto de Claude._

> Nota de método: la suite no se pudo ejecutar en local desde el entorno de auditoría porque el `node_modules` del repo está instalado para Windows (falta el binario nativo de rollup para la VM Linux). Se toma el CI (`.github/workflows/ci.yml`) como fuente del estado verde. El análisis es estático sobre el código y los tests existentes.

---

## A. Estado actual de los tests

El proyecto **no parte de cero en TDD**: hay una base de tests seria y bien pensada, con dos capas claras y separadas a propósito.

**Unitarios (12 ficheros, ~1.080 líneas)** — rápidos, sin BD, sobre lógica pura. Calidad alta: se centran en comportamiento y casos límite, no en líneas. Buenos ejemplos: `push-diff.test.ts`, `normalize.test.ts`, `eu-timezone.test.ts` y `fep-ficha.parser.test.ts` (365 líneas contra actas reales).

**Integración (16 ficheros, ~1.850 líneas)** — contra Postgres real, no emulador. Cubren lo que no se puede verificar de otra forma: `replaceMatchEvents`, el trigger NOTIFY, los snapshots del push, la cola de resolución de entidades, la guarda de particionado, el watchdog de partidos fantasma. Casi todos nacieron de un incidente y lo dejan escrito para que no vuelva.

El CI es sólido: typecheck (incluido el de `tests/`), unitarios, lint bloqueante, `npm audit` de prod bloqueante, migraciones desde cero + reaplicación idempotente + verificación de índices, integración contra Postgres y build de la imagen de producción.

### Dos avisos que importan más que cualquier hueco de cobertura

1. **`apps/etl/src/enrich-promote.ts` tenía un conflicto de merge sin resolver** (bloqueaba el typecheck; es la única pieza que escribe sobre filas nativas de producción). _Resuelto el 2026-09-24 quedándonos con la versión de la rama `feat/a5-promote-season-extras`._
2. **`npm test` da falsa sensación de seguridad.** `turbo run test` solo corre unitarios; los de integración van por un job aparte (`npm run test:integration`, con Docker) y solo se ejecutan en CI. Además `apps/api`, `apps/etl` y `apps/scraper` usan `vitest run --passWithNoTests`: un módulo nuevo sin tests nunca pone el pipeline en rojo.

---

## B. Problemas encontrados (huecos y riesgos)

Ordenados por riesgo, no por tamaño.

**Sin ninguna red y con impacto grave:**

- **`enrich-promote.ts`** (0 tests): escribe sobre prod nativo con lista blanca. Cuatro guardas duras, dry-run/commit/revert y captura del valor anterior en `enrich_changes`. Un fallo corrompe datos reales o los deja irreversibles.
- **Stripe** (`payments-stripe.ts`, 0 tests): verificación de firma del webhook, idempotencia por `processed_stripe_events`, activación de premium y estado autoritativo por `premium_until`.
- **Auth** (`auth.ts`, 0 tests): `signState`/`verifyState` (HMAC + timing-safe), magic link de un solo uso, adopción de usuario anónimo y su fallback, cuentas `disabled`, hasheo del token de sesión.
- **`match.loader.ts`** (0 tests directos): corre cada 45 s en directo. Adopción de placeholders sintéticos, guarda anti-duplicados, fallback de solo-marcador y self-heal de `alt_source_refs`.

**Cobertura parcial que da tranquilidad de más:**

- El **push** tiene la decisión pura testeada (`push-diff.ts`) y los snapshots testeados, pero la **segmentación** (`wants`/`effectivePreset`/`PRESET_EVENTS`) y el **silencio nocturno** (`isQuietHours`) no tienen test.
- **`derive-results.ts`**: `win_type`, ganador y ventana de 12 h sin cubrir.

**Fuente de verdad sin fijar:** los parsers `fep-calendar`, `fep-matches`, `fep-standings` no tienen tests de fixture (`fep-ficha.parser` sí).

**Menor pero real:** `rate-limit`, `competition.transformer`/`team.transformer`, `slugify`, `standing.loader`, `sidgad-client`, y el paquete `packages/db` sin unitarios.

No se encontraron tests frágiles, duplicados ni sobre-mockeados. El riesgo es de **ausencia**, salvo la excepción estructural de `--passWithNoTests` + integración solo-en-CI.

---

## C. Backlog priorizado

`int` = integración (Postgres real), `unit` = unitario puro. Complejidad: S / M / L.

| ID | Pri | Área | Test | Riesgo si falta | Tipo | Compl. |
|----|-----|------|------|-----------------|------|--------|
| T-001 | P0 | enrich-promote | Guarda: aborta si quedan partidos del lote en 'Histórico' en staging | Promueve datos a medio mover | int | M |
| T-002 | P0 | enrich-promote | Guarda: aborta si hay partidos del lote sin fecha | Escribe fechas nulas en prod | int | S |
| T-003 | P0 | enrich-promote | Guarda: aborta por colisión de fecha en temporada destino | Duplica partidos en prod | int | M |
| T-004 | P0 | enrich-promote | Guarda: aborta si la clasificación no reconcilia (gf/ga) | Acepta re-scrape no fiable como verdad | int | M |
| T-005 | P0 | enrich-promote | Commit aplica SOLO la lista blanca (season_id, scheduled_at, marcador) | Pisa columnas que no debe en prod | int | M |
| T-006 | P0 | enrich-promote | Idempotencia: re-ejecutar no vuelve a mover | Doble promoción | int | M |
| T-007 | P0 | enrich-promote | Guarda el valor anterior en `enrich_changes` antes del UPDATE | Cambio irreversible | int | S |
| T-008 | P0 | enrich-promote | `--revert` restaura desde `enrich_changes` y marca 'reverted' | No hay vuelta atrás | int | M |
| T-009 | P0 | Stripe | Webhook rechaza firma inválida (400) | Activación de premium falsificable | int | S |
| T-010 | P0 | Stripe | Webhook idempotente: `event_id` repetido no reactiva | Efectos duplicados | int | S |
| T-011 | P0 | Stripe | `checkout.session.completed` activa premium (+1 año) | El pago no entrega el producto | int | M |
| T-012 | P1 | Stripe | `checkout` con premium activo devuelve 409 | Cobro doble | int | S |
| T-013 | P1 | Stripe | `status` refleja caducidad (`premium_until` pasado → false) | Premium eterno | int | S |
| T-014 | P0 | Auth | `verifyState` acepta HMAC válido y rechaza el manipulado | CSRF de login | unit | S |
| T-015 | P0 | Auth | `verifyState`: firma de otra longitud / payload corrupto → null | Bypass de la verificación | unit | S |
| T-016 | P1 | Auth | `magic-link` valida email (regex, >254) → 400 | Inyección de datos basura | int | S |
| T-017 | P0 | Auth | `verify` canjea el token una sola vez (2º intento → 410) | Reutilización de magic link | int | M |
| T-018 | P1 | Auth | `verify` con token caducado → 410 | Acceso con enlace viejo | int | S |
| T-019 | P1 | Auth | `resolveUserByEmail` adopta al usuario anónimo por `device_id` | Se pierden favoritos al registrarse | int | M |
| T-020 | P1 | Auth | Fallback ante colisión de `device_id` (`email:`) | 500 en el login | int | M |
| T-021 | P1 | Auth | Cuenta `disabled` → 403 en verify y en Google | Reactivación de cuenta baneada | int | S |
| T-022 | P1 | Auth | `openSession` guarda el token hasheado, devuelve el claro | Robo de sesión desde la BD | int | S |
| T-023 | P0 | match.loader | Adopta el placeholder sintético cuando llega el idp real | Partido duplicado + fantasma | int | M |
| T-024 | P0 | match.loader | Omite el sintético si ya existe el partido real del cruce/fecha | Duplicado en playoff | int | M |
| T-025 | P1 | match.loader | Omite el placeholder sintético pasado sin idp | Fantasmas programados | int | S |
| T-026 | P1 | match.loader | Fallback solo-marcador por `source_ref` si el equipo no resuelve | Se pierde el marcador del directo | int | M |
| T-027 | P1 | match.loader | Self-heal: aprende `alt_source_ref` (`fep_club_*`) → equipo | El directo omite partidos (club vs team) | int | M |
| T-028 | P2 | match.loader | Distingue error esperado (equipo no hallado → skip) del real (→ errors) | Diagnóstico enmascarado | int | S |
| T-029 | P1 | push/segmentación | `wants`: sigue por equipo local o visitante → recibe | Silencio a quien sigue el equipo | unit | S |
| T-030 | P1 | push/segmentación | `wants`: sigue por competición → recibe | Silencio por liga | unit | S |
| T-031 | P1 | push/segmentación | `wants`: sigue por jugador → recibe su gol | Silencio de jugador | unit | S |
| T-032 | P1 | push/segmentación | `wants`: sin favoritos que casen → NO recibe | Spam a quien no sigue nada | unit | S |
| T-033 | P1 | push/segmentación | `effectivePreset`: default 'complete'; 'silent' no recibe nada | Preset ignorado | unit | S |
| T-034 | P1 | push/segmentación | `PRESET_EVENTS`: 'results' sin 'goal'; 'key_events' sin 'start' | Notifica lo que el usuario apagó | unit | S |
| T-035 | P1 | push/silencio | `isQuietHours`: bordes 23:00/08:00 en Madrid (y DST) | Push de madrugada | unit | S |
| T-036 | P1 | derive-results | `win_type='overtime'` con gol en periodo ≥3 | Resultado mal etiquetado | int | M |
| T-037 | P1 | derive-results | `win_type='penalties'` con empate + fase extra sin goles OT | Penaltis mal clasificados | int | M |
| T-038 | P2 | derive-results | `win_type='regular'` decidido en reglamentario | Etiqueta incorrecta | int | S |
| T-039 | P1 | derive-results | `winner_team_id` por marcador; conserva el de penaltis existente | Ganador pisado en penaltis | int | M |
| T-040 | P2 | derive-results | `home/away_goals_reg` cuentan solo periodo ≤2 | Desglose reglamentario erróneo | int | S |
| T-041 | P2 | derive-results | Solo recalcula partidos con `updated_at` < 12 h | Recalcula/omite de más | int | S |
| T-042 | P1 | scraper FEP | `fep-calendar`: extrae partidos de un fixture HTML real | Calendario roto en silencio | unit | M |
| T-043 | P1 | scraper FEP | `fep-matches`: marcador/estado/fecha de fixture | Directo roto en silencio | unit | M |
| T-044 | P1 | scraper FEP | `fep-standings`: filas + `group_name` limpiado | Clasificación rota / clave upsert sucia | unit | M |
| T-045 | P1 | rate-limit | Bloquea al superar `max` en la ventana (429 + Retry-After) | Fuerza bruta de magic-link | unit | S |
| T-046 | P2 | rate-limit | Resetea al expirar la ventana | Bloqueo permanente de un usuario | unit | S |
| T-047 | P2 | rate-limit | Aísla por (ruta + IP) [+ keyFn] | Limita a quien no toca | unit | S |
| T-048 | P2 | standing.loader | Upsert de clasificación con `group_name` en la clave | Duplica/pisa grupos | int | M |
| T-049 | P2 | standing.loader | La columna generada `goal_diff` no se inserta | Falla el INSERT en enrich | int | S |
| T-050 | P2 | transformers | `competition.transformer` infiere género (+ warning si no) | Competición mal clasificada | unit | S |
| T-051 | P2 | transformers | `competition.transformer` infiere categoría (senior/juvenil/…) | Categoría perdida | unit | S |
| T-052 | P2 | transformers | `team.transformer` genera slug y avisa si falta ciudad | Equipo sin slug | unit | S |
| T-053 | P2 | transformers | `slugify`: diacríticos/ñ, límite 100, `uniqueSlug` ante colisión | Slugs colisionan (identidad) | unit | S |
| T-054 | P2 | db/queries | `getMatchesBySeason`: ventana y orden | Home vacía / desordenada | int | M |
| T-055 | P3 | sidgad-client | Warm-up de sesión y reutilización de cookie (fetch mock) | POSTs sin sesión fallan | unit | M |
| T-056 | P3 | sidgad-client | Reintentos con backoff ante 5xx/timeout | Scrape frágil ante fallo puntual | unit | M |
| T-057 | P3 | worldskate | Parser de acta/alineaciones de selección (fixture) | Europeos rotos en silencio | unit | M |
| T-058 | P1 | infra/CI | Endurecer: quitar `--passWithNoTests` y/o umbral de cobertura mínimo | Módulos nuevos sin test siguen en verde | unit | S |

---

## D. Primeros tests recomendados (5–10)

Antes de T-001: resolver el conflicto de merge de `enrich-promote.ts` (hecho el 2026-09-24).

Orden para arrancar, por riesgo × impacto × automatismo:

1. **T-009 (Stripe, firma inválida)** — barato y de máxima gravedad.
2. **T-010 (Stripe, idempotencia)** — el webhook es automático y Stripe reintenta.
3. **T-011 (Stripe, activación de premium)** — el camino feliz del dinero.
4. **T-014 (auth, `verifyState` HMAC)** — unitario puro, cierra el CSRF de login.
5. **T-017 (auth, magic link de un solo uso)** — base del modelo de acceso.
6. **T-005 (enrich, lista blanca)** — la única pieza que escribe prod nativo.
7. **T-006 (enrich, idempotencia)** — hace segura la operación.
8. **T-023 (match.loader, adopción de sintético)** — corre cada 45 s; origen de duplicados.
9. **T-035 + T-032 (push: silencio nocturno + no-spam)** — los dos fallos más visibles.
10. **T-058 (CI, endurecer)** — que la disciplina la sostenga el pipeline.

---

## E. Estrategia

**No persigas un porcentaje.** El objetivo es proteger comportamiento de riesgo. Meta realista: cerrar P0 y P1, dejar P2/P3 como cobertura oportunista.

**Trabaja por olas, no por módulos enteros.** Cada T-xxx es una unidad ejecutable en RED → GREEN → REFACTOR, uno a uno.

**Regla nueva:** todo módulo nuevo o corrección de bug empieza por un test que falla. Para que no dependa de la voluntad, T-058 (quitar `--passWithNoTests`) lo sostiene en CI.

**Orden de ataque:**
1. Desbloquear (merge) + primeros P0 pequeños (Stripe/auth puros).
2. P0 de integración (enrich-promote, match.loader).
3. P1 (push, derive-results, parsers FEP, rate-limit).
4. Endurecer el CI (T-058).
5. P2/P3 según se toque cada zona.

Aprovechar las factorías de `tests/integration/support/` y el patrón pura/E-S de `push-diff.ts` (extraer decisión pura → test unitario, dejar la E/S fina).

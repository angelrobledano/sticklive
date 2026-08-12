# A4 — Scraping masivo a staging antes de prod

*Diseño (ADR) · 12 de agosto de 2026*

## Contexto

Todo el scraping masivo —el volcado histórico, los re-scrapes, `import-history`, `import-federations`, `import-history-fichas`, backfills— se lanza hoy desde el portátil por el túnel SSH y escribe **directo en la base de producción** (`sports_results`). No hay red de seguridad: un scrape con refs de equipo que no casan, actas duplicadas o un stream de eventos que no cuadra con el marcador entra en prod y hay que limpiarlo a mano después (pasó en la prueba de re-scrape de la 23/24: duplicados, avalancha en la cola HITL, equipos huérfanos). Es el riesgo que la filosofía del proyecto —"los malos datos son peores que no tener datos"— quiere justamente evitar. La auditoría de arquitectura lo marca como inversión #1.

## Decisión

Una **base de datos de staging en el mismo host**, `sports_staging`, dentro del mismo contenedor Postgres. El scraping escribe primero ahí; se valida con los mismos controles de calidad que ya usamos; y solo lo que pasa la validación se **promociona** a prod por `source_ref`, de forma idempotente y transaccional, reusando el andamiaje de `import_batches`.

Se descartó el entorno de staging completo (BD+API+web+ETL) por coste/ops en un host pequeño, y el esquema `staging` dentro de la misma BD por aislamiento débil (una instancia compartida). La BD aparte en la misma instancia da el 90% del aislamiento al 10% del coste: prod nunca ve el dato en bruto, y el túnel/credenciales/imagen no cambian.

## Por qué encaja con lo que ya hay

El túnel SSH ya expone `localhost:5432` contra esa instancia Postgres. Apuntar a staging es cambiar el nombre de BD en `DATABASE_URL` (`…/sports_staging` en vez de `…/sports_results`) — mismo túnel, mismo puerto, misma password por `PGPASSWORD`. Y ya tenemos las tres piezas que hacen viable la promoción: dedup por `source_ref` (índice único, migración 002), el registro de lotes `import_batches` (048) con `event_coverage` para trazar y revertir, y el embudo de resolución de entidades (`source_entity_map`, `team_aliases` en 045, `resolution_queue` en 046).

## Arquitectura y flujo

El ciclo de una corrida de scraping masivo queda así:

1. **Sembrar staging desde prod.** Antes de cada corrida, `pg_dump` de prod → `psql` a `sports_staging`, recreando la BD desde cero. Se restauran con **los mismos UUID** las tablas de referencia (sports, data_sources, competitions, seasons, teams, source_entity_map, team_aliases) — o el dump completo, que en esta BD es barato. Esto consigue dos cosas: la resolución de refs y el dedup se comportan **exactamente como en prod**, y como los UUID coinciden, la promoción es un copiado directo sin remapear ids. Staging es desechable: se recrea en cada corrida, así que nunca deriva de prod.

2. **Scrapear/importar contra staging.** Los `import-*` corren desde el portátil igual que hoy, pero con `DATABASE_URL` apuntando a `sports_staging`. Los equipos y partidos nuevos (y sus eventos) aterrizan solo en staging, bajo un `import_batch`.

3. **Validar.** Un `validate-staging.ts` corre la batería de QA que ya conocemos y emite un informe con veredicto PASA/FALLA: actas duplicadas entre partidos terminados, marcadores negativos o imposibles, auto-partidos (local == visitante), equipos sin resolver / huérfanos, tamaño de la `resolution_queue` (avalancha HITL), y desajuste `event_coverage` vs marcador. Nada se promociona si el veredicto no es PASA.

4. **Promocionar a prod.** Un `promote-to-prod.ts` toma el/los `import_batch` que pasaron y, en **una transacción**, inserta en prod los equipos nuevos (por `source_ref`) y luego los partidos/eventos nuevos (por `source_ref`, `ON CONFLICT DO NOTHING`) — las mismas guardas "prod manda" del importador del volcado. Registra la promoción en `import_batches` (p. ej. `status='promoted'`, con el timestamp y las estadísticas). Como staging se sembró con los UUID de prod, las FK de entidad mapean 1:1 y las entidades nuevas conservan su UUID al pasar.

5. **Descartar.** Terminada la promoción, staging se puede tirar; la próxima corrida vuelve a sembrarse fresco de prod.

## Invariantes que hay que preservar

**Prod manda, siempre.** La promoción nunca sobrescribe un dato nativo de prod: dedup por `source_ref` y `ON CONFLICT DO NOTHING`, igual que en el volcado. **Idempotente:** promocionar dos veces el mismo lote no duplica nada. **Reversible:** todo lo promocionado cuelga de su `import_batch`, así que se revierte en prod por lote (`DELETE … WHERE import_batch_id = …`). **Trazable:** el informe de validación se archiva junto al lote.

## Riesgo asumido

Staging comparte la instancia Postgres con prod, así que un scrape desbocado podría estresar la instancia (CPU/IO/disco). Mitigaciones: `statement_timeout` en el rol de staging, y vigilar disco antes de sembrar (el dump duplica temporalmente el tamaño de la BD). Es la contrapartida aceptada frente a una instancia separada; si algún día el scraping crece mucho, la migración natural es mover `sports_staging` a su propia instancia sin tocar el flujo.

## Piezas a construir

- **`sports_staging`**: creación de la BD + rol con `statement_timeout`; paridad de esquema vía el dump de siembra (no hace falta correr migraciones aparte si se siembra el dump completo).
- **`deploy/seed-staging.sh`**: recrea `sports_staging` desde un `pg_dump` de prod. Se lanza en el servidor (no viaja por el túnel).
- **`apps/etl/src/validate-staging.ts`**: batería de QA → informe + veredicto. Reusa las consultas que ya escribimos para el volcado.
- **`apps/etl/src/promote-to-prod.ts`**: promoción transaccional por `import_batch`, con las guardas de dedup.
- **Runbook**: sección en `docs/RUNBOOK_COMPETICIONES.md` + `docs/DEPLOY.md` con el ciclo sembrar → scrapear(staging) → validar → promover, y el recordatorio de que `DATABASE_URL` apunta a `sports_staging` en los pasos de scraping.

## Ticket

**Contexto:** el scraping masivo escribe directo en prod; sin validación previa, los malos datos entran y hay que limpiarlos a mano. Se quiere una BD de staging en el mismo host donde validar antes de promover.

**Solución propuesta:** BD `sports_staging` en el mismo Postgres; ciclo sembrar-desde-prod → scrapear contra staging → `validate-staging` (veredicto PASA/FALLA) → `promote-to-prod` (idempotente, transaccional, por `source_ref` y `import_batch`). Detalle arriba.

**Criterios de aceptación:**

1. Existe `sports_staging` en el host, con rol propio y `statement_timeout`, sembrable desde prod con un solo comando (`deploy/seed-staging.sh`) que recrea la BD con esquema y datos de referencia idénticos (mismos UUID).
2. Un `import-*` lanzado con `DATABASE_URL→sports_staging` no toca `sports_results` en absoluto (verificable: conteos de prod inalterados durante y después del scrape).
3. `validate-staging.ts` emite un informe con veredicto y falla (exit ≠ 0) si hay actas duplicadas, marcadores imposibles, auto-partidos, equipos sin resolver por encima de un umbral, o avalancha HITL.
4. `promote-to-prod.ts` promociona solo lotes con veredicto PASA; es idempotente (re-ejecutar no duplica), transaccional (todo o nada), preserva "prod manda" (no sobrescribe nativos) y deja el lote marcado como promocionado.
5. Revertir una promoción en prod es un `DELETE … WHERE import_batch_id = …` documentado.
6. Runbook actualizado con el ciclo completo.

**Estimación:** ~4–5 días de trabajo, faseable:
- Fase 1 — `sports_staging` + `seed-staging.sh` + paridad de esquema (~1 día).
- Fase 2 — `validate-staging.ts` reusando la QA del volcado (~1 día).
- Fase 3 — `promote-to-prod.ts` transaccional + idempotente (~1,5 días).
- Fase 4 — runbook + corrida end-to-end de prueba con el próximo re-scrape (~0,5–1 día).

**Fuera de alcance:** entorno de staging completo (API/web), Postgres gestionado o réplica — quedan como pasos posteriores de la misma línea de inversión de la auditoría de arquitectura.

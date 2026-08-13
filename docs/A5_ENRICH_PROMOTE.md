# A5 — Enrich-promote: recuperar fechas y temporadas del histórico

*Diseño (ADR) · 13 de agosto de 2026*

## Contexto

El volcado histórico (migración 048, `import-volcado`) metió en producción todo el archivo RFEP como **solo marcador**: los partidos viven en una temporada colapsada `'Histórico'` con `scheduled_at = NULL` y `event_coverage = 'none'`. No hay fecha, no hay temporada real, no hay acta. El backlog de calidad pide recuperar eso: darle a cada partido su fecha y su temporada (2022/23, 2021/22, …) para que la ficha, el calendario de equipo y las clasificaciones por temporada dejen de estar vacíos para el pasado.

A4 (BD de staging + `promote-to-prod`) montó el ciclo seguro `sembrar → scrapear(staging) → validar → promover`, y A4-import-history-batch (#114) hizo que `import-history` etiquete sus altas con un `import_batch` para poder promoverlas. Pero **A4 es add-only**: promociona por `source_ref` con `ON CONFLICT DO NOTHING` y su invariante es "prod manda" — nunca sobrescribe un dato nativo. Eso es exactamente lo correcto para altas nuevas, y exactamente lo que impide recuperar el histórico.

## Evidencia (piloto de re-scrape 2022/23, idc 2092)

Se sembró staging de prod, se re-scrapeó la OK Liga masculina 2022/23 y se validó (PASA). El diagnóstico contra ambas BDs fue concluyente:

| | temporada | partidos | con fecha |
|---|---|---|---|
| **PROD** | Histórico | 182 | **0** |
| **STAGING** | Histórico | 182 | **182** |

El re-scrape **sí recuperó las 182 fechas** — en staging están —, pero:

1. Los partidos ya existen en prod con el mismo `source_ref`, así que `upsertMatch` entró por `ON CONFLICT DO UPDATE`, **no** por INSERT. Como #114 solo etiqueta los INSERT, esos 182 **no** llevan `import_batch_id` → `promote-to-prod` los ve como 0 candidatos. El dry-run promovió 0.
2. El `upsert` casa por `source_ref` y **no reasigna `season_id`**: los 182 siguen en `'Histórico'` incluso en staging, no se movieron a la 2022/23 real (que quedó creada pero vacía).

Conclusión: recuperar fecha/temporada de un partido que ya está en el `'Histórico'` colapsado **no es un alta, es un `UPDATE`** de una fila nativa de prod (fijar `scheduled_at` y reasignar `season_id`). A4 se diseñó para no hacer eso. Hace falta una pieza aparte, con su propia red de seguridad.

## Decisión

Una operación **enrich-promote** separada de la promoción de altas, que aplica a producción un conjunto **acotado y validado** de cambios sobre filas que ya existen, casadas por `source_ref`:

- **Campos que toca (lista blanca cerrada):** `scheduled_at` (fecha recuperada) y `season_id` (reasignación de `'Histórico'` a la temporada real). Nada más: marcador, equipos, estado y `source_ref` siguen siendo intocables — para esos, prod manda.
- **Dirección única:** solo saca partidos de la temporada colapsada `'Histórico'` hacia su temporada real; nunca al revés, nunca entre temporadas reales.
- **Reversible por lote:** cada cambio guarda el valor anterior, así que revertir restaura exactamente el estado previo.
- **Transaccional e idempotente:** todo o nada; re-ejecutar no produce cambios nuevos.

Se descarta "borrar el Histórico y re-scrapear todo como altas nuevas": perdería los partidos cuya acta ya no está en la fuente (el volcado es la única copia de mucho archivo), y viola "los malos datos son peores que no tener datos". Enrich preserva el marcador oficial del volcado y solo le añade la fecha y la temporada.

## Por qué encaja con lo que ya hay

Reusa todo el andamiaje de A4: la BD `sports_staging` sembrada de prod con los mismos UUID, el ciclo por el túnel SSH, y el registro `import_batches` (aquí con `kind='enrich'`) para trazar y revertir. La resolución de entidades no cambia (los equipos ya existen). La única capacidad nueva es un `UPDATE` guardado sobre prod para dos columnas.

## Arquitectura y flujo

1. **Sembrar staging desde prod** — igual que A4 (`seed-staging.sh`).

2. **Enrich-scrape contra staging.** Un modo del scraper que, para el ámbito pedido (una temporada real, p. ej. idc 2092 → 2022/23), en vez de dejar el partido en `'Histórico'`, **actualiza la fila existente** (casada por `source_ref`) fijando `scheduled_at` y **reasignando `season_id`** a la temporada real (creándola en staging si no existe). Es un `upsert` en modo enrich: en el `ON CONFLICT` sí toca `season_id`/`scheduled_at`, al contrario que el camino normal. Deja el conjunto trazado (un `import_batch` `kind='enrich'`, marcando las filas movidas).

3. **Validar (validate-enrich).** Batería específica, veredicto PASA/FALLA (exit ≠ 0 corta): (a) todos los partidos del lote salen de `'Histórico'` y no de otra temporada; (b) el destino es la temporada real correcta (misma competición, slug de año coherente con la fecha); (c) tras el move no quedan colisiones de fecha en la temporada destino (mismo local/visitante/día); (d) el marcador y los equipos no cambian respecto a prod (solo fecha/temporada). Reusa las guardas de `validate-staging` que apliquen.

4. **Enrich-promote a prod (dry-run por defecto).** Por cada partido del lote, en **una transacción**: crea la temporada real en prod si falta (mismo UUID que staging), guarda `(match_id, season_id_anterior, scheduled_at_anterior)` en un registro de cambios, y aplica el `UPDATE matches SET season_id=…, scheduled_at=… WHERE id=…`. Informe con conteos. Marca el `import_batch` `promoted`.

5. **Descartar staging.** La próxima corrida se siembra fresca.

## Invariantes que preservar

- **Lista blanca de columnas.** El `UPDATE` solo puede tocar `season_id` y `scheduled_at`. Cualquier otra diferencia staging↔prod se ignora. Esto se verifica en el propio SQL (no un `UPDATE *`).
- **Solo desde 'Histórico'.** El enrich nunca mueve un partido que ya está en una temporada real. Guarda dura antes de escribir.
- **Reversible al valor exacto.** El registro de cambios permite `UPDATE … SET season_id=old, scheduled_at=old WHERE id=…` por lote. Nada de "volver a NULL a ciegas".
- **Idempotente.** Si `scheduled_at`/`season_id` de prod ya coinciden con staging, el partido no entra en el lote.
- **Trazable.** El informe de validación y las estadísticas del lote se archivan junto al `import_batch`.

## Riesgo asumido

Es la primera pieza del proyecto que **escribe sobre filas nativas de prod**, así que el listón de seguridad sube: lista blanca de columnas a nivel de SQL, dry-run por defecto, dirección única (solo saca de 'Histórico'), y revert por lote con valores anteriores guardados. El fallo a evitar es reasignar un partido a la temporada equivocada (p. ej. si dos temporadas comparten `source_ref` por un bug de la fuente); lo cubre la guarda (c) de validación y el hecho de acotar cada corrida a un `idc`/temporada.

## Piezas a construir

- **Migración**: permitir `kind='enrich'` en `import_batches` (el CHECK actual solo acepta `historic|backfill|manual`) y crear `enrich_changes (batch_id, match_id, old_season_id, old_scheduled_at)` para el revert.
- **Modo enrich del scraper/loader**: `upsertMatch` (o variante) que en el ámbito enrich reasigne `season_id` + `scheduled_at` en el `ON CONFLICT`, y marque el lote.
- **`apps/etl/src/validate-enrich.ts`**: batería específica → informe + veredicto.
- **`apps/etl/src/enrich-promote.ts`**: `UPDATE` transaccional por `source_ref`, lista blanca de columnas, registro de cambios para revert, dry-run por defecto.
- **Runbook**: sección con el ciclo enrich y la corrida real (empezando por 2022/23, idc 2092, cuyas 182 fechas ya están recuperadas en staging).

## Ticket

**Contexto:** el volcado dejó el archivo histórico en prod sin fecha ni temporada (colapsado en 'Histórico'). El re-scrape recupera esas fechas en staging, pero A4 (add-only, "prod manda") no puede llevarlas a prod porque es un `UPDATE` de filas nativas, no un alta.

**Solución propuesta:** una promoción `enrich` acotada — lista blanca de columnas (`scheduled_at`, `season_id`), dirección única (solo sacar de 'Histórico'), transaccional, idempotente y reversible por lote — que aplica a prod las fechas/temporadas validadas en staging.

**Criterios de aceptación:**

1. Existe `kind='enrich'` en `import_batches` y una tabla `enrich_changes` que permite revertir al valor exacto anterior.
2. El enrich-scrape deja en staging los partidos del ámbito movidos a su temporada real con su fecha, trazados bajo un `import_batch` `kind='enrich'`, sin tocar marcador ni equipos.
3. `validate-enrich` falla (exit ≠ 0) si algún partido del lote no venía de 'Histórico', si el destino no es la temporada real coherente con la fecha, si aparecen colisiones de fecha tras el move, o si cambió el marcador.
4. `enrich-promote` solo modifica `season_id` y `scheduled_at` (verificable en el SQL), es transaccional, idempotente, y deja el lote y el registro de cambios para revertir.
5. Revertir una corrida es un comando documentado que restaura `season_id`/`scheduled_at` anteriores por lote.
6. Corrida real de 2022/23 (idc 2092) aplicada y verificada en la web: la ficha de esos partidos muestra fecha y la temporada 2022/23 aparece poblada.

**Estimación:** ~3–4 días, faseable:
- Fase 1 — migración (`kind='enrich'` + `enrich_changes`) + modo enrich del loader (~1 día).
- Fase 2 — `validate-enrich` (~1 día).
- Fase 3 — `enrich-promote` transaccional + revert (~1–1,5 días).
- Fase 4 — runbook + corrida real 2022/23 (~0,5 día).

**Fuera de alcance:** recuperar actas/eventos del histórico (el volcado es solo marcador; las actas antiguas que la fuente ya no sirve no se recuperan por esta vía), y mover partidos entre temporadas reales. Enrich solo saca del 'Histórico' colapsado.

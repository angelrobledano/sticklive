# Volcado histórico — archivo all-time del núcleo (v1)

*Actualizado: 11 de agosto de 2026*

Importación única del histórico de competiciones **núcleo** de la RFEP (OK Liga
M/F, Plata, Bronce, Copas, Supercopas y Campeonatos de Selecciones) a partir del
`pg_dump` anterior al vaciado del 16/06. Enfoque de **calidad de dato sobre
volumen**: se importa solo lo fiable.

## Qué entra y qué no

**Entra:** el **resultado** (marcador) de 8.828 partidos únicos, en 18
competiciones canónicas, con sus equipos resueltos contra los de producción.

**No entra, y por qué:**

- **Eventos / estadística de jugador.** El stream de eventos del dump no cuadra
  con el marcador en el 83% de los partidos terminados (86% sin jugador, 67% sin
  equipo). Cada partido entra con `event_coverage='none'`: solo marcador. La
  UI no debe mostrar timeline en estos partidos.
- **Temporada / fecha.** La dimensión temporal del dump no es fiable: la
  correlación entre el nº de acta (cronológico) y `scheduled_at` es 0,62, y un
  40%+ de los partidos viejos están re-fechados a 2021-22. Por eso **no se
  asigna temporada**: cada competición cuelga de una única temporada
  `Histórico` y `scheduled_at` queda `NULL`. Recuperar la temporada real es una
  fase posterior (re-scraping de actas por id).
- **Cantera, regional y MiniCopas.** Fuera de v1 por decisión de alcance.

## Principios

- **Prod manda.** Los equipos se deduplican por `source_ref` (mismos ids FEP que
  prod), así que se enganchan a los equipos existentes; solo se crean los clubes
  antiguos que ya no están. Cada partido lleva guarda `NOT EXISTS` contra
  `matches.source_ref` de prod: nunca se reimporta lo que prod ya tiene (p. ej.
  la temporada 2025/26 actual).
- **Trazable y reversible.** Todo cuelga de un `import_batch` (kind='historic') y
  de la `data_source` `historic_dump`. Revertir:

  ```sql
  DELETE FROM matches WHERE import_batch_id = '<batch>';
  UPDATE import_batches SET status='reverted' WHERE id = '<batch>';
  ```

- **Idempotente.** `ON CONFLICT DO NOTHING` en todo; se puede relanzar.

## Competiciones nuevas que crea (el resto se reutilizan de prod)

`primera-division-nacional` (2º nivel masc. ≤2017-18, nombre histórico),
`ok-liga-plata` (grupo único pre-split), y los dos `cto-espana-selecciones-*`.
El resto mapea por slug a competiciones ya existentes en producción.

## Cómo ejecutarlo

**Requisito previo:** la migración **048** (columnas `event_coverage`,
`import_batch_id` y tabla `import_batches`) tiene que estar **desplegada en
prod**. Sin ella el importador falla.

Se lanza desde el portátil por el túnel SSH contra prod (como el resto de
`import-*`, ver `DEPLOY.md`). **Antes, backup:** `./deploy/backup-db.sh`.

```bash
cd apps/etl
# 1) Ensayo: cuenta cuántos partidos entrarían y cuántos ya están en prod.
npx tsx --env-file=../../.env src/import-volcado.ts --dry-run
# 2) Import real.
npx tsx --env-file=../../.env src/import-volcado.ts
```

El payload curado vive en `data/volcado-nucleo.json` (generado y validado en
staging: 0 duplicados de acta, 0 marcadores negativos, 0 auto-partidos).

## Pendiente para fases siguientes

- Fusiones semánticas de club (patrocinadores: *Generali Palau = Palau*) como
  capa de `team_aliases` sobre lo importado — hoja de decisiones ya revisada.
- 2º nivel femenino pre-2020-21 (~110 partidos): existe en el dump bajo el
  nombre retroactivo "OK Liga Plata Femenina"; su nombre histórico real está por
  confirmar en la RFEP antes de importarlo.
- Reconstrucción de fechas/temporadas por re-scraping de actas.

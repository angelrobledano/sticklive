# Volcado hist√≥rico ‚Äî archivo all-time del n√∫cleo (v1)

*Actualizado: 11 de agosto de 2026*
*Estado: **importaci√≥n v1 completada en producci√≥n** (solo marcadores). La recuperaci√≥n de fechas/temporadas est√° en curso v√≠a enrich-promote ([A5_ENRICH_PROMOTE.md](./A5_ENRICH_PROMOTE.md)).*

Importaci√≥n √∫nica del hist√≥rico de competiciones **n√∫cleo** de la RFEP (OK Liga
M/F, Plata, Bronce, Copas, Supercopas y Campeonatos de Selecciones) a partir del
`pg_dump` anterior al vaciado del 16/06. Enfoque de **calidad de dato sobre
volumen**: se importa solo lo fiable.

## Qu√© entra y qu√© no

**Entra:** el **resultado** (marcador) de 8.828 partidos √∫nicos, en 18
competiciones can√≥nicas, con sus equipos resueltos contra los de producci√≥n.

**No entra, y por qu√©:**

- **Eventos / estad√≠stica de jugador.** El stream de eventos del dump no cuadra
  con el marcador en el 83% de los partidos terminados (86% sin jugador, 67% sin
  equipo). Cada partido entra con `event_coverage='none'`: solo marcador. La
  UI no debe mostrar timeline en estos partidos.
- **Temporada / fecha.** La dimensi√≥n temporal del dump no es fiable: la
  correlaci√≥n entre el n¬∫ de acta (cronol√≥gico) y `scheduled_at` es 0,62, y un
  40%+ de los partidos viejos est√°n re-fechados a 2021-22. Por eso **no se
  asigna temporada**: cada competici√≥n cuelga de una √∫nica temporada
  `Hist√≥rico` y `scheduled_at` queda `NULL`. Recuperar la temporada real es una
  fase posterior (re-scraping de actas por id).
- **Cantera, regional y MiniCopas.** Fuera de v1 por decisi√≥n de alcance.

## Principios

- **Prod manda.** Los equipos se deduplican por `source_ref` (mismos ids FEP que
  prod), as√≠ que se enganchan a los equipos existentes; solo se crean los clubes
  antiguos que ya no est√°n. Cada partido lleva guarda `NOT EXISTS` contra
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

`primera-division-nacional` (2¬∫ nivel masc. ‚â§2017-18, nombre hist√≥rico),
`ok-liga-plata` (grupo √∫nico pre-split), y los dos `cto-espana-selecciones-*`.
El resto mapea por slug a competiciones ya existentes en producci√≥n.

## C√≥mo ejecutarlo

**Requisito previo:** la migraci√≥n **048** (columnas `event_coverage`,
`import_batch_id` y tabla `import_batches`) tiene que estar **desplegada en
prod**. Sin ella el importador falla.

Se lanza desde el port√°til por el t√∫nel SSH contra prod (como el resto de
`import-*`, ver `DEPLOY.md`). **Antes, backup:** `./deploy/backup-db.sh`.

```bash
cd apps/etl
# 1) Ensayo: cuenta cu√°ntos partidos entrar√≠an y cu√°ntos ya est√°n en prod.
npx tsx --env-file=../../.env src/import-volcado.ts --dry-run
# 2) Import real.
npx tsx --env-file=../../.env src/import-volcado.ts
```

El payload curado vive en `data/volcado-nucleo.json` (generado y validado en
staging: 0 duplicados de acta, 0 marcadores negativos, 0 auto-partidos).

## Pendiente para fases siguientes

- Fusiones sem√°nticas de club (patrocinadores: *Generali Palau = Palau*) como
  capa de `team_aliases` sobre lo importado ‚Äî hoja de decisiones ya revisada.
- 2¬∫ nivel femenino pre-2020-21 (~110 partidos): existe en el dump bajo el
  nombre retroactivo "OK Liga Plata Femenina"; su nombre hist√≥rico real est√° por
  confirmar en la RFEP antes de importarlo.
- Reconstrucci√≥n de fechas/temporadas por re-scraping de actas.

---

## DECISI”N (30/09/2026) ó estrategia del archivo pre-2017 (#235)

**DecisiÛn: opciÛn B ó el archivo pre-2017 NO se importa como partidos.** El
`data/volcado-nucleo.json` queda como ARCHIVO fuera de la base (no como fuente
del producto), y la ˙nica vÌa de entrada futura de ese contenido es la
recuperaciÛn por re-scrape contra sidgad (opciÛn c) con las herramientas del
re-fichas (#232), bajo `import_batches kind='historic'`.

Razones, con los n˙meros de la re-auditorÌa del 30/09 (#237):

1. **El volcado es una proyecciÛn del dump, no dato nuevo**: 8.767/8.828 refs
   (99,3%) YA existen en la base con fecha real (cubos 2017+). Importarlo
   fabricarÌa duplicados o forzarÌa reconciliaciÛn contra el propio enrich.
2. **Sin fecha fiable por diseÒo** (meta del propio volcado: "Fechas no
   fiables ? no se importan"): 8.828 partidos sin `scheduled_at` romperÌan las
   invariantes que hoy sostenemos (ventana de temporada #229, particionado 047,
   check de integridad #231) y la guarda #229 los rechazarÌa en el loader.
3. **La cobertura real del producto ya est·**: la re-auditorÌa (#237) da 0
   partidos fuera de ventana, 26/1.226 marcadores discrepantes (9
   administrativos) y el bloque NO-GO del histÛrico nacional resuelto.
4. Las temporadas pre-2017 sembradas con 0 partidos permanecen visibles como
   est·n (sin inventar contenido).

**Las 61 refs ausentes (0,7%)**: quedan investigadas como parte de la
debida diligencia de CUALQUIER futuro re-scrape ó hasta entonces el JSON no se
usa como fuente, asÌ que su origen (diferencia de snapshot vs borrado) no
bloquea nada. Si alg˙n dÌa se retoma la opciÛn c, la investigaciÛn es el paso 0
del plan y el import ser· add-only bajo lote (`048`), reversible, sin pisar
nativos.

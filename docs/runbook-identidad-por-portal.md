# Runbook — identidad por portal, clubes y fases de clasificación

Despliegue de las mejoras A1–A7 del [análisis OKMob](./ANALISIS_OKMOB_MODELO_DATOS_2026-10-22.md). Orden obligatorio: cada paso depende del anterior.

## Qué cambia

| Mejora | Qué hace | Dónde |
|---|---|---|
| A1 | Refs de jugador, partido, competición y club con el portal sidgad (`fecapa_player_`, `wse_player_`, `fecapa_match_`…). RFEP conserva `fep_`. Un `SourceDef` por federación autonómica. | `core/sources.ts`, parser y scrapers de ficha, calendario y directo, migración 081 |
| A2 | Separa a las personas fusionadas por colisión de ids entre portales | `apps/etl/src/split-merged-players.ts` |
| A3 | Quita la licencia (`OKL`, `JUNU`, `NACC`) que FECAPA mete en el nombre. Fotos del CDN del portal correcto | `fep-ficha.parser.ts`, `player-photo-url.ts` |
| A4 | Cada equipo cuelga de un club identificado por el escudo sidgad (id de club). Backfill y relleno de género/categoría | `ensureClubForTeam`, `backfill-clubs-by-crest.ts`, seed |
| A5 | La ref de inscripción (`teamId` sidgad) vive en `season_teams.source_ref`, y el resolver la usa primero | migración 082, `RefResolver` |
| A6 | Sin cambios: `replaceMatchEvents` ya borraba los eventos que el acta deja de listar (test `borra los eventos que el acta ya no lista`) | — |
| A7 | `standings.phase_id`: dos liguillas de una temporada ya no se pisan. Sin fase indicada, la API sirve la última | migración 083, `standing.loader.ts`, `getStandings` |

## Pasos en producción

1. **Backup.** La 081 reescribe refs.
   ```bash
   ./deploy/backup-db.sh
   ```
2. **Desplegar y migrar** (081, 082, 083). La 081 termina con `SELECT * FROM apply_portal_namespacing()` y deja en el log cuántos jugadores, partidos, alineaciones y competiciones renombró y cuántos jugadores quedan en varios portales (`players_mixed`).
3. **Separar jugadores fusionados (A2).** Primero en seco, revisar la lista, después aplicar.
   ```bash
   $DC exec etl node dist/apps/etl/src/split-merged-players.js
   $DC exec etl node dist/apps/etl/src/split-merged-players.js --write
   ```
   Después, `SELECT * FROM apply_portal_namespacing()` debe dar `players_mixed = 0`.
4. **Clubes por escudo y género/categoría (A4).** En seco, revisar los grupos con varios equipos y los candidatos a fusión de clubes (un escudo genérico compartido agruparía mal).
   ```bash
   $DC exec etl node dist/apps/etl/src/backfill-clubs-by-crest.js
   $DC exec etl node dist/apps/etl/src/backfill-clubs-by-crest.js --write
   # solo tras revisar los candidatos:
   $DC exec etl node dist/apps/etl/src/backfill-clubs-by-crest.js --write --merge-clubs
   ```
5. **Fotos.** Recalcular con la carpeta del portal correcto.
   ```bash
   $DC exec etl node dist/apps/etl/src/update-player-photos.js
   ```
6. **Re-procesar fichas FECAPA** para que los nombres pierdan la licencia: los jugadores ya creados conservan el apellido con `OKL` hasta que una ficha los vuelva a pasar por `fixPlayerNameSplit`. Con `SIDGAD_PORTAL=fecapa`, `run-pipeline --entity=refichas` sobre la temporada de la Lliga Catalana.

## Verificación

Las consultas V1 y V2 del análisis (§12) deben devolver 0 filas. La V3 solo grupos con un club.

```sql
SELECT * FROM apply_portal_namespacing();        -- todo 0 en una segunda pasada
SELECT count(*) FROM teams WHERE club_id IS NULL AND logo_url LIKE '%logos_clubes/%';
SELECT season_id, count(*) FROM season_teams WHERE source_ref IS NOT NULL GROUP BY 1;
```

## Altas nuevas

Las federaciones autonómicas ya tienen fuente propia: el seed y los scrapers toman el portal de `SIDGAD_PORTAL` y sus refs nacen con él. Un portal que no esté en `core/sources.ts` falla al arrancar en vez de cargarse como RFEP.

## Reversión

- 082 y 083 son aditivas (columnas e índices). Revertir el código basta, salvo que la segunda fase de una competición ya haya escrito filas con `phase_id`: en ese caso `getStandings` antiguo mostraría las dos tablas mezcladas, así que no se revierte código sin revertir datos de `standings`.
- 081 y A2 reescriben datos: restaurar el backup del paso 1.

# Alta FECAPA — «Lliga Catalana» 2026/27 (idc 4858)

Fecha: 2026-10-19 · Fuente: `https://www.server2.sidgad.es/fecapa` (portal `fecapa`) · Página pública:
`https://www.hoqueipatins.fecapa.cat/?idc=4858`

## Formato entendido (verificado contra la fuente)

- **12 equipos**, temporada `temp_41` = **2026/27**, organiza **FECAPA**, ámbito regional (Cataluña).
- **Fase de grupos** (`content_fase_4859`): 3 grupos de 4 (A, B, C), una sola vuelta de **3 jornadas**
  (18 partidos). Clasificación por grupo en la misma respuesta de `clasif`.
- **Fase final** (`content_fase_5093`): **semifinales y final** a partido único.
  Los semifinalistas son los 3 primeros de grupo + el mejor segundo:
  Igualada (A1) – Calafell (C1) y Barça (B1) – Voltregà (B2).
- **Resultados reales cargados desde las actas**:
  - Semifinal 1: Igualada 2–2 Calafell → **Calafell gana 0–1 en penaltis** (`gr_164289`).
  - Semifinal 2: Barça 5–0 Voltregà (`gr_164290`).
  - **Final: Calafell 0–1 Barça** (`gr_164291`), campeón **Barça**.
- El calendario **no publica el `idp` de la final** (la fila no tiene enlace de acta); el acta sí
  existe en `fecapa_gr_164291_1.php`. Se cargó con el scraper de ficha apuntando al portal `fecapa`
  y se creó el partido real con `source_ref=fep_match_164291` para que futuros pases no lo traten
  como placeholder.
- Un partido de la jornada 3 (CH Lloret – PAS Alcoi) tampoco tiene `idp`/resultado: la fuente no lo
  jugó/publicó (ambos equipos constan con 2 partidos en la clasificación). Se descarta como
  placeholder de liga.

## Cambios de código necesarios (ya incluidos)

| Área | Cambio |
|---|---|
| `packages/shared-types` | `parsePhaseTitle` reconoce **«GRUPS»** (catalán) como fase de grupos y **«FASES FINALS»** como eliminatoria. Antes la fase de grupos caía a `league`. |
| `fep-standings.scraper` | Lee también `table.tabla_standard` (FECAPA no usa `tabla_clasif`). Extrae el grupo de la cabecera de cada tabla («GRUPO GRUP A» → `A`), ignora la tabla de la fase final y conserva el CDN del portal en los escudos. |
| `match.loader` / `reconcileSyntheticMatches` | No descarta un cruce **de eliminatoria** sin `idp` con fecha pasada: la final debe seguir en el cuadro. |
| `import-history` | El CDN de escudos usa `SIDGAD_PORTAL` (antes hardcodeaba `rfep`). |
| `import-federations` | Nuevo `--only-idc=` para sembrar/cargar una sola competición del catálogo. |

## Alta en producción (staging → prod)

Requisitos: túnel SSH abierto, `DATABASE_URL`/`STAGING_URL`/`PROD_URL`, `SIDGAD_PORTAL=fecapa`,
`SIDGAD_REFERER=https://www.fecapa.cat/`, `FEP_SOURCE_ID` = id real de `data_sources.fep_hockey`.

1. **Re-sembrar staging desde prod** (en el servidor): `bash deploy/seed-staging.sh`.
2. **Dry-run del seed** contra staging. Revisar la sección de identidad: los clubes que ya existen
   en RFEP deben salir como `reusar-*`; los dudosos van a la cola HITL (`/admin/resolucion`).

   ```powershell
   $env:DATABASE_URL='postgresql://sports_user@localhost:5432/sports_staging'
   $env:SIDGAD_PORTAL='fecapa'; $env:SIDGAD_REFERER='https://www.fecapa.cat/'
   npx tsx apps/etl/src/seed-fep-competition.ts --idc=4858 `
     --name="LLIGA CATALANA MASCULINA" --short="Lliga Catalana" --gender=male `
     --organizer=FECAPA --region=Cataluña --scope=regional `
     --season=2026/27 --temp=41 --start=2026-09-01 --end=2027-06-30 --active=false
   ```

   `--active=false`: liga terminada; no hace falta que el cron la repita cada hora.
3. Repetir con `--write`. Guardar `SEASON_ID` y `COMPETITION_ID`.
4. **Crear el lote de importación** para poder promocionar (SQL en staging), y cargar calendario y
   clasificación con ese `batch-id`:

   ```sql
   INSERT INTO import_batches (source_id, label, kind, status, scope_note)
   SELECT id, 'fecapa-4858-2026-27', 'backfill', 'running', 'Alta Lliga Catalana 2026/27'
     FROM data_sources WHERE scraper_key='fep_hockey'
   ON CONFLICT (label) DO UPDATE SET status='running'
   RETURNING id;
   ```

   ```powershell
   npx tsx apps/etl/src/run-pipeline.ts --entity=calendar  --idc=4858 --season-id=<SEASON_ID> --batch-id=<BATCH_ID>
   npx tsx apps/etl/src/run-pipeline.ts --entity=standings --idc=4858 --season-id=<SEASON_ID>
   ```

5. **Validar staging**: `npx tsx src/validate-staging.ts --batch fecapa-4858-2026-27` → debe dar PASA.
6. **Promocionar**: `npx tsx src/promote-to-prod.ts --batch fecapa-4858-2026-27` (dry-run) y después
   `--commit`.
7. **Verificar en web**:
   - Pestaña **Final Four**: semifinales + final (Calafell – Barça, pendiente de resultado).
   - **Clasificación**: tres tablas, Grupo A / B / C.
   - **Jornadas**: 3 jornadas con 6 partidos cada una.
   - Escudos servidos desde `sidgad.cloud/fecapa/...`.

## Verificación local realizada

Base Postgres efímera + migraciones desde cero + seed/calendario/clasificación reales:

- 12 equipos, 2 fases (`groups` + `knockout`), 3 jornadas + semis/final.
- 20 partidos: 18 de grupos + 2 semifinales + final (0–1, campeón Barça) con actas.
- 12 filas de clasificación en 3 grupos (4 por grupo), posiciones/puntos/goles correctos.
- Web local: grupos A/B/C renderizados, cuadro con la final «Calafell la Menorquina – Barça».
- Tests: `apps/scraper` 218 OK, `apps/etl` 192 OK, `packages/shared-types` 45 OK, web 814 OK.

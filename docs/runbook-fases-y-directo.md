# Runbook — fases de competición y directo explícito (migración 072)

Operativa del cambio descrito en
[superpowers/specs/2026-10-08-fases-y-directo-explicito-design.md](./superpowers/specs/2026-10-08-fases-y-directo-explicito-design.md):
cómo desplegarlo, cómo comprobar que la migración ha ido bien, cómo pasar las temporadas heredadas a
estructura explícita y qué datos de producción hay que revisar a mano.

Todo se ejecuta en el servidor (`/opt/sticklive`) con el alias de Compose:

```bash
cd /opt/sticklive
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
# Consola SQL (mismo usuario/BD que el resto de runbooks):
$DC exec postgres psql -U sports_user -d sports_results
```

---

## 1. Despliegue

La migración 072 es aditiva (no borra filas ni columnas), pero **reescribe filas** (el backfill asigna
`phase_id` a todas las rondas y partidos) y **cambia la restricción única de `rounds`**. Por eso:

1. **Backup** antes de nada (regla de [DEPLOY.md](./DEPLOY.md) para migraciones que reescriben datos):

   ```bash
   ./deploy/backup-db.sh
   ```

2. **Parar el `etl` antes de levantar**. Si el `etl` antiguo coincide con la migración, un upsert de
   rondas con el `ON CONFLICT` antiguo fallaría (la restricción `rounds_season_id_number_round_type_key`
   desaparece). No rompe datos, pero ensucia Sentry y pierde ese ciclo. Mejor hacerlo fuera de horario de
   partidos (sin directos en juego):

   ```bash
   $DC stop etl
   ./deploy/deploy.sh          # o el despliegue paso a paso: git pull && $DC up -d --build
   ```

   `deploy.sh` levanta el servicio `migrate` (aplica la 072) antes que `api` y `etl`.

3. **Comprobar la migración** (sección 2) y los logs: `$DC logs --tail=200 etl api`.

Requisito: PostgreSQL ≥ 15 (usa `UNIQUE NULLS NOT DISTINCT`). Producción corre la 16.

**Rollback**: las migraciones son forward-only. Volver a la imagen anterior (`:previous`, ver DEPLOY.md)
funciona con el esquema nuevo **salvo** el upsert de rondas del código antiguo (por la restricción
cambiada). Si hiciera falta un rollback largo, restaurar el backup del paso 1.

---

## 2. Verificación tras migrar

```sql
-- Fases creadas por el backfill (todas 'legacy' hasta el primer scrape estructurado).
SELECT resolved_by, kind, is_placement, count(*) FROM phases GROUP BY 1,2,3 ORDER BY 1,2,3;

-- Nada debe quedar sin fase (ambos 0).
SELECT count(*) AS partidos_sin_fase FROM matches WHERE phase_id IS NULL;
SELECT count(*) AS rondas_sin_fase  FROM rounds  WHERE phase_id IS NULL;

-- Rondas eliminatorias heredadas SIN fase eliminatoria: son las que el backfill no quiso adivinar
-- (ronda 100 de OK Liga, "FINAL" con todo el cuadro de la Copa del Rey…). Candidatas a re-scrape.
SELECT c.name AS competicion, s.name AS temporada, s.id AS season_id, s.source_ref,
       r.number, r.name, count(m.id) AS partidos
  FROM rounds r
  JOIN phases p ON p.id = r.phase_id AND p.kind = 'knockout' AND p.resolved_by = 'legacy'
  JOIN seasons s ON s.id = r.season_id
  JOIN competitions c ON c.id = s.competition_id
  LEFT JOIN matches m ON m.round_id = r.id
 WHERE r.stage IS NULL
 GROUP BY 1,2,3,4,5,6
 ORDER BY s.start_date DESC NULLS LAST, c.name;

-- Estado: ningún partido debe estar 'live' sin señal de la fuente. Tras el despliegue, los 'live'
-- deben coincidir con los que el feed da en juego.
SELECT m.id, c.name, m.scheduled_at, m.started_at, m.home_score, m.away_score
  FROM matches m JOIN seasons s ON s.id = m.season_id JOIN competitions c ON c.id = s.competition_id
 WHERE m.status = 'live';
```

En la web, sin re-scrapear nada, todo debe verse **igual que antes**: las temporadas heredadas mantienen
su presentación (la API marca `fromSource=false` y la web usa la lógica anterior).

---

## 3. Pasar temporadas heredadas a estructura explícita (re-scrape)

Las temporadas en curso se re-estructuran solas en el siguiente ciclo horario de calendario
(`COMPETITION_SOURCES_DRIVEN=1`): el plan de estructura adopta sus fases `legacy` y las completa.

Las **temporadas pasadas** no las recorre el cron. Para las que se quieran corregir (las que salen en la
consulta de la sección 2), re-scrapear su calendario con los `idc` de la fuente. El `idc` está en el
catálogo de importación (`fep-catalog.json`) y, normalmente, en `seasons.source_ref`.

1. **Dry-run** — scrapea y planifica sin escribir; imprime las fases que crearía:

   ```bash
   $DC exec etl node dist/apps/etl/src/run-pipeline.js \
     --entity=calendar --season-id=<SEASON_ID> --idc=<IDC_LIGA>,<IDC_PLAYOFF> --dry-run
   ```

   Comprueba en el log `[dry-run] Estructura planificada`: liga → `league@source_rounds`, playoff →
   `knockout@source_rounds`, 9.º-10.º → `knockout(colocación)@source_title`.

2. **Escritura** — mismo comando sin `--dry-run`. Es idempotente: se puede repetir.

3. **Comprobar**: la consulta de la sección 2 ya no debe listar esa temporada, y en la web el playoff debe
   verse por fases (cuartos/semis/final) sin la marca de deducción.

Qué hace por dentro (por qué es seguro): los partidos se actualizan por `source_ref` (mismos ids); las
fases y rondas heredadas se **adoptan** (no se duplican); el estado solo cambia si la fuente lo publica
(resultado en el calendario → `finished`); y las rondas que quedan vacías y la fuente ya no publica (la
antigua ronda 100) se retiran solo si **todos** los `idc` se leyeron bien. Nunca se borra una ronda con
partidos.

### Casos conocidos a re-scrapear (auditoría del 08/10/2026)

| Temporada | Síntoma | `idc` |
|---|---|---|
| OK Liga Masculina 2025/26 | Playoff entero en la ronda 100; la API lo deduce por fechas | 3150 (liga) + 3481 (playoff) |
| OK Liga Femenina 2025/26 | Ídem | liga fem. + 3484 (playoff) |
| Copa del Rey 2025/26 | Los 7 partidos en una sola ronda «FINAL» | 3258 |

Confirma cada `idc` con el `--dry-run` antes de escribir (si el `idc` no es el de esa temporada, el plan
mostrará otros equipos/fechas).

---

## 4. Datos de producción a revisar

### 4.1 WSG Asunción — ITA-COL femenino con datos del sub-19

El índice de `idp` del match center confundía categorías: el ITA-COL femenino (sin `idp` publicado
todavía) se llevó el `idp` 3359 del cuarto de final sub-19 COL-ITA. El código nuevo ya no lo hace (la
clave incluye la hora), pero lo escrito antes puede seguir mezclado. Tras el primer ciclo de World Skate
con el código nuevo:

```sql
-- ¿A qué temporada/equipos pertenece la fila con el idp 3359?
SELECT m.id, c.name AS competicion, ht.name AS local, at.name AS visitante, m.scheduled_at,
       m.status, m.home_score, m.away_score, r.name AS ronda, m.source_ref
  FROM matches m
  JOIN seasons s ON s.id = m.season_id JOIN competitions c ON c.id = s.competition_id
  JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id
  LEFT JOIN rounds r ON r.id = m.round_id
 WHERE m.source_ref = 'wse_match_3359'
    OR (c.name ILIKE '%femenino%' AND c.name ILIKE '%world skate%'
        AND ht.name ~* 'ital|colom' AND at.name ~* 'ital|colom');
```

Lo correcto: `wse_match_3359` en la competición **sub-19** (COL-ITA, 12:30 local, 1-11) y el ITA-COL
**femenino** con su propio `idp` (o una ref `synthetic:` mientras no lo publique la fuente) y su propio
resultado. Si no es así, la corrección es puntual (backup + transacción revisada antes del `COMMIT`); no
la automatices: cada fila mezclada se decide mirando su acta.

### 4.2 Partidos que empezaron tarde o quedaron atascados

Con el código nuevo el watchdog mide desde el saque real (`started_at`). Revisa que no quede ningún
`live` de hace días (la consulta de estado de la sección 2) y, si lo hay, mira su acta: el ETL lo cierra
por acta (`periodo_fin`) en el siguiente ciclo en que el partido entre en la ventana del directo.

---

## 5. Qué esperar y cómo diagnosticar

| Síntoma | Causa probable | Dónde mirar |
|---|---|---|
| Un partido no aparece en directo aunque ya es la hora | La fuente aún no lo da en juego (feed/mc). La web muestra «Pendiente». **Es lo correcto.** | Feed `rfep_mc_1.php` / `worldskate_mc_1.php` |
| Aviso Sentry «Estructura de fase no resuelta por la fuente — fallback a liga» | Una fase cuyo calendario no trae cabeceras reconocibles | Declarar `external_ids.format` en `competition_sources` o revisar la fuente |
| Log «Estado desconocido de la fuente … ignorado» | La fuente publica un estado nuevo | `apps/etl/src/transformers/match.transformer.ts` |
| Playoff que sigue saliendo por fechas (`stageInferred`) | Temporada heredada sin re-scrapear | Sección 3 |
| Un partido se cierra sin desaparecer del feed | Acta con `periodo_fin` («FINALIZADO») | `apps/etl/src/acta-final.ts` |

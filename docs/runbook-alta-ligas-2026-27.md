# Runbook — alta de las 9 ligas 2026/27 (Vía A)

Fecha: 2026-09-27 · Requiere: `feat/seed-fep-generico` mergeado y desplegado.

Seed genérico nuevo: `apps/etl/src/seed-fep-competition.ts` (ya en los entrypoints del build). Se auto-descubre los equipos vía `competicion_header_creator.php` (fallback al calendario) y crea competición + temporada 2026/27 (is_current) + equipos + `competition_sources`. Dry-run por defecto; `--write` para escribir. Respeta identidad de equipo por temporada (no pisa `source_ref`, añade a `alt_source_refs`).

## 0. Push + merge + deploy

Desde el PC (la rama ya está commiteada localmente):

```
git push -u origin feat/seed-fep-generico
# merge a main (PR o directo) y en el PC: git checkout main && git pull
```

En el VPS (`cd /opt/sticklive`, `DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"`):

```
git pull
$DC up -d --build        # reconstruye etl con el nuevo entrypoint (seed-fep-competition.js)
```

Comprobación previa: `FEP_SOURCE_ID` debe seguir en `.env.prod` (lo necesita run-pipeline para upsert de partidos; el seed no). `COMPETITION_SOURCES_DRIVEN=1` ya está encendido, así que en cuanto una competición quede sembrada e `is_active`, el cron horario la barre sola.

## 1. Seed por liga (dry-run → --write)

Ejecuta cada uno primero SIN `--write` para revisar los equipos descubiertos, y repite con `--write`. Prioridad: 3568 y 3569 primero (validan sin tocar formato), luego Plata/Bronce, Supercopas al final.

```
DC_ETL="$DC exec -T etl node dist/apps/etl/src/seed-fep-competition.js"

# Nivel 1
$DC_ETL --idc=3568 --name="OK LIGA MASCULINA" --short="OK Liga" --gender=male
$DC_ETL --idc=3569 --name="OK LIGA FEMENINA"  --short="OK Liga Iberdrola" --gender=female

# Plata (nivel 2) — grupos territoriales
$DC_ETL --idc=3574 --name="OK LIGA PLATA NORTE"    --short="Plata Norte" --gender=male
$DC_ETL --idc=3575 --name="OK LIGA PLATA SUR"      --short="Plata Sur"   --gender=male
$DC_ETL --idc=3571 --name="OK LIGA PLATA FEMENINA" --short="Plata Fem"   --gender=female

# Bronce (nivel 3)
$DC_ETL --idc=3572 --name="OK LIGA BRONCE MASCULINA NORTE" --short="Bronce Norte" --gender=male
$DC_ETL --idc=3573 --name="OK LIGA BRONCE MASCULINA SUR"   --short="Bronce Sur"   --gender=male

# Supercopas (Final Four: 2 semifinales + final, partido único) — al final
$DC_ETL --idc=3592 --name="SUPERCOPA DE ESPAÑA MASCULINA" --short="Supercopa" --gender=male   --format=final_four
$DC_ETL --idc=3593 --name="SUPERCOPA DE ESPAÑA FEMENINA"  --short="Supercopa" --gender=female --format=final_four
```

Añade `--write` al final de cada uno cuando el dry-run se vea bien. Cada `--write` imprime `SEASON_ID` (guárdalo para el paso 2).

Flags útiles: `--temp=NN` (id de temporada sidgad para `seasons.source_ref`; opcional, `is_current` ya resuelve), `--start=/--end=` (por defecto 2026-09-01 / 2027-06-30), `--active=false` (sembrar sin activar el cron todavía).

## 2. Carga inicial inmediata (sin esperar al cron)

Con el `SEASON_ID` que imprimió cada seed:

```
$DC exec -T etl node dist/apps/etl/src/run-pipeline.js --entity=calendar  --idc=<idc> --season-id=<SEASON_ID>
$DC exec -T etl node dist/apps/etl/src/run-pipeline.js --entity=standings --idc=<idc> --season-id=<SEASON_ID>
```

Las Supercopas: `--format=final_four` en el seed (torneo a 4: 2 semifinales + final, partido único) y solo `calendar`; el parser capta las rondas del `thead.head_jornada` y la web las pinta como cuadro (sin clasificación de liga).

## 3. Verificación

- Cuenta de partidos y equipos por competición en BD tras cada carga.
- **Plata/Bronce Norte/Sur**: confirmar que `standings.group_name` sale como grupo real (Norte/Sur) y no como el título genérico "CLASIFICACIÓN" (gotcha 041). Si sale genérico, hay que limpiar con migración, no basta re-scrape.
- Vigilar el tiempo del `etl-scheduler.sh`: con 9 ligas más el ciclo se alarga (scheduler secuencial). Palanca: `is_active=false` por competición o subir `MULTI_COURTESY_MS`.
- Si un partido se omite con "competición no indexada": revisar `FEP_SOURCE_ID`.

## Pendiente tras esto

- idc de playoff / fases de ascenso 2026/27: cuando la RFEP los publique, añadir a `external_ids.playoff_idcs` de la fila correspondiente.
- Formato (puestos playoff/ascenso/descenso): es la **Vía B** (hoy hardcodeado a OK Liga en `StandingsTab.tsx`). Ver `plan-indexado-ligas-2026-27.md`.

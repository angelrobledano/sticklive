#!/bin/sh
# ============================================================
# Planificador de ETL para producción (contenedor etl).
#   · cron-live:          cada 5 minutos
#   · calendario+standings: cada hora (en punto)
#   · fichas-pendientes:  una vez al día (~06:00 UTC)
# Sencillo y visible: un loop con marcas de tiempo, sin crond.
# INVARIANTE DE ORDEN (auditoría M3): worldskate y cron-live van PRIMERO;
# cron-live puede ocupar el bucle hasta MAX_RUNTIME_MIN (180) durante un
# torneo, así que TODA tarea nueva se añade DESPUÉS y debe tolerar no correr
# mientras haya directo. No reordenar sin releer los comentarios de cada bloque.
# ============================================================
set -u
# Desde la raíz: los procesos van empaquetados en /app/dist y las rutas de
# datos las fija la imagen por entorno (ESCUDOS_DIR). Antes esto hacía
# `cd /app/apps/etl` porque `npx tsx` necesitaba resolver desde el paquete.
cd /app

# Latido para el healthcheck del contenedor (docker-compose.prod.yml). El ETL
# no expone HTTP, así que el único modo de distinguir "vivo" de "colgado" es
# que el bucle deje constancia de cada vuelta. Se toca al entrar y al salir de
# cada iteración: los ciclos de directo pueden durar hasta 180 min, y sin el
# toque de entrada el healthcheck lo daría por muerto a mitad de un torneo.
ALIVE=/tmp/etl-alive
touch "$ALIVE"

# Lock compartido (auditoría B4): evita que dos pipelines de scraping corran a
# la vez (p. ej. un scrape MANUAL solapándose con el cron). Tanto el scheduler
# como las ejecuciones manuales deben envolver el comando con:
#   flock -n "$ETL_LOCK" node dist/apps/etl/src/run-pipeline.js ...
# Si el lock está cogido, flock -n sale sin ejecutar (lo absorbe el `|| ...`).
ETL_LOCK=/tmp/etl-pipeline.lock
# flock es OBLIGATORIO. Antes, si faltaba, el scheduler seguía sin lock tras un
# simple echo — silencioso en los logs y con riesgo de dos pipelines escribiendo
# a la vez sobre las mismas filas. La imagen lo instala (deploy/Dockerfile); si
# aun así no está, es un fallo de build y hay que enterarse ya.
if ! command -v flock >/dev/null 2>&1; then
  echo "[scheduler] ERROR: flock no disponible en la imagen." >&2
  echo "[scheduler] Sin lock, dos pipelines pueden solaparse. Abortando." >&2
  exit 1
fi
LOCK="flock -n $ETL_LOCK"

LAST_HOUR=""
LAST_DAY=""

echo "[scheduler] arrancado $(date -u +%FT%TZ)"

while true; do
  touch "$ALIVE"   # latido: entramos en una vuelta
  NOW_HOUR=$(date -u +%Y%m%d%H)
  NOW_DAY=$(date -u +%Y%m%d)
  HOUR_UTC=$(date -u +%H)

  # ── Cada 5 min: World Skate Europe ──────────────────────
  # VA ANTES DE cron-live A PROPÓSITO. Este bucle es SECUENCIAL y `cron-live`
  # se queda dentro de su propio bucle activo mientras haya partidos en juego
  # (MAX_RUNTIME_MIN, 180 por defecto). Puesto detrás, durante un torneo no le
  # llegaba nunca el turno: los partidos de World Skate se quedaban colgados en
  # "EN JUEGO" — y ese `live` fantasma era justo lo que mantenía vivo el bucle
  # de cron-live, que a su vez impedía esta ejecución. Círculo vicioso.
  #
  # El directo de verdad ya NO depende de esta línea: cron-live scrapea World
  # Skate en cada ciclo de 45 s (runWorldskateScores). Esto cubre el reposo —
  # cambios de calendario, horas y altas de equipos fuera del bucle activo.
  #
  # Es barato (un POST por competición) y `resolveWorldskate` devuelve vacío si
  # no hay competiciones activas, así que fuera de torneo esto es una consulta
  # a la BD y poco más.
  echo "[scheduler] worldskate $(date -u +%T)"
  $LOCK node dist/apps/scraper/src/index.js --run-once worldskate \
    || echo "[scheduler] worldskate saltado o falló (seguimos)"
  touch "$ALIVE"   # latido entre fases (#146)

  # ── Cada 5 min: marcadores en vivo ──────────────────────
  # Puede quedarse hasta MAX_RUNTIME_MIN dentro de su bucle activo: todo lo que
  # va DESPUÉS de esta línea espera a que termine. Tenerlo en cuenta al añadir
  # tareas nuevas.
  echo "[scheduler] cron-live $(date -u +%T)"
  $LOCK node dist/apps/etl/src/cron-live.js || echo "[scheduler] cron-live saltado o falló (seguimos)"
  touch "$ALIVE"   # latido tras el directo (cron-live además late por dentro cada ciclo, #146)

  # ── Cada hora: calendario + clasificación ──────────────────
  if [ "$NOW_HOUR" != "$LAST_HOUR" ]; then
    LAST_HOUR=$NOW_HOUR
    echo "[scheduler] calendario+standings $(date -u +%T)"
    $LOCK node dist/apps/etl/src/run-pipeline.js --entity=calendar   || true
    touch "$ALIVE"   # latido entre fases (#146)
    $LOCK node dist/apps/etl/src/run-pipeline.js --entity=standings  || true
    touch "$ALIVE"
  fi

  # ── Diario a las 06 UTC: actas pendientes + purga de logs ──
  if [ "$NOW_DAY" != "$LAST_DAY" ] && [ "$HOUR_UTC" = "06" ]; then
    LAST_DAY=$NOW_DAY
    echo "[scheduler] fichas-pendientes $(date -u +%T)"
    $LOCK node dist/apps/etl/src/run-pipeline.js --entity=fichas-pendientes || true
    touch "$ALIVE"   # latido entre fases (#146)

    # scrape_logs crece ~1.000 filas/día y no lo lee nadie. Se conservan 30
    # días (SCRAPE_LOGS_RETENTION_DAYS). Va sin lock: borra por lotes y no
    # compite con el scraping.
    echo "[scheduler] purga de scrape_logs $(date -u +%T)"
    node dist/packages/db/scripts/purge-scrape-logs.js \
      || echo "[scheduler] purga fallo (seguimos)"

    # Guarda del particionado de match_events (047): asegura las particiones de
    # la temporada actual + siguientes (idempotente) y avisa a Sentry si
    # match_events_undated recibe filas. Sin lock: DDL IF NOT EXISTS + un count.
    echo "[scheduler] partition-guard $(date -u +%T)"
    node dist/apps/etl/src/partition-guard.js \
      || echo "[scheduler] partition-guard fallo (seguimos)"

    # Vigilante de salud del scraping (I3): avisa a Sentry si un scraper clave
    # está parado (> SCRAPE_STALE_HOURS) o terminó OK con 0 resultados (éxito
    # silencioso por cambio de la fuente). Sin lock: solo lee scrape_logs.
    echo "[scheduler] scrape-health-watch $(date -u +%T)"
    node dist/apps/etl/src/scrape-health-watch.js \
      || echo "[scheduler] scrape-health-watch fallo (seguimos)"

    # Chequeo de integridad de datos (#231): ventana de temporadas, coherencia
    # eventos↔marcador, standings↔partidos, homónimos en temporada, refs
    # compartidas, partidos sin season_teams y ganadores imposibles. Solo lee y
    # avisa a Sentry; nunca escribe.
    echo "[scheduler] integrity-check $(date -u +%T)"
    node dist/apps/etl/src/integrity-check.js \
      || echo "[scheduler] integrity-check fallo (seguimos)"
  fi

  touch "$ALIVE"   # latido: vuelta completada
  sleep 300
done

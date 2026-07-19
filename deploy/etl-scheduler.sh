#!/bin/sh
# ============================================================
# Planificador de ETL para producción (contenedor etl).
#   · cron-live:          cada 5 minutos
#   · calendario+standings: cada hora (en punto)
#   · fichas-pendientes:  una vez al día (~06:00 UTC)
# Sencillo y visible: un loop con marcas de tiempo, sin crond.
# ============================================================
set -u
cd /app/apps/etl

# Lock compartido (auditoría B4): evita que dos pipelines de scraping corran a
# la vez (p. ej. un scrape MANUAL solapándose con el cron). Tanto el scheduler
# como las ejecuciones manuales deben envolver el comando con:
#   flock -n "$ETL_LOCK" npx tsx src/run-pipeline.ts ...
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
  NOW_HOUR=$(date -u +%Y%m%d%H)
  NOW_DAY=$(date -u +%Y%m%d)
  HOUR_UTC=$(date -u +%H)

  # ── Cada 5 min: marcadores en vivo ─────────────────────────
  echo "[scheduler] cron-live $(date -u +%T)"
  $LOCK npx tsx src/cron-live.ts || echo "[scheduler] cron-live saltado o falló (seguimos)"

  # ── Cada hora: calendario + clasificación ──────────────────
  if [ "$NOW_HOUR" != "$LAST_HOUR" ]; then
    LAST_HOUR=$NOW_HOUR
    echo "[scheduler] calendario+standings $(date -u +%T)"
    $LOCK npx tsx src/run-pipeline.ts --entity=calendar   || true
    $LOCK npx tsx src/run-pipeline.ts --entity=standings  || true
  fi

  # ── Diario a las 06 UTC: actas pendientes ──────────────────
  if [ "$NOW_DAY" != "$LAST_DAY" ] && [ "$HOUR_UTC" = "06" ]; then
    LAST_DAY=$NOW_DAY
    echo "[scheduler] fichas-pendientes $(date -u +%T)"
    $LOCK npx tsx src/run-pipeline.ts --entity=fichas-pendientes || true
  fi

  sleep 300
done

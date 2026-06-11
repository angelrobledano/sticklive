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

LAST_HOUR=""
LAST_DAY=""

echo "[scheduler] arrancado $(date -u +%FT%TZ)"

while true; do
  NOW_HOUR=$(date -u +%Y%m%d%H)
  NOW_DAY=$(date -u +%Y%m%d)
  HOUR_UTC=$(date -u +%H)

  # ── Cada 5 min: marcadores en vivo ─────────────────────────
  echo "[scheduler] cron-live $(date -u +%T)"
  npx tsx src/cron-live.ts || echo "[scheduler] cron-live falló (seguimos)"

  # ── Cada hora: calendario + clasificación ──────────────────
  if [ "$NOW_HOUR" != "$LAST_HOUR" ]; then
    LAST_HOUR=$NOW_HOUR
    echo "[scheduler] calendario+standings $(date -u +%T)"
    npx tsx src/run-pipeline.ts --entity=calendar   || true
    npx tsx src/run-pipeline.ts --entity=standings  || true
  fi

  # ── Diario a las 06 UTC: actas pendientes ──────────────────
  if [ "$NOW_DAY" != "$LAST_DAY" ] && [ "$HOUR_UTC" = "06" ]; then
    LAST_DAY=$NOW_DAY
    echo "[scheduler] fichas-pendientes $(date -u +%T)"
    npx tsx src/run-pipeline.ts --entity=fichas-pendientes || true
  fi

  sleep 300
done

#!/bin/sh
# ============================================================
# etl-healthcheck.sh — salvaguarda de salud del ETL (#373, #319)
#
# Dos vigilantes en un script (cron del host, cada 5 min):
#
#  1. LATIDO DEL CONTENEDOR (#373): el healthcheck del contenedor `etl` mira el
#     latido de fichero (/tmp/etl-alive, ver docker-compose.prod.yml). El
#     sidecar `autoheal` NO toca el ETL a propósito: reiniciarlo durante un
#     directo mataría el bucle a media faena (el latido puede quedarse
#     "atrasado" mientras una tarea larga trabaja). Pero si el ETL se CUELGA de
#     verdad (vivo sin avanzar), se queda `unhealthy` indefinidamente y el
#     directo se congela hasta un restart manual. Salvaguarda CONSERVADORA:
#       · Solo actúa si el contenedor está `unhealthy` Y Docker acumula >= 3
#         fallos consecutivos del healthcheck (FailingStreak).
#       · Y exige 2 pasadas consecutivas de ESTE script (cron 5 min → ~10 min).
#       · Enfriamiento entre reinicios para no entrar en bucle.
#       · Avisa antes de reiniciar (log siempre; a Sentry si hay SENTRY_DSN).
#
#  2. INGESTA ESTANCADA (#319): un proceso VIVO puede dejar de ingestar sin que
#     el latido se entere — fue el mecanismo del gap de 6 h del 13/09 (el flock
#     lo sostenía el barrido de fichas durante horas y cron-live no entraba).
#     Señal barata y fiable: cron-live escribe fila en scrape_logs en CADA
#     ciclo, así que 0 filas en los últimos N minutos = ingesta parada aunque
#     los contenedores estén sanos. Exige 2 pasadas consecutivas antes de
#     alertar (una ventana por maintenance manual no debe abrir incidente).
#
# Instalación sugerida (cron del host, cada 5 min):
#   */5 * * * * root /opt/sticklive/deploy/etl-healthcheck.sh \
#       >> /var/log/sticklive-health.log 2>&1
#
# Variables:
#   ETL_CONTAINER             — nombre/ID del contenedor (autodetecta por
#                               label de compose `service=etl` si no se fija)
#   ETL_UNHEALTHY_CYCLES      — pasadas consecutivas unhealthy antes de reiniciar
#                               (defecto 2)
#   ETL_RESTART_COOLDOWN_MIN  — minutos mínimos entre reinicios (defecto 30)
#   ETL_HEALTHCHECK_STATE_DIR — dónde guardar contadores (defecto /var/lib/sticklive)
#   ETL_INGEST_STALE_MIN      — minutos sin filas en scrape_logs que cuentan
#                               como "ingesta estancada" (defecto 20)
#   ETL_INGEST_CYCLES         — pasadas consecutivas estancadas antes de alertar
#                               (defecto 2)
#   PG_CONTAINER              — contenedor de Postgres (autodetección por label)
#   PG_USER / PG_DB           — credenciales de la consulta (defecto prod)
#   SENTRY_DSN                — si está, manda la alerta a Sentry (best-effort)
# ============================================================
set -u

CONTAINER="${ETL_CONTAINER:-}"
if [ -z "$CONTAINER" ]; then
  CONTAINER=$(docker ps -q --filter 'label=com.docker.compose.service=etl' | head -n1)
fi
if [ -z "$CONTAINER" ]; then
  echo "[etl-healthcheck] $(date -u +%FT%TZ) ERROR: no encuentro el contenedor etl" >&2
  exit 1
fi

THRESHOLD="${ETL_UNHEALTHY_CYCLES:-2}"
COOLDOWN_MIN="${ETL_RESTART_COOLDOWN_MIN:-30}"
STALE_MIN="${ETL_INGEST_STALE_MIN:-20}"
INGEST_CYCLES="${ETL_INGEST_CYCLES:-2}"

STATE_DIR="${ETL_HEALTHCHECK_STATE_DIR:-/var/lib/sticklive}"
if ! ( mkdir -p "$STATE_DIR" 2>/dev/null && : > "$STATE_DIR/.wtest" 2>/dev/null ); then
  echo "[etl-healthcheck] aviso: $STATE_DIR no es escribible; uso ${TMPDIR:-/tmp}" >&2
  STATE_DIR="${TMPDIR:-/tmp}"
fi
rm -f "$STATE_DIR/.wtest" 2>/dev/null || true
COUNT_FILE="$STATE_DIR/etl-unhealthy.count"
COOLDOWN_FILE="$STATE_DIR/etl-last-restart"
INGEST_FILE="$STATE_DIR/etl-ingest-stale.count"

# ── Alerta a Sentry (best-effort; log siempre aparte) ────────────────────────
sentry_alert() {
  MSG="$1"
  if [ -n "${SENTRY_DSN:-}" ] && command -v curl >/dev/null 2>&1; then
    KEY=$(printf '%s' "$SENTRY_DSN" | sed -E 's#^https?://([^@]+)@.*$#\1#')
    HOST=$(printf '%s' "$SENTRY_DSN" | sed -E 's#^https?://[^@]+@([^/]+)/.*$#\1#')
    PROJECT=$(printf '%s' "$SENTRY_DSN" | sed -E 's#^.*/([0-9]+)$#\1#')
    if [ -n "$KEY" ] && [ -n "$HOST" ] && [ -n "$PROJECT" ]; then
      curl -sS -m 10 -X POST "https://$HOST/api/$PROJECT/store/" \
        -H 'Content-Type: application/json' \
        -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_client=sticklive-etl-healthcheck, sentry_key=$KEY" \
        --data "{\"message\":\"$MSG\",\"level\":\"warning\",\"logger\":\"etl-healthcheck\",\"tags\":{\"service\":\"etl\"}}" \
        >/dev/null 2>&1 || true
    fi
  fi
}

# ── 1. Latido del contenedor (#373) ──────────────────────────────────────────

# `docker inspect`: salud y fallos consecutivos. Si no hay healthcheck, se trata
# como sano (no reiniciamos por lo que no podemos medir).
HEALTH=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo none)
FAILING=$(docker inspect --format '{{if .State.Health}}{{.State.Health.FailingStreak}}{{else}}0{{end}}' "$CONTAINER" 2>/dev/null || echo 0)
# FailingStreak puede venir no numérico si el inspect falló.
case "$FAILING" in
  ''|*[!0-9]*) FAILING=0 ;;
esac

COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
case "$COUNT" in
  ''|*[!0-9]*) COUNT=0 ;;
esac

if [ "$HEALTH" = "unhealthy" ] && [ "$FAILING" -ge 3 ]; then
  COUNT=$((COUNT + 1))
else
  COUNT=0
fi
echo "$COUNT" > "$COUNT_FILE" 2>/dev/null || true

if [ "$COUNT" -ge "$THRESHOLD" ]; then
  NOW=$(date +%s)
  LAST=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  case "$LAST" in
    ''|*[!0-9]*) LAST=0 ;;
  esac
  if [ $((NOW - LAST)) -lt $((COOLDOWN_MIN * 60)) ]; then
    echo "[etl-healthcheck] $(date -u +%FT%TZ) etl unhealthy (FailingStreak=$FAILING) pero en enfriamiento; no reinicio"
  else
    # ── Alerta (log siempre; Sentry best-effort) ───────────────────────────
    sentry_alert "ETL unhealthy ${COUNT} pasadas (FailingStreak=$FAILING): reinicio automatico"
    echo "[etl-healthcheck] $(date -u +%FT%TZ) ALERTA: etl unhealthy confirmado ($COUNT pasadas, FailingStreak=$FAILING). Reiniciando $CONTAINER"

    if docker restart "$CONTAINER" >/dev/null 2>&1; then
      echo "$NOW" > "$COOLDOWN_FILE" 2>/dev/null || true
      echo 0 > "$COUNT_FILE" 2>/dev/null || true
      echo "[etl-healthcheck] $(date -u +%FT%TZ) etl reiniciado (cooldown ${COOLDOWN_MIN} min)"
    else
      echo "[etl-healthcheck] $(date -u +%FT%TZ) ERROR: docker restart falló" >&2
      exit 1
    fi
  fi
fi

# ── 2. Ingesta estancada (#319) ──────────────────────────────────────────────

PG_CONTAINER="${PG_CONTAINER:-$(docker ps -q --filter 'label=com.docker.compose.service=postgres' | head -n1)}"
if [ -n "$PG_CONTAINER" ]; then
  RECENT=$(docker exec "$PG_CONTAINER" psql -U "${PG_USER:-sports_user}" -d "${PG_DB:-sports_results}" -t -A -c \
    "SELECT count(*) FROM scrape_logs WHERE scraped_at > NOW() - ($STALE_MIN * INTERVAL '1 minute')" 2>/dev/null || echo "err")
  case "$RECENT" in
    ''|err)
      # No se pudo medir (BD caída, contenedor ausente): no contamos como
      # estancada — si la BD está caída, el path 1 y el healthcheck de la API
      # ya lo están viendo; duplicar la alerta solo añade ruido.
      echo "[etl-healthcheck] $(date -u +%FT%TZ) ingesta: sin señal medible (psql falló); no cuento"
      STALE=0
      ;;
    *)
      STALE=$RECENT
      ;;
  esac

  STALE_COUNT=$(cat "$INGEST_FILE" 2>/dev/null || echo 0)
  case "$STALE_COUNT" in
    ''|*[!0-9]*) STALE_COUNT=0 ;;
  esac

  if [ "$STALE" = "0" ]; then
    STALE_COUNT=$((STALE_COUNT + 1))
  else
    STALE_COUNT=0
  fi
  echo "$STALE_COUNT" > "$INGEST_FILE" 2>/dev/null || true

  if [ "$STALE_COUNT" -ge "$INGEST_CYCLES" ]; then
    sentry_alert "Ingesta estancada: scrape_logs sin filas nuevas en ${STALE_MIN} min ($STALE_COUNT pasadas). ETL vivo pero sin ingestar — revisar flock/barrido de fichas (ver #319)"
    echo "[etl-healthcheck] $(date -u +%FT%TZ) ALERTA: ingesta estancada (${STALE_MIN} min sin filas en scrape_logs, $STALE_COUNT pasadas)"
    # El contador NO se resetea aquí: la alerta se repite cada pasada mientras
    # persista (el gap de 6 h del 13/09 habría avisado cada 5 min).
  elif [ "$STALE_COUNT" -eq 1 ]; then
    echo "[etl-healthcheck] $(date -u +%FT%TZ) ingesta sin filas nuevas en ${STALE_MIN} min (1ª pasada; alerta en la siguiente si persiste)"
  fi
else
  echo "[etl-healthcheck] $(date -u +%FT%TZ) ingesta: no encuentro contenedor de Postgres; check omitido"
fi

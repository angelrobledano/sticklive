#!/bin/sh
# ============================================================
# etl-healthcheck.sh — salvaguarda de salud del ETL (#373)
#
# El healthcheck del contenedor `etl` mira el latido de fichero
# (/tmp/etl-alive, ver docker-compose.prod.yml). El sidecar `autoheal` NO toca
# el ETL a propósito: reiniciarlo durante un directo mataría el bucle a media
# faena (el latido puede quedarse "atrasado" mientras una tarea larga trabaja).
#
# Pero si el ETL se CUELGA de verdad (vivo sin avanzar), se queda `unhealthy`
# indefinidamente y el directo se congela hasta un restart manual. Este script
# cierra ese hueco con una salvaguarda CONSERVADORA:
#
#   · Solo actúa si el contenedor está `unhealthy` Y Docker acumula >= 3 fallos
#     consecutivos del healthcheck (FailingStreak). Ese healthcheck ES la
#     comprobación de latido: 3 fallos = sin latido durante >2 intervalos.
#   · Y exige 2 pasadas consecutivas de ESTE script viendo el problema (por
#     defecto: cron cada 5 min → ~10 min de cuelgue confirmado).
#   · Tras reiniciar, entra en un periodo de enfriamiento para no entrar en
#     bucle si la causa no se arregla sola.
#   · Avisa antes de reiniciar (log siempre; a Sentry si hay `SENTRY_DSN`).
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

STATE_DIR="${ETL_HEALTHCHECK_STATE_DIR:-/var/lib/sticklive}"
if ! ( mkdir -p "$STATE_DIR" 2>/dev/null && : > "$STATE_DIR/.wtest" 2>/dev/null ); then
  echo "[etl-healthcheck] aviso: $STATE_DIR no es escribible; uso ${TMPDIR:-/tmp}" >&2
  STATE_DIR="${TMPDIR:-/tmp}"
fi
rm -f "$STATE_DIR/.wtest" 2>/dev/null || true
COUNT_FILE="$STATE_DIR/etl-unhealthy.count"
COOLDOWN_FILE="$STATE_DIR/etl-last-restart"

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

if [ "$COUNT" -lt "$THRESHOLD" ]; then
  # Sin problema confirmado (o aún no lleva suficientes pasadas).
  exit 0
fi

NOW=$(date +%s)
LAST=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
case "$LAST" in
  ''|*[!0-9]*) LAST=0 ;;
esac
if [ $((NOW - LAST)) -lt $((COOLDOWN_MIN * 60)) ]; then
  echo "[etl-healthcheck] $(date -u +%FT%TZ) etl unhealthy (FailingStreak=$FAILING) pero en enfriamiento; no reinicio"
  exit 0
fi

# ── Alerta (log siempre; Sentry best-effort) ────────────────────────────────
if [ -n "${SENTRY_DSN:-}" ] && command -v curl >/dev/null 2>&1; then
  KEY=$(printf '%s' "$SENTRY_DSN" | sed -E 's#^https?://([^@]+)@.*$#\1#')
  HOST=$(printf '%s' "$SENTRY_DSN" | sed -E 's#^https?://[^@]+@([^/]+)/.*$#\1#')
  PROJECT=$(printf '%s' "$SENTRY_DSN" | sed -E 's#^.*/([0-9]+)$#\1#')
  if [ -n "$KEY" ] && [ -n "$HOST" ] && [ -n "$PROJECT" ]; then
    curl -sS -m 10 -X POST "https://$HOST/api/$PROJECT/store/" \
      -H 'Content-Type: application/json' \
      -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_client=sticklive-etl-healthcheck, sentry_key=$KEY" \
      --data "{\"message\":\"ETL unhealthy ${COUNT} pasadas (FailingStreak=$FAILING): reinicio automatico\",\"level\":\"warning\",\"logger\":\"etl-healthcheck\",\"tags\":{\"service\":\"etl\"}}" \
      >/dev/null 2>&1 || true
  fi
fi

echo "[etl-healthcheck] $(date -u +%FT%TZ) ALERTA: etl unhealthy confirmado ($COUNT pasadas, FailingStreak=$FAILING). Reiniciando $CONTAINER"

if docker restart "$CONTAINER" >/dev/null 2>&1; then
  echo "$NOW" > "$COOLDOWN_FILE" 2>/dev/null || true
  echo 0 > "$COUNT_FILE" 2>/dev/null || true
  echo "[etl-healthcheck] $(date -u +%FT%TZ) etl reiniciado (cooldown ${COOLDOWN_MIN} min)"
else
  echo "[etl-healthcheck] $(date -u +%FT%TZ) ERROR: docker restart falló" >&2
  exit 1
fi

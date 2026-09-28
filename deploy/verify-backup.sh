#!/bin/bash
# ============================================================
# Verifica que el ÚLTIMO backup es RESTAURABLE, en una base de datos
# TEMPORAL, sin tocar producción. Un backup que no se puede restaurar
# no es un backup.
#
#   1. Coge el .sql.gz más reciente de /opt/backups
#   2. Falla si ese dump tiene más de MAX_AGE_HOURS horas (#292: evita el
#      "falso confort" si el backup lleva días fallando en silencio)
#   3. Si hay off-site configurado, comprueba que ese mismo dump está remoto (#289)
#   4. Lo restaura en sports_results_verify
#   5. Imprime conteos de sanidad (matches/teams/match_events)
#   6. Borra la BD temporal
#
# Uso (como root):
#   chmod +x /opt/sticklive/deploy/verify-backup.sh
#   /opt/sticklive/deploy/verify-backup.sh
# Opcional, semanal:
#   echo '30 4 * * 1 root /opt/sticklive/deploy/verify-backup.sh >> /var/log/sticklive-backup.log 2>&1' > /etc/cron.d/sticklive-verify
#
# Variables:
#   MAX_AGE_HOURS   — edad máxima del dump más reciente (defecto 30; el backup
#                     es diario a las 04:15, así que >30 h = al menos un día perdido)
#   VERIFY_PING_URL — monitor para el resultado del verify (si no se define, usa
#                     BACKUP_PING_URL del .backup-offsite.env)
# ============================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
COMPOSE="docker compose -f /opt/sticklive/docker-compose.prod.yml --env-file /opt/sticklive/.env.prod"
VERIFY_DB=sports_results_verify
MAX_AGE_HOURS="${MAX_AGE_HOURS:-30}"

# Config del off-site y de las alertas (mismo fichero que backup-db.sh).
OFFSITE_CONF="${OFFSITE_CONF:-/opt/sticklive/.backup-offsite.env}"
if [ -f "$OFFSITE_CONF" ]; then
  # shellcheck source=/dev/null
  . "$OFFSITE_CONF"
fi

# ── Alerta del verify (#292) ─────────────────────────────────────────────────
# Misma convención que backup-db.sh: healthchecks.io/dead-man-snitch usan
# "<url>/fail"; Sentry Cron Monitor (URL con "/cron/") usa "?status=error".
# Best-effort: el ping NUNCA cambia el resultado del verify.
PING_URL="${VERIFY_PING_URL:-${BACKUP_PING_URL:-}}"

ping_monitor() {
  local status="$1" url="$PING_URL"
  [ -n "$url" ] || return 0
  case "$url" in
    */cron/*)
      if [ "$status" = ok ]; then url="${url}?status=ok"; else url="${url}?status=error"; fi
      ;;
    *)
      [ "$status" = fail ] && url="${url%/}/fail"
      ;;
  esac
  if command -v curl >/dev/null 2>&1; then
    if ! curl -fsS -m 10 -o /dev/null "$url"; then
      echo "[verify] aviso: no se pudo enviar el ping ($status) a $url" >&2
    fi
  elif command -v wget >/dev/null 2>&1; then
    if ! wget -q -T 10 -O /dev/null "$url"; then
      echo "[verify] aviso: no se pudo enviar el ping ($status) a $url" >&2
    fi
  fi
}

on_exit() {
  local code=$?
  if [ "$code" -eq 0 ]; then ping_monitor ok; else ping_monitor fail; fi
}
trap on_exit EXIT

LATEST=$(ls -1t "$BACKUP_DIR"/sticklive-*.sql.gz 2>/dev/null | head -1 || true)
[ -n "$LATEST" ] || { echo "[verify] ERROR: no hay backups en $BACKUP_DIR" >&2; exit 1; }

# ── Edad del dump más reciente (#292) ────────────────────────────────────────
NOW=$(date +%s)
AGE_HOURS=$(( (NOW - $(stat -c %Y "$LATEST")) / 3600 ))
if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  echo "[verify] ERROR: el backup más reciente ($(basename "$LATEST")) tiene ${AGE_HOURS} h (umbral ${MAX_AGE_HOURS} h) — los backups pueden estar fallando en silencio" >&2
  exit 1
fi
echo "[verify] $(date -u +%FT%TZ) dump más reciente: $(basename "$LATEST") (${AGE_HOURS} h)"

# ── Comprobación off-site (#289) ─────────────────────────────────────────────
if [ -n "${OFFSITE_TARGET:-}" ]; then
  if ! command -v rsync >/dev/null 2>&1; then
    echo "[verify] ERROR: OFFSITE_TARGET definido pero rsync no está instalado" >&2
    exit 1
  fi
  REMOTE_LIST=$(rsync --list-only -e "ssh ${OFFSITE_SSH_OPTS:-}" "$OFFSITE_TARGET" 2>/dev/null || true)
  if ! printf '%s\n' "$REMOTE_LIST" | grep -qF "$(basename "$LATEST")"; then
    echo "[verify] ERROR: el dump más reciente ($(basename "$LATEST")) NO está en el destino off-site ($OFFSITE_TARGET)" >&2
    exit 1
  fi
  echo "[verify] $(date -u +%FT%TZ) off-site OK: $(basename "$LATEST") presente en $OFFSITE_TARGET"
else
  echo "[verify] aviso: off-site no configurado (falta OFFSITE_TARGET en $OFFSITE_CONF) — ver issue #289" >&2
fi

echo "[verify] $(date -u +%FT%TZ) restaurando $LATEST en BD temporal $VERIFY_DB"
$COMPOSE exec -T postgres psql -U sports_user -d postgres -q -c "DROP DATABASE IF EXISTS $VERIFY_DB;"
$COMPOSE exec -T postgres psql -U sports_user -d postgres -q -c "CREATE DATABASE $VERIFY_DB OWNER sports_user;"

# Restaurar (si el dump está corrupto, psql falla y el script aborta).
gunzip -c "$LATEST" | $COMPOSE exec -T postgres psql -U sports_user -d "$VERIFY_DB" -q

echo "[verify] conteos de sanidad:"
$COMPOSE exec -T postgres psql -U sports_user -d "$VERIFY_DB" -c \
  "SELECT 'matches' AS tabla, count(*) FROM matches
   UNION ALL SELECT 'teams', count(*) FROM teams
   UNION ALL SELECT 'match_events', count(*) FROM match_events
   UNION ALL SELECT 'players', count(*) FROM players;"

# Limpieza: la BD temporal no debe quedarse.
$COMPOSE exec -T postgres psql -U sports_user -d postgres -q -c "DROP DATABASE $VERIFY_DB;"

echo "[verify] $(date -u +%FT%TZ) ✅ backup restaurable (BD temporal eliminada)"

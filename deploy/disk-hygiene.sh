#!/bin/bash
# ============================================================
# Higiene de disco del VPS (#301). Idempotente; pensado para cron.
#
#   · Alerta si el disco ≥ DISK_THRESHOLD_PCT (def. 80 %)
#   · docker builder prune conservando la caché de los últimos días
#     (BUILD_CACHE_KEEP_HOURS; se ejecuta a diario y poda lo que cruza el umbral)
#   · journald: cap persistente (SystemMaxUse) + reclamo con --vacuum-size
#   · instala logrotate para /var/log/sticklive-*.log (#309)
#
# NO purga match_events: eso es una decisión de RETENCIÓN de datos, no de
# limpieza. Se difiere a propósito (ver docs/database.md y docs/operations.md).
#
# Instalación sugerida (cron del host, diaria a las 05:00 UTC):
#   echo '0 5 * * * root /opt/sticklive/deploy/disk-hygiene.sh >> /var/log/sticklive-hygiene.log 2>&1' > /etc/cron.d/sticklive-hygiene
#
# Variables (todas opcionales):
#   DISK_THRESHOLD_PCT=80        umbral de alerta del sistema de ficheros
#   DISK_PING_URL=...            monitor de disco; si falta, usa BACKUP_PING_URL
#   BUILD_CACHE_KEEP_HOURS=168   caché de build a conservar (7 días)
#   JOURNAL_MAX=500M             tope de journald
#   LOGROTATE_DEST=/etc/logrotate.d/sticklive
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISK_THRESHOLD_PCT="${DISK_THRESHOLD_PCT:-80}"
BUILD_CACHE_KEEP_HOURS="${BUILD_CACHE_KEEP_HOURS:-168}"
JOURNAL_MAX="${JOURNAL_MAX:-500M}"
LOGROTATE_DEST="${LOGROTATE_DEST:-/etc/logrotate.d/sticklive}"
LOGROTATE_SRC="$SCRIPT_DIR/logrotate-sticklive"
OFFSITE_CONF="${OFFSITE_CONF:-/opt/sticklive/.backup-offsite.env}"

log() { echo "[hygiene] $(date -u +%FT%TZ) $*"; }

# Config del off-site (mismo fichero que backup-db.sh): de ahí puede salir el
# ping del monitor de alertas (BACKUP_PING_URL).
if [ -f "$OFFSITE_CONF" ]; then
  # shellcheck source=/dev/null
  . "$OFFSITE_CONF"
fi
PING_URL="${DISK_PING_URL:-${BACKUP_PING_URL:-}}"

# Ping best-effort al monitor. Misma convención que backup-db.sh (#292):
# healthchecks.io/dead-man-snitch → "<url>/fail"; Sentry Cron → "?status=".
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
    curl -fsS -m 10 -o /dev/null "$url" || log "aviso: no se pudo enviar el ping ($status)"
  fi
}

# ── 1. Alerta de disco ───────────────────────────────────────────────────────
USE_PCT=$(df -Pk / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
AVAIL=$(df -Ph / | awk 'NR==2 {print $4}')
case "$USE_PCT" in ''|*[!0-9]*) USE_PCT=0 ;; esac
log "disco /: ${USE_PCT}% usado, ${AVAIL} libres (umbral ${DISK_THRESHOLD_PCT}%)"
if [ "$USE_PCT" -ge "$DISK_THRESHOLD_PCT" ]; then
  log "ALERTA: disco por encima del ${DISK_THRESHOLD_PCT}% — libera espacio"
  ping_monitor fail
else
  ping_monitor ok
fi

# ── 2. Caché de build (conserva lo reciente) ────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  log "docker builder prune (conservando <${BUILD_CACHE_KEEP_HOURS}h)"
  docker builder prune -f --filter "until=${BUILD_CACHE_KEEP_HOURS}h" \
    || log "aviso: docker builder prune falló"
else
  log "aviso: docker no disponible; se omite el prune"
fi

# ── 3. journald: cap persistente + reclamo del espacio ya usado ─────────────
if command -v journalctl >/dev/null 2>&1; then
  # `--vacuum-size` solo libera AHORA; para que no vuelva a crecer hace falta el
  # cap persistente SystemMaxUse (#301).
  JOURNALD_DROPIN="/etc/systemd/journald.conf.d/00-sticklive.conf"
  if [ -d /etc/systemd ] \
     && ! grep -qs "SystemMaxUse=${JOURNAL_MAX}" "$JOURNALD_DROPIN" 2>/dev/null; then
    if mkdir -p /etc/systemd/journald.conf.d \
       && printf '[Journal]\nSystemMaxUse=%s\n' "$JOURNAL_MAX" > "$JOURNALD_DROPIN" 2>/dev/null; then
      log "journald cap persistente: SystemMaxUse=$JOURNAL_MAX ($JOURNALD_DROPIN)"
      systemctl restart systemd-journald 2>/dev/null \
        || log "aviso: no se pudo reiniciar journald; el cap aplicará al próximo reinicio"
    else
      log "aviso: no se pudo escribir $JOURNALD_DROPIN (¿sin root?)"
    fi
  fi
  log "journalctl --vacuum-size=${JOURNAL_MAX}"
  journalctl --vacuum-size="$JOURNAL_MAX" >/dev/null 2>&1 \
    || log "aviso: el vacuum de journald falló"
fi

# ── 4. logrotate de los logs de cron (#309) ─────────────────────────────────
if [ -f "$LOGROTATE_SRC" ]; then
  if ! cmp -s "$LOGROTATE_SRC" "$LOGROTATE_DEST" 2>/dev/null; then
    if install -m 0644 "$LOGROTATE_SRC" "$LOGROTATE_DEST" 2>/dev/null; then
      log "logrotate instalado en $LOGROTATE_DEST"
    else
      log "aviso: no se pudo instalar $LOGROTATE_DEST (¿sin root?)"
    fi
  else
    log "logrotate ya al día"
  fi
fi

log "higiene completada"

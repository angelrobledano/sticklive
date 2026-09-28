#!/bin/bash
# ============================================================
# Backup diario de Postgres (producción).
#   · Dump comprimido a /opt/backups/sticklive-YYYYMMDD.sql.gz
#   · Verifica integridad (gzip -t) y tamaño antes de rotar
#   · Rotación: conserva los últimos 7
#   · Copia off-site opcional (rsync a Storage Box)
#   · Ping de éxito/fallo a un monitor (ver más abajo)
#
# Robusto: con pipefail, si pg_dump falla el script falla y NO rota
# (antes un fallo de pg_dump escribía un .gz vacío y borraba los buenos).
#
# Instalación (una vez, como root):
#   chmod +x /opt/sticklive/deploy/backup-db.sh
#   echo '15 4 * * * root /opt/sticklive/deploy/backup-db.sh >> /var/log/sticklive-backup.log 2>&1' > /etc/cron.d/sticklive-backup
# Restaurar un backup:
#   gunzip -c /opt/backups/sticklive-YYYYMMDD.sql.gz | docker compose -f /opt/sticklive/docker-compose.prod.yml --env-file /opt/sticklive/.env.prod exec -T postgres psql -U sports_user -d sports_results
# ============================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
COMPOSE="docker compose -f /opt/sticklive/docker-compose.prod.yml --env-file /opt/sticklive/.env.prod"
STAMP=$(date +%Y%m%d)
TMP="$BACKUP_DIR/.sticklive-$STAMP.sql.gz.tmp"
OUT="$BACKUP_DIR/sticklive-$STAMP.sql.gz"
MIN_BYTES=102400 # 100 KB: un dump real pesa mucho más; por debajo = sospechoso

# Config del off-site y de las alertas. Vive en el host (gitignored, 600); ver
# deploy/.backup-offsite.env.example. Se carga arriba para que también pueda
# definir BACKUP_PING_URL (el ping de éxito/fallo, #292).
OFFSITE_CONF="${OFFSITE_CONF:-/opt/sticklive/.backup-offsite.env}"
if [ -f "$OFFSITE_CONF" ]; then
  # shellcheck source=/dev/null
  if ! . "$OFFSITE_CONF"; then
    echo "[backup] $(date -u +%FT%TZ) ERROR: no se pudo cargar $OFFSITE_CONF" >&2
    exit 2
  fi
fi

# ── Alerta de éxito/fallo (#292) ──────────────────────────────────────────────
# Sin BACKUP_PING_URL: no hay alerta externa (el cron seguirá escribiendo el log).
# Con BACKUP_PING_URL: un ping por ejecución. Convención:
#   · healthchecks.io / dead-man-snitch → GET a la URL en éxito y a "<url>/fail" en fallo.
#   · Sentry Cron Monitor (URL con "/cron/") → "?status=ok" en éxito y "?status=error" en fallo.
# Es best-effort: un fallo del ping NUNCA cambia el resultado del backup.
PING_URL="${BACKUP_PING_URL:-}"

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
      echo "[backup] aviso: no se pudo enviar el ping ($status) a $url" >&2
    fi
  elif command -v wget >/dev/null 2>&1; then
    if ! wget -q -T 10 -O /dev/null "$url"; then
      echo "[backup] aviso: no se pudo enviar el ping ($status) a $url" >&2
    fi
  else
    echo "[backup] aviso: BACKUP_PING_URL definido pero no hay curl ni wget" >&2
  fi
}

# Prueba del canal de alertas sin tocar la BD ni el off-site:
#   BACKUP_PING_URL=... /opt/sticklive/deploy/backup-db.sh --test-alert
if [ "${1:-}" = "--test-alert" ]; then
  if [ -z "$PING_URL" ]; then
    echo "[backup] ERROR: define BACKUP_PING_URL para probar la alerta" >&2
    exit 1
  fi
  echo "[backup] enviando ping de prueba (ok) y (fail) a $PING_URL"
  ping_monitor ok
  ping_monitor fail
  echo "[backup] prueba enviada: revisa que el monitor reciba ambos eventos"
  exit 0
fi

# Ping de éxito/fallo al salir, con el código real del script (exit 1 = dump,
# exit 2 = off-site) para que el monitor distinga el tipo de fallo.
on_exit() {
  local code=$?
  if [ "$code" -eq 0 ]; then
    ping_monitor ok
  else
    ping_monitor fail
  fi
}
trap on_exit EXIT

mkdir -p "$BACKUP_DIR"

# Dump a temporal. Con pipefail, un fallo de pg_dump aborta aquí (no se rota nada).
$COMPOSE exec -T postgres pg_dump -U sports_user sports_results | gzip > "$TMP"

# Verificación: gzip íntegro y tamaño razonable.
gzip -t "$TMP"
SIZE=$(stat -c%s "$TMP")
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "[backup] $(date -u +%FT%TZ) ERROR: dump sospechosamente pequeño ($SIZE bytes) — abortando, NO se rota" >&2
  rm -f "$TMP"
  exit 1
fi

# Solo tras verificar: publicar atómicamente y rotar.
mv "$TMP" "$OUT"
ls -1t "$BACKUP_DIR"/sticklive-*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f

echo "[backup] $(date -u +%FT%TZ) OK → $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"

# ── Copia off-site (#289) ─────────────────────────────────────────────────────
# Requiere /opt/sticklive/.backup-offsite.env con OFFSITE_TARGET (ver
# deploy/.backup-offsite.env.example). Sincroniza los .sql.gz por rsync-over-SSH
# (sin --delete: el destino acumula histórico → retención larga off-site). Sin
# OFFSITE_TARGET se omite (el backup local queda intacto); verify-backup.sh
# avisará de que el off-site no está activo.
if [ -n "${OFFSITE_TARGET:-}" ]; then
  # Validación: host:ruta + rsync disponible + clave SSH legible (si se usa -i).
  case "$OFFSITE_TARGET" in
    *:*) : ;;
    *)
      echo "[backup] $(date -u +%FT%TZ) ERROR: OFFSITE_TARGET debe ser host:ruta (p. ej. u123@u123.your-storagebox.de:backups/)" >&2
      exit 2
      ;;
  esac
  if ! command -v rsync >/dev/null 2>&1; then
    echo "[backup] $(date -u +%FT%TZ) ERROR: OFFSITE_TARGET definido pero rsync no está instalado" >&2
    exit 2
  fi
  SSH_KEY=""
  read -r -a SSH_OPTS_ARR <<< "${OFFSITE_SSH_OPTS:-}"
  for ((i = 0; i < ${#SSH_OPTS_ARR[@]}; i++)); do
    case "${SSH_OPTS_ARR[$i]}" in
      -i) SSH_KEY="${SSH_OPTS_ARR[$((i + 1))]:-}" ;;
      -i*) SSH_KEY="${SSH_OPTS_ARR[$i]#-i}" ;;
    esac
  done
  if [ -n "$SSH_KEY" ] && [ ! -r "$SSH_KEY" ]; then
    echo "[backup] $(date -u +%FT%TZ) ERROR: la clave SSH $SSH_KEY no existe o no es legible" >&2
    exit 2
  fi

  echo "[backup] $(date -u +%FT%TZ) off-site → $OFFSITE_TARGET"
  # Alerta si el push off-site falla (auditoría C2): el backup local ya está
  # OK y rotado, pero perder la copia off-site sin enterarse reintroduce el
  # riesgo de "todo en el mismo VPS". Se sale con código 2 (distinto del 1 de
  # los fallos de dump) para que el monitor pueda alertar específicamente.
  if ! rsync -az -e "ssh ${OFFSITE_SSH_OPTS:-}" "$BACKUP_DIR"/sticklive-*.sql.gz "$OFFSITE_TARGET"; then
    echo "[backup] $(date -u +%FT%TZ) ALERTA: la copia OFF-SITE FALLÓ (backup local OK). Revisar Storage Box/SSH." >&2
    exit 2
  fi
  echo "[backup] $(date -u +%FT%TZ) off-site OK"
fi

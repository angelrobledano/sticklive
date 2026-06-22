#!/bin/bash
# ============================================================
# Backup diario de Postgres (producción).
#   · Dump comprimido a /opt/backups/sticklive-YYYYMMDD.sql.gz
#   · Verifica integridad (gzip -t) y tamaño antes de rotar
#   · Rotación: conserva los últimos 7
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

BACKUP_DIR=/opt/backups
COMPOSE="docker compose -f /opt/sticklive/docker-compose.prod.yml --env-file /opt/sticklive/.env.prod"
STAMP=$(date +%Y%m%d)
TMP="$BACKUP_DIR/.sticklive-$STAMP.sql.gz.tmp"
OUT="$BACKUP_DIR/sticklive-$STAMP.sql.gz"
MIN_BYTES=102400 # 100 KB: un dump real pesa mucho más; por debajo = sospechoso

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

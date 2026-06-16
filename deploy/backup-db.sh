#!/bin/sh
# ============================================================
# Backup diario de Postgres (producción).
#   · Dump comprimido a /opt/backups/sticklive-YYYYMMDD.sql.gz
#   · Rotación: conserva los últimos 7
# Instalación (una vez, como root):
#   chmod +x /opt/sticklive/deploy/backup-db.sh
#   echo '15 4 * * * root /opt/sticklive/deploy/backup-db.sh >> /var/log/sticklive-backup.log 2>&1' > /etc/cron.d/sticklive-backup
# Restaurar:
#   gunzip -c /opt/backups/sticklive-YYYYMMDD.sql.gz | docker compose -f /opt/sticklive/docker-compose.prod.yml --env-file /opt/sticklive/.env.prod exec -T postgres psql -U sports_user -d sports_results
# ============================================================
set -eu

BACKUP_DIR=/opt/backups
COMPOSE="docker compose -f /opt/sticklive/docker-compose.prod.yml --env-file /opt/sticklive/.env.prod"
STAMP=$(date +%Y%m%d)

mkdir -p "$BACKUP_DIR"

$COMPOSE exec -T postgres pg_dump -U sports_user sports_results \
  | gzip > "$BACKUP_DIR/sticklive-$STAMP.sql.gz"

# Rotación: borrar todo lo que no sean los 7 más recientes
ls -1t "$BACKUP_DIR"/sticklive-*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f

echo "[backup] $(date -u +%FT%TZ) OK → sticklive-$STAMP.sql.gz ($(du -h "$BACKUP_DIR/sticklive-$STAMP.sql.gz" | cut -f1))"

#!/bin/bash
# ============================================================
# Verifica que el ÚLTIMO backup es RESTAURABLE, en una base de datos
# TEMPORAL, sin tocar producción. Un backup que no se puede restaurar
# no es un backup.
#
#   1. Coge el .sql.gz más reciente de /opt/backups
#   2. Lo restaura en sports_results_verify
#   3. Imprime conteos de sanidad (matches/teams/match_events)
#   4. Borra la BD temporal
#
# Uso (como root):
#   chmod +x /opt/sticklive/deploy/verify-backup.sh
#   /opt/sticklive/deploy/verify-backup.sh
# Opcional, semanal:
#   echo '30 4 * * 1 root /opt/sticklive/deploy/verify-backup.sh >> /var/log/sticklive-backup.log 2>&1' > /etc/cron.d/sticklive-verify
# ============================================================
set -euo pipefail

BACKUP_DIR=/opt/backups
COMPOSE="docker compose -f /opt/sticklive/docker-compose.prod.yml --env-file /opt/sticklive/.env.prod"
VERIFY_DB=sports_results_verify

LATEST=$(ls -1t "$BACKUP_DIR"/sticklive-*.sql.gz 2>/dev/null | head -1 || true)
[ -n "$LATEST" ] || { echo "[verify] ERROR: no hay backups en $BACKUP_DIR" >&2; exit 1; }

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

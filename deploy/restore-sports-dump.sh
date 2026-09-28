#!/bin/sh
# ============================================================
# Restaura un dump COMPLETO del PC en producción PRESERVANDO
# los datos de usuarios del servidor (cuentas, favoritos en
# nube, sesiones, suscripciones push, pedidos).
#   · user_sessions se preserva desde #309: sin él, el restore
#     cierra todas las sesiones y obliga a re-loguear.
#
# Uso (en el servidor, con el dump ya subido por scp):
#   ./deploy/restore-sports-dump.sh /opt/sticklive/dump.sql.gz
# ============================================================
set -eu

DUMP="${1:?Uso: restore-sports-dump.sh /ruta/al/dump.sql.gz}"
COMPOSE="docker compose -f /opt/sticklive/docker-compose.prod.yml --env-file /opt/sticklive/.env.prod"

echo "→ 1/7 Backup de seguridad del estado actual"
/opt/sticklive/deploy/backup-db.sh

echo "→ 2/7 Salvando datos de usuarios del servidor"
$COMPOSE exec -T postgres pg_dump -U sports_user -d sports_results --data-only \
  -t users -t user_favorites -t auth_tokens -t user_sessions -t push_subscriptions -t orders > /tmp/userdata.sql

echo "→ 3/7 Parando servicios (etl, api, web)"
$COMPOSE stop etl api web

echo "→ 4/7 Recreando base de datos"
$COMPOSE exec -T postgres psql -U sports_user -d postgres -c "DROP DATABASE sports_results;"
$COMPOSE exec -T postgres psql -U sports_user -d postgres -c "CREATE DATABASE sports_results OWNER sports_user;"

echo "→ 5/7 Restaurando dump (esto tarda unos minutos)"
gunzip -c "$DUMP" | $COMPOSE exec -T postgres psql -U sports_user -d sports_results -q

echo "→ 6/7 Reaplicando datos de usuarios del servidor"
$COMPOSE exec -T postgres psql -U sports_user -d sports_results -c \
  "TRUNCATE user_favorites, auth_tokens, user_sessions, push_subscriptions, orders, users RESTART IDENTITY CASCADE;"
$COMPOSE exec -T postgres psql -U sports_user -d sports_results -q < /tmp/userdata.sql

echo "→ 7/7 Arrancando servicios"
$COMPOSE up -d

echo "✅ Restore completado. Verifica https://sticklive.eu"

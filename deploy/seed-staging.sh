#!/usr/bin/env bash
# A4 · Fase 1 — (re)crea la BD de staging `sports_staging` a partir de un dump
# de producción, en la MISMA instancia Postgres. Solo LEE de prod (pg_dump); no
# modifica `sports_results`. Idempotente: se puede relanzar antes de cada corrida
# de scraping para que staging nunca derive de prod.
#
# Ejecutar EN EL SERVIDOR (no por el túnel), desde la carpeta del compose:
#   cd /opt/sticklive && bash deploy/seed-staging.sh
#
# Después, para scrapear contra staging desde el PC, apunta DATABASE_URL a
# `…/sports_staging` (mismo túnel SSH, mismo puerto; solo cambia el nombre de BD).
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
STAGING_DB="sports_staging"
STO_MS="300000"   # statement_timeout de la BD de staging, en ms (300 s)

if [ ! -f "$COMPOSE_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "✗ Ejecuta esto desde la carpeta del compose (donde están $COMPOSE_FILE y $ENV_FILE)." >&2
  exit 1
fi

DC="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"

echo "→ Espacio en disco (el dump duplica temporalmente el tamaño de la BD):"
df -h / | tail -1

echo "→ (Re)creando $STAGING_DB y volcando prod dentro del contenedor postgres…"
# El trabajo ocurre dentro del contenedor: socket local + credenciales propias.
# Las variables SDB/STO_MS entran por -e para no pelear con las comillas.
$DC exec -T -e SDB="$STAGING_DB" -e STO_MS="$STO_MS" postgres sh -euc '
  set -o pipefail
  echo "  · DROP/CREATE $SDB (WITH FORCE corta conexiones vivas)…"
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$SDB\" WITH (FORCE);"
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SDB\" OWNER \"$POSTGRES_USER\";"
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE \"$SDB\" SET statement_timeout TO $STO_MS;"
  echo "  · pg_dump $POSTGRES_DB → $SDB (esquema + datos, mismos UUID)…"
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | psql -U "$POSTGRES_USER" -d "$SDB" -v ON_ERROR_STOP=1 --quiet
'

echo "→ Paridad rápida (nº de tablas públicas y de partidos en ambas BDs):"
$DC exec -T -e SDB="$STAGING_DB" postgres sh -euc '
  for DB in "$POSTGRES_DB" "$SDB"; do
    T=$(psql -U "$POSTGRES_USER" -d "$DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\'';")
    M=$(psql -U "$POSTGRES_USER" -d "$DB" -tAc "SELECT count(*) FROM matches;" 2>/dev/null || echo "n/a")
    printf "  · %-16s tablas=%s partidos=%s\n" "$DB" "$T" "$M"
  done
'

echo "✓ $STAGING_DB listo: esquema + datos de prod, mismos UUID, statement_timeout=${STO_MS}ms."
echo "  Siguiente paso del ciclo: scrapear con DATABASE_URL→$STAGING_DB, luego validar y promover."

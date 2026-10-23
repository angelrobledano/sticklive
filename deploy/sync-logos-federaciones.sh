#!/bin/bash
# Logos de competición desde el catálogo de cada portal sidgad.
#   bash deploy/sync-logos-federaciones.sh           # en seco: lista lo que pondría
#   bash deploy/sync-logos-federaciones.sh --write
# Las competiciones sin logo en el catálogo siguen mostrando la bandera.
set -uo pipefail
cd "$(dirname "$0")/.."
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
EXTRA=()
[ "${1:-}" = "--write" ] && EXTRA=(--write)
for p in rfep worldskate fecapa fisr fmp fap fpcv fnp fgpatinaxe; do
  echo "════════ $p"
  OUT=$($DC exec -T etl node dist/apps/etl/src/sync-competition-logos.js --portal=$p "${EXTRA[@]}" 2>&1)
  echo "$OUT" | grep -vE '^\{'
  echo "$OUT" | grep -oE '"(updated|skipped)":[0-9]+' | paste -sd' '
done

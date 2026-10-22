#!/bin/bash
# ============================================================
# Comprobaciones EN SECO tras desplegar identidad por portal (A1-A7) y
# oportunidades (B1-B5). No escribe nada: informa de lo que harían los pasos
# de datos de los runbooks para revisarlo antes de lanzarlos con --write.
#
#   docs/runbook-identidad-por-portal.md · docs/runbook-oportunidades-okmob.md
#
# Uso (en el servidor, tras ./deploy/deploy.sh):
#   bash deploy/post-deploy-identidad.sh
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"

psql_q() {
  $DC exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " | "' <<< "$1"
}

echo "== Migraciones aplicadas (últimas)"
psql_q "SELECT name FROM _migrations ORDER BY name DESC LIMIT 6;"

echo "== A1: jugadores que siguen en varios portales (a separar con A2)"
psql_q "SELECT players_mixed FROM apply_portal_namespacing();"

echo "== A1: refs ya con portal"
psql_q "SELECT split_part(source_ref, '_player_', 1) AS portal, count(*) FROM players WHERE source_ref LIKE '%\\_player\\_%' GROUP BY 1 ORDER BY 2 DESC;"

echo "== A2 (dry-run): separar jugadores fusionados"
$DC exec -T etl node dist/apps/etl/src/split-merged-players.js 2>&1 | grep -vE '^\s+(service|module|pid|hostname)' | tail -40

echo "== A4 (dry-run): clubes por escudo y género/categoría"
$DC exec -T etl node dist/apps/etl/src/backfill-clubs-by-crest.js 2>&1 | grep -vE '^\s+(service|module|pid|hostname)' | tail -60

echo "== B2 (dry-run): zonas de clasificación desde las bases 2026/27 (OK Liga e Iberdrola)"
$DC exec -T etl node dist/apps/etl/src/declare-standings-zones.js 2>&1 | tail -10

echo "== B5: partidos con acta que pasarían a 'partial' al recalcular"
psql_q "SELECT count(*) FROM matches m WHERE m.event_coverage = 'full' AND m.status = 'finished'
          AND EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id)
          AND ((SELECT count(*) FROM match_events e WHERE e.match_id = m.id AND e.event_type = 'goal' AND e.team_id = m.home_team_id) <> m.home_score
            OR (SELECT count(*) FROM match_events e WHERE e.match_id = m.id AND e.event_type = 'goal' AND e.team_id = m.away_team_id) <> m.away_score);"

echo "== Fin. Nada escrito."

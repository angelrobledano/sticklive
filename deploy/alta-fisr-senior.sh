#!/bin/bash
# ============================================================
# Alta de las competiciones SÉNIOR de Italia (FISR) 2026/27 (portal sidgad `fisr`).
# Catálogo: import-federations --only=fisr --catalog-only (23/10/2026, temp_41).
#
#   bash deploy/alta-fisr-senior.sh            # EN SECO: preflight + dry-run de cada seed
#   bash deploy/alta-fisr-senior.sh --write    # alta real + carga inicial de calendario/clasificación
#   bash deploy/alta-fisr-senior.sh --write --only=1896
#
# ORDEN = IDENTIDAD. La fuente llama igual al primer equipo y a sus filiales
# (HOCKEY TRISSINO juega A1, A2 y Serie B). Primero A1: crea los primeros
# equipos. Después A2 y B: el seed manda a la cola (/admin/resolucion) todo
# equipo homónimo que ya juega otra liga actual, en vez de fusionarlo. Esos
# homónimos son FILIALES: A2 y B van con --filial-if-shared y se crean como
# equipo B/C (squad_level) automáticamente; los parecidos dudosos, a la cola. Las copas comparten equipos (--allow-shared)
# y van DESPUÉS de su liga para reutilizarlos, buscando PRIMERO entre los
# equipos de su liga (--teams-from): la Coppa A2 es de los equipos de A2 (el
# TRISSINO de la Coppa A2 es el filial, no el de A1).
#
# Hora: sidgad publica en hora local italiana. Europe/Rome = Europe/Madrid en
# todo el año, pero se fija competitions.timezone = Europe/Rome por corrección.
# Directo: el feed en vivo de cron-live es de la RFEP; FISR entra por
# calendario (horario) + fichas, como FECAPA.
#
# Requisitos (el preflight los comprueba y PARA si fallan):
#   · Desplegado el commit que hace que el cron horario pida cada competición a
#     SU portal (sourceForCompetitionRef). Sin él, una competición FECAPA activa
#     se pediría a la RFEP.
#   · Identidad por portal aplicada (runbook-identidad-por-portal.md):
#     sin fusiones reales entre portales (split-merged-players en seco = 0).
#
# Qué hace cada alta (seed-fep-competition): descubre los equipos en sidgad,
# reutiliza los que ya existen (por ref, slug o alias), manda los dudosos a la
# cola /admin/resolucion y crea el resto; competición + temporada 2026/27 +
# competition_sources. Revisa en el dry-run la sección de identidad.
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"

WRITE=0; ONLY=""
for a in "$@"; do
  case "$a" in
    --write) WRITE=1 ;;
    --only=*) ONLY="${a#--only=}" ;;
    *) echo "opción desconocida: $a" >&2; exit 2 ;;
  esac
done

PORTAL_ENV=(-e SIDGAD_PORTAL=fisr -e SIDGAD_REFERER=https://hockeypista.fisr.it/)
COMMON=(--organizer=FISR --country=IT --scope=national --season=2026/27 --temp=41 --start=2026-09-01 --end=2027-06-30 --min-score=0.6)

# idc | nombre | corto | género | extra
COMPS=(
  "1896|CAMPIONATO SERIE A1|Serie A1|male|"
  "1906|SUPERCOPPA ITALIANA|Supercoppa|male|--format=bracket --allow-shared=true --teams-from=1896"
  "1910|SKATE ITALIA TROPHY|Skate Italia Trophy|male|--format=bracket --allow-shared=true --teams-from=1896"
  "1895|CAMPIONATO SERIE A2|Serie A2|male|--filial-if-shared=true"
  "1904|COPPA ITALIA A2|Coppa Italia A2|male|--format=bracket --allow-shared=true --teams-from=1895"
  "1894|CAMPIONATO SERIE B|Serie B|male|--filial-if-shared=true"
  "1909|COPPA ITALIA SERIE B|Coppa Italia B|male|--format=bracket --allow-shared=true --teams-from=1894"
  "1907|SUPERCOPPA ITALIANA FEMMINILE|Supercoppa F|female|--format=bracket"
)

psql_q() { $DC exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<< "$1"; }

# ── Preflight ─────────────────────────────────────────────
echo "== Preflight"
if ! $DC exec -T etl grep -q "function sourceForCompetitionRef" dist/apps/etl/src/run-pipeline.js 2>/dev/null; then
  echo "ERROR: el etl desplegado no lleva el arreglo de portal por competición. Despliega main antes (./deploy/deploy.sh)." >&2
  exit 1
fi
# Fusiones REALES (colisión de ids entre portales). Las personas enlazadas a
# propósito en /admin (misma persona en RFEP y FECAPA, ref registrada en
# player_source_refs) no cuentan: `players_mixed` de la 081 sí las contaba.
MIXED=$($DC exec -T etl node dist/apps/etl/src/split-merged-players.js 2>/dev/null | sed -n 's/^\([0-9]\+\) jugadores fusionados.*/\1/p' | tail -1)
echo "jugadores fusionados entre portales = ${MIXED:-?}"
if [ "${MIXED:-1}" != "0" ]; then
  echo "ERROR: hay jugadores fusionados entre portales. Revísalos con split-merged-players.js (en seco):" >&2
  echo "  · personas distintas → split-merged-players.js --write" >&2
  echo "  · la misma persona   → enlázala en /admin y vuelve a lanzar esto" >&2
  exit 1
fi
echo "OK"

# ── Altas ─────────────────────────────────────────────────
for row in "${COMPS[@]}"; do
  IFS='|' read -r IDC NAME SHORT GENDER EXTRA <<< "$row"
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$IDC,"* ]]; then continue; fi
  echo; echo "════════ $IDC · $NAME ════════"
  # shellcheck disable=SC2086
  ARGS=(--idc="$IDC" --name="$NAME" --short="$SHORT" --gender="$GENDER" "${COMMON[@]}" $EXTRA)

  if [ "$WRITE" -eq 0 ]; then
    $DC exec -T "${PORTAL_ENV[@]}" etl node dist/apps/etl/src/seed-fep-competition.js "${ARGS[@]}"
    continue
  fi

  OUT=$($DC exec -T "${PORTAL_ENV[@]}" etl node dist/apps/etl/src/seed-fep-competition.js "${ARGS[@]}" --write=true 2>&1)
  echo "$OUT" | grep -E "Sección|identidad|nuevos|dudoso|SEASON_ID|Equipos:|ERROR|Error" || true
  SEASON_ID=$(echo "$OUT" | sed -n 's/^SEASON_ID=//p' | tail -1)
  if [ -z "$SEASON_ID" ]; then echo "  ⚠️  sin SEASON_ID: revisa la salida completa del seed"; continue; fi
  psql_q "UPDATE competitions SET timezone = 'Europe/Rome', country = 'IT' WHERE source_ref = 'fisr_competition_$IDC';" >/dev/null

  $DC exec -T "${PORTAL_ENV[@]}" etl flock -w "${LOCK_WAIT:-600}" /tmp/etl-pipeline.lock \
    node dist/apps/etl/src/run-pipeline.js --entity=calendar --idc="$IDC" --season-id="$SEASON_ID" >/dev/null 2>&1 \
    && echo "  calendario ✓" || echo "  calendario ✗ (revisa logs del etl)"
  if [[ "$EXTRA" != *"--format="* ]]; then
    $DC exec -T "${PORTAL_ENV[@]}" etl flock -w "${LOCK_WAIT:-600}" /tmp/etl-pipeline.lock \
      node dist/apps/etl/src/run-pipeline.js --entity=standings --idc="$IDC" --season-id="$SEASON_ID" >/dev/null 2>&1 \
      && echo "  clasificación ✓" || echo "  clasificación ✗ (revisa logs del etl)"
  fi
done

echo; echo "== Resumen"
psql_q "SELECT c.idc_name, count(DISTINCT m.id) AS partidos, count(DISTINCT st.team_id) AS equipos
          FROM (SELECT c.id, c.name AS idc_name FROM competitions c WHERE c.organizer = 'FISR') c
          JOIN seasons s ON s.competition_id = c.id AND s.is_current
          LEFT JOIN matches m ON m.season_id = s.id
          LEFT JOIN season_teams st ON st.season_id = s.id
         GROUP BY 1 ORDER BY 1;"
[ "$WRITE" -eq 0 ] && echo && echo "(en seco) Nada escrito. Revisa la identidad de cada liga y repite con --write."
echo "Dudosos (filiales homónimos): revisa /admin/resolucion y da de alta los filiales con --only=<idc> + --force-new/--squad-level (ver cabecera)."

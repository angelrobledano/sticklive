#!/bin/bash
# ============================================================
# Alta de las competiciones 2026/27 de Galicia (FGP) (11), portal sidgad.
# Catálogo: import-federations --catalog-only (23/10/2026, temp_41).
#
#   bash deploy/alta-XX.sh            # EN SECO
#   bash deploy/alta-XX.sh --write
#
# Mismo esquema que FECAPA: --filial-if-shared en ligas (1ª antes que 2ª),
# copas con --allow-shared y --teams-from su liga, --min-score=0.6.
#
# Requisitos (el preflight los comprueba y PARA si fallan):
#   · Desplegado el commit que hace que el cron horario pida cada competición a
#     SU portal (sourceForCompetitionRef). Sin él, una competición FECAPA activa
#     se pediría a la RFEP.
#   · Identidad por portal aplicada (runbook-identidad-por-portal.md):
#     sin fusiones reales entre portales (split-merged-players en seco = 0).
#
# Identidad (23/10, tras el primer dry-run):
#   · Ligas (Nacional/Primera/Segona/Tercera): --filial-if-shared. Un homónimo
#     de un equipo que ya juega otra liga actual (Barça, Caldes, Igualada…) es
#     su FILIAL → se crea como B/C con squad_level, no va a la cola.
#   · Lligues Catalanes y Supercopas: torneos de pretemporada con los PRIMEROS
#     equipos → --allow-shared (se reutilizan).
#   · --min-score=0.6: un parecido de trigramas por debajo (Castellar ~ Girona
#     0.43) no bloquea el alta.
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

PORTAL_ENV=(-e SIDGAD_PORTAL=fgpatinaxe -e SIDGAD_REFERER=https://www.hockeypatines.fgpatinaxe.gal/)
COMMON=(--organizer=FGP --region="Galicia" --scope=regional --season=2026/27 --temp=41 --start=2026-09-01 --end=2027-06-30 --min-score=0.6)

# idc | nombre | corto | género | categoría (age_category) | extra
COMPS=(
  "4853934|SENIOR MASCULINO GALICIA|Sénior Galicia|male|senior|--filial-if-shared=true"
  "4853935|SENIOR FEMENINO GALICIA|Sénior F Galicia|female|senior|--filial-if-shared=true"
  "4853936|JUNIOR GALICIA|Júnior Galicia|male|junior|--filial-if-shared=true"
  "4853937|JUVENIL GALICIA|Juvenil Galicia|male|juvenil|--filial-if-shared=true"
  "4853938|INFANTIL GALICIA|Infantil Galicia|male|infantil|--filial-if-shared=true"
  "4853939|ALEVÍN GALICIA|Alevín Galicia|male|alevin|--filial-if-shared=true"
  "4853940|JUVENIL FEMENINO GALICIA|Juvenil F Galicia|female|juvenil|--filial-if-shared=true"
  "4853941|INFANTIL FEMENINO GALICIA|Infantil F Galicia|female|infantil|--filial-if-shared=true"
  "4853942|ALEVÍN FEMENINO GALICIA|Alevín F Galicia|female|alevin|--filial-if-shared=true"
  "4853901|COPA GALICIA MASCULINA|Copa Galicia|male|senior|--format=bracket --allow-shared=true --teams-from=4853934"
  "4853902|COPA GALICIA FEMENINA|Copa Galicia F|female|senior|--format=bracket --allow-shared=true --teams-from=4853935"
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
  IFS='|' read -r IDC NAME SHORT GENDER AGE EXTRA <<< "$row"
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$IDC,"* ]]; then continue; fi
  echo; echo "════════ $IDC · $NAME ════════"
  # shellcheck disable=SC2086
  ARGS=(--idc="$IDC" --name="$NAME" --short="$SHORT" --gender="$GENDER" --age="$AGE" --category="$AGE" "${COMMON[@]}" $EXTRA)

  if [ "$WRITE" -eq 0 ]; then
    $DC exec -T "${PORTAL_ENV[@]}" etl node dist/apps/etl/src/seed-fep-competition.js "${ARGS[@]}"
    continue
  fi

  OUT=$($DC exec -T "${PORTAL_ENV[@]}" etl node dist/apps/etl/src/seed-fep-competition.js "${ARGS[@]}" --write=true 2>&1)
  echo "$OUT" | grep -E "Sección|identidad|nuevos|dudoso|SEASON_ID|Equipos:|ERROR|Error" || true
  SEASON_ID=$(echo "$OUT" | sed -n 's/^SEASON_ID=//p' | tail -1)
  if [ -z "$SEASON_ID" ]; then echo "  ⚠️  sin SEASON_ID: revisa la salida completa del seed"; continue; fi

  $DC exec -T "${PORTAL_ENV[@]}" etl flock -w 600 /tmp/etl-pipeline.lock \
    node dist/apps/etl/src/run-pipeline.js --entity=calendar --idc="$IDC" --season-id="$SEASON_ID" >/dev/null 2>&1 \
    && echo "  calendario ✓" || echo "  calendario ✗ (revisa logs del etl)"
  if [[ "$EXTRA" != *"--format="* ]]; then
    $DC exec -T "${PORTAL_ENV[@]}" etl flock -w 600 /tmp/etl-pipeline.lock \
      node dist/apps/etl/src/run-pipeline.js --entity=standings --idc="$IDC" --season-id="$SEASON_ID" >/dev/null 2>&1 \
      && echo "  clasificación ✓" || echo "  clasificación ✗ (revisa logs del etl)"
  fi
done

echo; echo "== Resumen"
psql_q "SELECT c.idc_name, count(DISTINCT m.id) AS partidos, count(DISTINCT st.team_id) AS equipos
          FROM (SELECT c.id, c.name AS idc_name FROM competitions c WHERE c.organizer = 'FGP') c
          JOIN seasons s ON s.competition_id = c.id AND s.is_current
          LEFT JOIN matches m ON m.season_id = s.id
          LEFT JOIN season_teams st ON st.season_id = s.id
         GROUP BY 1 ORDER BY 1;"
[ "$WRITE" -eq 0 ] && echo && echo "(en seco) Nada escrito. Revisa la identidad de cada liga y repite con --write."
echo "Dudosos a resolver a mano: /admin/resolucion"

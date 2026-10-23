#!/bin/bash
# ============================================================
# Alta de la BASE, veteranos y torneos Golden Cat de FECAPA 2026/27 (46).
# Catálogo: docs/plan-cobertura-fecapa-2026-27.md (22/10/2026, temp_41).
#
#   bash deploy/alta-fecapa-base.sh                  # EN SECO
#   bash deploy/alta-fecapa-base.sh --write
#   bash deploy/alta-fecapa-base.sh --write --only=4782,4784
#
# Categorías (age_category) — equivalencia del plan B3, decidida el 23/10:
#   FEMENÍ 19 → junior · 17 → juvenil · 15 → infantil · 13 → alevin ·
#   11 → benjamin · MINIFEM → base. YOUTH GOLDEN CAT → base.
# Orden dentro de cada categoría: Or → Plata → Bronze, para que el homónimo de
# la división inferior salga como filial (--filial-if-shared) del de arriba.
# GoldenCat FEMENÍ: el plan lo clasificó como masculino por error; aquí female.
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

PORTAL_ENV=(-e SIDGAD_PORTAL=fecapa -e SIDGAD_REFERER=https://www.fecapa.cat/)
COMMON=(--organizer=FECAPA --region=Cataluña --scope=regional --season=2026/27 --temp=41 --start=2026-09-01 --end=2027-06-30 --min-score=0.6)

# idc | nombre | corto | género | categoría (age_category) | extra
COMPS=(
  "4782|JÚNIOR OR|Júnior Or|male|junior|--filial-if-shared=true"
  "4783|JÚNIOR PLATA|Júnior Plata|male|junior|--filial-if-shared=true"
  "4784|JUVENIL OR|Juvenil Or|male|juvenil|--filial-if-shared=true"
  "4785|JUVENIL PLATA|Juvenil Plata|male|juvenil|--filial-if-shared=true"
  "4786|INFANTIL OR|Infantil Or|male|infantil|--filial-if-shared=true"
  "4787|INFANTIL PLATA|Infantil Plata|male|infantil|--filial-if-shared=true"
  "4788|INFANTIL BRONZE|Infantil Bronze|male|infantil|--filial-if-shared=true"
  "4789|ALEVÍ OR|Aleví Or|male|alevin|--filial-if-shared=true"
  "4790|ALEVÍ PLATA|Aleví Plata|male|alevin|--filial-if-shared=true"
  "4791|ALEVÍ BRONZE|Aleví Bronze|male|alevin|--filial-if-shared=true"
  "4792|FEMENÍ 19|Femení 19|female|junior|--filial-if-shared=true"
  "4793|FEMENÍ 17 OR|Femení 17 Or|female|juvenil|--filial-if-shared=true"
  "4794|FEMENÍ 17 PLATA|Femení 17 Plata|female|juvenil|--filial-if-shared=true"
  "4802|FEMENÍ 15 OR|Femení 15 Or|female|infantil|--filial-if-shared=true"
  "4803|FEMENÍ 15 PLATA|Femení 15 Plata|female|infantil|--filial-if-shared=true"
  "4804|FEMENÍ 13 OR|Femení 13 Or|female|alevin|--filial-if-shared=true"
  "4805|FEMENÍ 13 PLATA|Femení 13 Plata|female|alevin|--filial-if-shared=true"
  "4806|FEMENÍ 11 OR|Femení 11 Or|female|benjamin|--filial-if-shared=true"
  "4807|FEMENÍ 11 PLATA|Femení 11 Plata|female|benjamin|--filial-if-shared=true"
  "4808|MINIFEM|Minifem|female|base|--filial-if-shared=true"
  "4810|BENJAMÍ OR BARCELONA|Benjamí Or BCN|male|benjamin|--filial-if-shared=true"
  "4811|BENJAMÍ PLATA BARCELONA|Benjamí Plata BCN|male|benjamin|--filial-if-shared=true"
  "4812|BENJAMÍ BRONZE BARCELONA|Benjamí Bronze BCN|male|benjamin|--filial-if-shared=true"
  "4817|BENJAMÍ OR TARRAGONA|Benjamí Or TGN|male|benjamin|--filial-if-shared=true"
  "4818|BENJAMÍ PLATA TARRAGONA|Benjamí Plata TGN|male|benjamin|--filial-if-shared=true"
  "4822|BENJAMÍ OR GIRONA|Benjamí Or GI|male|benjamin|--filial-if-shared=true"
  "4823|BENJAMÍ PLATA GIRONA|Benjamí Plata GI|male|benjamin|--filial-if-shared=true"
  "5027|BENJAMÍ LLEIDA|Benjamí LLD|male|benjamin|--filial-if-shared=true"
  "4813|PREBENJAMÍ OR BARCELONA|Prebenjamí Or BCN|male|prebenjamin|--filial-if-shared=true"
  "4814|PREBENJAMÍ PLATA BARCELONA|Prebenjamí Plata BCN|male|prebenjamin|--filial-if-shared=true"
  "4815|PREBENJAMÍ BRONZE BARCELONA|Prebenjamí Bronze BCN|male|prebenjamin|--filial-if-shared=true"
  "4816|PREBENJAMÍ INICIACIÓ BARCELONA|Prebenjamí Iniciació BCN|male|prebenjamin|--filial-if-shared=true"
  "4819|PREBENJAMÍ OR TARRAGONA|Prebenjamí Or TGN|male|prebenjamin|--filial-if-shared=true"
  "4820|PREBENJAMÍ PLATA TARRAGONA|Prebenjamí Plata TGN|male|prebenjamin|--filial-if-shared=true"
  "4821|PREBENJAMÍ BRONZE TARRAGONA|Prebenjamí Bronze TGN|male|prebenjamin|--filial-if-shared=true"
  "4824|PREBENJAMÍ OR GIRONA|Prebenjamí Or GI|male|prebenjamin|--filial-if-shared=true"
  "4825|PREBENJAMÍ PLATA GIRONA|Prebenjamí Plata GI|male|prebenjamin|--filial-if-shared=true"
  "4833|PREBENJAMÍ OR LLEIDA|Prebenjamí Or LLD|male|prebenjamin|--filial-if-shared=true"
  "4834|PREBENJAMÍ PLATA-BRONZE LLEIDA|Prebenjamí Plata LLD|male|prebenjamin|--filial-if-shared=true"
  "5045|LLIGA CATALANA DE VETERANS|Lliga Catalana Veterans|male|veteranos|--filial-if-shared=true"
  "5046|MÀSTER 50 LLIGA CATALANA DE VETERANS|Màster 50 Veterans|male|veteranos|--filial-if-shared=true"
  "5062|LLIGA VETERANS GIRONA|Veterans Girona|male|veteranos|--filial-if-shared=true"
  "5082|LLIGA VETERANS TARRAGONA|Veterans Tarragona|male|veteranos|--filial-if-shared=true"
  "5070|OPEN INTERNACIONAL GOLDENCAT MASCULÍ|GoldenCat Masculí|male|senior|--format=bracket --allow-shared=true"
  "5073|OPEN INTERNACIONAL GOLDENCAT FEMENÍ|GoldenCat Femení|female|senior|--format=bracket --allow-shared=true"
  "5076|YOUTH GOLDEN CAT|Youth GoldenCat|male|base|--format=bracket --allow-shared=true"
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
          FROM (SELECT c.id, c.name AS idc_name FROM competitions c WHERE c.organizer = 'FECAPA') c
          JOIN seasons s ON s.competition_id = c.id AND s.is_current
          LEFT JOIN matches m ON m.season_id = s.id
          LEFT JOIN season_teams st ON st.season_id = s.id
         GROUP BY 1 ORDER BY 1;"
[ "$WRITE" -eq 0 ] && echo && echo "(en seco) Nada escrito. Revisa la identidad de cada liga y repite con --write."
echo "Dudosos a resolver a mano: /admin/resolucion"

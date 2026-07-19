#!/usr/bin/env bash
# =============================================================================
# Verificación de la migración 034 + upsert de match_events (PR #36).
#
# Comprueba de una pasada las tres piezas de SQL que NO se pudieron ejecutar
# durante el desarrollo:
#
#   1. La migración 034 aplica limpia (dedupe + índices + UNIQUE parcial).
#   2. `replaceMatchEvents` con ON CONFLICT infiere bien el índice PARCIAL
#      `uq_match_events_match_source_ref` — es la sintaxis de mayor riesgo.
#   3. Los `id` de match_events NO cambian entre dos pasadas de la misma ficha.
#      Esto es lo que hace correcto el diff por id del push-dispatcher.
#
# Además valida `make_interval(...)` de rebote: /matches/current y el cron lo
# usan, y el paso 6 ejecuta esas consultas.
#
# Uso:
#   bash deploy/verify-034-event-identity.sh                  # elige partido solo
#   bash deploy/verify-034-event-identity.sh fep_match_34267  # partido concreto
#
# Requisitos: docker, node/npm. En Windows, ejecutar con el bash de Git:
#   & "C:\Program Files\Git\bin\bash.exe" deploy/verify-034-event-identity.sh
#
# NO toca producción en ningún momento: todo ocurre en el contenedor de dev.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.dev.yml"
PGUSER_DEV="sports_user"
PGDB_DEV=""   # se resuelve en el paso 1 (ver nota)
WANTED_REF="${1:-}"

# psql SIEMPRE dentro del contenedor: no hace falta tenerlo instalado en Windows.
psql_dev() { $COMPOSE exec -T postgres psql -U "$PGUSER_DEV" -d "$PGDB_DEV" -qtAX "$@"; }
psql_adm() { $COMPOSE exec -T postgres psql -U "$PGUSER_DEV" -d postgres -qtAX "$@"; }
db_exists() { [ "$(psql_adm -c "SELECT 1 FROM pg_database WHERE datname = '$1'")" = "1" ]; }

say()  { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; exit 1; }

# ── 1. Postgres de desarrollo ────────────────────────────────────────────────
# OJO: docker-compose.dev.yml es un OVERRIDE (no define `image`), hay que
# combinarlo con el base. Y se arranca SOLO el servicio postgres: el base
# declara además `api`, que apunta a un apps/api/Dockerfile inexistente.
say "1/7 Levantando Postgres de desarrollo"
$COMPOSE up -d postgres

# Esperar al SERVIDOR (sin -d: pg_isready no valida que exista la base, sólo
# que el servidor acepta conexiones — comprobarlo con la base equivocada da un
# falso verde y el fallo aparece dos pasos más tarde).
for i in $(seq 1 30); do
  if $COMPOSE exec -T postgres pg_isready -U "$PGUSER_DEV" >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = "30" ] && fail "Postgres no arrancó en 60 s"
done

# Resolver el NOMBRE de la base. POSTGRES_DB del compose sólo se aplica en la
# PRIMERA inicialización del volumen: si el contenedor ya existía de antes
# (creado con el compose base), la base se llama `sports_results` y no
# `sports_results_dev`. En vez de asumir, se mira qué hay realmente.
if db_exists sports_results_dev; then
  PGDB_DEV="sports_results_dev"
elif db_exists sports_results; then
  PGDB_DEV="sports_results"
else
  PGDB_DEV="sports_results_dev"
  psql_adm -c "CREATE DATABASE $PGDB_DEV OWNER $PGUSER_DEV" >/dev/null
fi
ok "Postgres listo — base de dev: $PGDB_DEV"

# Las herramientas de Node (migrate, run-pipeline) corren en el HOST y leen
# DATABASE_URL. Se exporta aquí para que apunten a la MISMA base que psql:
# Node da precedencia al entorno sobre --env-file, así que esto manda sobre .env
# y la prueba no depende de cómo lo tengas configurado.
export DATABASE_URL="postgresql://${PGUSER_DEV}:sports_pass@localhost:5432/${PGDB_DEV}"

# ── 2. Datos ─────────────────────────────────────────────────────────────────
# Sin partidos reales no hay nada que verificar. Si la BD está vacía, se
# restaura el dump del repo (es de solo lectura para esta prueba).
say "2/7 Comprobando que hay datos"
MATCH_COUNT="$(psql_dev -c "SELECT COUNT(*) FROM matches" 2>/dev/null || echo 0)"
if [ "${MATCH_COUNT:-0}" -lt 1 ]; then
  [ -f dump.sql.gz ] || fail "BD vacía y no encuentro dump.sql.gz. Restaura datos y reintenta."
  echo "  BD vacía → restaurando dump.sql.gz (tarda unos minutos)…"
  gunzip -c dump.sql.gz | $COMPOSE exec -T postgres psql -U "$PGUSER_DEV" -d "$PGDB_DEV" -q
  MATCH_COUNT="$(psql_dev -c "SELECT COUNT(*) FROM matches")"
fi
ok "$MATCH_COUNT partidos en la BD de dev"

# ── 3. Migraciones ───────────────────────────────────────────────────────────
say "3/7 Aplicando migraciones (incluida la 034)"
npm run db:migrate

INDEX_OK="$(psql_dev -c "SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'uq_match_events_match_source_ref'")"
[ "$INDEX_OK" = "1" ] || fail "No existe uq_match_events_match_source_ref — la 034 no se aplicó"
ok "Índice único parcial creado"

for idx in idx_matches_season_scheduled idx_matches_live_partial idx_matches_season_status_scheduled; do
  [ "$(psql_dev -c "SELECT COUNT(*) FROM pg_indexes WHERE indexname = '$idx'")" = "1" ] \
    || fail "Falta el índice $idx"
done
ok "Índices del directo creados"

# ── 4. FEP_SOURCE_ID ─────────────────────────────────────────────────────────
# Gotcha conocido: si esta env falta o lleva un placeholder no-UUID, el scraper
# revienta el upsert y los partidos se omiten en silencio. Se resuelve desde la
# propia BD para que la prueba no dependa de lo que haya en .env.
say "4/7 Resolviendo FEP_SOURCE_ID desde la BD"
FEP_SOURCE_ID="$(psql_dev -c "SELECT id FROM data_sources WHERE scraper_key = 'fep_hockey' LIMIT 1")"
[ -n "$FEP_SOURCE_ID" ] || fail "No hay fila data_sources con scraper_key='fep_hockey'"
export FEP_SOURCE_ID
ok "FEP_SOURCE_ID=$FEP_SOURCE_ID"

# ── 5. Elegir partido ────────────────────────────────────────────────────────
# Uno que YA tenga eventos: así la primera pasada del upsert se enfrenta a filas
# existentes, que es justo el caso que queremos probar (UPDATE, no INSERT).
say "5/7 Eligiendo partido de prueba"
if [ -n "$WANTED_REF" ]; then
  SOURCE_REF="$WANTED_REF"
else
  SOURCE_REF="$(psql_dev -c "
    SELECT m.source_ref
    FROM matches m
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions c ON c.id = s.competition_id
    WHERE m.source_ref LIKE 'fep_match_%'
      AND c.source_ref IS NOT NULL
      AND EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id AND e.source_ref IS NOT NULL)
    ORDER BY m.scheduled_at DESC
    LIMIT 1")"
fi
[ -n "$SOURCE_REF" ] || fail "No encuentro ningún partido con eventos y source_ref utilizable"

MATCH_ID="$(psql_dev -c "SELECT id FROM matches WHERE source_ref = '$SOURCE_REF'")"
[ -n "$MATCH_ID" ] || fail "No existe partido con source_ref=$SOURCE_REF"
ok "Partido $SOURCE_REF (id $MATCH_ID)"

dump_events() {
  psql_dev -c "SELECT id, source_ref, event_type, COALESCE(minute::text,'-'), COALESCE(period::text,'-')
               FROM match_events WHERE match_id = '$MATCH_ID' ORDER BY source_ref"
}

# ── 6. Dos pasadas de la ficha ───────────────────────────────────────────────
say "6/7 Ejecutando la ficha DOS veces (esto hace 2 peticiones a la fuente)"
BEFORE="$(mktemp)"; AFTER="$(mktemp)"
trap 'rm -f "$BEFORE" "$AFTER"' EXIT

npx tsx --env-file=.env apps/etl/src/run-pipeline.ts --entity=ficha --source-ref="$SOURCE_REF"
dump_events > "$BEFORE"
ok "Pasada 1: $(wc -l < "$BEFORE") eventos"

sleep 2
npx tsx --env-file=.env apps/etl/src/run-pipeline.ts --entity=ficha --source-ref="$SOURCE_REF"
dump_events > "$AFTER"
ok "Pasada 2: $(wc -l < "$AFTER") eventos"

# ── 7. Veredicto ─────────────────────────────────────────────────────────────
say "7/7 Comparando ids entre pasadas"
if diff -u "$BEFORE" "$AFTER" > /tmp/verify-034.diff; then
  ok "Los ids de match_events son ESTABLES entre pasadas"
else
  echo
  head -40 /tmp/verify-034.diff
  fail "Los ids CAMBIARON — el upsert no está funcionando (diff completo en /tmp/verify-034.diff)"
fi

DUPES="$(psql_dev -c "
  SELECT COUNT(*) FROM (
    SELECT match_id, source_ref FROM match_events
    WHERE source_ref IS NOT NULL
    GROUP BY match_id, source_ref HAVING COUNT(*) > 1
  ) d")"
[ "$DUPES" = "0" ] || fail "Hay $DUPES pares (match_id, source_ref) duplicados"
ok "Sin duplicados de (match_id, source_ref)"

# make_interval: las mismas expresiones que usan /matches/current y checkWindow.
psql_dev -c "SELECT COUNT(*) FROM matches
             WHERE scheduled_at >= NOW() - make_interval(days => 8)
               AND scheduled_at <  NOW() + make_interval(days => 15)" > /dev/null
psql_dev -c "SELECT COUNT(*) FROM matches
             WHERE scheduled_at BETWEEN NOW() AND NOW() + make_interval(hours => 2)" > /dev/null
ok "make_interval válido en las consultas del directo"

printf '\n\033[1;32m✅ Verificación completa: la 034 y el upsert se comportan como se esperaba.\033[0m\n'
printf '   El PR #36 puede mergearse. Recuerda en producción: migración ANTES que código.\n\n'

#!/bin/bash
# ============================================================
# Purga de imágenes de releases antiguas (hueco de disco, 10/10/2026).
#
# Cada deploy etiqueta 4 imágenes (migrate/api/web/etl) como
# `vYYYYMMDD-<sha>` y nada las limpiaba: 10 releases llegaron a ocupar
# 19 GB del VPS y el preflight de deploy.sh abortaba por espacio.
#
# Qué hace (idempotente, best-effort: nunca rompe un deploy):
#   Para cada servicio conserva los tags `:current`, `:previous` y
#   `:latest`, más TODOS los tags de release (`vYYYYMMDD-<sha>`) que
#   apunten a la MISMA imagen que `:current` o `:previous` (el objetivo
#   documentado del rollback #297). El resto de tags de release se
#   borra con `docker rmi`.
#
# Nunca toca: imágenes de otros repos, tags que no sean de release, ni
# los contenedores en marcha (solo retira etiquetas; las capas vivas
# siguen referenciadas por :current/:latest).
#
# Uso (en el VPS; lo invocan deploy.sh y tag-release.sh):
#   /opt/sticklive/deploy/prune-release-images.sh
#
# Variables:
#   SERVICES="..."    servicios a procesar (def. "migrate api web etl").
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose -f $REPO/docker-compose.prod.yml --env-file $REPO/.env.prod"
SERVICES="${SERVICES:-migrate api web etl}"

log()  { echo "[prune-releases] $(date -u +%FT%TZ) $*"; }
warn() { echo "[prune-releases] $(date -u +%FT%TZ) AVISO: $*" >&2; }

if ! command -v docker >/dev/null 2>&1; then
  warn "sin docker; nada que purgar"
  exit 0
fi

# Misma derivación de imagen que tag-release.sh: referencia del contenedor
# (aunque esté parado, p. ej. `migrate`) y, si no hay, del nombre de Compose.
for svc in $SERVICES; do
  cid="$($COMPOSE ps -a -q "$svc" 2>/dev/null | head -n1 || true)"
  ref=""
  if [ -n "$cid" ]; then
    ref="$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
  fi
  if [ -z "$ref" ] || printf '%s' "$ref" | grep -q '^sha256:'; then
    ref="$($COMPOSE config --images 2>/dev/null | grep -E "[-_]${svc}\$" | head -n1 || true)"
  fi
  if [ -z "$ref" ]; then
    warn "sin imagen para '$svc'; se omite"
    continue
  fi
  if printf '%s' "$ref" | grep -q '/'; then
    warn "referencia inesperada '$ref' para '$svc'; se omite"
    continue
  fi
  repo="${ref%%:*}"

  # Anclas por ID de imagen (no por nombre de tag): la release viva y su
  # rollback sobreviven aunque sus tags de release se llamen distinto.
  keep_current="$(docker image inspect --format '{{.Id}}' "$repo:current" 2>/dev/null || true)"
  keep_previous="$(docker image inspect --format '{{.Id}}' "$repo:previous" 2>/dev/null || true)"

  # Solo tags con forma de release (`vYYYYMMDD-<sha>`); cualquier otro tag
  # del repo queda fuera de la purga por decisión deliberada.
  purged=0
  while IFS= read -r tag; do
    [ -z "$tag" ] && continue
    id="$(docker image inspect --format '{{.Id}}' "$repo:$tag" 2>/dev/null || true)"
    if [ -n "$id" ] && { [ "$id" = "$keep_current" ] || [ "$id" = "$keep_previous" ]; }; then
      continue # apunta a la release viva o a su rollback: se conserva
    fi
    if docker rmi "$repo:$tag" >/dev/null 2>&1; then
      log "  $repo:$tag purgada"
      purged=$((purged + 1))
    else
      warn "no se pudo purgar $repo:$tag (¿en uso?); se sigue"
    fi
  done < <(docker image ls "$repo" --format '{{.Tag}}' 2>/dev/null | grep -E '^v[0-9]{8}-[0-9a-f]+$' || true)

  log "$repo: ${purged} release(s) antigua(s) purgada(s)"
done

log "purga de releases antiguas completada"

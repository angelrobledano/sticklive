#!/bin/bash
# ============================================================
# Etiqueta la versión desplegada en GIT y en DOCKER (#297).
#
# Sin esto no había forma de hacer un rollback rápido: las imágenes se
# re-etiquetaban a `:latest` en cada build y no se conservaba la anterior.
#
# Qué hace (idempotente, se puede relanzar):
#   1. Crea un tag de git `vYYYYMMDD-<sha>` en el commit desplegado.
#   2. Para cada servicio retiene su imagen como `:<release>` y `:current`, y
#      mueve la `:current` anterior a `:previous` (rollback en segundos).
#   3. Purga los tags de releases anteriores (prune-release-images.sh):
#      conservarlas todas llenó el disco del VPS (19 GB de imágenes).
#
# Uso (como root, DESPUÉS de un deploy verificado):
#   /opt/sticklive/deploy/tag-release.sh
#   /opt/sticklive/deploy/tag-release.sh --push   # además publica el tag git
#
# `deploy/deploy.sh` lo invoca solo al terminar un deploy correcto (best-effort).
#
# Variables:
#   TAG_PREFIX=v      prefijo del tag git (p. ej. `release-`).
#   SERVICES="..."    servicios a etiquetar (def. "migrate api web etl").
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose -f $REPO/docker-compose.prod.yml --env-file $REPO/.env.prod"

TAG_PREFIX="${TAG_PREFIX:-v}"
SERVICES="${SERVICES:-migrate api web etl}"
PUSH=0
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    -h|--help)
      awk 'NR==1{next} /^set -euo/{exit} {sub(/^# ?/,""); print}' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) echo "[tag-release] opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

log()  { echo "[tag-release] $(date -u +%FT%TZ) $*"; }
warn() { echo "[tag-release] $(date -u +%FT%TZ) AVISO: $*" >&2; }

SHA="$(git -C "$REPO" rev-parse --short HEAD)"
REL="${TAG_PREFIX}$(date -u +%Y%m%d)-$SHA"

# ── 1. Tag de git ────────────────────────────────────────────────────────────
if git -C "$REPO" rev-parse -q --verify "refs/tags/$REL" >/dev/null; then
  log "tag git $REL ya existe"
else
  if git -C "$REPO" tag -a "$REL" -m "release $REL" 2>/dev/null; then
    log "tag git $REL creado"
  else
    # Sin identidad de git configurada (usuario/email): tag ligero igualmente.
    git -C "$REPO" tag "$REL"
    log "tag git $REL creado (ligero; configura user.name/user.email para anotados)"
  fi
  if [ "$PUSH" -eq 1 ]; then
    git -C "$REPO" push origin "$REL"
    log "tag $REL publicado"
  fi
fi

# ── 2. Imágenes Docker ───────────────────────────────────────────────────────
# La referencia de imagen de cada servicio se toma del contenedor (aunque esté
# parado, p. ej. `migrate`) y, si no hay contenedor, del nombre generado por
# Compose. El repo destino es la parte sin `:tag`.
for svc in $SERVICES; do
  cid="$($COMPOSE ps -a -q "$svc" 2>/dev/null | head -n1 || true)"
  img_id=""
  ref=""
  if [ -n "$cid" ]; then
    img_id="$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true)"
    ref="$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
  fi
  if [ -z "$ref" ] || printf '%s' "$ref" | grep -q '^sha256:'; then
    ref="$($COMPOSE config --images 2>/dev/null | grep -E "[-_]${svc}\$" | head -n1 || true)"
  fi
  if [ -z "$ref" ]; then
    warn "sin imagen para '$svc'; se omite"
    continue
  fi
  # Solo `repo` o `repo:tag` (sin registro con puerto/namespace). En este VPS
  # las imágenes las genera Compose como `sticklive-<svc>`, sin `/`.
  if printf '%s' "$ref" | grep -q '/'; then
    warn "referencia inesperada '$ref' para '$svc'; se omite"
    continue
  fi
  repo="${ref%%:*}"
  # Si no hay contenedor, cae al ID de la imagen por nombre.
  if [ -z "$img_id" ]; then
    img_id="$(docker image inspect --format '{{.Id}}' "$ref" 2>/dev/null || true)"
  fi
  if [ -z "$img_id" ]; then
    warn "sin id de imagen para '$svc'; se omite"
    continue
  fi

  # current → previous SOLO si de verdad es una imagen distinta (idempotente:
  # relanzar el script sin desplegar no machaca el `previous` bueno).
  current_id="$(docker image inspect --format '{{.Id}}' "$repo:current" 2>/dev/null || true)"
  if [ -n "$current_id" ] && [ "$img_id" != "$current_id" ]; then
    docker tag "$current_id" "$repo:previous"
    log "  $repo:current → $repo:previous"
  fi
  docker tag "$img_id" "$repo:$REL"
  docker tag "$img_id" "$repo:current"
  log "  $repo:$REL y $repo:current listos"
done

# ── 3. Purga de releases antiguas ────────────────────────────────────────────
# Conserva `:current` y `:previous` (y los tags de release que apunten a esas
# mismas imágenes); el resto de tags `vYYYYMMDD-<sha>` se retira. Best-effort:
# un fallo aquí NO invalida la release recién etiquetada.
if [ -x "$SCRIPT_DIR/prune-release-images.sh" ]; then
  log "purgando releases antiguas (deploy/prune-release-images.sh)"
  "$SCRIPT_DIR/prune-release-images.sh" || warn "la purga de releases falló (no bloqueante)"
else
  warn "no encuentro prune-release-images.sh; no se purgan releases antiguas"
fi

log "etiquetado $REL completado"

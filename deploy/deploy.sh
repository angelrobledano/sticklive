#!/bin/bash
# ============================================================
# Despliegue de Stick Live en el VPS (producción).
#
#   git pull --ff-only → docker compose up -d --build → smoke test
#
# Por qué existe (auditoría pre-lanzamiento #248 y #165):
#   · El despliegue era manual y sin verificación: producción llegó a servir
#     un build anterior a `main` sin que nadie lo notara.
#   · El build de las imágenes puede llenar el disco del VPS de 4 GB ("no space
#     left on device"): este script comprueba el espacio ANTES y libera caché de
#     build si hace falta; como último recurso purga los tags de releases
#     antiguas (conserva `:current` y `:previous`, ver prune-release-images.sh).
#   · Tras desplegar, comprueba la versión viva (smoke), no solo que los
#     contenedores estén "up".
#
# Uso (como root, en el servidor):
#   chmod +x /opt/sticklive/deploy/deploy.sh
#   /opt/sticklive/deploy/deploy.sh
#
# Opciones:
#   --dry-run      Solo preflight + estado + smoke; no toca git ni reconstruye.
#   --skip-pull    No hace `git pull` (despliega el código ya presente).
#   --skip-smoke   No ejecuta el smoke test posterior.
#   -h | --help    Esta ayuda.
#
# Variables de entorno (todas opcionales):
#   BRANCH=main               Rama a desplegar.
#   REMOTE=origin             Remoto de git.
#   SMOKE_BASE=https://sticklive.eu   Base pública para el smoke.
#   MIN_FREE_GB=15            Espacio libre mínimo exigido antes de construir.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO/docker-compose.prod.yml"
ENV_FILE="$REPO/.env.prod"
COMPOSE="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"

BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
SMOKE_BASE="${SMOKE_BASE:-https://sticklive.eu}"
MIN_FREE_GB="${MIN_FREE_GB:-15}"

DRY_RUN=0
SKIP_PULL=0
SKIP_SMOKE=0

# ── Argumentos ─────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --skip-pull)  SKIP_PULL=1 ;;
    --skip-smoke) SKIP_SMOKE=1 ;;
    -h|--help)
      # Imprime el bloque de cabecera (líneas 2.. hasta `set -euo pipefail`).
      awk 'NR==1{next} /^set -euo/{exit} {sub(/^# ?/,""); print}' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *)
      echo "[deploy] opción desconocida: $arg (usa --help)" >&2; exit 2 ;;
  esac
done

log()  { echo "[deploy] $(date -u +%FT%TZ) $*"; }
warn() { echo "[deploy] $(date -u +%FT%TZ) AVISO: $*" >&2; }
die()  { echo "[deploy] $(date -u +%FT%TZ) ERROR: $*" >&2; exit 1; }

require() { command -v "$1" >/dev/null 2>&1 || die "falta el comando '$1'"; }

# Espacio libre del sistema de ficheros donde vive el repo, en GB enteros.
free_gb() { df -Pk "$REPO" | awk 'NR==2 { printf "%d", $4/1024/1024 }'; }

# ── Preflight ──────────────────────────────────────────────────────────
log "repositorio: $REPO"
[ -f "$COMPOSE_FILE" ] || die "no encuentro $COMPOSE_FILE"
[ -f "$ENV_FILE" ]     || die "no encuentro $ENV_FILE (¿vives en el VPS?)"
require docker; require git
if [ "$SKIP_SMOKE" -eq 0 ]; then require curl; fi

log "commit actual: $(git -C "$REPO" rev-parse --short HEAD) ($(git -C "$REPO" branch --show-current))"

# Disco: el build de Next + imágenes puede agotar 4 GB. Liberar caché si aprieta.
FREE="$(free_gb)"
log "espacio libre: ${FREE} GB (mínimo exigido ${MIN_FREE_GB} GB)"
if [ "$FREE" -lt "$MIN_FREE_GB" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    warn "espacio por debajo del mínimo; en un deploy real se liberaría caché de build y releases antiguas"
  else
    warn "espacio bajo → liberando caché de build (docker builder prune -f)"
    docker builder prune -f >/dev/null || warn "docker builder prune falló"
    FREE="$(free_gb)"
    log "espacio libre tras el prune: ${FREE} GB"
    if [ "$FREE" -lt "$MIN_FREE_GB" ]; then
      warn "sigue por debajo; intentando purgar imágenes sin usar (dangling)"
      docker image prune -f >/dev/null || true
      FREE="$(free_gb)"
      log "espacio libre tras purgar imágenes: ${FREE} GB"
    fi
    if [ "$FREE" -lt "$MIN_FREE_GB" ] && [ -x "$SCRIPT_DIR/prune-release-images.sh" ]; then
      warn "sigue por debajo; purgando releases antiguas (conserva :current y :previous)"
      "$SCRIPT_DIR/prune-release-images.sh" >/dev/null 2>&1 || warn "la purga de releases falló"
      FREE="$(free_gb)"
      log "espacio libre tras purgar releases: ${FREE} GB"
    fi
    [ "$FREE" -lt "$MIN_FREE_GB" ] && die "espacio insuficiente (${FREE} GB < ${MIN_FREE_GB} GB). Revisa 'docker system df' y 'df -h'."
  fi
fi

# ── Sincronización de código ───────────────────────────────────────────
if [ "$SKIP_PULL" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  log "git fetch $REMOTE"
  git -C "$REPO" fetch --prune "$REMOTE" -q

  AHEAD="$(git -C "$REPO" rev-list --count "$REMOTE/$BRANCH"..HEAD)"
  if [ "$AHEAD" -gt 0 ]; then
    die "el repo local tiene ${AHEAD} commit(s) que no están en $REMOTE/$BRANCH; no se pull-ea a ciegas (resuélvelo a mano)"
  fi

  BEHIND="$(git -C "$REPO" rev-list --count "HEAD..$REMOTE/$BRANCH")"
  if [ "$BEHIND" -gt 0 ]; then
    log "commits entrantes (${BEHIND}):"
    git -C "$REPO" log --oneline --max-count=20 "HEAD..$REMOTE/$BRANCH"
    log "git pull --ff-only"
    git -C "$REPO" pull --ff-only || die "git pull falló (¿cambios locales en conflicto?)"
  else
    log "ya está en el último commit de $REMOTE/$BRANCH"
  fi
elif [ "$DRY_RUN" -eq 1 ]; then
  log "[dry-run] se omitiría el git pull"
fi

# ── Build + arranque ───────────────────────────────────────────────────
if [ "$DRY_RUN" -eq 0 ]; then
  log "construyendo y levantando: $COMPOSE up -d --build"
  $COMPOSE up -d --build
else
  log "[dry-run] se omitiría: $COMPOSE up -d --build"
fi

# ── Espera a que los servicios con healthcheck estén sanos ─────────────
if [ "$DRY_RUN" -eq 0 ]; then
  log "esperando a que los servicios estén 'healthy'…"
  for _ in $(seq 1 60); do
    PS="$($COMPOSE ps --format '{{.Service}} {{.Status}}' 2>/dev/null || true)"
    ok=1
    for svc in postgres api web etl; do
      echo "$PS" | grep -q "^$svc .*healthy" || ok=0
    done
    [ "$ok" -eq 1 ] && break
    sleep 5
  done
  $COMPOSE ps --format '{{.Service}} {{.Status}}'
  echo "$PS" | grep -q "^api .*healthy" || die "api no llegó a 'healthy' tras el deploy"
fi

# ── Smoke test (versión viva) ──────────────────────────────────────────
FAILED=0
smoke_ok()   { echo "  ✅ $1"; }
smoke_fail() { echo "  ❌ $1"; FAILED=$((FAILED + 1)); }

# Código HTTP esperado.
http_is() { # url esperado descripción
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" || echo 000)"
  if [ "$got" = "$2" ]; then smoke_ok "$3 (HTTP $got)"; else smoke_fail "$3 (esperado $2, obtenido $got)"; fi
}

# El cuerpo contiene un patrón.
http_contains() { # url patrón descripción
  if curl -fsS --max-time 20 "$1" 2>/dev/null | grep -q "$2"; then
    smoke_ok "$3"
  else
    smoke_fail "$3"
  fi
}

if [ "$SKIP_SMOKE" -eq 0 ]; then
  log "smoke test contra $SMOKE_BASE"

  http_contains "$SMOKE_BASE/api/health" '"status":"ok"' "health responde ok"
  http_is "$SMOKE_BASE/api/matches/not-a-uuid" 404 "id no-UUID → 404"
  http_is "$SMOKE_BASE/api/teams/not-a-uuid" 404 "team id no-UUID → 404"
  http_is "$SMOKE_BASE/es/competitions/00000000-0000-0000-0000-000000000000" 404 "competición inexistente → 404"
  http_is "$SMOKE_BASE/api/search?q=a" 200 "endpoint de búsqueda global disponible"

  # Marcador de versión: /api/matches/:id debe incluir competitionId (#182).
  MID="$(curl -fsS --max-time 20 "$SMOKE_BASE/api/matches/current" 2>/dev/null \
         | grep -oE '"id":"[0-9a-f-]{36}"' | head -1 | cut -d'"' -f4 || true)"
  if [ -n "$MID" ]; then
    http_contains "$SMOKE_BASE/api/matches/$MID" '"competitionId"' "ficha de partido con competitionId (marcador de versión)"
  else
    warn "sin partidos en /api/matches/current; se omite la comprobación de competitionId"
  fi

  if [ "$FAILED" -gt 0 ]; then
    die "smoke test con ${FAILED} fallo(s); el despliegue NO está verificado"
  fi
  log "smoke test OK ✅"
fi

# ── Etiquetado de la release (#297) ────────────────────────────────────
# Retiene la imagen anterior como `<repo>:previous` y crea el tag git de release
# para poder hacer rollback sin rebuild. Best-effort: un fallo aquí NO invalida
# un despliegue ya verificado.
if [ "$DRY_RUN" -eq 0 ] && [ -x "$SCRIPT_DIR/tag-release.sh" ]; then
  log "etiquetando la release (deploy/tag-release.sh)"
  "$SCRIPT_DIR/tag-release.sh" || warn "tag-release.sh falló (no bloqueante)"
fi

log "desplegado commit $(git -C "$REPO" rev-parse --short HEAD) en $BRANCH"

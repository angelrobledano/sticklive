#!/bin/sh
# ============================================================
# Activa la segunda salida SIDGAD por Floating IP de Hetzner.
#
# Requisitos:
#   1. La Floating IPv4 ya está asignada al servidor en Hetzner.
#   2. Ya se ejecutó deploy/setup-floating-ip.sh --ip <IP> --apply.
#   3. SIDGAD/RFEP autorizó esa IP.
#
# Uso:
#   sudo ./deploy/enable-secondary-egress.sh --ip 203.0.113.10 --apply
#   sudo ./deploy/enable-secondary-egress.sh --ip 203.0.113.10 --mode fallback --apply
#
# Modos:
#   primary  (defecto): SIDGAD_EGRESS_PRIMARY=secondary-ip, fallback direct
#   fallback: mantiene la primaria actual y añade secondary-ip como respaldo
#             de transporte (nunca ante 403/429/5xx)
#
# Sin --apply solo muestra lo que haría.
# ============================================================
set -eu

IP=""
MODE="primary"
APPLY=0

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ip) IP="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$IP" ] || { echo "Falta --ip" >&2; exit 2; }
case "$MODE" in
  primary|fallback) ;;
  *) echo "Modo inválido: $MODE (primary|fallback)" >&2; exit 2 ;;
esac

echo "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || {
  echo "IP inválida: $IP" >&2; exit 2;
}

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

[ -f .env.prod ] || { echo "No existe $ROOT_DIR/.env.prod" >&2; exit 2; }
[ -f docker-compose.prod.yml ] || { echo "No existe docker-compose.prod.yml" >&2; exit 2; }

OVERRIDE="$ROOT_DIR/deploy/docker-compose.egress-secondary-ip.yml.example"
[ -f "$OVERRIDE" ] || { echo "No existe $OVERRIDE" >&2; exit 2; }

if ! ip -br addr show 2>/dev/null | grep -q " $IP/"; then
  echo "ERROR: $IP no está asignada a ninguna interfaz del host." >&2
  echo "Ejecutá primero: sudo ./deploy/setup-floating-ip.sh --ip $IP --apply" >&2
  exit 3
fi

PRIMARY_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
if [ "$IP" = "$PRIMARY_IP" ]; then
  echo "ERROR: $IP es la IP primaria del servidor. No la uso como segunda salida." >&2
  exit 2
fi

if [ "$APPLY" -eq 1 ] && [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: --apply requiere root. Usá sudo." >&2
  exit 1
fi

STATE="$ROOT_DIR/.egress-secondary.state"
if [ ! -f "$STATE" ]; then
  PREV_PRIMARY=$(grep -E '^SIDGAD_EGRESS_PRIMARY=' .env.prod | tail -n 1 | cut -d= -f2- || true)
  PREV_FALLBACKS=$(grep -E '^SIDGAD_EGRESS_FALLBACKS=' .env.prod | tail -n 1 | cut -d= -f2- || true)
  PREV_PRIMARY=${PREV_PRIMARY:-direct}
  printf 'PREV_PRIMARY=%s\nPREV_FALLBACKS=%s\n' "$PREV_PRIMARY" "$PREV_FALLBACKS" > "$STATE"
  chmod 600 "$STATE"
fi
# shellcheck disable=SC1090
. "$STATE"
PREV_PRIMARY=${PREV_PRIMARY:-direct}
PREV_FALLBACKS=${PREV_FALLBACKS:-}

if [ "$MODE" = "fallback" ] && [ "$PREV_PRIMARY" = "secondary-ip" ]; then
  echo "ERROR: la primaria guardada ya es secondary-ip; usá --mode primary o desactivá primero." >&2
  exit 2
fi

if [ "$MODE" = "primary" ]; then
  NEW_PRIMARY="secondary-ip"
  NEW_FALLBACKS="direct"
else
  NEW_PRIMARY="$PREV_PRIMARY"
  NEW_FALLBACKS="secondary-ip,direct"
fi

echo "IP secundaria: $IP"
echo "Modo:          $MODE"
echo "Primaria:      $NEW_PRIMARY"
echo "Fallbacks:     $NEW_FALLBACKS"
echo "Override:      $OVERRIDE"
echo "Backup:        .env.prod.bak.$(date +%Y%m%d-%H%M%S)"
echo ""

if [ "$APPLY" -eq 0 ]; then
  echo "[dry-run] escribir en .env.prod:"
  echo "  SIDGAD_EGRESS_SECONDARY_IP_ENABLED=1"
  echo "  SIDGAD_EGRESS_SECONDARY_IP_AUTHORIZED=1"
  echo "  SIDGAD_EGRESS_SECONDARY_SOURCE_IP=$IP"
  echo "  SIDGAD_EGRESS_PRIMARY=$NEW_PRIMARY"
  echo "  SIDGAD_EGRESS_FALLBACKS=$NEW_FALLBACKS"
  echo ""
  echo "[dry-run] docker compose -f docker-compose.prod.yml -f $OVERRIDE --env-file .env.prod up -d etl"
  echo "Repetí con --apply para aplicarlo."
  exit 0
fi

cp .env.prod ".env.prod.bak.$(date +%Y%m%d-%H%M%S)"

TMP=$(mktemp)
grep -v -E '^SIDGAD_EGRESS_(PRIMARY|FALLBACKS|SECONDARY_IP_ENABLED|SECONDARY_IP_AUTHORIZED|SECONDARY_SOURCE_IP)=' .env.prod > "$TMP"
cat "$TMP" > .env.prod
rm -f "$TMP"

{
  echo ""
  echo "# Salida SIDGAD: segunda IP de Hetzner (activada $(date -u +%FT%TZ))"
  echo "SIDGAD_EGRESS_SECONDARY_IP_ENABLED=1"
  echo "SIDGAD_EGRESS_SECONDARY_IP_AUTHORIZED=1"
  echo "SIDGAD_EGRESS_SECONDARY_SOURCE_IP=$IP"
  echo "SIDGAD_EGRESS_PRIMARY=$NEW_PRIMARY"
  echo "SIDGAD_EGRESS_FALLBACKS=$NEW_FALLBACKS"
} >> .env.prod

chmod 600 .env.prod

echo "Recreando etl con red de host..."
docker compose -f docker-compose.prod.yml -f "$OVERRIDE" --env-file .env.prod up -d etl

echo "Esperando a que arranque..."
sleep 6

if ! docker compose -f docker-compose.prod.yml -f "$OVERRIDE" --env-file .env.prod \
  exec -T etl node dist/apps/scraper/src/index.js --egress-status; then
  echo "" >&2
  echo "AVISO: no se pudo verificar la configuración." >&2
  echo "Rollback: sudo ./deploy/disable-secondary-egress.sh --apply" >&2
  exit 1
fi

echo ""
echo "OK: segunda salida activada."
echo "Rollback: sudo ./deploy/disable-secondary-egress.sh --apply"

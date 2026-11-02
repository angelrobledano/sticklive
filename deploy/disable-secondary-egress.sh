#!/bin/sh
# ============================================================
# Desactiva la segunda salida SIDGAD y vuelve a la red bridge.
#
# Restaura SIDGAD_EGRESS_PRIMARY / FALLBACKS guardados al activar, elimina
# las variables de la segunda IP y recrea el ETL sin network_mode: host.
#
# Uso:
#   sudo ./deploy/disable-secondary-egress.sh --apply
#
# No borra la Floating IP del host; al final imprime los comandos para
# quitarla si ya no la vas a usar.
# ============================================================
set -eu

APPLY=0

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; usage >&2; exit 2 ;;
  esac
done

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

[ -f .env.prod ] || { echo "No existe $ROOT_DIR/.env.prod" >&2; exit 2; }
[ -f docker-compose.prod.yml ] || { echo "No existe docker-compose.prod.yml" >&2; exit 2; }

STATE="$ROOT_DIR/.egress-secondary.state"
if [ -f "$STATE" ]; then
  # shellcheck disable=SC1090
  . "$STATE"
else
  echo "AVISO: no existe $STATE; vuelvo a la salida directa por seguridad." >&2
  PREV_PRIMARY=direct
  PREV_FALLBACKS=""
fi
PREV_PRIMARY=${PREV_PRIMARY:-direct}
PREV_FALLBACKS=${PREV_FALLBACKS:-}

SECONDARY_IP=$(grep -E '^SIDGAD_EGRESS_SECONDARY_SOURCE_IP=' .env.prod | tail -n 1 | cut -d= -f2- || true)
SECONDARY_IFACE=""
if [ -n "$SECONDARY_IP" ]; then
  SECONDARY_IFACE=$(ip -br addr show 2>/dev/null | awk -v needle="$SECONDARY_IP/" '$0 ~ needle {print $1; exit}')
fi

echo "Restaurando primaria: $PREV_PRIMARY"
echo "Restaurando fallbacks: ${PREV_FALLBACKS:-(vacío)}"
echo ""

if [ "$APPLY" -eq 0 ]; then
  echo "[dry-run] quitar variables SIDGAD_EGRESS_SECONDARY_IP_*"
  echo "[dry-run] escribir SIDGAD_EGRESS_PRIMARY=$PREV_PRIMARY"
  echo "[dry-run] escribir SIDGAD_EGRESS_FALLBACKS=$PREV_FALLBACKS"
  echo "[dry-run] docker compose -f docker-compose.prod.yml --env-file .env.prod up -d etl"
  echo "Repetí con --apply para aplicarlo."
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: --apply requiere root. Usá sudo." >&2
  exit 1
fi

cp .env.prod ".env.prod.bak.$(date +%Y%m%d-%H%M%S)"

TMP=$(mktemp)
grep -v -E '^SIDGAD_EGRESS_(PRIMARY|FALLBACKS|SECONDARY_IP_ENABLED|SECONDARY_IP_AUTHORIZED|SECONDARY_SOURCE_IP)=' .env.prod > "$TMP"
cat "$TMP" > .env.prod
rm -f "$TMP"

{
  echo ""
  echo "# Salida SIDGAD: configuración restaurada $(date -u +%FT%TZ)"
  echo "SIDGAD_EGRESS_PRIMARY=$PREV_PRIMARY"
  echo "SIDGAD_EGRESS_FALLBACKS=$PREV_FALLBACKS"
} >> .env.prod

chmod 600 .env.prod

echo "Recreando etl con red bridge..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d etl

echo "Esperando a que arranque..."
sleep 6

if ! docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T etl node dist/apps/scraper/src/index.js --egress-status; then
  echo "" >&2
  echo "AVISO: no se pudo verificar la configuración. Revisá .env.prod y $STATE." >&2
  exit 1
fi

echo ""
echo "OK: segunda salida desactivada; el ETL vuelve a red bridge."
echo ""
echo "La Floating IP sigue configurada en el host. Si ya no la vas a usar:"
if [ -n "$SECONDARY_IP" ] && [ -n "$SECONDARY_IFACE" ]; then
  SAFE_IP=$(echo "$SECONDARY_IP" | tr '.' '-')
  echo "  sudo ip addr del $SECONDARY_IP/32 dev $SECONDARY_IFACE"
  echo "  sudo systemctl disable --now floating-ip-$SAFE_IP.service"
  echo "  sudo rm /etc/systemd/system/floating-ip-$SAFE_IP.service"
  echo "  sudo systemctl daemon-reload"
else
  echo "  (No pude detectar la IP/interfaz desde .env.prod; revisá 'ip -br addr'.)"
fi

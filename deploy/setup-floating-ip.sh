#!/bin/sh
# ============================================================
# Configura una Floating IPv4 de Hetzner en el host y la persiste.
#
# NO toca la ruta por defecto ni la IP primaria. Solo añade la IP a la
# interfaz y crea una unidad systemd para que sobreviva a reinicios.
#
# Uso:
#   sudo ./deploy/setup-floating-ip.sh --ip 203.0.113.10 [--interface eth0] --apply
#   sudo ./deploy/setup-floating-ip.sh --ip 203.0.113.10 --verify-egress
#
# Sin --apply solo muestra lo que haría (dry-run).
# ============================================================
set -eu

IP=""
IFACE=""
APPLY=0
VERIFY=0

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ip) IP="${2:-}"; shift 2 ;;
    --interface) IFACE="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --verify-egress) VERIFY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$IP" ] || { echo "Falta --ip" >&2; exit 2; }

# Validación IPv4 (formato + rangos 0-255).
echo "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || {
  echo "IP inválida: $IP" >&2; exit 2;
}
echo "$IP" | awk -F. '
  NF == 4 {
    for (i = 1; i <= 4; i++) {
      if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1
    }
    exit 0
  }
  { exit 1 }
' || { echo "IP inválida: $IP" >&2; exit 2; }

IP_BIN=$(command -v ip || true)
[ -n "$IP_BIN" ] || { echo "No encuentro el comando 'ip'." >&2; exit 2; }

if [ -z "$IFACE" ]; then
  IFACE=$("$IP_BIN" route show default | awk '{print $5; exit}')
fi
[ -n "$IFACE" ] || {
  echo "No pude detectar la interfaz por defecto. Pasá --interface <eth0|enp1s0>." >&2
  exit 2
}

PRIMARY=$("$IP_BIN" route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
if [ "$IP" = "$PRIMARY" ]; then
  echo "ERROR: $IP es la IP primaria del servidor. No la toco." >&2
  exit 2
fi

CURRENT_IFACE=$("$IP_BIN" -br addr show | awk -v needle="$IP/" '$0 ~ needle {print $1; exit}')
if [ -n "$CURRENT_IFACE" ] && [ "$CURRENT_IFACE" != "$IFACE" ]; then
  echo "ERROR: $IP ya está asignada a $CURRENT_IFACE, no a $IFACE. Abortando." >&2
  exit 2
fi

SAFE_IP=$(echo "$IP" | tr '.' '-')
UNIT="/etc/systemd/system/floating-ip-${SAFE_IP}.service"

if [ "$APPLY" -eq 1 ] && [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: --apply requiere root. Usá sudo." >&2
  exit 1
fi

echo "IP:        $IP"
echo "Interfaz:  $IFACE"
echo "Unidad:    $UNIT"
echo "IP actual: ${PRIMARY:-desconocida}"
echo ""

if [ "$APPLY" -eq 0 ]; then
  echo "[dry-run] $IP_BIN addr replace $IP/32 dev $IFACE"
  echo "[dry-run] escribir $UNIT"
  echo "[dry-run] systemctl daemon-reload && systemctl enable --now floating-ip-${SAFE_IP}.service"
  echo ""
  echo "Repetí con --apply para aplicarlo."
  exit 0
fi

"$IP_BIN" addr replace "$IP/32" dev "$IFACE"

cat > "$UNIT" <<EOF
[Unit]
Description=Hetzner Floating IP $IP
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$IP_BIN addr replace $IP/32 dev $IFACE
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "floating-ip-${SAFE_IP}.service"

if ! "$IP_BIN" -br addr show dev "$IFACE" | grep -q " $IP/"; then
  echo "ERROR: la IP no aparece en $IFACE después de aplicarla." >&2
  exit 1
fi

echo "OK: $IP asignada a $IFACE y persistida en $UNIT"

if [ "$VERIFY" -eq 1 ]; then
  if command -v curl >/dev/null 2>&1; then
    echo "Comprobando salida a Internet con $IP..."
    OUT=$(curl --interface "$IP" -fsS --max-time 10 https://ifconfig.me 2>/dev/null || true)
    if [ "$OUT" = "$IP" ]; then
      echo "OK: la salida es $IP"
    else
      echo "AVISO: ifconfig.me devolvió '${OUT:-sin respuesta}' (esperaba $IP)." >&2
    fi
  else
    echo "curl no está instalado. Verificá desde otro sitio con:"
    echo "  curl --interface $IP https://ifconfig.me"
  fi
fi

echo ""
echo "Siguiente paso:"
echo "  sudo ./deploy/enable-secondary-egress.sh --ip $IP --apply"

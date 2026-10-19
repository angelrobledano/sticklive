#!/usr/bin/env bash
# ============================================================
# Instala el jail de fail2ban que banea scrapers a partir de los
# access logs JSON de Caddy. Pensado para el VPS de producción:
#
#   cd /opt/sticklive
#   sudo bash deploy/install-fail2ban.sh
#
# Requisitos:
#   · fail2ban instalado (apt-get install -y fail2ban)
#   · Docker con la cadena DOCKER-USER (la crea Docker al arrancar)
#   · Caddy recreado con el volumen ./logs/caddy (docker compose up -d caddy)
#
# El script es idempotente: copia los ficheros, valida la configuración y
# reinicia fail2ban. No borra ni desactiva nada más.
# ============================================================
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/sticklive}"
FAIL2BAN_DIR="${FAIL2BAN_DIR:-/etc/fail2ban}"
LOG_DIR="${LOG_DIR:-$REPO_DIR/logs/caddy}"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || die "ejecuta este script como root (sudo)"
command -v fail2ban-client >/dev/null 2>&1 || die "fail2ban no está instalado. En Debian/Ubuntu: apt-get update && apt-get install -y fail2ban"
command -v systemctl >/dev/null 2>&1 || die "systemctl no disponible; este instalador asume systemd"
[[ -d "$REPO_DIR/deploy/fail2ban" ]] || die "no encuentro $REPO_DIR/deploy/fail2ban (¿REPO_DIR correcto?)"

# Docker publica 80/443 con DNAT; el ban debe ir a DOCKER-USER, no a INPUT.
[[ -x /usr/sbin/iptables ]] || die "falta /usr/sbin/iptables"
if ! /usr/sbin/iptables -w -n -L DOCKER-USER >/dev/null 2>&1; then
  die "no existe la cadena DOCKER-USER. ¿Está Docker arrancado en este host?"
fi
if [[ ! -x /usr/sbin/ip6tables ]]; then
  say "AVISO: no hay /usr/sbin/ip6tables; el jail solo podrá banear IPv4."
fi

# Caddy escribe aquí (volumen ./logs/caddy:/var/log/caddy). Debe existir antes
# de recrear el contenedor.
install -d -m 0750 -o root -g root "$LOG_DIR"

install -m 0644 "$REPO_DIR/deploy/fail2ban/filter.d/sticklive-caddy.conf" "$FAIL2BAN_DIR/filter.d/sticklive-caddy.conf"
install -m 0644 "$REPO_DIR/deploy/fail2ban/action.d/sticklive-docker.conf" "$FAIL2BAN_DIR/action.d/sticklive-docker.conf"
# El jail se genera con la ruta real del log (por defecto /opt/sticklive/...).
sed "s|/opt/sticklive/logs/caddy|$LOG_DIR|g" \
  "$REPO_DIR/deploy/fail2ban/jail.d/sticklive.local" > "$FAIL2BAN_DIR/jail.d/sticklive.local"
chmod 0644 "$FAIL2BAN_DIR/jail.d/sticklive.local"

say "Validando configuración de fail2ban…"
fail2ban-client -t

say "Activando y reiniciando fail2ban…"
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban

sleep 1
say ""
say "Jail instalado. Estado:"
fail2ban-client status sticklive-caddy || true
say ""
say "Siguientes pasos:"
say "  1) Recrear Caddy para montar el log y aplicar el Caddyfile:"
say "     cd $REPO_DIR && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d caddy"
say "  2) Comprobar que se escribe el log:"
say "     tail -f $LOG_DIR/access.log"
say "  3) Ver IPs baneadas:"
say "     fail2ban-client status sticklive-caddy"
say "     /usr/sbin/iptables -n -L DOCKER-USER"
say ""
say "Los logs de acceso ya NO van a 'docker logs caddy'; están en $LOG_DIR/access.log."

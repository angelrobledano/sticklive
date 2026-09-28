#!/bin/bash
# ============================================================
# Copia CIFRADA de .env.prod (todos los secretos de producción) — issue #290
#
# /opt/sticklive/.env.prod es la única copia de POSTGRES_PASSWORD, VAPID,
# SMTP/Brevo, Google OAuth, Sentry, ADMIN_TOKEN, AUTH_STATE_SECRET, PostHog…
# Si el VPS muere sin esta copia, el login, el push y la alertabilidad quedan
# rotos. Este script la cifra con una clave PÚBLICA (age o gpg) y, opcionalmente,
# la envía off-site con el mismo destino que los dumps (#289).
#
# El servidor solo necesita la clave PÚBLICA para cifrar: la privada debe
# guardarse FUERA del VPS (gestor de secretos / bóveda offline). Así, un
# compromiso del servidor no expone los backups.
#
# Prerrequisitos (uno de los dos):
#   · age  →  apt install age     (preferido: sin keyring, receta = una línea)
#   · gpg  →  apt install gnupg   (alternativa en cualquier Debian/Ubuntu)
# La clave pública se define en /opt/sticklive/.backup-offsite.env:
#   AGE_RECIPIENT=age1xxxx…        (o)        GPG_RECIPIENT=you@example.com
#
# Uso (como root):
#   chmod +x /opt/sticklive/deploy/backup-env.sh
#   /opt/sticklive/deploy/backup-env.sh
# Semanal (opcional), a las 04:30 del lunes:
#   echo '30 4 * * 1 root /opt/sticklive/deploy/backup-env.sh >> /var/log/sticklive-backup.log 2>&1' > /etc/cron.d/sticklive-env
#
# Restaurar (en una máquina de confianza, con la clave privada):
#   age -d -i ~/age-key.txt -o .env.prod /ruta/sticklive-env-YYYYMMDD.age
#   gpg -d -o .env.prod /ruta/sticklive-env-YYYYMMDD.gpg
#   chmod 600 .env.prod   # y colócalo en /opt/sticklive/.env.prod
# ============================================================
set -euo pipefail

umask 077

ENV_FILE="${ENV_FILE:-/opt/sticklive/.env.prod}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
KEEP="${KEEP:-30}" # copias cifradas locales a conservar
STAMP=$(date +%Y%m%d)
OFFSITE_CONF="${OFFSITE_CONF:-/opt/sticklive/.backup-offsite.env}"

# Config del off-site y de las claves públicas (opcional).
if [ -f "$OFFSITE_CONF" ]; then
  # shellcheck source=/dev/null
  . "$OFFSITE_CONF"
fi
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"
ENV_OFFSITE_TARGET="${ENV_OFFSITE_TARGET:-${OFFSITE_TARGET:-}}"

[ -r "$ENV_FILE" ] || { echo "[backup-env] ERROR: no se puede leer $ENV_FILE" >&2; exit 1; }

# Aviso (no bloqueante) si los permisos del origen no son restrictivos.
PERMS=$(stat -c %a "$ENV_FILE")
case "$PERMS" in
  600 | 400) : ;;
  *) echo "[backup-env] aviso: $ENV_FILE tiene permisos $PERMS (recomendado 600)" >&2 ;;
esac

mkdir -p "$BACKUP_DIR"

# Elige herramienta: age (preferido) con fallback a gpg. Nunca instala nada.
if command -v age >/dev/null 2>&1; then
  [ -n "$AGE_RECIPIENT" ] || { echo "[backup-env] ERROR: age disponible pero falta AGE_RECIPIENT (clave pública) en $OFFSITE_CONF" >&2; exit 1; }
  OUT="$BACKUP_DIR/sticklive-env-$STAMP.age"
  TMP="$OUT.tmp"
  if ! age -r "$AGE_RECIPIENT" -o "$TMP" "$ENV_FILE"; then
    echo "[backup-env] ERROR: age falló al cifrar $ENV_FILE" >&2
    rm -f "$TMP"
    exit 1
  fi
elif command -v gpg >/dev/null 2>&1; then
  [ -n "$GPG_RECIPIENT" ] || { echo "[backup-env] ERROR: gpg disponible pero falta GPG_RECIPIENT (clave pública) en $OFFSITE_CONF" >&2; exit 1; }
  OUT="$BACKUP_DIR/sticklive-env-$STAMP.gpg"
  TMP="$OUT.tmp"
  if ! gpg --batch --yes --trust-model always --encrypt --recipient "$GPG_RECIPIENT" --output "$TMP" "$ENV_FILE"; then
    echo "[backup-env] ERROR: gpg falló al cifrar $ENV_FILE (¿clave pública importada?)" >&2
    rm -f "$TMP"
    exit 1
  fi
else
  echo "[backup-env] ERROR: no hay age ni gpg instalados. Instala uno: 'apt install age' o 'apt install gnupg'" >&2
  exit 1
fi

# Sanidad: el cifrado debe existir y no ser trivial.
SIZE=$(stat -c%s "$TMP")
if [ "$SIZE" -lt 64 ]; then
  echo "[backup-env] ERROR: salida cifrada sospechosamente pequeña ($SIZE bytes) — abortando" >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$OUT"
chmod 600 "$OUT"
echo "[backup-env] $(date -u +%FT%TZ) OK → $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"

# Rotación local: conserva las últimas KEEP copias cifradas.
ls -1t "$BACKUP_DIR"/sticklive-env-* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# ── Envío off-site (opcional, mismo destino que los dumps) ───────────────────
if [ -n "$ENV_OFFSITE_TARGET" ]; then
  case "$ENV_OFFSITE_TARGET" in
    *:*) : ;;
    *)
      echo "[backup-env] ERROR: ENV_OFFSITE_TARGET debe ser host:ruta" >&2
      exit 2
      ;;
  esac
  if ! command -v rsync >/dev/null 2>&1; then
    echo "[backup-env] ERROR: hay destino off-site pero rsync no está instalado" >&2
    exit 2
  fi
  echo "[backup-env] off-site → $ENV_OFFSITE_TARGET"
  if ! rsync -az -e "ssh ${OFFSITE_SSH_OPTS:-}" "$OUT" "$ENV_OFFSITE_TARGET"; then
    echo "[backup-env] ALERTA: el envío OFF-SITE de la copia de .env.prod FALLÓ (copia local OK)" >&2
    exit 2
  fi
  echo "[backup-env] $(date -u +%FT%TZ) off-site OK"
else
  echo "[backup-env] aviso: sin destino off-site (define OFFSITE_TARGET en $OFFSITE_CONF) — la copia cifrada sigue solo en el VPS" >&2
fi

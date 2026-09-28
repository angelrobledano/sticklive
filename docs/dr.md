# Disaster Recovery (DR) — reconstrucción de Stick Live desde cero

*Actualizado: 28 de septiembre de 2026*

Este runbook cubre el escenario **«VPS destruido»**: la máquina de producción se
pierde por completo (disco, volúmenes, `bash_history`, `.env.prod`, backups
locales) y hay que reconstruir el servicio desde cero. Es el procedimiento que
`docs/DEPLOY.md` **no** cubre (ese es el deploy cotidiano) y que hasta ahora solo
existía como memoria tácita del titular.

**Fuentes de verdad de la operación diaria:** [DEPLOY.md](./DEPLOY.md) (deploy y
túnel SSH), [operations.md](./operations.md) (salud, crons, recuperación),
[VOLCADO_HISTORICO.md](./VOLCADO_HISTORICO.md) (re-import histórico). Este
documento no los duplica: los enlaza y describe **solo** la reconstrucción.

> **Invariante:** el ETL, la API y la web se reconstruyen volviendo a desplegar
> código git y re-scrapeando. Lo que **no** se reconstruye re-scrapeando es la
> base de datos (datos de usuario) y los secretos de `.env.prod`. Por eso el DR
> depende de dos cosas externas al VPS: **la copia diaria off-site** y **la copia
> cifrada de `.env.prod`** (#290).

---

## 0. Escenarios y alcance

| Escenario | Qué se perdió | Procedimiento |
|---|---|---|
| **A. VPS destruido** | Todo (máquina, volúmenes, `.env.prod`, backups locales) | Este documento, de §5 a §14 |
| **B. VPS vivo, solo datos** | Corrupción/borrado de la BD | `restore` de §10.1 sobre el VPS actual (no reprovisionar) |
| Fuera de alcance | Fuente caída, migración fallida a mitad | [operations.md](./operations.md) |

El resultado esperado del escenario A es un VPS nuevo, con la IP antigua
(`167.233.94.156`) reasignada o con el DNS reapuntado, sirviendo
`https://sticklive.eu` con los datos restaurados hasta el último backup off-site.

---

## 1. Qué es recuperable y qué no

### Sí es recuperable

| Activo | De dónde |
|---|---|
| Código (api, web, etl, scraper, db, deploy) | `git clone` de `main` (§8) |
| Esquema y datos de competiciones/partidos/equipos/jugadores | Dump diario off-site (§10.1); en su defecto, re-scraping + histórico (§10.2) |
| Datos de usuario (users, favorites, tokens, push, orders) | Incluidos en el dump diario; `restore-sports-dump.sh` los preserva al re-importar (§10.2) |
| Configuración de infra (compose, Caddyfile, scripts) | Git (`docker-compose.prod.yml`, `deploy/*`) |
| Certificados TLS | Caddy los solicita de nuevo automáticamente (§12) |
| Escudos (PNG) | Volumen `escudos`, **no** se backupea; se regenera con `download-logos` (§10.4) |
| Secretos de `.env.prod` | Copia cifrada off-site generada por `deploy/backup-env.sh` (#290) (§9) |

### No es recuperable / en riesgo

| Activo | Consecuencia |
|---|---|
| `.env.prod` **si no existe copia cifrada** (#290) | Login por magic link y Google OAuth rotos; las suscripciones push se invalidan si se regenera el par VAPID (#290); alertabilidad (Sentry/SMTP) rota. La `POSTGRES_PASSWORD` sí es re-generable (la `DATABASE_URL` se compone en runtime), pero el resto exige acceso a las cuentas cloud. |
| Datos entre el último backup off-site y el desastre | Hasta **24 h** (ver RPO): se pierden o se re-scrapean si la fuente aún los tiene |
| Volumen `pgdata` en sí | Se sustituye por el restore del dump; **no** hay que borrarlo después |
| Backups locales (`/opt/backups`) de entre ejecuciones | Se pierden; la copia buena es la off-site (Storage Box) |
| `bash_history` y configuración no versionada | Por eso existe este runbook: todo lo que antes vivía solo ahí está aquí |
| `escudos` entre regeneraciones | Se re-descargan (coste de ancho de banda, no de datos) |
| Analítica histórica (Sentry/PostHog) | **Segura**: vive en la nube, no en el VPS |

---

## 2. RTO y RPO esperados

| Métrica | Valor | Depende de |
|---|---|---|
| **RPO** (pérdida máxima de datos) | **≤ 24 h** — backup diario a las 04:15 UTC con copia off-site en la misma ejecución | Que `.backup-offsite.env` esté configurado. **Sin copia off-site, RPO = ∞** (no hay dump recuperable): verificar en §9.3 |
| **RPO histórico** | El histórico all-time se puede re-importar del dump de ~80,5 MB + `VOLCADO_HISTORICO.md` (§10.2) | El fichero `dump.sql.gz` y `data/volcado-nucleo.json` deben existir fuera del VPS |
| **RTO** (tiempo hasta servicio verificado) | **Objetivo: < 2 h** desde que se tiene el VPS y la copia de secretos | Provision + apt/Docker + build + restore + DNS/TLS + smoke |
| **RTO medido** | **[COMPLETAR: valor medido en el ensayo de §15]** | Ensayo del runbook (§15) |

> El RTO real está dominado por lo que depende de terceros (propagación DNS,
> emisión del certificado Let's Encrypt, velocidad del build de Next) más que
> por la mecánica. El ensayo (§15) existe para medirlo, no para estimarlo.

---

## 3. Inventario de cuentas externas

Sin estas cuentas **no hay DR**. Rellenar quién tiene acceso y dónde viven las
credenciales y los recovery codes de 2FA antes del lanzamiento: el DR no puede
depender de una sola persona.

| Cuenta / Servicio | Qué controla | Quién tiene acceso | Dónde viven credenciales / recovery 2FA | Caducidad / renovación |
|---|---|---|---|---|
| **Hetzner Cloud** | VPS de producción, red, IP (`167.233.94.156`), firewalls/volúmenes de Hetzner | [COMPLETAR] | [COMPLETAR] | Pago mensual |
| **Hetzner Storage Box** | Copia off-site de los dumps (rsync a `OFFSITE_TARGET`) | [COMPLETAR] | `OFFSITE_SSH_OPTS`/clave en `.backup-offsite.env` + `/root/.ssh/storagebox` (§9.3) | Pago mensual |
| **Registrador del dominio** (p. ej. Hostinger) | DNS de `sticklive.eu` (registros A/CNAME) | [COMPLETAR] | [COMPLETAR] | **Caducidad del dominio: [COMPLETAR fecha]** |
| **GitHub** | Repositorio `angelrobledano/sticklive`, deploy keys, CI | [COMPLETAR] | [COMPLETAR] | Sin caducidad (revisar deploy keys) |
| **Sentry** | Errores api/web/etl, alertas de pipeline, Cron Monitor del directo | [COMPLETAR] | `SENTRY_DSN` (runtime) y `SENTRY_AUTH_TOKEN` (solo build, #300) (§9) | [COMPLETAR] |
| **PostHog** | Analítica de producto | [COMPLETAR] | `POSTHOG_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY` | [COMPLETAR] |
| **Brevo** | SMTP de magic links (`SMTP_USER`/`SMTP_PASS`) | [COMPLETAR] | `SMTP_USER`/`SMTP_PASS` | [COMPLETAR] |
| **Google Cloud** | OAuth (login con Google); redirect URI `https://sticklive.eu/api/auth/google/callback` | [COMPLETAR] | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` | [COMPLETAR] |
| **Stripe** | Premium (clave secreta + webhook `checkout.session.completed`) | [COMPLETAR] | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | [COMPLETAR] |
| **Gestor de secretos / bóveda** | Copia cifrada de `.env.prod` (#290) | [COMPLETAR] | **[COMPLETAR: proveedor y ubicación]** | [COMPLETAR] |

> **Bloqueante P0:** si la fila de la bóveda sigue sin completar, el escenario A
> **no tiene RTO finito**. Los secretos de `.env.prod` eran la única copia en el
> universo (#290).

---

## 4. Antes de empezar (preflight de DR)

- [ ] Tengo acceso a la **bóveda / copia cifrada de `.env.prod`** (#290). Sin esto, parar: el resto no sirve.
- [ ] Confirmo que existe un **dump off-site reciente** (`/opt/backups/sticklive-YYYYMMDD-HHMM.sql.gz` en la Storage Box).
- [ ] Tengo acceso al **panel de DNS** del dominio.
- [ ] Tengo acceso a **Hetzner Cloud** para crear el VPS y reasignar/crear la IP.
- [ ] Tengo acceso al **repo GitHub** para añadir la deploy key (§8).
- [ ] Conozco el **RTO/RPO** aceptables y he avisado si el servicio va a estar caído.
- [ ] (Opcional) Tengo la IP actual `167.233.94.156` y el registro DNS actual anotados por si hay que revertir.

---

## 5. Provision del VPS nuevo

### 5.1 Tamaño

El VPS actual es Hetzner de **4 GB** (`docker-compose.prod.yml` reparte límites de
memoria de ≈3,4 GB para dejar margen al sistema). Recomendación:

- **Mínimo: 2 vCPU + 4 GB RAM + ≥ 40 GB SSD.**
- **Disco: mejor ≥ 80 GB.** El build de Next + imágenes llena 4 GB con facilidad;
  `deploy/deploy.sh` exige **≥ 15 GB libres** antes de construir y purga caché si
  no los hay. El actual es de 4 GB y ya se topó con «no space left on device».
- **SO: Ubuntu 24.04 LTS** (o Debian 12). **[COMPLETAR: confirmar la imagen exacta
  que usa el titular; el historial del VPS solo acredita `apt` + `get.docker.com`,
  compatible con ambas]**.

`[COMPLETAR: modelo/plan exacto de Hetzner contratado]`.

### 5.2 Acceso SSH

1. Crear el VPS en Hetzner Cloud en la misma región que la IP/volúmenes actuales.
2. Añadir la clave pública SSH de administración al provisionar (**no** usar
   contraseña). **[COMPLETAR: ruta de la clave privada de admin en el PC del
   titular; el histórico usa `~/.ssh/sticklive`]**.
3. Confirmar el primer login: `ssh root@<IP_NUEVA>`.
4. Reasignar la IP actual al VPS nuevo **solo si** el DNS aún apunta a ella;
   si no, anotar la IP nueva para §12.

> No reproducir la IP antigua no es requisito: el DNS se reapunta en §12.

---

## 6. Instalación base (apt, Docker, UFW)

Todo esto se ejecuta **como root** en el VPS nuevo. Corresponde al rastro que
antes solo vivía en `bash_history`.

### 6.1 Paquetes base

```bash
apt-get update
apt-get -y upgrade
apt-get install -y git curl rsync ufw ca-certificates age
```

`age` (o `gnupg`) es requisito de `deploy/backup-env.sh` de #290 (cifrado de
`.env.prod`); el resto son los esenciales que usan los scripts. **[COMPLETAR:
contrastar la lista con el `bash_history` del VPS si aún se puede recuperar]**.

### 6.2 Docker (script oficial)

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version
docker compose version   # debe existir el plugin compose v2
```

Los contenedores corren con `node` sin privilegios; el Compose (`postgres`,
`migrate`, `api`, `web`, `caddy`, `etl`, `autoheal`) no necesita nada más en el
host.

### 6.3 Firewall UFW (default deny; 22/80/443 v4 + v6)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP (Caddy + challenge ACME)
ufw allow 443/tcp    # HTTPS
ufw enable
ufw status verbose   # debe mostrar 22, 80 y 443 en IPv4 Y IPv6
```

- Con IPv6 habilitado (por defecto en UFW), cada `allow` crea la regla **v4 y
  v6**. Verificarlo en la salida de `ufw status verbose`: debe aparecer `(v6)`
  para 22, 80 y 443. Si no aparece, habilitar `IPV6=yes` en
  `/etc/default/ufw` y recargar (`ufw reload`).
- **Postgres NO se abre en UFW**: el Compose lo publica solo en
  `127.0.0.1:5432` (`docker-compose.prod.yml`), accesible por túnel SSH.
- `autoheal` monta `/var/run/docker.sock` (equivale a root en el host): riesgo ya
  aceptado y documentado en `docker-compose.prod.yml`; no cambia nada del DR.

---

## 7. Usuario, permisos y estructura

```bash
mkdir -p /opt/sticklive /opt/backups /var/lib/sticklive
chmod 700 /opt/backups
```

- Los scripts del host (backup, verify, healthcheck, deploy) los ejecuta el
  **cron de root**. El titular opera como root por SSH. `[COMPLETAR: confirmar si
  se quiere un usuario no-root para operación diaria]`.
- `.env.prod` debe quedar **`600 root:root`** (el issue #290 exige corregir el
  644 actual; aprovechar la reconstrucción para dejarlo bien desde el principio):

  ```bash
  chmod 600 /opt/sticklive/.env.prod
  ```

- **Hardening SSH (#304):** en `/etc/ssh/sshd_config.d/99-sticklive.conf` (o el
  `sshd_config` principal):

  ```text
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  X11Forwarding no
  PermitRootLogin prohibit-password
  PubkeyAuthentication yes
  ```

  Recarga con `systemctl reload ssh`. **Antes de cerrar la sesión**, abre una
  **segunda terminal** y confirma `ssh root@<IP>` por clave: si algo salió mal,
  pierdes el acceso. `sshd -T | grep -E 'passwordauthentication|x11forwarding'`
  debe mostrar `no`/`no`. Recomendado: **fail2ban** con jail `sshd`
  (`apt install fail2ban` + `/etc/fail2ban/jail.d/sshd.local` con `enabled =
  true`): hoy no hay usuarios con contraseña, pero frena la fuerza bruta y
  protege si algún día se crea uno.
- **Segunda clave SSH (#302):** una sola clave en un solo PC deja el VPS
  inaccesible si ese PC se pierde. Genera una segunda clave en **otro**
  dispositivo (o guárdala en la bóveda) y añade su pública a
  `/root/.ssh/authorized_keys`; **verifica un login real** antes de darla por
  buena y anótala en §3/§16.

---

## 8. Obtener el código: clone + deploy key

El repo es privado; el VPS se autentica con una **deploy key de solo lectura**.

```bash
# 1. Generar una clave nueva propia de este servidor (la anterior murió con el VPS).
ssh-keygen -t ed25519 -C "sticklive-vps-deploy" -f /root/.ssh/sticklive_deploy -N ""

# 2. Mostrar la pública para pegarla en GitHub.
cat /root/.ssh/sticklive_deploy.pub
```

En GitHub: `angelrobledano/sticklive` → **Settings → Deploy keys → Add deploy
key**, pegar la pública, marcar **Allow write access = NO** (solo lectura).

```bash
# 3. Configurar SSH para usar esa clave con GitHub.
cat >> /root/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/sticklive_deploy
  IdentitiesOnly yes
EOF

# 4. Clonar la rama main en la ruta de producción.
git clone --branch main git@github.com:angelrobledano/sticklive.git /opt/sticklive

# 5. Verificar.
cd /opt/sticklive
git rev-parse --short HEAD
git branch --show-current   # main
```

> El `dump.sql.gz` de ~80,5 MB **no está trackeado en git**: si se necesita la
> ruta histórica de §10.2, hay que subirlo aparte.

---

## 9. Reconstituir `.env.prod`

`.env.prod` **nunca** está en git. Se reconstituye desde su **copia cifrada
off-site** (`deploy/backup-env.sh`, issue **#290**). El script cifra `.env.prod`
con una clave **pública** `age` (o `gpg`) y lo envía off-site; la clave
**privada** se guarda **fuera del VPS** (bóveda), de modo que un compromiso del
servidor no expone los backups.

> ⚠️ La disponibilidad de este paso depende de que **#290 esté cerrado y
> `deploy/backup-env.sh` exista en `main`**. Si no, es un **[COMPLETAR:
> mecanismo y ubicación a cargo del titular (issue #290)]** y el escenario A no
> tiene RTO finito.

Procedimiento:

1. En una **máquina de confianza** (o en el VPS recién provisto, subiendo la
   clave privada solo para esto y borrándola después), descifrar el fichero más
   reciente `sticklive-env-YYYYMMDD.age` (o `.gpg`):

   ```bash
   age -d -i ~/age-key.txt -o .env.prod /ruta/sticklive-env-YYYYMMDD.age
   # o bien:
   gpg -d -o .env.prod /ruta/sticklive-env-YYYYMMDD.gpg
   chmod 600 .env.prod
   ```

2. Copiarlo a `/opt/sticklive/.env.prod` (permisos `600 root:root`). Nunca
   dejarlo sin cifrar fuera del VPS ni en git.
3. Si no hay copia y hay que reconstruir a mano, partir de
   `.env.prod.example` (referencia de todas las claves) y regenerar cada secreto
   según la tabla de abajo.
4. Verificar que **ninguna `NEXT_PUBLIC_*` queda vacía** antes de construir
   (§10.3): se hornean en build (`docker-compose.prod.yml`, `deploy/Dockerfile`).

### 9.1 Variables sensibles (solo nombres) y qué rompe su pérdida

| Variable(s) | Controla | Si se pierde / rota |
|---|---|---|
| `POSTGRES_PASSWORD` | Password del rol `sports_user` | **Recuperable**: se re-inicializa el cluster con la nueva; la `DATABASE_URL` se compone en runtime. **No** pierde datos si se restaura el dump después. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push | **Crítico:** regenerar el par **invalida todas las suscripciones push** existentes (los usuarios deben re-suscribirse, #290). Si la copia conserva el par, no rompe nada. Requiere **rebuild de web** (la pública es build arg). |
| `SMTP_USER`, `SMTP_PASS` | Magic links (Brevo) | Login por email roto hasta restaurar/rotar la clave SMTP. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Login con Google (OAuth) | Regenerable en Google Cloud; el redirect URI (`.../api/auth/google/callback`) debe seguir existiendo. |
| `AUTH_STATE_SECRET` | Firma del `state` de OAuth | Opcional (cae a `GOOGLE_CLIENT_SECRET`, `apps/api/src/lib/auth-state.ts`). Rotarlo solo invalida states en vuelo. |
| `ADMIN_TOKEN` | Acceso admin | Regenerable (token aleatorio nuevo); invalida sesiones admin. |
| `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | Alertas de errores/pipeline; sourcemaps | **Sin `SENTRY_DSN` toda la alertabilidad es un no-op silencioso** (`.env.prod.example`). `SENTRY_AUTH_TOKEN` es **solo de build** (se pasa como build arg; no llega al runtime desde #300). Recuperar ambos de Sentry. |
| `POSTHOG_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY` | Analítica | Recuperables del proyecto PostHog. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Pagos premium | Recuperables/rotables en Stripe; hay que **re-verificar el endpoint** `.../api/payments/stripe/webhook`. |
| `FEP_SOURCE_ID` | UUID de `data_sources` para el scraper | No es secreto; se toma de la BD restaurada (§10.1) o se consulta en la tabla. |
| `COMPETITION_SOURCES_DRIVEN`, `API_BASE_URL`, `WEB_BASE_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `LOG_LEVEL`, `PREMIUM_PRICE_EUR_CENTS` | Configuración no secreta | Valores por defecto en `.env.prod.example` (URLs de producción ya pobladas). |

> `.env.prod` tiene 33+ variables (#290). Las no listadas arriba deben quedar
> cubiertas por `.env.prod.example` y la copia cifrada; si aparece una variable
> desconocida, **[COMPLETAR: contrastar con el `.env.prod` real que #290 capture]**.

### 9.2 `.backup-offsite.env` (copia off-site)

`deploy/backup-db.sh` (y `backup-env.sh`) activan la copia off-site si existe
`/opt/sticklive/.backup-offsite.env`. Ese fichero **también se pierde** con el
VPS y debe reconstituirse desde la bóveda; sirve de plantilla
`deploy/.backup-offsite.env.example`:

```bash
# /opt/sticklive/.backup-offsite.env  (valores reales en la bóveda; NO commitear)
OFFSITE_TARGET=uXXXXXX@uXXXXXX.your-storagebox.de:backups/
OFFSITE_SSH_OPTS="-p 23 -i /root/.ssh/storagebox -o StrictHostKeyChecking=accept-new"
# Copia cifrada de .env.prod (#290): solo la clave PÚBLICA va en el servidor.
AGE_RECIPIENT=age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# GPG_RECIPIENT=you@example.com
# Alertas de backup (#292), opcional:
# BACKUP_PING_URL=
```

- Recrear asimismo la clave SSH de la Storage Box en `/root/.ssh/storagebox`
  (**dedicada**, no la del deploy) `[COMPLETAR: recuperar de la bóveda /
  regenerar y autorizar en Storage Box]`.
- La **clave privada** de `age`/`gpg` **nunca** vive en el VPS: sin ella la copia
  cifrada no se puede descifrar. `[COMPLETAR: dónde vive la clave privada]`.
- `chmod 600 /opt/sticklive/.backup-offsite.env` (contiene el ping URL, secreto).
- Sin este fichero el backup local sigue funcionando, pero **no sale del VPS**:
  volvería a haber un único punto de fallo. Verificar en §9.3 antes de dar el DR
  por bueno.

### 9.3 Verificación

```bash
test -s /opt/sticklive/.env.prod && stat -c '%a %U:%G' /opt/sticklive/.env.prod   # 600 root:root
test -f /opt/sticklive/.backup-offsite.env && echo "off-site configurado"
grep -c '=' /opt/sticklive/.env.prod   # sanity: nº de variables razonable (≈33+)
```

---

## 10. Restaurar la base de datos

**Invariante:** Postgres es el único servicio cuyos datos no se reconstruyen
scrapeando (`docker-compose.prod.yml`). Se restaura **antes** de levantar api/etl.

### 10.1 Ruta primaria — dump diario off-site (recomendada)

```bash
cd /opt/sticklive
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"

# 1. Solo Postgres: inicializa el cluster vacío y crea sports_results.
$DC up -d postgres
$DC ps postgres   # esperar (healthy)

# 2. Traer el dump más reciente desde la Storage Box (off-site).
mkdir -p /opt/backups
rsync -av -e "ssh ${OFFSITE_SSH_OPTS:-}" \
  "${OFFSITE_TARGET}sticklive-*.sql.gz" /opt/backups/
ls -lt /opt/backups/   # el más reciente, ≥100 KB

# 3. Verificar integridad ANTES de tocar la BD.
LATEST=$(ls -1t /opt/backups/sticklive-*.sql.gz | head -1)
gzip -t "$LATEST" && echo "gzip OK"

# 4. Restaurar. El dump ESQUEMA + DATOS (pg_dump de sports_results); no incluye
#    el rol ni CREATE DATABASE, que ya existen por POSTGRES_USER/POSTGRES_DB.
gunzip -c "$LATEST" | $DC exec -T postgres psql -U sports_user -d sports_results

# 5. Levantar TODO: construye imágenes y `migrate` aplica migraciones posteriores
#    al dump (idempotente; api/etl no arrancan hasta que `migrate` termina bien).
$DC up -d --build
```

> El comando de restore está documentado en la cabecera de
> `deploy/backup-db.sh`. La copia off-site **no** lleva `--delete`: el destino
> acumula histórico, por lo que puede haber dumps más antiguos elegibles como
> plan B.

### 10.2 Ruta alternativa — dump histórico del portátil (~80,5 MB)

Úsala **solo** si no hay dump diario off-site, o si hay que reponer el histórico
all-time. El dump (`dump.sql.gz`, ~80,5 MB, generado el 15/06/2026) vive fuera
del VPS (portátil; ver `docs/VOLCADO_HISTORICO.md`). El script
`deploy/restore-sports-dump.sh` restaura un dump completo **preservando los datos
de usuario del servidor**:

```bash
# El dump debe estar subido al servidor por scp.
scp dump.sql.gz root@<IP_NUEVA>:/opt/sticklive/dump.sql.gz

# El script hace backup de seguridad, salva datos de usuario, DROP/CREATE la BD,
# restaura y reaplica los datos de usuario; termina con `up -d`.
cd /opt/sticklive
./deploy/restore-sports-dump.sh /opt/sticklive/dump.sql.gz
```

> **En un VPS nuevo, construir las imágenes primero** (`$DC up -d postgres` +
> `$DC build`) y, tras el restore, asegurar el arranque con `$DC up -d --build`:
> el script termina con `up -d` sin `--build`.
>
> Si ya se restauró el dump diario (que **incluye** el histórico), este paso no
> es necesario. El histórico v1 se puede re-importar también con
> `apps/etl/src/import-volcado.ts` desde el portátil por el túnel SSH (ver
> [VOLCADO_HISTORICO.md](./VOLCADO_HISTORICO.md)); requiere la migración 048.

### 10.3 Arranque y migraciones

`$DC up -d --build` de §10.1/§10.2 arranca `migrate` (aplica migraciones que el
dump no tuviera), `api`, `web`, `etl`, `caddy` y `autoheal`. Verificar:

```bash
$DC ps
$DC logs -f --tail=100 migrate api web etl
```

### 10.4 Escudos

El volumen `escudos` no se backupea. Regenerarlo (la API lee el volumen en cada
request desde la auditoría A3; no hace falta reiniciar `web`):

```bash
$DC exec etl node dist/apps/etl/src/run-pipeline.js --entity=download-logos
```

---

## 11. Crons del host

Los jobs del host se recrean como ficheros en `/etc/cron.d/`. **Darles permiso de
ejecución** (en git están marcados `100755` desde #291, pero el `chmod` es
cinturón y tirantes).

```bash
chmod +x /opt/sticklive/deploy/backup-db.sh \
         /opt/sticklive/deploy/backup-env.sh \
         /opt/sticklive/deploy/verify-backup.sh \
         /opt/sticklive/deploy/restore-sports-dump.sh \
         /opt/sticklive/deploy/etl-healthcheck.sh \
         /opt/sticklive/deploy/disk-hygiene.sh \
         /opt/sticklive/deploy/tag-release.sh \
         /opt/sticklive/deploy/deploy.sh

# Backup diario de BD (04:15 UTC) + copia off-site.
echo '15 4 * * * root /opt/sticklive/deploy/backup-db.sh >> /var/log/sticklive-backup.log 2>&1' \
  > /etc/cron.d/sticklive-backup

# Verificación semanal del backup (lunes 04:30 UTC): restaura en BD temporal.
echo '30 4 * * 1 root /opt/sticklive/deploy/verify-backup.sh >> /var/log/sticklive-backup.log 2>&1' \
  > /etc/cron.d/sticklive-verify

# Copia cifrada de .env.prod (#290), semanal (lunes 04:30 UTC).
echo '30 4 * * 1 root /opt/sticklive/deploy/backup-env.sh >> /var/log/sticklive-backup.log 2>&1' \
  > /etc/cron.d/sticklive-env

# Salud del ETL (#373): reinicia etl solo si lleva cuelgue confirmado; alerta antes.
echo '*/5 * * * * root /opt/sticklive/deploy/etl-healthcheck.sh >> /var/log/sticklive-health.log 2>&1' \
  > /etc/cron.d/sticklive-health

# Higiene de disco (#301): alerta ≥80 %, prune de caché, cap de journald y
# logrotate de los logs de cron (#309). Diaria a las 05:00 UTC.
echo '0 5 * * * root /opt/sticklive/deploy/disk-hygiene.sh >> /var/log/sticklive-hygiene.log 2>&1' \
  > /etc/cron.d/sticklive-hygiene

chmod 644 /etc/cron.d/sticklive-*
```

- `disk-hygiene.sh` instala solo el logrotate de `/var/log/sticklive-*.log`
  (`deploy/logrotate-sticklive`); se puede lanzar una vez a mano tras la
  reconstrucción para dejarlo instalado sin esperar al cron diario.

- Horarios tomados de la cabecera de cada script (no inventar otros). `verify` y
  `env` coinciden a las 04:30 del lunes: son independientes y no se pisan.
- El `age`/`gpg` y el destinatario público (`AGE_RECIPIENT`/`GPG_RECIPIENT`) son
  requisito de `backup-env.sh`; ver §6.1 y §9.2.
- **[COMPLETAR: valorar `BACKUP_PING_URL` (#292) para que un backup fallido
  alerte; hoy los scripts solo dejan log y código de salida]**.
- `etl-healthcheck.sh` requiere `docker` en el PATH del root del cron; el DSN de
  Sentry para alertar se toma del entorno del cron
  `[COMPLETAR: decidir si se exporta SENTRY_DSN en /etc/environment o en el
  propio fichero de cron]`.
- El scheduler de scraping (`deploy/etl-scheduler.sh`) corre **dentro** del
  contenedor `etl`, no es un cron del host.

---

## 12. Caddy, DNS y TLS

### 12.1 DNS en el registrador

En el panel del registrador del dominio `sticklive.eu`:

| Tipo | Nombre | Valor |
|---|---|---|
| `A` | `@` (apex) | `<IP_NUEVA>` |
| `A` | `www` | `<IP_NUEVA>` (o `CNAME` a `sticklive.eu`) |

- El apex es el canónico; `www` redirige a apex vía Caddy (`deploy/Caddyfile`).
- **TTL del registro A (#302):** bajarlo a **3600 s** (hoy ~77500 s, ~21,5 h)
  acelera cualquier migración de IP en un desastre. Hacerlo con antelación: el
  TTL antiguo sigue cacheado hasta que expire.
- Comprobar propagación: `dig +short sticklive.eu` y `dig +short www.sticklive.eu`.
- **[COMPLETAR: fecha de expiración del dominio]** — renovación a cargo del titular (ver §3).

### 12.2 Caddy / TLS

- `docker-compose.prod.yml` publica `80:80` y `443:443`; `deploy/Caddyfile` sirve
  `sticklive.eu` (+ `www → apex` con 301) y `handle_path /api/*` hacia `api:3000`.
- En un VPS nuevo los volúmenes `caddy_data`/`caddy_config` están vacíos: Caddy
  solicita los certificados **automáticamente** (Let's Encrypt) en cuanto el DNS
  resuelva al VPS y los puertos 80/443 estén abiertos en UFW (§6.3).
- Verificar:

```bash
$DC logs caddy | grep -iE "certificate|obtain|https"
curl -fsS -o /dev/null -w '%{http_code}\n' https://sticklive.eu/es   # 200
curl -fsS -o /dev/null -w '%{http_code}\n' https://www.sticklive.eu  # 301
```

- Las cabeceras de seguridad, HSTS, CSP y `flush_interval -1` del SSE ya vienen
  en el `Caddyfile` versionado: no hay que reconfigurarlas a mano.

---

## 13. Verificación post-reconstrucción (smoke)

Usar el smoke de `deploy/deploy.sh` (fuente única de verdad; no improvisar
comprobaciones). Sin tocar git ni reconstruir:

```bash
cd /opt/sticklive
./deploy/deploy.sh --skip-pull
```

El smoke de `deploy/deploy.sh` verifica, contra `https://sticklive.eu`:

| Comprobación | Esperado |
|---|---|
| `curl -fsS /api/health` contiene `"status":"ok"` | OK (503 si Postgres no responde) |
| `/api/matches/not-a-uuid` | 404 |
| `/api/teams/not-a-uuid` | 404 |
| `/es/competitions/00000000-0000-0000-0000-000000000000` | 404 |
| `/api/search?q=a` | 200 |
| `/api/matches/<id>` contiene `"competitionId"` (marcador de versión #182) | OK (se omite si no hay partido en curso) |

Además, completar el checklist de [DEPLOY.md](./DEPLOY.md) y la tabla de
[operations.md](./operations.md):

```bash
$DC ps                                     # postgres/api/web/etl Up y (healthy)
$DC logs --since 1h etl | grep -i error    # sin errores
ls -lt /opt/backups/                        # hay backup; ≥100 KB
./deploy/verify-backup.sh                   # el backup restaura en BD temporal
curl -fsS https://sticklive.eu/api/health | grep -o '"db":"[a-z]*"'  # "db":"ok"
```

- [ ] `postgres`, `api`, `web`, `etl` `Up` y `(healthy)`; `caddy`/`autoheal` `Up`.
- [ ] `migrate` terminó con código 0 (`$DC ps -a` → `Exited (0)`).
- [ ] Smoke de `deploy.sh` en verde.
- [ ] `/api/health` → `db: ok`.
- [ ] Login por magic link funciona (SMTP).
- [ ] Login con Google funciona (OAuth).
- [ ] `scrape_logs` con pasadas `success` recientes (el ETL vuelve a scrapear).
- [ ] Un partido conocido tiene `competitionId` y su ficha carga.
- [ ] Escudos visibles (`download-logos` ejecutado, §10.4).
- [ ] Backup diario corriendo y **con copia off-site** (`exit 0`, no 2).
- [ ] Copia **cifrada** de `.env.prod` off-site (`backup-env.sh` en verde; `age`/`gpg` presente).
- [ ] Sentry recibe eventos (probar un error controlado o mirar el Cron Monitor).
- [ ] `match_events_undated` vacía (centinela de particionado).

---

## 14. Checklist final de reconstrucción (resumen)

- [ ] VPS nuevo provisto (§5); SO y tamaño correctos.
- [ ] `apt` + Docker + UFW (22/80/443 v4+v6, default deny) (§6).
- [ ] Permisos: `.env.prod` `600 root:root`; SSH sin password (§7).
- [ ] Repo clonado en `/opt/sticklive` (`main`) con deploy key de solo lectura (§8).
- [ ] `.env.prod` reconstituido desde la bóveda (#290); off-site configurado (§9).
- [ ] BD restaurada desde el dump off-site; `migrate` en verde (§10).
- [ ] Escudos regenerados (§10.4).
- [ ] Crons: backup, verify, env y etl-healthcheck, con `chmod +x` (§11).
- [ ] DNS reapuntado; TLS automático con Caddy activo (§12).
- [ ] Smoke de `deploy.sh` y checklist de operaciones en verde (§13).
- [ ] RTO/RPO registrados tras el ensayo (§15).

---

## 15. Ensayo del runbook (registro de RTO)

El issue #295 exige **ensayar el runbook al menos una vez** y **registrar el RTO
medido**. No se puede dar por bueno un DR que no se ha probado.

Procedimiento de ensayo:

1. Crear un VPS desechable (Hetzner) con un nombre que no toque producción.
2. **No** reapuntar el DNS de producción: usar `/etc/hosts` o un dominio de
   prueba, o importar el scope de `SMOKE_BASE` (`SMOKE_BASE=https://<vps-prueba>`)
   para el smoke de `deploy.sh`.
3. Cronometrar desde «tengo el VPS y la copia de secretos» hasta «smoke en
   verde». Ejecutar §5–§13 tal cual.
4. Al terminar, **destruir el VPS desechable** y anotar los resultados en la
   tabla. No dejar copias de `.env.prod` sin cifrar en el VPS de prueba.

| Fecha del ensayo | Quién | Tiempo total | Provision+base | Build+restore | DNS+TLS | Smoke | Observaciones |
|---|---|---|---|---|---|---|---|
| **[COMPLETAR]** | **[COMPLETAR]** | **[COMPLETAR]** | **[COMPLETAR]** | **[COMPLETAR]** | **[COMPLETAR]** | **[COMPLETAR]** | **[COMPLETAR]** |

Puntos donde el ensayo suele descubrir que este runbook está incompleto:
tamaño real del VPS, ruta/proveedor de la bóveda de secretos, y tiempo de build
de Next.

---

## 16. Acceso de emergencia y cuentas (#302)

Cierra el escenario «se perdió el PC / no puedo entrar por SSH». Los valores
concretos (IPs, claves, recovery codes) van a la **bóveda**, no a este documento.

### 16.1 Consola *rescue* de Hetzner (VPS inaccesible)

1. **Hetzner Cloud Console** → proyecto → servidor `sticklive`.
2. Pestaña **Rescues** → *Enable rescue* eligiendo una clave pública (o el
   password temporal que muestra el panel) y *Reset* del servidor.
   `[COMPLETAR: ruta exacta en la UI y si el rescue conserva la IP]`.
3. Conecta por SSH como `root` con la clave/password del rescue: `ssh root@<IP>`.
   Es un sistema en RAM; el disco real está sin montar.
4. Monta el disco para reparar (SSH, `authorized_keys`, servicios…):

   ```bash
   lsblk                      # identifica la raíz, p. ej. /dev/sda1
   mount /dev/sda1 /mnt
   # …revisa /mnt/etc/ssh, /mnt/root/.ssh/authorized_keys, /mnt/opt/sticklive, etc.
   ```

5. Desactiva el rescue, reinicia y vuelve a probar el acceso normal.
   `[COMPLETAR: pasos exactos de desactivación en el panel]`.

### 16.2 Si se pierde el PC de administración

- La **segunda clave SSH** (§7) debe existir en otro dispositivo o en la bóveda.
- El **registrar del dominio** (`[COMPLETAR: proveedor]`) y su **fecha de
  caducidad** (`[COMPLETAR]`) están en §3; baja el TTL del A en §12.
- Las credenciales de **Hetzner, GitHub, Sentry, PostHog, Brevo y Google Cloud**
  y sus **recovery codes de 2FA** viven en la bóveda (`[COMPLETAR]`).

> Sin bóveda y sin segunda clave, la recuperación depende de la memoria de una
> persona: eso es justo lo que este runbook elimina.

---

## Referencias

- [docs/DEPLOY.md](./DEPLOY.md) — deploy, alias `DC`, túnel SSH, secretos.
- [docs/operations.md](./operations.md) — salud, crons, recuperación diaria.
- [docs/VOLCADO_HISTORICO.md](./VOLCADO_HISTORICO.md) — re-import histórico.
- `deploy/backup-db.sh` — backup diario + off-site.
- `deploy/backup-env.sh` — copia cifrada de `.env.prod` (#290); `deploy/.backup-offsite.env.example` — plantilla de configuración off-site.
- `deploy/restore-sports-dump.sh` — restore completo preservando datos de usuario.
- `deploy/verify-backup.sh` — verificación de restaurabilidad.
- `deploy/etl-healthcheck.sh` — salvaguarda de salud del ETL (#373).
- `deploy/disk-hygiene.sh` + `deploy/logrotate-sticklive` — higiene de disco y rotación de logs de cron (#301, #309).
- `deploy/tag-release.sh` — etiqueta git/docker de la release para rollback (#297).
- `deploy/deploy.sh` — build + smoke verificable; llama a `tag-release.sh` al terminar.
- `docker-compose.prod.yml`, `deploy/Dockerfile`, `deploy/Caddyfile` — la
  infraestructura como código que este runbook reconstruye.
- Issues **#290** (copia cifrada de `.env.prod`), **#295** (este runbook),
  **#297** (rollback), **#300** (superficie de secretos), **#301** (disco),
  **#302** (acceso), **#304** (SSH), **#373** (healthcheck del ETL).

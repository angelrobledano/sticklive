# Despliegue — Stick Live (producción)

*Actualizado: 17 de junio de 2026*

Procedimiento de despliegue en el VPS. No contiene secretos: la password de BD y las claves VAPID viven **solo** en `/opt/sticklive/.env.prod` en el servidor.

---

## Infraestructura

- **VPS**: Hetzner, IP `167.233.94.156`, ruta `/opt/sticklive`.
- **Orquestación**: Docker Compose (`docker-compose.prod.yml`) con servicios `postgres` (16-alpine), `api`, `web`, `caddy`, `etl`.
- **Proxy/TLS**: Caddy con HTTPS automático para `sticklive.eu` (+ www). Regla `handle_path /api/*` → `api:3000`.
- **Postgres**: publicado solo en `127.0.0.1:5432` (accesible por túnel SSH, nunca expuesto a internet).
- **Runtime**: los contenedores ejecutan vía `npx tsx` (el comando va en el compose); `tsx` está disponible dentro de la imagen.

## Alias imprescindible

Todo comando de Compose en el servidor usa este alias (carga el fichero de entorno correcto):

```bash
cd /opt/sticklive
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
```

Sin `--env-file .env.prod` fallan cosas como `$DC logs` o cualquier `exec`.

---

## Despliegue estándar

```bash
cd /opt/sticklive

# 1. Proteger los scripts que están modificados EN el servidor (si no, git pull aborta).
git checkout -- deploy/backup-db.sh deploy/restore-sports-dump.sh

# 2. Traer el código nuevo.
git pull

# 3. Reconstruir y levantar (los NEXT_PUBLIC_* se hornean aquí, ver abajo).
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$DC up -d --build

# 4. Aplicar migraciones pendientes (idempotente).
$DC exec api npx tsx packages/db/src/migrate.ts

# 5. Verificar.
$DC ps
$DC logs -f --tail=100 api web etl
```

### Despliegue solo-web

Si el cambio es únicamente de `apps/web`, basta reconstruir ese servicio:

```bash
$DC up -d --build web
```

---

## ⚠️ Variables `NEXT_PUBLIC_*` se hornean en BUILD

Las variables `NEXT_PUBLIC_*` (entre ellas `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SEASON_ID`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) se inyectan como **build args** en el `docker build` de la web (anchor `&app-build` que las pasa desde `.env.prod`). Consecuencias:

- Cambiar una `NEXT_PUBLIC_*` en `.env.prod` **no surte efecto** hasta un `up -d --build web`.
- Si alguna quedó **vacía** en el build, la web arranca sin ese valor. Por eso hay derivación en runtime donde es posible (p. ej. la temporada se deriva de `/competitions` si `NEXT_PUBLIC_SEASON_ID` viene vacío). Aun así, lo correcto es tenerlas pobladas antes de construir.

---

## Migraciones

- Runner idempotente con tabla `_migrations`: `$DC exec api npx tsx packages/db/src/migrate.ts`.
- **Siempre** tras cualquier `git pull` que traiga migraciones nuevas, y **obligatorio** tras reconstruir/vaciar la BD (si no, aparecen errores como `column "session_expires_at" does not exist` y el magic link devuelve 500).
- Para reconstruir competiciones/datos, ver [RUNBOOK_COMPETICIONES.md](./RUNBOOK_COMPETICIONES.md).

---

## Acceso a la BD desde el PC (túnel SSH)

Postgres no está expuesto; hay que abrir un túnel:

```powershell
ssh -i $env:USERPROFILE\.ssh\sticklive -L 5432:localhost:5432 root@167.233.94.156
```

Deja esa ventana abierta (solo sostiene el túnel) y, en **otra** terminal del PC, ejecuta los scripts (`npx tsx …`) contra `localhost:5432`.

Notas que ahorran tiempo:

- El `DATABASE_URL` local va **sin** la password en la URL; la password se pasa por `PGPASSWORD` en el entorno (la password tiene caracteres especiales que rompen la URL).
- Los `npx` se ejecutan en el PC, no dentro de la ventana del túnel SSH (ahí daría "npx not found").
- `ECONNREFUSED localhost:5432` = el túnel no está abierto.

---

## Secretos (no versionar, no documentar valores)

Viven solo en `/opt/sticklive/.env.prod`:

- `DATABASE_URL` / password de Postgres.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` y `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (Web Push).
- `ADMIN_TOKEN`, credenciales de Brevo (email), Google OAuth, PostHog, Stripe/Redsys.

Si se rotan las VAPID, hay que **reconstruir la web** (la pública es build arg) y las suscripciones push existentes seguirán siendo válidas solo si la pareja de claves se mantiene; cambiarlas invalida las suscripciones.

---

## Checklist de despliegue

- [ ] `git checkout --` de `deploy/backup-db.sh` y `deploy/restore-sports-dump.sh`.
- [ ] `git pull`.
- [ ] `$DC up -d --build` (o `--build web` si solo es front).
- [ ] `$DC exec api npx tsx packages/db/src/migrate.ts`.
- [ ] `NEXT_PUBLIC_*` pobladas antes de construir.
- [ ] `$DC ps` todo `Up` + revisar `logs` de `api`/`web`/`etl`.

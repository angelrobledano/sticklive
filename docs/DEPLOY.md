# Despliegue — Stick Live (producción)

*Actualizado: 17 de junio de 2026*

Procedimiento de despliegue en el VPS. No contiene secretos: la password de BD y las claves VAPID viven **solo** en `/opt/sticklive/.env.prod` en el servidor.

---

## Infraestructura

- **VPS**: Hetzner, IP `167.233.94.156`, ruta `/opt/sticklive`.
- **Orquestación**: Docker Compose (`docker-compose.prod.yml`) con servicios `postgres` (16-alpine), `api`, `web`, `caddy`, `etl`.
- **Proxy/TLS**: Caddy con HTTPS automático para `sticklive.eu` (+ www). Regla `handle_path /api/*` → `api:3000`.
- **Postgres**: publicado solo en `127.0.0.1:5432` (accesible por túnel SSH, nunca expuesto a internet).
- **Runtime**: los contenedores ejecutan **JavaScript ya compilado** desde `dist/`, con `node`. La imagen se construye en tres etapas (`deploy/Dockerfile`) y la final no lleva ni `tsx`, ni TypeScript, ni el código fuente; corre como usuario `node`, sin privilegios. El empaquetado lo hace `scripts/build-server.mjs`.
- **Migraciones**: las aplica el servicio `migrate`, que corre una vez al levantar y del que dependen `api` y `etl`. Ya **no** hay paso manual.

## Alias imprescindible

Todo comando de Compose en el servidor usa este alias (carga el fichero de entorno correcto):

```bash
cd /opt/sticklive
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
```

Sin `--env-file .env.prod` fallan cosas como `$DC logs` o cualquier `exec`.

---

## Releases con migraciones

**Ya no hay procedimiento especial.** El servicio `migrate` corre al levantar y
`api` y `etl` no arrancan hasta que termina bien, así que el orden lo garantiza
el compose y no la memoria de quien despliega.

Lo único que sigue siendo tuyo: `./deploy/backup-db.sh` **antes** si la
migración reescribe datos existentes. Añadir una columna o un índice no lo
necesita; reescribir filas, sí.

<details>
<summary>Qué había antes y por qué se cambió</summary>

El despliegue construía primero y migraba después, lo que dejaba una ventana en
la que el `etl` corría contra una base sin preparar. Con la migración 034 —que
crea el índice único contra el que `replaceMatchEvents` hace `ON CONFLICT`— el
`cron-live` arrancaba, pedía la ficha y reventaba hasta que alguien ejecutaba el
paso de migrar a mano.

El remedio era una secuencia de cuatro comandos en un orden concreto,
documentada aquí y en ningún otro sitio. Funcionaba mientras te acordaras. El
20/07/2026 un despliegue se quedó a medias justo así: el `etl` parado una hora,
las migraciones sin aplicar y `api`/`web` con imagen de 24 horas antes.

Un paso manual que hay que recordar en el momento exacto no es un procedimiento:
es un fallo esperando su turno. De ahí el servicio `migrate`.

</details>

---

## Despliegue en un comando (recomendado)

`deploy/deploy.sh` encapsula el despliegue estándar y añade lo que faltaba:
comprueba el espacio libre **antes** de construir (el VPS de 4 GB se llena con la
caché de build), libera caché de build si hace falta y verifica la **versión
viva** con un smoke test — no solo que los contenedores estén `up`. Nació del
incidente en que producción sirvió durante días un build anterior a `main` (#248).
Al terminar en verde llama a `deploy/tag-release.sh`, que crea el tag de git de la
release y conserva la imagen anterior como `:previous` para el rollback (#297).

```bash
cd /opt/sticklive
./deploy/deploy.sh
```

Opciones: `--dry-run` (preflight + smoke sin tocar git ni reconstruir),
`--skip-pull`, `--skip-smoke`, `--help`. Variables de entorno: `BRANCH` (main),
`REMOTE` (origin), `SMOKE_BASE` (https://sticklive.eu), `MIN_FREE_GB` (15).

Usa `git pull --ff-only`: si tienes cambios locales en ficheros que también
cambian upstream (p. ej. `deploy/verify-backup.sh`), **aborta** en vez de
descartarlos; resuélvelo a mano y relánzalo.

---

## Despliegue estándar (paso a paso)

```bash
cd /opt/sticklive

# 1. Descartar cambios locales en scripts del servidor (si no, git pull aborta).
#    Los scripts de deploy están trackeados como EJECUTABLES (100755) en git desde
#    #291, así que este checkout también restaura el bit +x. Cinturón y tirantes:
git checkout -- deploy/backup-db.sh deploy/restore-sports-dump.sh
chmod +x deploy/backup-db.sh deploy/verify-backup.sh deploy/restore-sports-dump.sh 2>/dev/null || true

# 2. Traer el código nuevo.
git pull

# 3. Reconstruir y levantar (los NEXT_PUBLIC_* se hornean aquí, ver abajo).
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$DC up -d --build

# 4. Verificar (las migraciones ya las aplicó el servicio `migrate`).
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

- Runner idempotente con tabla `_migrations`. Lo ejecuta el **servicio `migrate`** en cada `up`, antes de que arranquen `api` y `etl` (`condition: service_completed_successfully`). Si una migración falla, el despliegue se para ahí en vez de seguir a medias.
- Para lanzarlo suelto: `$DC run --rm migrate`.
- Antes esto era manual y su orden vivía sólo en este documento. Olvidarlo producía errores como `column "session_expires_at" does not exist` y un magic link devolviendo 500 — un fallo que aparecía lejos de su causa.
- Para reconstruir competiciones/datos, ver [RUNBOOK_COMPETICIONES.md](./RUNBOOK_COMPETICIONES.md).

---

## Rollback (#297)

No hay botón mágico: hay que decidir entre **volver el código** y/o **volver la
BD**. Código y esquema deben quedar alineados o la API se niega a arrancar
(`assertSchemaCurrent` → `SchemaOutdatedError`).

### Artefactos de release

Cada deploy correcto (vía `deploy/deploy.sh`) llama a **`deploy/tag-release.sh`**,
que crea el tag de git `vYYYYMMDD-<sha>` y conserva la imagen de cada servicio
como `<proyecto>-<svc>:<release>`, moviendo la anterior a `:previous` y dejando
la actual en `:current` (p. ej. `sticklive-api:previous`). Así `previous` es
siempre la release **anterior** a la que corre.

Desde el 10/10/2026, tras etiquetar, `tag-release.sh` **purga los tags de
releases anteriores** (`deploy/prune-release-images.sh`): conserva `:current`,
`:previous` y los tags de release que apunten a esas mismas imágenes, y retira
el resto. Sin esta purga cada deploy añadía 4 imágenes nuevas y 10 releases
llegaron a ocupar 19 GB. El preflight de `deploy.sh` también usa esa purga como
último recurso antes de abortar por espacio libre insuficiente.

### Rollback de app (rápido, sin rebuild)

Si el fallo es de código y el esquema **no** cambió, vuelve a la imagen anterior
(segundos):

```bash
cd /opt/sticklive
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
docker images | grep -E 'sticklive-(api|web|etl)'   # confirma que hay :previous

# Reapunta el tag que usa Compose a la imagen anterior y recrea.
for svc in api web etl; do
  repo="sticklive-$svc"        # = <nombre-proyecto-compose>-<svc>; aquí 'sticklive'
  docker tag "$repo:previous" "$repo:latest"
done
$DC up -d --no-build --force-recreate api web etl
$DC ps
```

### Rollback de app (rebuild desde git)

Si prefieres volver el código (o no hay `:previous`):

```bash
cd /opt/sticklive
git fetch --tags origin
git checkout vYYYYMMDD-<sha-anterior>
./deploy/deploy.sh --skip-pull        # o: $DC up -d --build
# ...resuelto, vuelve a main:
git checkout main && ./deploy/deploy.sh
```

Rebuild en 2 vCPU: ~10–15 min + 15–60 s de recreación.

### Rollback de BD (el caso duro)

Las migraciones son **forward-only**: no hay `down`. Para volver atrás hay que
**restaurar el dump previo** y **volver el código de la época**:

```bash
# 1. Backup de seguridad del estado actual (nunca restaurar sin él).
./deploy/backup-db.sh
# 2. Restaurar el dump ANTERIOR al despliegue problemático (ver operations.md).
gunzip -c /opt/backups/sticklive-<fecha-hora>.sql.gz \
  | $DC exec -T postgres psql -U sports_user -d sports_results
# 3. Volver el código a la release que casaba con ese esquema y arrancar.
git checkout vYYYYMMDD-<sha-de-esa-release> && $DC up -d --build
```

`assertSchemaCurrent` compara el esquema con el que espera el código: si
restauras una BD más vieja **sin** volver el código, la API no arranca
(`SchemaOutdatedError`). El escape temporal `SKIP_SCHEMA_CHECK=1` en el entorno
de `api` permite arrancar sobre esquema atrasado **solo para diagnosticar o
adelantar la migración**, nunca como estado permanente: puede provocar errores
de columna/tabla ausente.

### Cuándo NO hay rollback limpio

- **Migración que reescribe datos** (borra columnas, transforma filas, cambia
  identidades): el dump anterior no incluye el trabajo posterior; volver atrás
  pierde lo escrito desde entonces. Exige `./deploy/backup-db.sh` **antes** de
  desplegar y asumir la ventana de pérdida.
- Si el incidente corre **más de 24 h** desde el último dump (RPO), restaura el
  más nuevo y asume la pérdida de lo posterior.
- **Nunca** hagas rollback de esquema a mano con SQL: no hay `down` y dejarías
  el esquema en un estado que el runner no reconoce.

> Pendiente: ensayar el rollback de app una vez (deploy trivial → `:previous` →
> `up -d --no-build`) y anotar el tiempo real (#297).

---

## Acceso a la BD desde el PC (túnel SSH)

Postgres no está expuesto; hay que abrir un túnel:

```powershell
ssh -i $env:USERPROFILE\.ssh\sticklive -L 5432:localhost:5432 root@167.233.94.156
```

Deja esa ventana abierta (solo sostiene el túnel) y, en **otra** terminal del PC, ejecuta los scripts (`npx tsx …`) contra `localhost:5432`. En el PC sí hay `tsx`: es en la imagen de producción donde ya no está.

Este es el camino para todo lo que **no** va empaquetado en la imagen: importaciones históricas masivas (`import-history`, `import-federations`, `import-history-fichas`), depuración y backfills. Son trabajos largos, leen ficheros del repo o lanzan subprocesos, y conviene lanzarlos desde IP residencial. La lista de lo que sí viaja en la imagen está en `scripts/build-server.mjs`.

Notas que ahorran tiempo:

- El `DATABASE_URL` local va **sin** la password en la URL; la password se pasa por `PGPASSWORD` en el entorno (la password tiene caracteres especiales que rompen la URL).
- Los `npx` se ejecutan en el PC, no dentro de la ventana del túnel SSH (ahí daría "npx not found").
- `ECONNREFUSED localhost:5432` = el túnel no está abierto.

---

## Secretos (no versionar, no documentar valores)

Viven solo en `/opt/sticklive/.env.prod`:

- `DATABASE_URL` / password de Postgres.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` y `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (Web Push).
- `ADMIN_TOKEN`, `AUTH_STATE_SECRET` (firma del `state` de OAuth), credenciales de
  Brevo (email), Google OAuth y PostHog. **`STRIPE_*` y `PREMIUM_PRICE_EUR_CENTS`
  solo si los pagos están activos** (hoy, apagados).

> **Superficie de secretos (#300):** `docker-compose.prod.yml` ya **no** usa
> `env_file` para `web`: cada servicio declara explícitamente lo que consume, así
> que `web` no recibe `POSTGRES_PASSWORD` (no la usa) y `SENTRY_AUTH_TOKEN` es
> **solo un build arg** (no llega al runtime de api/web/etl). Al añadir una
> variable nueva al código hay que declararla en el servicio correspondiente.

Si se rotan las VAPID, hay que **reconstruir la web** (la pública es build arg) y las suscripciones push existentes seguirán siendo válidas solo si la pareja de claves se mantiene; cambiarlas invalida las suscripciones.

---

## Checklist de despliegue

- [ ] ¿La release trae migraciones? → nada especial: el servicio `migrate`
      las aplica al levantar y api/etl no arrancan hasta que termine. Si
      alguna reescribe datos existentes, `./deploy/backup-db.sh` antes.
- [ ] `git checkout --` de `deploy/backup-db.sh` y `deploy/restore-sports-dump.sh` (restaura el bit +x; son `100755` en git desde #291).
- [ ] `git pull` (sin desplegar si el job `docker` de CI no está en verde).
- [ ] `$DC up -d --build` (o `--build web` si solo es front).
- [ ] `NEXT_PUBLIC_*` pobladas antes de construir.
- [ ] `$DC ps` todo `Up` + revisar `logs` de `api`/`web`/`etl`.
- [ ] Smoke post-deploy: `curl -fsS https://sticklive.eu/api/health` y `curl -fsS -o /dev/null -w '%{http_code}' https://sticklive.eu/es` (deben dar 200). No des el deploy por bueno sin esto (#165).
- [ ] Smoke test: `curl -fsS https://sticklive.eu/api/health` → `{"status":"ok"}`.
- [ ] Release etiquetada (`deploy/deploy.sh` la hace sola): `git tag -l 'v*'` y `docker images | grep -E 'sticklive-(api|web|etl).*previous'`. Si no, `./deploy/tag-release.sh` (#297).

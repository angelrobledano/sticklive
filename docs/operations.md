# Operaciones — Stick Live en producción

*Host: VPS Hetzner, `/opt/sticklive`. Alias de compose en el servidor: `DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"`. Despliegue en [DEPLOY.md](./DEPLOY.md).*

## Cómo saber que todo funciona (comprobación rápida)

| Qué | Cómo | Sano si… |
|---|---|---|
| Web + API arriba | `curl -fsS https://sticklive.eu/api/health` | `{"status":"ok","db":"ok",…}` (503 si Postgres no responde) |
| Contenedores | `$DC ps` | todos `Up`; `api`/`web`/`etl` `(healthy)` |
| Directo vivo | Sentry → Cron Monitor del directo | latidos sin miss (avisa solo si falla) |
| Scraping al día | tabla `scrape_logs` (`SELECT scraper_key, status, max(scraped_at) FROM scrape_logs GROUP BY 1,2`) | últimas pasadas `success`, sin huecos de horas |
| Backups | `ls -lt /opt/backups/` | fichero de ayer (nombre `sticklive-YYYYMMDD-HHMM.sql.gz`), ≥100 KB y permisos `600`; `verify-backup.sh` falla si el último tiene >`MAX_AGE_HOURS`, def. 30 |
| Disco | `df -h /`; `deploy/disk-hygiene.sh` | <80 % usado; prune de caché + cap de journald en verde |
| Particiones BD | logs de `partition-guard` | sin alertas; `match_events_undated` vacía |

## Jobs y qué pasa si fallan

| Job | Cadencia | Si falla | Se entera alguien |
|---|---|---|---|
| `cron-live` (directo) | 5 min (bucle 45 s en vivo) | próxima pasada en 5 min; idempotente | Sentry Cron Monitor (~10 min de silencio) + alerta si el feed da 0 partidos 3 ciclos seguidos |
| `worldskate` | 5 min | idem | scrape-health diaria |
| calendario + standings | cada hora | siguiente pasada a la hora | scrape-health diaria (>26 h parado) |
| escudos (`download-logos`) | cada hora (tras calendario+standings) | siguiente pasada a la hora; la API sigue sirviendo el escudo proxeado del CDN | log del ETL |
| `fichas-pendientes` | diaria 06 UTC | actas se acumulan; se recuperan al día siguiente | scrape-health diaria |
| fotos de jugador (`update-player-photos`) | diaria 06 UTC (tras fichas) | los jugadores nuevos muestran silueta; se recuperan al día siguiente | log del ETL |
| purga `scrape_logs` / `partition-guard` / `scrape-health-watch` | diaria 06 UTC | sin efecto inmediato; vigilar disco/particiones | Sentry |
| backup BD | diaria 04:15 (cron del host) | exit 2 si falla el off-site a Storage Box; el verify falla si el dump supera `MAX_AGE_HOURS` | ping a `BACKUP_PING_URL` (éxito/fallo) + `/var/log/sticklive-backup.log` |
| higiene de disco (`disk-hygiene.sh`) | diaria 05:00 UTC | sin efecto inmediato; vigilar el disco | alerta si disco ≥80 % (ping) + `/var/log/sticklive-hygiene.log` |

El scheduler (`deploy/etl-scheduler.sh`) corre **con `flock`**: si un scrape manual se solapa, el cron lo registra y no ejecuta (sin duplicados de escritura). Los logs de contenedores van a `docker logs` (rotación pendiente, issue #163).

## Backups, off-site y secretos

- **Diario (04:15, host):** `deploy/backup-db.sh` dumpea Postgres a `/opt/backups/sticklive-YYYYMMDD-HHMM.sql.gz` (con hora: un re-dump manual ya no pisa el del cron, #309), lo deja en `600` y valida gzip y tamaño. Retención **escalonada**: 7 diarios + 4 semanales + 3 mensuales (los semanales/mensuales son *hardlinks* en `weekly/`/`monthly/`: no duplican bytes). Si algo falla **no rota**: un dump malo nunca borra los buenos.
- **`sports_staging` (#309):** **no** se dumpea a propósito. Es una copia regenerable de `sports_results` (`deploy/seed-staging.sh` la recrea desde prod en minutos), así que backupearla duplicaría ~59 MB sin valor de recuperación. Si algún día aloja datos no derivables de prod, revisar esta decisión.
- **Alerta de éxito/fallo (#292):** define `BACKUP_PING_URL` en `/opt/sticklive/.backup-offsite.env` para recibir un ping en cada ejecución. Convención: healthchecks.io/dead-man-snitch → GET a la URL en éxito y a `<url>/fail` en fallo; Sentry Cron Monitor (URL con `/cron/`) → `?status=ok|error`. `exit 1` = fallo de dump, `exit 2` = fallo del off-site. Sin la variable no hay aviso externo (solo el log). Probar el canal sin tocar la BD ni el off-site: `BACKUP_PING_URL=… ./deploy/backup-db.sh --test-alert`.
- **Off-site por rsync (#289):** `backup-db.sh` empuja los `.sql.gz` a una Hetzner Storage Box si existe `/opt/sticklive/.backup-offsite.env` con `OFFSITE_TARGET` (plantilla: `deploy/.backup-offsite.env.example`, permisos `600`). Sin el fichero la sincronización se omite y `verify-backup.sh` lo avisa. El envío valida `host:ruta`, que exista `rsync` y que la clave SSH (`-i`) sea legible. **Pendiente de activar** (requiere credenciales de la Storage Box).
- **Verify semanal (lunes 04:30):** `deploy/verify-backup.sh` restaura el dump más reciente en una BD temporal y comprueba conteos. **Falla** si el dump tiene más de `MAX_AGE_HOURS` horas (def. 30) — evita el "falso confort" si el backup lleva días fallando en silencio. Con off-site activo, además exige que ese mismo dump exista en el destino remoto.
- **Copia cifrada de `.env.prod` (#290):** `deploy/backup-env.sh` cifra `/opt/sticklive/.env.prod` con `age` (preferido) o `gpg` usando solo la **clave pública** (`AGE_RECIPIENT`/`GPG_RECIPIENT` en `.backup-offsite.env`), conserva las últimas 30 copias y las empuja off-site si hay destino. La clave privada se guarda **fuera del VPS**; sin ella la copia es inservible. Restaurar: `age -d -i <clave> -o .env.prod …` (o `gpg -d -o .env.prod …`) y `chmod 600`.

## Disco y retención (#301)

- **Higiene diaria:** `deploy/disk-hygiene.sh` (cron diario 05:00 UTC) alerta si el disco ≥80 %, hace `docker builder prune` conservando la caché de las últimas 168 h, fija un cap persistente de journald (`SystemMaxUse=500M`) + reclama espacio, y (re)instala el logrotate de `/var/log/sticklive-*.log` (`deploy/logrotate-sticklive`, semanal, 8 copias). Instalación:

  ```bash
  echo '0 5 * * * root /opt/sticklive/deploy/disk-hygiene.sh >> /var/log/sticklive-hygiene.log 2>&1' > /etc/cron.d/sticklive-hygiene
  ```

  La alerta usa `DISK_PING_URL` o, si falta, el `BACKUP_PING_URL` de `.backup-offsite.env`. Sin monitor externo solo queda el log.
- **`match_events` — retención DIFERIDA (decisión de producto):** las particiones `s20xx` se crean pero **no se purgan**, así que el dump crece con los años. Borrar eventos históricos no es limpieza: cambia qué muestra la hemeroteca y hay que decidirlo antes (¿purgar temporadas pasadas? ¿agregar?). Documentado en [database.md](./database.md#operación). Hasta entonces, el disco se vigila con la higiene de arriba.
- **Logs:** los de cron rotan con logrotate; los de contenedor los rota Docker (`10 MB × 3`, `docker-compose.prod.yml`).

## Logs

```bash
$DC logs -f --tail=100 api web etl        # en vivo
$DC logs --since 1h etl | grep -i error   # errores de la última hora
```

Además: `scrape_logs` en BD (trazabilidad por scraper, estado y filas) y Sentry (errores de api/web/etl + alertas del pipeline).

## Reinicio y caídas

- Reiniciar un servicio: `$DC restart api` (o `web`, `etl`). Rebuild si cambió código: `$DC up -d --build api`.
- **Crash-loop de la API** (lección del 26/09/2026, nodemailer): imagen compilada + entrypoints presentes pero una dependencia que no resuelve → exit 1 en bucle. Diagnóstico: `$DC logs api`; prevención: el job `docker` del CI verifica que todas las dependencias externas de `dist/` resuelven en la imagen. No desplegar sin ese job en verde.
- Contenedor `unhealthy`: `api`/`web` los reinicia el sidecar `autoheal` (label `autoheal`, #164). El `etl` queda fuera a propósito por diseño (reiniciarlo durante un directo mataría el bucle); para él hay una salvaguarda propia, ver [Salud del ETL](#salud-del-etl-373). El healthcheck de `api` usa **`/health/live`** (liveness: solo comprueba que el proceso responde, **sin tocar la BD**); `web` usa `/` (la home captura el fallo de API y responde 200). `/health` (con `SELECT 1`) es **readiness** y solo lo consume el monitor externo: un bache de Postgres no debe reiniciar la API (incidente 2026-10-05, ver `apps/api/src/routes/health.ts`).
  - El sidecar `autoheal` **monta `/var/run/docker.sock`** (equivale a root en el host): riesgo aceptado y documentado en `docker-compose.prod.yml`. Para eliminarlo: borrar el servicio `autoheal` y los labels `autoheal` de api/web; reiniciar `api`/`web` pasa a ser manual (el ETL ya tiene su propia salvaguarda).
- PostgreSQL no está expuesto a internet: solo `127.0.0.1:5432` en el VPS. Acceso desde el PC por túnel SSH (ver [DEPLOY.md](./DEPLOY.md)).

### Salud del ETL (#373)

El healthcheck de `etl` es un latido de fichero (`/tmp/etl-alive`; `cron-live` lo toca en cada ciclo de 45 s, #146). Si el ETL se **cuelga vivo** (sin avanzar, p. ej. un scrape bloqueado) queda `unhealthy` y el directo se congela hasta un `$DC restart etl` manual. El sidecar `autoheal` no puede tocar el ETL sin riesgo de matar un directo en curso.

Salvaguarda conservadora en el host (`deploy/etl-healthcheck.sh`), instalada como cron:

```bash
# /etc/cron.d/sticklive-health
*/5 * * * * root /opt/sticklive/deploy/etl-healthcheck.sh >> /var/log/sticklive-health.log 2>&1
```

Solo reinicia `etl` si se cumplen **las tres**:
1. el contenedor está `unhealthy`, y
2. Docker acumula `FailingStreak >= 3` (3 fallos consecutivos del healthcheck = sin latido >2 intervalos), y
3. este script lo confirma en `ETL_UNHEALTHY_CYCLES` pasadas consecutivas (defecto 2 → ~10 min con el cron de 5 min).

Antes de reiniciar escribe una **alerta** (log siempre; a Sentry si el entorno del cron define `SENTRY_DSN`) y tras reiniciar entra en enfriamiento (`ETL_RESTART_COOLDOWN_MIN`, 30 min) para no entrar en bucle. Variables en la cabecera del script. Requiere `docker` en el PATH del root que ejecuta el cron.

## Recuperación

- **Desastre total (VPS destruido):** runbook de reconstrucción desde cero en **[docs/dr.md](dr.md)** (provision, secretos, restauración de BD, DNS, smoke).
- **Base de datos:** `./deploy/backup-db.sh` (diario automatizado en `/etc/cron.d/sticklive-backup`, retención 7 diarios + 4 semanales + 3 mensuales, off-site opcional a Storage Box) y `./deploy/restore-sports-dump.sh` para restaurar — el restore **preserva los datos de usuario** (users, favorites, tokens, **sesiones**, push, orders) y deja api/etl/web parados durante la operación. `./deploy/verify-backup.sh` restaura en una BD temporal y valida conteos (semanal, documentado en el propio script). Secretos y off-site: ver [Backups, off-site y secretos](#backups-off-site-y-secretos).
- **Migración fallida a mitad:** el runner aborta y el despliegue no continúa (api/etl no arrancan con esquema desactualizado — `assertSchemaCurrent`). Si la migración reescribía datos: restaurar backup; si solo DDL: corregir el SQL y volver a aplicar.
- **Fuente caída / datos parados:** el sistema degrada sin corromper (upserts idempotentes). La web muestra lo último cargado; el backlog se recupera solo al volver la fuente (calendario horario + fichas diarias). Vigilar la alerta de "200 OK con 0 partidos" — suele ser un cambio de la fuente, no una caída.
- **Partido fantasma "EN VIVO":** `stale-live-watchdog` lo degrada a `scheduled` a las 5 h si sigue `live`. Y si un `live` con marcador **desaparece del feed mc 3 ciclos seguidos** (feed sano), `cron-live` lo marca `finished` con el último marcador (#374) — así no se espera al watchdog ni al calendario horario. El umbral es `MISSING_LIVE_CYCLES` (por defecto 3). El estado `live` de reloj se pinta, en API y web, con el MISMO umbral `STALE_LIVE_HOURS` (5 h, `@sports/shared-types`); antes la web usaba 3 h y divergía (#377). Nota: la ficha individual aún podía pintar `live` por `effectiveStatus` (issue #150).
- **Inicio >2 h antes de la hora programada (edge aceptado, #377):** no hay señal fiable para detectarlo antes de que el partido entre en la ventana de `checkWindow` (±2 h), y ampliarla haría que `cron-live` sondee en vacío. Se recupera solo por el calendario horario o al pasar `scheduled_at`. Documentado como limitación conocida.

## Dominio, TLS y borde

- `sticklive.eu` (+www) con HTTPS automático de Caddy (Let's Encrypt; certificados persistentes en volumen `caddy_data`, renovación automática).
- Cabeceras de seguridad en el borde (HSTS sin preload, XCTO, XFO, Referrer-Policy; `-Server`).
- `handle_path /api/*` hacia `api:3000` con `flush_interval -1` (imprescindible para el SSE).
- **Publicidad (Google AdSense):** apagada por defecto; solo se carga si se define `NEXT_PUBLIC_ADSENSE_CLIENT`. La CSP (modo observación) ya incluye los hosts de AdSense. Guía de activación, consentimiento (CMP) y política: **[docs/monetizacion.md](./monetizacion.md)**.
- **Monitorización externa (UptimeRobot, #155/#299):** monitor creado (dashboard id `804186186`) sobre `https://sticklive.eu` y `https://sticklive.eu/api/health` (readiness). Es la señal externa de "web/BD caída" (antes solo abrir la web o mirar Sentry). UptimeRobot expone además **MCP oficial** (`https://mcp.uptimerobot.com/mcp`), añadido a la config de OpenCode (`~/.config/opencode/opencode.jsonc`, OAuth al primer uso). Pendiente: **probar el canal de alertas**, añadir monitor de **TLS** y conectar la vigilancia de disco (`DISK_PING_URL`) a un heartbeat.

## Acceso, cuentas y SSH (#302, #304)

Inventario de cuentas externas, credenciales y recovery codes de 2FA: **[docs/dr.md §3](./dr.md)** (rellenar antes del lanzamiento). Puntos operativos:

- **Una sola clave SSH es un punto único de fallo (#302).** Añadir una **segunda clave** (dispositivo o copia segura fuera del PC habitual) a `/root/.ssh/authorized_keys` y **probarla en una sesión nueva** antes de confiar en ella. Procedimiento en [dr.md §7](./dr.md).
- **Acceso de emergencia:** consola *rescue* de Hetzner Cloud y credenciales de la Storage Box. Pasos en [dr.md §16](./dr.md); el registrar/vencimiento del dominio y los recovery codes viven en la bóveda.
- **Hardening SSH (#304):** `PasswordAuthentication no`, `X11Forwarding no` y `fail2ban` con jail `sshd`. En este repo **no** se toca el SSH del servidor: el procedimiento (con verificación de acceso por clave) está en [dr.md §7](./dr.md).
- **TTL del DNS:** bajar el TTL del registro A a 3600 s acelera una migración de IP en un desastre ([dr.md §12](./dr.md)).

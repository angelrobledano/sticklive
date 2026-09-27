# Operaciones — Stick Live en producción

*Host: VPS Hetzner, `/opt/sticklive`. Alias de compose en el servidor: `DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"`. Despliegue en [DEPLOY.md](./DEPLOY.md).*

## Cómo saber que todo funciona (comprobación rápida)

| Qué | Cómo | Sano si… |
|---|---|---|
| Web + API arriba | `curl -fsS https://sticklive.eu/api/health` | `{"status":"ok"}` |
| Contenedores | `$DC ps` | todos `Up`; `api`/`web`/`etl` `(healthy)` |
| Directo vivo | Sentry → Cron Monitor del directo | latidos sin miss (avisa solo si falla) |
| Scraping al día | tabla `scrape_logs` (`SELECT kind, status, max(created_at) … GROUP BY 1,2`) | últimas pasadas `success`, sin huecos de horas |
| Backups | `ls -lt /opt/backups/` | fichero de ayer, ≥100 KB (el script valida gzip y tamaño) |
| Particiones BD | logs de `partition-guard` | sin alertas; `match_events_undated` vacía |

## Jobs y qué pasa si fallan

| Job | Cadencia | Si falla | Se entera alguien |
|---|---|---|---|
| `cron-live` (directo) | 5 min (bucle 45 s en vivo) | próxima pasada en 5 min; idempotente | Sentry Cron Monitor (~10 min de silencio) + alerta si el feed da 0 partidos 3 ciclos seguidos |
| `worldskate` | 5 min | idem | scrape-health diaria |
| calendario + standings | cada hora | siguiente pasada a la hora | scrape-health diaria (>26 h parado) |
| `fichas-pendientes` | diaria 06 UTC | actas se acumulan; se recuperan al día siguiente | scrape-health diaria |
| purga `scrape_logs` / `partition-guard` / `scrape-health-watch` | diaria 06 UTC | sin efecto inmediato; vigilar disco/particiones | Sentry |
| backup BD | diaria 04:15 (cron del host) | exit 2 si falla el off-site a Storage Box | revisar `/var/log/sticklive-backup.log` |

El scheduler (`deploy/etl-scheduler.sh`) corre **con `flock`**: si un scrape manual se solapa, el cron lo registra y no ejecuta (sin duplicados de escritura). Los logs de contenedores van a `docker logs` (rotación pendiente, issue #163).

## Logs

```bash
$DC logs -f --tail=100 api web etl        # en vivo
$DC logs --since 1h etl | grep -i error   # errores de la última hora
```

Además: `scrape_logs` en BD (trazabilidad por scraper, estado y filas) y Sentry (errores de api/web/etl + alertas del pipeline).

## Reinicio y caídas

- Reiniciar un servicio: `$DC restart api` (o `web`, `etl`). Rebuild si cambió código: `$DC up -d --build api`.
- **Crash-loop de la API** (lección del 26/09/2026, nodemailer): imagen compilada + entrypoints presentes pero una dependencia que no resuelve → exit 1 en bucle. Diagnóstico: `$DC logs api`; prevención: el job `docker` del CI verifica que todas las dependencias externas de `dist/` resuelven en la imagen. No desplegar sin ese job en verde.
- Contenedor `unhealthy`: los healthchecks (api `/health`, web `/`, etl latido de fichero) lo marcan, pero **nada lo reinicia automáticamente** (issue #164). Si está colgado (proceso vivo sin responder): `$DC restart`.
- PostgreSQL no está expuesto a internet: solo `127.0.0.1:5432` en el VPS. Acceso desde el PC por túnel SSH (ver [DEPLOY.md](./DEPLOY.md)).

## Recuperación

- **Base de datos:** `./deploy/backup-db.sh` (diario automatizado en `/etc/cron.d/sticklive-backup`, rotación 7, off-site opcional a Storage Box) y `./deploy/restore-sports-dump.sh` para restaurar — el restore **preserva los datos de usuario** (users, favorites, tokens, push, orders) y deja api/etl/web parados durante la operación. `./deploy/verify-backup.sh` restaura en una BD temporal y valida conteos (semanal, documentado en el propio script).
- **Migración fallida a mitad:** el runner aborta y el despliegue no continúa (api/etl no arrancan con esquema desactualizado — `assertSchemaCurrent`). Si la migración reescribía datos: restaurar backup; si solo DDL: corregir el SQL y volver a aplicar.
- **Fuente caída / datos parados:** el sistema degrada sin corromper (upserts idempotentes). La web muestra lo último cargado; el backlog se recupera solo al volver la fuente (calendario horario + fichas diarias). Vigilar la alerta de "200 OK con 0 partidos" — suele ser un cambio de la fuente, no una caída.
- **Partido fantasma "EN VIVO":** `stale-live-watchdog` lo degrada a `scheduled` a las 5 h. (Nota: la ficha individual aún puede pintarlo live por `effectiveStatus` — issue #150.)

## Dominio, TLS y borde

- `sticklive.eu` (+www) con HTTPS automático de Caddy (Let's Encrypt; certificados persistentes en volumen `caddy_data`, renovación automática).
- Cabeceras de seguridad en el borde (HSTS sin preload, XCTO, XFO, Referrer-Policy; `-Server`).
- `handle_path /api/*` hacia `api:3000` con `flush_interval -1` (imprescindible para el SSE).
- Monitorización externa de la web: pendiente (issue #155) — hoy la única señal de "web caída" es abrir la web o mirar Sentry/healthchecks del compose.

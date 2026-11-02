# Salida SIDGAD: redundancia de conectividad

*Implementado y verificado con pruebas el 2 de noviembre de 2026. No se ha
modificado la red de producción ni se ha desplegado ningún Worker: ambas rutas
alternativas están deshabilitadas por defecto y requieren autorización escrita
de SIDGAD.*

## 1. Qué había antes (auditoría real)

Todo el acceso a SIDGAD pasa por un único cliente HTTP:

`apps/scraper/src/scrapers/fep/sidgad-client.ts` → `SidgadClient`.

Puntos que lo usan:

| Punto | Qué pide |
|---|---|
| `FepCalendarScraper` | Calendario (`rfep_cal_idc_*.php`) |
| `FepStandingsScraper` | Clasificación (`rfep_clasif_idc_*.php`) |
| `FepMatchesScraper` | Marcadores en vivo (`rfep_mc_1.php`) |
| `FepFichaScraper` | Acta / ficha resumen (`rfep_gr_*`, `rfep_acta_*`) |
| `FepListadoScraper` | Listado de equipos (`rfep_ls_1.php`) |
| `WorldskateScraper` | Calendario y match center de World Skate |
| `seed-fep-competition.ts` | Alta de competiciones |
| `plan-federation-coverage.ts` | Cobertura de federaciones |
| `casos-reales/capturar.ts` | Captura de fixtures reales |
| `monitor-directo.ts` | Monitor manual del directo |

Fuera del `SidgadClient`:

- **Playwright** (`fep-catalog.ts`, `core/browser.ts`) navega el portal de la
  FEP para descubrir el catálogo de competiciones. No está en el bucle de
  directo; se usa para altas/exploración.
- **CDN de imágenes** (`sidgad.cloud`): la API (`team-logo.ts`,
  `player-photo.ts`) y el ETL (`team-logos.ts`) descargan escudos/fotos. Tienen
  volumen local y fallback; no son datos de directo.
- **FPP y FVP** no son SIDGAD.

Comportamiento anterior del cliente:

- 3 intentos, backoff **lineal** (`2 s × intento`), timeout 30 s.
- 404 sin reintento.
- 403/429/5xx se reintentaban igual que un fallo de red, sin distinguir.
- Sin circuit breaker, sin métricas por ruta, sin clasificación de errores.
- La sesión se marcaba inicializada **antes** del warm-up: dos POST
  concurrentes podían lanzar dos warm-ups y salir sin cookie.
- Sin deduplicación de peticiones idénticas en vuelo.

La salida de red era la del VPS Hetzner (`167.233.94.158`, ver
`docs/DEPLOY.md`), sin alternativa.

Concurrencia y duplicados:

- `cron-live` hace un ciclo cada 45 s; las actas van con `FICHA_CONCURRENCY=3`.
- Calendario/clasificación usan `SCRAPE_CONCURRENCY=4` con `forEachLimited`.
- `flock` en el scheduler + advisory lock de Postgres (`acquireEtlLock`)
  impiden dos pipelines simultáneos.
- La deduplicación nueva es **por instancia de `SidgadClient`**; los circuitos
  y métricas son **por proceso**.

Protección de datos ya existente (verificada):

- Calendario, clasificación y marcadores solo llaman al loader si
  `data.length > 0`.
- `replaceMatchEvents` retorna sin tocar nada si el acta llega vacía (#149).
- Los upserts de partidos preservan datos con `COALESCE` y guardas de estado.
- **Cambio añadido:** si el acta falla en todos los patrones por 403/429/5xx/red,
  `FepFichaScraper` lanza el error en vez de devolver un “éxito con 0 eventos”.
  Un 404 sigue siendo un éxito vacío (acta aún no publicada).

## 2. Arquitectura implementada

```text
FepCalendar / FepMatches / FepFicha / Worldskate / seeds
                    │
                    ▼
              SidgadClient                 (sesión, cookies, dedupe en vuelo)
                    │
                    ▼
              SidgadEgress                 (rutas, reintentos, circuit breaker,
                    │                        clasificación, métricas)
        ┌───────────┼────────────────┐
        ▼           ▼                ▼
     direct     cloudflare       secondary-ip
   (fetch)     (Worker HMAC)     (node:https localAddress)
```

Archivos nuevos:

```text
apps/scraper/src/egress/
  types.ts               tipos de ruta/petición/métrica
  config.ts              lectura y validación del entorno
  errors.ts              clasificación DNS/red/timeout/TLS/403/429/5xx
  circuit-breaker.ts     circuito por ruta + portal
  metrics.ts             contadores y latencias en memoria
  alerting.ts            Sentry con throttle
  hmac.ts                firma HMAC del Worker
  transport-fetch.ts     salida directa
  transport-cloudflare.ts salida por Worker
  transport-node.ts      salida con IP de origen (localAddress)
  egress.ts              router y política de reintentos/failover
  index.ts               singleton + resumen para logs

infra/cloudflare-worker/
  src/worker.ts          handler autocontenido (Web APIs)
  src/index.ts           entrypoint de wrangler
  wrangler.toml          configuración sin secretos
  README.md              despliegue y operación

deploy/docker-compose.egress-secondary-ip.yml.example
```

### Selección de ruta

Variables (todas opcionales; por defecto `direct`):

```bash
SIDGAD_EGRESS_PRIMARY=direct          # direct | cloudflare | secondary-ip
SIDGAD_EGRESS_FALLBACKS=              # CSV, solo fallos de TRANSPORTE
```

Una ruta alternativa solo se usa si cumple **las tres**:

1. `*_ENABLED=1`
2. `*_AUTHORIZED=1` (declaración explícita de autorización de SIDGAD)
3. Configuración completa (URL+secreto o IP de origen)

Si falta cualquiera, el proceso **falla al arrancar** con un mensaje claro. No
hay fallback silencioso a una ruta no autorizada.

### Política de errores

| Situación | Reintento | Cambia de ruta | Motivo |
|---|---|---|---|
| DNS / red / timeout | Sí, backoff exponencial + jitter | Sí, si hay fallback autorizado | Es un problema de nuestra conectividad |
| 403 / 401 | **No** | **No** | Autorización/restricción; cambiar de IP sería eludirla |
| 429 | Sí, respeta `Retry-After` (máx. 60 s) | **No** | Rate limit; cambiar de IP lo eludiría |
| 5xx | Sí, backoff | **No** | El problema es de SIDGAD, no de la ruta |
| 404 / 4xx | No | No | Error de petición/recurso |
| TLS inválido | No | No | No es transitorio; hay que investigarlo |
| Respuesta > 20 MB | No | No | Protección de memoria |
| Configuración inválida al arrancar | No | No | Error del despliegue, debe verse |
| Worker rechaza nuestra firma/config (401/400) | No | Sí, si hay fallback autorizado | La ruta intermedia está mal; el directo puede seguir. Se alerta para corregirla |

Circuit breaker: por `ruta + portal`. Se abre tras 5 fallos consecutivos
(configurable), falla rápido durante 60 s y deja pasar **una** prueba
half-open. Un éxito lo cierra y emite alerta de recuperación.

Deduplicación:

- Peticiones idénticas en vuelo dentro del mismo `SidgadClient` comparten una
  sola promesa.
- El warm-up de sesión comparte una sola promesa entre POST concurrentes.
- `flock` + advisory lock siguen evitando pipelines duplicados.

### Configuración fina

| Variable | Default | Para qué |
|---|---|---|
| `SIDGAD_EGRESS_RETRIES` | `3` | Intentos totales (1 = sin reintentos) |
| `SIDGAD_EGRESS_TIMEOUT_MS` | `SCRAPER_REQUEST_TIMEOUT_MS` o `30000` | Timeout por intento |
| `SIDGAD_EGRESS_RETRY_BASE_MS` | `SCRAPER_RETRY_DELAY_MS` o `2000` | Base del backoff |
| `SIDGAD_EGRESS_RETRY_MAX_MS` | `30000` | Tope del backoff |
| `SIDGAD_EGRESS_MAX_RETRY_AFTER_MS` | `60000` | Tope de `Retry-After` |
| `SIDGAD_EGRESS_CIRCUIT_FAILURES` | `5` | Fallos para abrir |
| `SIDGAD_EGRESS_CIRCUIT_COOLDOWN_MS` | `60000` | Enfriamiento |
| `SIDGAD_EGRESS_ALERT_THROTTLE_MS` | `600000` | Throttle de alertas Sentry |

## 3. Cloudflare Worker

### Viabilidad y autorización

El Worker está implementado, pero **no desplegado**. No hay credenciales de
Cloudflare en este repositorio y **no se ha verificado autorización de
SIDGAD**. No existe documentación pública de SIDGAD que autorice
intermediarios; hay que pedirlo por escrito.

Antes de activarlo, confirma por escrito con SIDGAD:

- Que acepta peticiones desde las IPs compartidas de Cloudflare Workers.
- Que no bloqueará por `User-Agent`, TLS fingerprint ni `CF-*`.
- Que el volumen y los endpoints siguen siendo los mismos (no se aumenta la
  frecuencia).
- Que un 403 debe tratarse como bloqueo y **no** como invitación a cambiar de
  IP.
- Persona/contacto para incidencias.

Riesgos a validar en una prueba controlada:

- Cloudflare puede modificar/eliminar `User-Agent` en subrequests.
- SIDGAD puede tener WAF/anti-bot que rechace ASN de Cloudflare.
- La IP de salida es compartida y variable; si SIDGAD hace allowlist por IP,
  esta ruta no sirve.
- El Worker termina TLS: ve la cookie de sesión de SIDGAD. Si eso no es
  aceptable, usa la segunda IP.

### Despliegue

```bash
cd infra/cloudflare-worker
npx wrangler login
npx wrangler secret put SIDGAD_WORKER_SECRET   # >= 32 chars; openssl rand -hex 32
npx wrangler deploy
```

Wrangler imprime la URL `https://sticklive-sidgad-egress.<subdominio>.workers.dev`.
Configura en el servidor:

```bash
SIDGAD_EGRESS_CLOUDFLARE_ENABLED=1
SIDGAD_EGRESS_CLOUDFLARE_AUTHORIZED=1
SIDGAD_EGRESS_WORKER_URL=https://sticklive-sidgad-egress.<subdominio>.workers.dev
SIDGAD_EGRESS_WORKER_SECRET=<el mismo secreto>
SIDGAD_EGRESS_PRIMARY=cloudflare
# Opcional, solo para fallos de transporte:
# SIDGAD_EGRESS_FALLBACKS=direct
```

Reinicia solo el ETL y comprueba:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod restart etl
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec etl node dist/apps/scraper/src/index.js --egress-status
```

`--egress-status` no hace red: imprime la configuración resuelta y las
métricas/circuitos del proceso (vacíos si acaba de arrancar).

### Seguridad del Worker

- HMAC-SHA256 sobre `timestamp + método + path + sha256(body)`.
- Ventana de reloj de 300 s.
- Lista blanca de portales y endpoints `*.php`; no acepta URLs absolutas,
  `..`, query strings ni métodos distintos de GET/POST.
- Cuerpo máximo 64 KB; solo `application/x-www-form-urlencoded`.
- No reenvía `authorization`, `cf-*` ni cabeceras internas.
- No registra cookies, cuerpos ni firmas.
- Sin firma válida no hay subrequest: no es un proxy abierto.
- El secreto se guarda con `wrangler secret` y en `.env.prod` (permisos 600).

Limitaciones:

- La ventana de replay es de 5 min. Los endpoints usados son de lectura; no hay
  estado que un replay pueda cambiar. No se añade KV/Durable Objects para no
  introducir coste/complejidad.
- El plan gratuito da 100.000 peticiones/día y 10 ms de CPU. El volumen real
  está muy por debajo. Si se supera, Cloudflare devuelve error y el servidor lo
  registra sin cambiar de ruta.

### Coste

- Workers Free: **0 €/mes** (100k req/día).
- Workers Paid, solo si se supera el free: desde 5 USD/mes.
- No hace falta KV, D1, R2 ni Durable Objects.

## 4. Segunda IP en Hetzner

### Coste real (verificar en la consola)

El VPS es un **Cloud Server** de Hetzner. Los Cloud Servers permiten **una
Primary IPv4**; la segunda IP se consigue con una **Floating IPv4**:

| Concepto | Precio (noviembre 2026) |
|---|---|
| Floating IPv4 | **3,00 €/mes** (sin IVA) |
| IVA 21 % | ≈ 0,63 €/mes |
| **Total** | **≈ 3,63 €/mes** |
| Alta | Sin coste de setup en Cloud |

Si algún día se migra a un **servidor dedicado**, el precio es otro: IP
adicional única ≈ 1,70 €/mes + 4,90 € de setup. Confirma siempre en la consola
de Hetzner antes de pedirla.

### Configuración (manual, con recuperación)

No ejecutes esto sin una sesión SSH de recuperación abierta y sin comprobar
antes que la IP principal sigue funcionando.

1. Consola Hetzner → **IPs → Floating IPs → Add Floating IP** → IPv4, misma
   ubicación que el servidor → asignar al servidor.
2. En el host, identificar la interfaz:
   ```bash
   ip -br addr
   ```
3. Añadir la IP (ejemplo `203.0.113.10`, interfaz `eth0`):
   ```bash
   sudo ip addr replace 203.0.113.10/32 dev eth0
   ```
4. Verificar que el host la tiene y que puede usarla como origen:
   ```bash
   ip -br addr show dev eth0
   curl --interface 203.0.113.10 -sS https://ifconfig.me
   ```
   Debe devolver `203.0.113.10`. Si no, **para y revierte**.
5. Persistencia tras reinicio (systemd, ejemplo):
   ```ini
   # /etc/systemd/system/floating-ip.service
   [Unit]
   Description=Hetzner Floating IP
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=oneshot
   ExecStart=/sbin/ip addr replace 203.0.113.10/32 dev eth0
   RemainAfterExit=yes

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now floating-ip.service
   ```

**No cambies la ruta por defecto ni la IP primaria.** Eso sí corta el servicio.

### Docker

`localAddress` solo funciona si la IP está en la interfaz del proceso. En un
contenedor bridge, la Floating IP del host **no** está en su namespace.

La vía simple es ejecutar solo el ETL con red de host, usando el override de
ejemplo:

```bash
docker compose -f docker-compose.prod.yml \
               -f deploy/docker-compose.egress-secondary-ip.yml \
               --env-file .env.prod up -d etl
```

Ese override:

- pone `network_mode: host` en `etl`;
- cambia `DATABASE_URL` a `127.0.0.1:5432` (Postgres ya está publicado en
  loopback);
- no toca `api`, `web`, `caddy` ni `postgres`.

Rollback:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d etl
```

Vuelve a la red bridge y a `postgres:5432`. No hay cambios permanentes en la
red del host.

Alternativas si no quieres host networking:

- red macvlan/ipvlan con la Floating IP asignada al contenedor (más compleja;
  puede romper la comunicación host-contenedor);
- proxy de salida en el host ligado a la IP adicional (añade un componente y
  superficie de ataque).

Configuración en el servidor:

```bash
SIDGAD_EGRESS_SECONDARY_IP_ENABLED=1
SIDGAD_EGRESS_SECONDARY_IP_AUTHORIZED=1
SIDGAD_EGRESS_SECONDARY_SOURCE_IP=203.0.113.10
SIDGAD_EGRESS_PRIMARY=secondary-ip
# Opcional, solo para fallos de transporte:
# SIDGAD_EGRESS_FALLBACKS=direct
```

Verificación desde el servidor:

```bash
# IP de origen de una conexión concreta (fuera de SIDGAD, no genera tráfico a la fuente)
curl --interface 203.0.113.10 -sS https://ifconfig.me

# Configuración que usaría el scraper
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec etl node dist/apps/scraper/src/index.js --egress-status
```

La ruta `secondary-ip` usa `node:https` con `localAddress`; las pruebas
levantan un servidor HTTP local y comprueban que el servidor ve
`127.0.0.1` como origen.

### Autorización de SIDGAD

Antes de activar la segunda IP, pide por escrito que añadan
`203.0.113.10` a su allowlist (o que confirmen que no la bloquean). No cambies
de IP ante un 403: el código no lo hace y no debe hacerse manualmente.

## 5. Monitorización

Todo va al log estructurado existente (pino) y a Sentry. No se añade
Prometheus ni otro servicio.

Eventos que verás:

| Log | Nivel | Qué significa |
|---|---|---|
| `Configuración de salida SIDGAD` | info | Ruta primaria/fallbacks y flags (sin secretos) |
| `Reintentando petición SIDGAD` | warn | Intento fallido, tipo, status y delay |
| `Circuito de salida SIDGAD abierto` | error | Ruta/portal dejan de llamarse temporalmente |
| `Salida SIDGAD recuperada` | info | La prueba half-open funcionó |
| `SIDGAD 403/401: posible restricción...` | error | No se cambia de ruta |
| `Resumen de salida SIDGAD` | info/debug | Contadores y latencias por ruta/portal |

Consultas:

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$DC logs --since=1h etl | grep -E 'SIDGAD|egress'
$DC exec etl node dist/apps/scraper/src/index.js --egress-status
```

El resumen incluye, por `ruta:portal`:

- `requests`, `successes`, `failures`
- `retries`, `failovers`, `circuitRejects`, `circuitOpens`, `recoveries`
- `consecutiveFailures`, `lastErrorKind`, `lastStatus`
- `lastSuccessAt`, `lastFailureAt`, `lastRecoveredAt`
- `latency.lastMs`, `avgMs`, `p95Ms`

En directo se emite en `debug` cada ciclo y en `info` cada 20 ciclos (~15 min).
Al terminar el proceso se emite siempre en `info`.

Sentry:

- Circuito abierto → error con tags `egress_route`, `egress_portal`.
- Recuperación → info.
- 403/401 → error, con throttle de 10 min por ruta+portal.

No se envían cookies, cuerpos, firmas ni secretos.

## 6. Pruebas

Unitarias/integración local (sin tráfico real a SIDGAD):

```bash
npm run test --workspace=apps/scraper
npm run test --workspace=apps/etl
```

Cubren:

- configuración y validación de rutas (incluida la negativa a usar una ruta no
  autorizada);
- clasificación DNS/red/timeout/TLS/403/429/5xx/404;
- backoff exponencial con jitter y `Retry-After`;
- circuit breaker (abrir, half-open, recuperar, reabrir);
- failover solo ante fallos de transporte;
- 403/429/5xx sin failover;
- deduplicación de peticiones y warm-up de sesión;
- renovación de cookies por nombre;
- segunda IP con un servidor HTTP local y `localAddress`;
- Worker: firma válida/inválida, timestamp, portal, path, cuerpo, timeout,
  `Set-Cookie`, lista blanca de portales;
- ficha: 403/5xx se propagan; 404 sigue siendo éxito vacío;
- persistencia de datos: los loaders no se ejecutan con 0 filas y
  `replaceMatchEvents` no borra con un acta vacía.

Comandos completos de verificación del repo:

```bash
npm run typecheck
npm run lint
npm run test
```

## 7. Puesta en marcha y rollback

### Activar Cloudflare (solo con autorización)

1. Desplegar el Worker y crear el secreto.
2. Añadir las variables al `.env.prod`.
3. Reiniciar `etl`.
4. `--egress-status` debe mostrar `primary: cloudflare` y `authorized: true`.
5. Forzar una pasada controlada (`--run-once fep_matches_live`) y revisar
   logs/DB.
6. Si algo falla: `SIDGAD_EGRESS_PRIMARY=direct`, `SIDGAD_EGRESS_FALLBACKS=`,
   reiniciar `etl`.

### Activar segunda IP (solo con autorización)

1. Pedir/asignar la Floating IP y configurarla en el host.
2. Verificar `curl --interface`.
3. Arrancar el ETL con el override de host networking.
4. Añadir las variables y reiniciar `etl`.
5. `--egress-status` debe mostrar `primary: secondary-ip`.
6. Rollback: volver al compose base y `SIDGAD_EGRESS_PRIMARY=direct`.

### Qué NO hacer

- No cambiar de IP ante un 403.
- No aumentar la frecuencia de scraping para "compensar" un fallo.
- No usar proxies residenciales ni rotación de IPs.
- No exponer el Worker sin HMAC.
- No poner el secreto en `wrangler.toml`, git o logs.

## 8. Limitaciones conocidas

- **Autorización de SIDGAD no verificada.** Las rutas alternativas están
  deshabilitadas; activarlas sin permiso escrito es una decisión del operador,
  no del código.
- **Worker no desplegado.** Falta cuenta/credenciales y una prueba controlada
  contra SIDGAD.
- **Playwright no pasa por el egress.** `fep-catalog.ts` navega el portal para
  descubrir competiciones. No está en el bucle de directo; si se necesita
  cubrir el 100 % del tráfico, hay que interceptar `route.fetch` o desactivar
  esa ruta mientras se use la alternativa.
- **CDN de imágenes no pasa por el egress.** Escudos/fotos usan
  `sidgad.cloud` con volumen local y fallback; no son datos de directo.
- **Circuit breaker y métricas en memoria.** Un reinicio del proceso los
  resetea; el peor caso es una petición de más, nunca una tormenta.
- **Sin persistencia histórica de métricas.** Se consultan en logs; si se
  necesita histórico, habría que enviarlas a Sentry/PostHog o a una tabla, pero
  no se introduce infraestructura nueva sin necesidad.
- **Cloudflare comparte IPs.** Si SIDGAD hace allowlist por IP, esta ruta no
  es viable; usa la segunda IP.
- **Host networking tiene trade-offs.** El ETL comparte la red del host y
  `postgres` se resuelve por `127.0.0.1`. Es un cambio manual y reversible, no
  el comportamiento por defecto.
- **La Floating IP no se persiste sola.** Hay que configurar systemd/netplan;
  si no, tras un reinicio el host pierde la IP y la ruta falla (el fallback a
  directo, si está configurado, mantiene el servicio).

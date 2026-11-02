# Cloudflare Worker — intermediario SIDGAD

Worker que reenvía a SIDGAD las peticiones del scraper cuando la salida
`cloudflare` está habilitada y **autorizada por SIDGAD**.

## Requisitos antes de desplegar

1. **Autorización escrita de SIDGAD.** Sin ella, esta ruta no se activa. El
   servidor exige `SIDGAD_EGRESS_CLOUDFLARE_AUTHORIZED=1` además de
   `SIDGAD_EGRESS_CLOUDFLARE_ENABLED=1`.
2. Cuenta de Cloudflare con Workers habilitado.
3. `wrangler` (se puede usar `npx wrangler`, no hace falta instalarlo en el
   monorepo).

## Desplegar

```bash
cd infra/cloudflare-worker

# 1. Autenticarse (una vez)
npx wrangler login

# 2. Crear el secreto compartido (mínimo 32 caracteres aleatorios)
#    Genera uno con: openssl rand -hex 32
npx wrangler secret put SIDGAD_WORKER_SECRET

# 3. Desplegar
npx wrangler deploy
```

Wrangler imprime la URL `https://sticklive-sidgad-egress.<subdominio>.workers.dev`.
Esa URL es la que va en `SIDGAD_EGRESS_WORKER_URL` del servidor.

## Configuración del Worker

En `wrangler.toml` (variables no secretas):

| Variable | Default | Para qué |
|---|---|---|
| `SIDGAD_UPSTREAM_ORIGIN` | `https://www.server2.sidgad.es` | Origen fijo. No se acepta una URL por petición. |
| `SIDGAD_ALLOWED_PORTALS` | lista de portales | Lista blanca. Si se añade una fuente nueva en `core/sources.ts`, hay que añadir su portal aquí. |
| `SIDGAD_MAX_BODY_BYTES` | `65536` | Tope del cuerpo POST. |
| `SIDGAD_CLOCK_SKEW_SECONDS` | `300` | Ventana de reloj para la firma. |
| `SIDGAD_REQUEST_TIMEOUT_MS` | `25000` | Timeout del subrequest a SIDGAD. |

El secreto `SIDGAD_WORKER_SECRET` **no** va en `wrangler.toml`; se sube con
`wrangler secret put` y se guarda en `.env.prod` como
`SIDGAD_EGRESS_WORKER_SECRET`.

## Qué hace y qué no hace

- Solo acepta `GET`/`POST` a `/{portal}/{endpoint}.php`.
- Rechaza URLs absolutas, `..`, query strings, portales fuera de la lista y
  cuerpos que no sean `application/x-www-form-urlencoded`.
- Verifica HMAC-SHA256 de `timestamp + método + path + sha256(body)`.
- Reenvía la cookie de sesión de SIDGAD y devuelve sus `Set-Cookie`.
- No registra cookies, cuerpos ni firmas. Los logs son JSON con requestId,
  portal, endpoint, método, status y duración.
- No es un proxy abierto: sin firma válida no hay subrequest.

## Límites del plan gratuito

- 100.000 peticiones/día (reset a medianoche UTC).
- 10 ms de CPU por petición (la verificación HMAC y el reenvío caben).
- 50 subrequests por invocación (aquí se hace 1).

El volumen de Stick Live (cron-live cada 45 s en directo + calendario horario)
está muy por debajo. Si se supera, Cloudflare devuelve error y el servidor
clasifica el fallo sin cambiar de ruta.

## Operación

```bash
npx wrangler tail                 # logs en vivo
npx wrangler deployments list     # historial
npx wrangler rollback             # volver a la versión anterior
```

## Pruebas

El handler es autocontenido y se prueba desde el monorepo:

```bash
npm run test --workspace=apps/scraper -- src/egress/worker.test.ts
```

Las pruebas verifican firma válida/inválida, timestamp caducado, portal no
permitido, path traversal, cuerpo demasiado grande, timeout y reenvío de
`Set-Cookie`. No hacen ninguna petición real a SIDGAD.

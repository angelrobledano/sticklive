# Auditoría técnica — Stick Live

**Alcance:** monorepo Turborepo (`apps/api`, `apps/web`, `apps/etl`, `apps/scraper`, `packages/*`), en producción en sticklive.eu.
**Método:** lectura directa del código y seguimiento de llamadas entre API ↔ DB ↔ web ↔ scraper. Cada hallazgo cita el fichero verificado. Los puntos no verificables al 100% se marcan como "verificar".
**Fecha:** 16/06/2026.

> Nota de contexto: es un proyecto de un solo desarrollador, ya funcional y en producción, con una arquitectura real (separación scraper/ETL/API/web, i18n propio, auth progresiva, pagos). La mayoría de hallazgos son de *endurecimiento para producción*, no de "está roto". Lo que de verdad falta para un estándar de lanzamiento serio: pruebas automáticas, CI, límites de abuso en la API y un par de footguns de configuración.

---

## 1. Seguridad

### S1 — Sin rate limiting en toda la API pública · **Alta**
**Categoría:** Seguridad / Disponibilidad · **Archivo:** `apps/api/src/index.ts` (no existe middleware de límite)
**Problema:** La API está expuesta públicamente (`sticklive.eu/api`, Caddy) y no hay ningún límite de peticiones. `POST /auth/magic-link` envía un email por cada llamada; `POST /payments/stripe/checkout` crea sesiones de Stripe; `GET /matches/:id/stream` abre un bucle SSE; `/auth/verify` permite reintentos.
**Impacto:** Email bombing a terceros (se puede forzar el envío de magic links a cualquier dirección, quemando la cuota y la reputación de Brevo), creación masiva de checkouts, agotamiento de conexiones por SSE, y enumeración/fuerza bruta sin fricción. Coste real de dinero (Brevo/Stripe) y de disponibilidad.
**Solución:** Middleware de rate limit por IP y por ruta (más estricto en `/auth/*` y `/payments/*`). En Hono se puede con un middleware propio + store en memoria (suficiente para un solo nodo) o Redis si escala. Como mínimo: `/auth/magic-link` 3–5/hora por email+IP.
```ts
// middleware sencillo en memoria (1 nodo)
const hits = new Map<string, { n: number; t: number }>();
function rateLimit(maxPerMin: number) {
  return async (c, next) => {
    const k = `${c.req.path}:${c.req.header('x-forwarded-for') ?? 'local'}`;
    const now = Date.now(), e = hits.get(k);
    if (!e || now - e.t > 60_000) hits.set(k, { n: 1, t: now });
    else if (++e.n > maxPerMin) return c.json({ error: 'rate_limited' }, 429);
    await next();
  };
}
authRouter.use('/magic-link', rateLimit(5));
```

### S2 — El magic link se filtra en la respuesta si falta `SMTP_HOST` (ATO total) · **Alta**
**Categoría:** Seguridad / Autenticación · **Archivo:** `apps/api/src/routes/auth.ts:11,47-49`; `apps/api/src/lib/mailer.ts`
**Problema:** `DEV_MODE = !process.env['SMTP_HOST']`. En ese modo, `POST /auth/magic-link` **devuelve el enlace de acceso en el JSON de respuesta** (`devLink`). La protección depende solo de que `SMTP_HOST` esté definido en producción.
**Impacto:** Si `SMTP_HOST` se queda sin definir en un despliegue (exactamente el tipo de fallo que pasó hoy con `FEP_SOURCE_ID`), cualquiera puede pedir un magic link para **cualquier email** y recibir el enlace válido en la respuesta → **toma de control de cualquier cuenta**. Es un footgun crítico latente.
**Solución:** No derivar el modo de un env opcional. Exigir un flag explícito (`AUTH_DEV_LINKS=1`) que nunca esté en prod, y que en `NODE_ENV=production` el `devLink` no se devuelva jamás aunque falte SMTP (en su lugar, 503 "email no configurado").
```ts
const DEV_LINKS = process.env['AUTH_DEV_LINKS'] === '1' && process.env['NODE_ENV'] !== 'production';
// ...
if (!process.env['SMTP_HOST']) {
  if (DEV_LINKS) return c.json({ sent: true, devLink: link });
  return c.json({ error: 'email_not_configured' }, 503); // nunca filtrar el link en prod
}
```

### S3 — Tokens de sesión y de magic link en claro, sesión sin caducidad ni rotación · **Media-Alta**
**Categoría:** Seguridad / Autenticación · **Archivo:** `apps/api/src/routes/auth.ts:13,112-113,21-24`
**Problema:** El `session_token` se guarda en `users.session_token` en texto plano y se usa como Bearer indefinidamente (no hay expiración ni `last_used`). Los `auth_tokens` (magic link) también se guardan en claro. No hay limpieza de tokens caducados.
**Impacto:** Una fuga de la BD (backup, lectura indebida) entrega sesiones usables para siempre. Las sesiones no expiran nunca: un token robado vale indefinidamente.
**Solución:** Guardar **hash** del token (SHA-256) en BD y comparar por hash; añadir `expires_at`/`last_used_at` a la sesión y caducarla (p. ej. 90 días o renovación deslizante); job que borre `auth_tokens` usados/caducados. El token en claro solo vive en el cliente.

### S4 — Google OAuth sin validación de `state` (login CSRF) · **Media**
**Categoría:** Seguridad / Autenticación · **Archivo:** `apps/api/src/routes/auth.ts:137-168`
**Problema:** Se genera un `state` con `deviceId` + nonce, pero en el callback **no se valida** contra nada almacenado (no hay cookie/sesión de ida). El nonce no se comprueba.
**Impacto:** Login CSRF: un atacante puede forzar a una víctima a iniciar sesión con la cuenta del atacante (o viceversa según el flujo), o reutilizar el callback. Riesgo moderado por el modelo de la app, pero es una desviación clara del estándar OAuth.
**Nota verificada:** El `id_token` se decodifica sin verificar la firma, pero se obtiene **directamente del token endpoint de Google por TLS** y se valida `aud` + `email_verified`, lo cual es aceptable según la guía de Google. El problema real es el `state`.
**Solución:** Firmar el `state` (HMAC con secreto del servidor) o guardarlo en cookie `HttpOnly` antes del redirect y verificarlo en el callback.

### S5 — XSS por JSON-LD sin escapar · **Media**
**Categoría:** Seguridad · **Archivo:** `apps/web/src/components/shared/JsonLd.tsx:7`
**Problema:** `dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}` dentro de un `<script type="application/ld+json">`. `JSON.stringify` **no escapa** `<`, `>`, `&`. Los datos incluyen nombres de equipos/jugadores **scrapeados** (fuente externa no confiable).
**Impacto:** Un nombre de equipo/jugador con `</script><script>…` rompería el bloque e inyectaría script (XSS almacenado vía contenido scrapeado). Baja probabilidad, impacto alto.
**Solución:** Escapar los caracteres peligrosos antes de inyectar.
```tsx
const safe = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safe }} />;
```

### S6 — Admin con token único compartido; expone PII; filtra detalles de error · **Media**
**Categoría:** Seguridad / Autorización · **Archivo:** `apps/api/src/routes/admin.ts`
**Problema:** Autenticación admin = un único `ADMIN_TOKEN` compartido (comparado en tiempo constante, bien). `GET /admin/users` vuelca **email, device_id, estado premium** de todos los usuarios. No hay roles, rotación ni auditoría. Las respuestas de error incluyen `detail: err.message`.
**Impacto:** Si el token se filtra, vuelco completo de PII y acciones destructivas (`DELETE /admin/users/:id`). Sin trazabilidad de quién hizo qué.
**Solución:** Roles por usuario (ya está en el backlog como "Admin nivel 2"); rotación del token; registro de acciones admin; no devolver `err.message` al cliente.

### S7 — Fuga de detalles internos de error al público · **Baja-Media**
**Categoría:** Seguridad / Information disclosure · **Archivo:** `apps/api/src/routes/live.ts:99-101` (y varias rutas más)
**Problema:** Endpoints públicos devuelven `{ error: 'Database error', detail: err.message }`. `err.message` puede revelar SQL, nombres de columnas o estructura interna.
**Impacto:** Facilita el reconocimiento a un atacante.
**Solución:** Loguear el detalle en servidor; al cliente, mensaje genérico + un `requestId` para correlacionar.

### S8 — CORS de SSE cae a `*` y sin límite de body · **Baja**
**Categoría:** Seguridad · **Archivo:** `apps/api/src/routes/match-stream.ts:181`; `apps/api/src/index.ts`
**Problema:** `Access-Control-Allow-Origin: process.env['WEB_BASE_URL'] ?? '*'` (comodín si falta el env). La API no impone límite de tamaño de body en los POST (`favorites/merge` acepta arrays).
**Impacto:** Relajación de CORS si el env falta; DoS por payload grande.
**Solución:** Origin fijo sin fallback a `*`; middleware de límite de body (p. ej. 64 KB) y de tamaño de arrays en `favorites/merge`.

### S9 — Webhook de Stripe sin idempotencia; premium no expira · **Baja-Media**
**Categoría:** Seguridad / Negocio · **Archivo:** `apps/api/src/routes/payments-stripe.ts:67-111`
**Problema:** La firma del webhook **sí** se verifica (correcto). Pero no se registra el `event.id` procesado (sin protección anti-replay/duplicados de Stripe). Y `is_premium = TRUE` se queda permanente: ningún proceso lo revierte cuando `premium_until` vence.
**Impacto:** Reprocesos benignos (premium se re-fija a +1 año), pero **el premium nunca caduca de facto** → pérdida de ingresos recurrentes / lógica de negocio incorrecta.
**Solución:** Tabla `processed_stripe_events(event_id)` con `ON CONFLICT DO NOTHING`; y derivar premium de `premium_until > NOW()` (o job diario que baje `is_premium` al vencer).

---

## 2. Bugs, lógica y concurrencia

### B1 — Footguns de configuración con fallback silencioso · **Media**
**Categoría:** Bugs / Robustez · **Archivos:** `auth.ts` (SMTP), `match-stream.ts` (WEB_BASE_URL), histórico `FEP_SOURCE_ID` (ya blindado hoy)
**Problema:** Patrón repetido `process.env['X'] ?? <fallback peligroso>` que degrada en silencio (link en respuesta, CORS `*`, UUID placeholder). Hoy mismo `FEP_SOURCE_ID` ausente omitió 215 partidos en silencio con un mensaje engañoso.
**Impacto:** Fallos difíciles de diagnosticar y, en algún caso (S2), de seguridad.
**Solución:** Validación de entorno al arranque (un módulo `assertEnv()` que falle rápido con lista de variables obligatorias por servicio). Patrón ya aplicado a `requireFepSourceId()`; generalizarlo.

### B2 — Mensajes de error engañosos enmascaran la causa real · **Media**
**Categoría:** Mantenibilidad / Bugs · **Archivo:** `apps/etl/src/loaders/match.loader.ts:129-139`
**Problema:** El `catch` del upsert de partido lo reporta como "competición no indexada o equipos no registrados" aunque el fallo real sea otro (hoy era un UUID inválido en `source_id`). Verificado en sesión.
**Impacto:** Diagnóstico lento (horas perdidas hoy por esto).
**Solución:** Diferenciar el error: si es de resolución de equipo, ese mensaje; si es de la query, loguear el error real con su código.

### B3 — Sin cierre limpio (SIGTERM/SIGINT) ni `statement_timeout` · **Baja**
**Categoría:** Concurrencia / Robustez · **Archivos:** `apps/api/src/index.ts`, `packages/db/src/client.ts:20-26`
**Problema:** Ni la API ni el ETL manejan `SIGTERM`; al parar el contenedor no se drena el pool ni se cierran los SSE. El pool no define `statement_timeout`, así que una query colgada bloquea una conexión (de 10).
**Impacto:** Cierres abruptos; una query lenta puede degradar el pool.
**Solución:** `process.on('SIGTERM', () => server.close(...) ; closeDb())`; añadir `statement_timeout` (p. ej. 15 s) y `query_timeout` al pool.

### B4 — Concurrencia del scheduler: OK, pero frágil ante solapamiento de scraping manual · **Baja**
**Categoría:** Concurrencia · **Archivo:** `deploy/etl-scheduler.sh`
**Problema (verificado):** El bucle es secuencial con `sleep 300` *después* de cada iteración → no hay solapamiento del propio cron. Pero hoy lanzaste scraping manual (`exec etl`) mientras el cron corría: dos procesos compartiendo el navegador Playwright y el pool. No rompió nada, pero no hay guardia.
**Impacto:** Contención puntual de recursos.
**Solución:** Lock de fichero/PID para que no corran dos pipelines a la vez.

---

## 3. Calidad del código

### Q1 — Cero tests en todo el repo · **Media (Alta para "listo para producción")**
**Categoría:** Testing · **Verificado:** 0 ficheros `*.test.ts`/`*.spec.ts`; `vitest` está en devDependencies pero sin usar.
**Impacto:** Cualquier refactor (como los de hoy) se valida a mano y en producción. Las zonas críticas sin red de seguridad: parseo de fechas/TZ (`madridToUtc`, `match-time.ts`), transformers del ETL, resolución de refs, lógica de pagos.
**Solución:** Empezar por tests unitarios de funciones puras de alto riesgo y sin dependencias: `madridToUtc`, `match-time.ts` (ya tiene los 13 casos que escribí hoy — formalízalos en vitest), transformers, `classifyMatch`. Es donde más ROI hay con menos esfuerzo.

### Q2 — El typecheck del monorepo no pasa; producción corre con `tsx` sin type-check · **Media**
**Categoría:** Calidad / Tooling · **Verificado hoy:** `npm run typecheck` falla con ~130+ errores (rootDir + `exactOptionalPropertyTypes`). El Dockerfile arranca con `tsx`/`next start`, que transpila sin chequear tipos.
**Impacto:** `strict` + `exactOptionalPropertyTypes` están activados pero **no se aplican**: dan sensación de seguridad de tipos que no existe. Errores de tipo reales pasarían a producción.
**Solución (sesión aparte):** Arreglar `rootDir` (o pasar a project references / `paths`), y decidir sobre `exactOptionalPropertyTypes` (es el origen de la mayoría de avisos). Objetivo: `npm run typecheck` en verde y meterlo en CI.

### Q3 — Sin CI · **Media**
**Categoría:** Proceso · **Verificado:** no existe `.github/workflows`.
**Impacto:** Ningún gate automático (typecheck, lint, tests, `npm audit`) antes de desplegar. Todo depende de disciplina manual.
**Solución:** Workflow mínimo en push: `typecheck` + `lint` + `test` + `npm audit --omit=dev`. Aunque el typecheck aún no esté verde, empezar por lint/test.

### Q4 — Componentes/archivos enormes (god components) · **Media**
**Categoría:** Mantenibilidad · **Verificado (líneas):** `MatchCenterClient.tsx` 1346, `settings/page.tsx` 849, `CompetitionClient.tsx` 816, `lib/api/client.ts` 691, `fep-ficha.scraper.ts` 878.
**Impacto:** Difíciles de mantener, testear y razonar; mezclan fetching, estado, UI y lógica.
**Solución:** Extraer hooks (`useMatchStream`, `useFavorites` ya existe) y subcomponentes; partir `client.ts` por dominio (matches/teams/players). No urgente, pero crece la deuda con cada feature.

### Q5 — Código muerto / de desarrollo en el árbol de producción · **Baja**
**Categoría:** Código muerto · **Archivos:** `apps/scraper/src/scrapers/fep/fep-*-probe.ts`, `fep-standings-validate.ts` (placeholder hardcodeado), `payments.ts` + `lib/redsys.ts` (Redsys inactivo).
**Impacto:** Ruido, superficie de mantenimiento y de seguridad innecesaria.
**Solución:** Mover los `*-probe`/scripts a una carpeta `tools/` o excluirlos del build; si Redsys no se va a usar, archivarlo.

---

## 4. Arquitectura y escalabilidad

### A1 — SSE hace polling a la BD por cliente → no escala · **Alta**
**Categoría:** Escalabilidad / Rendimiento · **Archivo:** `apps/api/src/routes/match-stream.ts:185-251`
**Problema (verificado):** Cada conexión SSE ejecuta **2 queries cada 15 s** durante hasta 30 min, contra un pool de **máx. 10 conexiones** (`client.ts`). No hay límite de conexiones concurrentes.
**Impacto:** Con audiencia real (decenas de espectadores de un partido en directo), cada 15 s hay ráfagas de cientos de queries compitiendo por 10 conexiones en un CX23 (2 vCPU/4 GB). Cuello de botella y posible caída justo en el momento de máximo valor (un directo).
**Solución:** Un **único poller en memoria por partido** que consulta la BD una vez cada 15 s y hace fan-out a todos los suscriptores SSE de ese partido. Pasa de O(clientes) queries a O(partidos en directo). Limitar conexiones SSE concurrentes.

### A2 — La home sobre-carga todos los partidos de todas las temporadas actuales · **Media**
**Categoría:** Escalabilidad / Rendimiento · **Archivos:** `apps/api/src/routes/live.ts` (`/matches/current`), `apps/web/src/lib/api/client.ts:290-295`, `MatchesView.tsx`
**Problema (verificado):** `/matches/current` devuelve **todos** los partidos (`scheduled|live|finished`) de **todas** las temporadas `is_current`, sin ventana temporal ni paginación; la web descarga el lote entero y filtra por día en el cliente. Hoy eran 213 partidos (~128 KB) con una sola competición.
**Impacto:** El payload crece linealmente al escalar competiciones (tu objetivo declarado). En móvil es ancho de banda y parseo desperdiciados en cada carga de la home.
**Solución:** Parametrizar el endpoint por ventana de fechas (`?from=&to=`, p. ej. hoy ± 7 días) y/o paginar; mover el filtrado por día al servidor.

### A3 — Escudos como ficheros + Next fotografía `public/` al arrancar · **Media**
**Categoría:** Arquitectura · **Archivos:** `TeamShield.tsx`, `run-pipeline.ts` (download-logos), `docker-compose.prod.yml` (volumen)
**Problema (verificado hoy):** Los escudos se sirven como `/escudos/{teamId}.png` y Next no los ve si se añaden tras el arranque (hubo que reiniciar `web`). Además existe `teams.logo_url` (CDN sidgad) pero `TeamShield` **no lo usa** — duplicidad de fuentes de verdad.
**Impacto:** Operativa frágil (reinicio manual obligatorio tras cada `download-logos`), y la incoherencia logo_url vs fichero local confunde.
**Solución:** O bien servir escudos desde `logo_url` (CDN) vía `next/image` (ya hay `remotePatterns` para sidgad.cloud) y eliminar el baile de ficheros; o bien, si se quieren locales por control, automatizar el reinicio de `web` tras `download-logos`. Elegir **una** fuente de verdad.

### A4 — Imagen Docker única para 4 servicios + scraping a prod desde IP residencial · **Baja**
**Categoría:** Arquitectura / Operativa · **Archivos:** `deploy/Dockerfile`, `docker-compose.prod.yml`
**Problema:** Una sola imagen para api/web/etl/scraper (simple, pero acopla despliegues y tamaño). El scraping masivo escribe directo a la BD de producción desde tu PC vía túnel SSH.
**Impacto:** Un cambio en cualquier app reconstruye todo; escribir a prod desde una máquina personal es arriesgado (un error de script impacta producción en vivo, como hoy con el vaciado sin backup).
**Solución:** A futuro, separar imágenes (o multi-stage con targets) y mover los trabajos masivos a un entorno de staging o a un job controlado en el VPS.

---

## 5. Rendimiento
Cubierto arriba: **A1** (SSE por cliente), **A2** (over-fetch de la home), **B3** (pool sin `statement_timeout`). La web usa `revalidate` razonable (60/120/300 s) en los fetchers de servidor, lo cual está bien. No se detectaron bucles O(n²) críticos ni renders descontrolados evidentes en la lectura, aunque los god components (Q4) dificultan auditarlo a fondo.

---

## 6. UX y producto

### U1 — La home abre en "hoy", que en playoff suele estar vacío · **Media**
**Categoría:** UX · **Archivo:** `apps/web/src/components/shared/MatchesView.tsx`
**Problema (verificado hoy):** En calendario disperso (playoff, un partido cada 2-3 días), abrir en "hoy" muestra vacío y parece roto, aunque haya partidos a 3 días.
**Solución:** Que la home abra por defecto en el **próximo día con partidos** (o el más reciente con resultados) si hoy está vacío; ya tienes el cálculo de `nextDate` en el estado vacío, reutilízalo como ancla inicial.

### U2 — Mensajes de error que filtran detalles internos al usuario · **Baja**
**Categoría:** UX · **Archivo:** `apps/web/src/app/[locale]/page.tsx:38-40`
**Problema:** El error de carga de la home muestra "Asegúrate de que la API está activa en localhost:3000" al usuario final.
**Solución:** Mensaje neutro orientado al usuario; los detalles, a logs.

### U3 — Accesibilidad: base correcta, sin auditar a fondo · **Baja**
**Categoría:** A11y · Se observan `aria-label`, targets de 44px y `alt` en imágenes (bien). No se ha hecho auditoría WCAG completa (contrastes, foco, lectores de pantalla). Recomendado pasar una herramienta automática (axe) sobre las vistas clave.

---

## 7. Testing
Ver **Q1** (cero tests) y **Q3** (sin CI). Áreas críticas sin cobertura, por prioridad: lógica de fechas/TZ, transformers del ETL, `classifyMatch`/dedup, resolución de refs, y el flujo de pagos/webhook (al menos un test de idempotencia).

---

## 8. Dependencias
- **Verificado:** `nodemailer@8.0.11` es legítimo (resuelve del registro oficial con integridad válida; release posterior a versiones antiguas) — **no es un riesgo**.
- `next@^14.2.0`, `stripe@^22`, `playwright@^1.44`, `cheerio@^1.0.0`, `hono@^4.4`: versiones razonables. **Riesgo real:** no hay `npm audit` automatizado ni lockfile-check en CI, así que las vulnerabilidades aparecerían sin aviso. **Solución:** `npm audit` en CI + Dependabot/renovate.
- `cheerio@1.0.0` ya da errores de tipos (`cheerio.Element` no existe en esa build) — parte de los fallos de typecheck. Alinear la versión con los tipos esperados.

---

## Top 10 problemas más importantes
1. **Sin rate limiting** en la API pública — email bombing, coste y DoS (**S1, Alta**).
2. **Magic link filtrable** si falta `SMTP_HOST` → toma de control de cuentas (**S2, Alta**).
3. **SSE no escala** (polling a BD por cliente) — cae justo en los directos (**A1, Alta**).
4. **Cero tests** en zonas críticas (fechas, ETL, pagos) (**Q1**).
5. **Typecheck no pasa** y producción corre sin chequeo de tipos (**Q2**).
6. **Tokens de sesión en claro y sin caducidad** (**S3**).
7. **Premium no caduca** (`is_premium` nunca se revierte) — pérdida de ingresos (**S9**).
8. **Footguns de configuración con degradación silenciosa** (**B1**) y mensajes de error engañosos (**B2**).
9. **OAuth sin validar `state`** (login CSRF) (**S4**) y **XSS por JSON-LD** (**S5**).
10. **Over-fetch de la home** que no escala con más competiciones (**A2**).

## Riesgos antes de producción (ya está en producción, léase "antes de crecer/promocionar")
- **Abuso de la API** sin límites: el día que la app reciba tráfico (o un curioso), email bombing y posible caída por SSE. *Bloqueante para promocionar.*
- **Footgun de SMTP** (S2): un despliegue sin `SMTP_HOST` = cuentas comprometidas. *Bloqueante.*
- **Directos caídos** por el modelo SSE cuando haya audiencia simultánea (A1). *Alto riesgo en el momento de más valor.*
- **Sin red de seguridad** (tests + CI): cada cambio es una apuesta; hoy se vació producción sin backup. *Riesgo operativo alto.*

## Quick wins (< 1 hora cada uno)
- **S2:** cambiar el modo dev del magic link a flag explícito + nunca filtrar el link en `NODE_ENV=production`.
- **S5:** escapar `<`/`>`/`&` en `JsonLd.tsx`.
- **S7/U2:** quitar `detail: err.message` de respuestas públicas y el mensaje "localhost:3000".
- **S1 (parcial):** rate limit en memoria solo para `/auth/magic-link` (5/h por email+IP).
- **B3:** `statement_timeout` en el pool + handler de `SIGTERM`.
- **U1:** abrir la home en el próximo día con partidos si hoy está vacío.
- **Q1 (arranque):** convertir los 13 casos de `match-time` que ya validé en un test de vitest.
- **S9 (parte):** derivar premium de `premium_until > NOW()` en lugar de `is_premium`.

## Mejoras de alto impacto (proyecto, no de una tarde)
1. **Rate limiting + validación de entorno al arranque** transversal (cierra S1, S2, S8, B1 de raíz).
2. **Rediseñar el SSE** a un poller único por partido con fan-out (A1): habilita crecer la audiencia.
3. **CI + arreglar el typecheck + suite de tests** de las funciones críticas (Q1, Q2, Q3): convierte cada despliegue de apuesta a rutina.
4. **Higiene de auth**: hashear tokens, caducar sesiones, validar `state` OAuth (S3, S4).
5. **Endpoint de la home con ventana temporal** y una sola fuente de verdad para escudos (A2, A3): escalabilidad real al añadir competiciones.

---

# Estado de resolución (16/06/2026)

## Tabla completa de hallazgos y estado

Leyenda: ✅ Resuelto · 🟡 Parcial · ⬜ No resuelto · ⊘ Descartado (falso positivo).

| ID | Categoría | Hallazgo | Severidad | Estado |
|----|-----------|----------|-----------|--------|
| S1 | Seguridad | Sin rate limiting en la API pública | **Alta** | ✅ Resuelto |
| S2 | Seguridad/Auth | Magic link filtrable si falta SMTP (ATO) | **Alta** | ✅ Resuelto |
| S3 | Seguridad/Auth | Tokens en claro; sesión sin caducidad | Media-Alta | ✅ Resuelto |
| S4 | Seguridad/Auth | OAuth sin validar `state` (login CSRF) | Media | ✅ Resuelto |
| S5 | Seguridad | XSS por JSON-LD sin escapar | Media | ✅ Resuelto |
| S6 | Seguridad/Authz | Admin con token único: PII, sin roles/rotación/auditoría | Media | ⬜ No resuelto |
| S7 | Seguridad | Fuga de `detail` de error al cliente | Baja-Media | ✅ Resuelto (handler global + `detail` eliminado de las 18 rutas, log solo en servidor) |
| S8 | Seguridad | CORS de SSE a `*` + sin límite de body | Baja | ✅ Resuelto (SSE sin `*`, `merge` acotado y `bodyLimit` global de 64 KB) |
| S9 | Seguridad/Negocio | Webhook sin idempotencia; premium no caduca | Baja-Media | ✅ Resuelto (premium caduca + tabla `processed_stripe_events`, migración 024) |
| B1 | Bugs/Robustez | Footguns de config con fallback silencioso | Media | ✅ Resuelto (`assertEnv` + `FEP_SOURCE_ID` + magic link) |
| B2 | Bugs | Mensaje de error engañoso en `match.loader` | Media | ✅ Resuelto |
| B3 | Concurrencia | Sin `SIGTERM` ni `statement_timeout` | Baja | ✅ Resuelto |
| B4 | Concurrencia | Sin lock contra solapamiento de scraping | Baja | ✅ Resuelto (`flock` en el scheduler; manual debe usar el mismo lock) |
| B5 | Bugs | `config` sobrescrito en `fep-ficha` → `[undefined/undefined]` en logs | Media | ✅ Resuelto (hallado al cerrar el typecheck) |
| Q1 | Testing | Cero tests en el repo | Media | ✅ Resuelto (tests de lógica horaria, ventana de la home, premium y transformer del ETL; cobertura ampliable) |
| Q2 | Calidad | El typecheck del monorepo no pasaba | Media | ✅ Resuelto (8/8 paquetes en verde) |
| Q3 | Proceso | Sin CI | Media | ✅ Resuelto (GitHub Actions: typecheck+test+lint+audit) |
| Q4 | Mantenibilidad | God components (1346/878/849 líneas…) | Media | ⬜ No resuelto |
| Q5 | Código muerto | Probes / Redsys / `validate` en árbol de producción | Baja | ⬜ No resuelto |
| A1 | Escalabilidad | SSE con polling a BD por cliente | **Alta** | ✅ Resuelto (poller único por partido) |
| A2 | Escalabilidad | Over-fetch de la home (todo el calendario) | Media | ✅ Resuelto (ventana temporal) |
| A3 | Arquitectura | Escudos: doble fuente de verdad + reinicio manual | Media | ✅ Resuelto (la API sirve `/teams/:id/logo` desde el volumen o proxy del CDN; sin reinicios) |
| A4 | Arquitectura/Operativa | Imagen Docker única; scraping a prod desde IP residencial | Baja | ⬜ No resuelto |
| U1 | UX | La home abre en "hoy" vacío en playoff | Media | ✅ Resuelto (abre en el día más cercano con partidos) |
| U2 | UX | Mensaje técnico ("localhost:3000") al usuario final | Baja | ✅ Resuelto (mensaje neutro, sin detalle interno) |
| U3 | A11y | Sin auditoría WCAG completa | Baja | ⬜ No resuelto |
| D1 | Dependencias | `nodemailer@8` "sospechoso" | — | ⊘ Descartado (verificado legítimo) |
| D2 | Dependencias | Sin `npm audit`/Dependabot automatizado | Media | ✅ Resuelto (`npm audit` en CI + Dependabot semanal npm y actions) |
| D3 | Dependencias | Tipos de `cheerio` (`Element`) rotos | Baja | ✅ Resuelto (`domhandler`) |

**Totales:** 23 ✅ resueltos · 0 🟡 parciales · 5 ⬜ no resueltos · 1 ⊘ descartado (29 hallazgos).
Todos los hallazgos de severidad **Alta y Media-Alta** están cerrados, y no queda ningún 🟡.

### Pendiente (5 ⬜) — por qué no son "de una tanda"
Son de severidad media/baja y ninguno bloquea producción. No los cierro en caliente porque requieren decisión de producto, refactor amplio o trabajo de infraestructura:

1. **S6 — Roles de admin (Media).** Sustituir el token único por roles por usuario es una **decisión de producto** (quién es admin, qué puede hacer) + migración + cambios de auth. La fuga de PII vía detalle de error ya se mitigó (S7); falta el modelo de roles.
2. **Q4 — God components (Media).** Partir `MatchCenterClient` (1346), `settings` (849), `CompetitionClient` (816)… es un refactor amplio y **sin tests de esos componentes**: alto riesgo de regresión. Hacerlo con red de seguridad, no en caliente.
3. **U3 — Auditoría WCAG (Baja).** No es un cambio de código puntual: requiere pasar axe/lighthouse sobre las vistas y corregir hallazgos uno a uno.
4. **A4 — Infra (Baja).** Separar imágenes Docker y mover el scraping masivo a staging es trabajo de infraestructura/proceso, no de código.
5. **Q5 — Código muerto (Baja).** Mover los `*-probe`/Redsys fuera del árbol de producción; cosmético.

---

## Detalle del Top 10

Los 10 problemas prioritarios se han abordado en código. **Importante:** estos cambios requieren `npm run typecheck` + `npm run test` en local y un despliegue cuidadoso (hay una migración de BD). Tres de ellos —SSE, hashing de tokens y typecheck— son sustanciales: **verifícalos en local antes de producción.**

| # | Problema | Estado | Ficheros tocados |
|---|----------|--------|------------------|
| 1 | S1 Rate limiting | ✅ Resuelto | `apps/api/src/lib/rate-limit.ts` (nuevo); aplicado en `auth.ts` (`/magic-link` 5/h, `/verify` 20/10min) y `payments-stripe.ts` (`/checkout` 10/min) |
| 2 | S2 Magic link filtrable | ✅ Resuelto | `auth.ts`: flag `AUTH_DEV_LINKS`; en producción nunca devuelve el enlace (503 si falta SMTP) |
| 3 | A1 SSE no escala | ✅ Resuelto *(verificar)* | `apps/api/src/routes/match-stream.ts` reescrito: un `Hub`/poller por partido con fan-out + límite `SSE_MAX_CONNECTIONS` |
| 4 | Q1 Cero tests | ✅ Arrancado | `apps/web/vitest.config.ts`, `apps/web/src/lib/match-time.test.ts` (lógica de TZ), `test` en `package.json` |
| 5 | Q2 Typecheck | 🟡 Parcial *(verificar)* | `tsconfig.base.json` (`noEmit`+`exactOptionalPropertyTypes:false`), union de eventos en `matches.ts`, CI. Residuales: ver abajo |
| 6 | S3 Tokens en claro | ✅ Resuelto *(verificar)* | `migrations/023_session_hardening.sql` (nueva), `auth.ts`: tokens hasheados (SHA-256) + caducidad de sesión 90 días |
| 7 | S9 Premium no caduca | ✅ Resuelto | `payments-stripe.ts` (guard por `premium_until` + `GET /status`), `PremiumContext.tsx` (valida contra servidor) |
| 8 | B1/B2 Footguns + error engañoso | ✅ Resuelto | `apps/api/src/lib/env.ts` (`assertEnv` al arranque) + `index.ts`; `match.loader.ts` distingue el error real |
| 9 | S4 OAuth state + S5 XSS | ✅ Resuelto | `auth.ts` (state firmado con HMAC); `JsonLd.tsx` (escape de `<>&`) |
| 10 | A2 Over-fetch home | ✅ Resuelto | `live.ts`: `/matches/current` con ventana `[hoy-8d, hoy+15d]` (y `?from=&to=`/`?days=`) |

**Extras incluidos:** error handler global sin fuga de detalles (S7) y cierre limpio por `SIGTERM`/`SIGINT` (B3) en `index.ts`; `statement_timeout` en el pool (`packages/db/src/client.ts`); tope de tamaño en `favorites/merge`.

### Pasos de despliegue (en orden)
1. **`npm run typecheck` y `npm run test` en local.** El typecheck debería mejorar mucho; quedan residuales (abajo) que no bloquean producción pero conviene cerrar.
2. **`npm install`** (añade `vitest` a la web).
3. **Migración 023 ANTES de levantar el código nuevo** (invalida las sesiones actuales → los usuarios re-inician sesión una vez; los magic links viejos caducan, son de 15 min).
4. **Variables nuevas en `.env.prod`:** `NODE_ENV=production` (clave para S2), y opcionalmente `AUTH_STATE_SECRET`, `SSE_MAX_CONNECTIONS`, `DATABASE_STATEMENT_TIMEOUT_MS`. Sin `NODE_ENV=production`, el flag de magic-link dev no se desactiva solo.
5. `git pull` + `up -d --build` de `api` y `web`.

### Residuales de Q2 (no bloquean, requieren iterar con compilador en local)
- Tipos de `cheerio.Element` (la versión de cheerio no exporta ese símbolo) en los scrapers → cambiar a `import type { Element } from 'domhandler'`.
- `FepFichaScraper.config` necesita `override` y alinear `FichaScraperConfig` con `ScraperConfig`.
- `run-pipeline.ts`/`index.ts`: estrechar `seasonId` (`string | undefined` → `string`) tras el guard que ya garantiza su presencia.

### No incluido (consciente)
- `payments.ts` (Redsys, inactivo): el guard premium sigue leyendo `is_premium`; al estar desactivado el proveedor, no es prioritario.
- A3 (escudos: una sola fuente de verdad) y la auditoría WCAG completa quedan como mejora siguiente.

---

## Valoración global: **5.5 / 10** (de origen) → **~8 / 10 tras estos cambios, una vez verificados y desplegados**
**Justificación.** Como producto de un solo desarrollador, ya **en producción y funcional**, con arquitectura real (scraper/ETL/API/web bien separados), i18n propio, auth progresiva, pagos, SSE y PWA, el trabajo es notable y la base es sólida: separación de responsabilidades correcta, SQL parametrizado (sin SQLi), firma de webhook verificada, pool centralizado, comparación de token admin en tiempo constante.

La nota de partida (5.5) la lastraban la falta de rate limiting, un footgun de auth que podía comprometer cuentas, un SSE que no aguantaba audiencia, la ausencia de tests/CI y un typecheck que no pasaba. **Con los 10 puntos resueltos** —rate limiting, magic link blindado, SSE con poller único, tokens hasheados con sesión caducable, OAuth con state firmado, premium que caduca de verdad, validación de entorno al arranque, ventana temporal en la home, primeros tests y CI— el proyecto pasa a un **~7.5**: producto sólido y razonablemente endurecido. Para llegar a 8.5–9 falta cerrar los residuales de typecheck, ampliar cobertura de tests (pagos, ETL), una sola fuente de verdad para escudos y disciplina de backups. La puntuación final queda **condicionada a verificar en local** los tres cambios grandes (SSE, hashing de tokens, typecheck) antes de producción.

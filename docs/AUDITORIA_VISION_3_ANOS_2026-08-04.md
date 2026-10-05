# Auditoría de arquitectura — visión a 3 años

**Fecha:** 04/08/2026 · **Alcance:** monorepo completo (`apps/*`, `packages/*`, `deploy/`, `infra/`, CI) a fecha del commit `de8f4bb`.
**Horizonte evaluado:** el que planteas — cientos de miles de usuarios, millones de eventos históricos, apps iOS/Android/PWA, i18n completo, monetización, perfiles, API pública, integraciones con terceros, IA para resúmenes, varios desarrolladores en paralelo.

> Esta auditoría **no repite** lo que ya cerraron `AUDITORIA_TECNICA.md` y `AUDITORIA_ARQUITECTURA_2026-07-19.md` (bloques 1 y 2 completos: SSE, índices, idempotencia de eventos, Docker multi-stage, CI bloqueante, tests de integración) ni lo que ha avanzado desde entonces sin auditoría formal: `competition_sources` guiando el scraping multi-liga (#68-#76), zona horaria por competición (#73/#77/#80), directo por LISTEN/NOTIFY (#75), i18n de nombres de competición y eliminación de `players.position` (#66/#67), y el bloque completo de **Entity Resolution** (clubs/sponsors/team_aliases/resolution_queue, migraciones 044-046, PR #84-#96). Parte de ahí. El objetivo no es confirmar que el proyecto está sano — lo está, y por encima de lo habitual para un proyecto de una sola persona — sino encontrar las decisiones que hoy parecen correctas y que a tres años pueden no serlo.

---

## Lectura previa: el punto ciego real

Antes de entrar en los once bloques, una observación que atraviesa a todos ellos.

En seis semanas (19/06 → 4/08) se han cerrado los dos bloques críticos de la auditoría de julio y se ha construido, además, un sistema de resolución de entidades de nivel bastante superior a lo que la mayoría de plataformas de este tamaño tienen jamás: embudo de cinco escalones, cola de revisión humana, panel de moderación, auto-confirmación calibrada por señales de dominio, aprendizaje retroalimentado. Es un trabajo de arquitectura excelente. Y hoy resuelve **108 clubes con una cola vacía**, porque la OK Liga resuelve al 100% por ID de fuente — el propio runbook lo dice sin rodeos: "hoy la cola está vacía porque OK Liga resuelve por ID" y la Fase 4 (LLM) se difiere "a propósito" hasta que Portugal/Italia metan volumen inter-fuente real.

Al mismo tiempo, el propio plan de medición (`ANALITICA_PLAN_MEDICION.md`, escrito hace un día) es explícito: *"la monetización está implementada pero desactivada tras flag, así que hoy el juego es de adopción, engagement y retención, no de ingresos"*. No hay en ningún documento del repo una sola cifra de usuarios activos, seguimientos en directo o retención. La instrumentación para medirlo existe sobre el papel; no hay evidencia de que se haya mirado.

Puestas una al lado de la otra, estas dos observaciones son el hallazgo más importante de esta auditoría: **se está invirtiendo esfuerzo de ingeniería de escalado (45 ligas, resolución inter-fuente, tiempo real sin cuello de botella) por delante de cualquier señal validada de que hay demanda para la segunda liga.** No es un juicio sobre la calidad del trabajo — es impecable — es una pregunta de secuencia. Con un solo desarrollador, cada sprint dedicado a "por si acaso" es un sprint que no se dedica a las dos palancas que el propio backlog ya identifica como las de mayor retorno probable: activar el histórico que ya está scrapeado, y activar la monetización que ya está construida y dormida. Vuelvo sobre esto en la revisión del backlog, al final.

La segunda pata del mismo punto ciego: la hipótesis de "varios desarrolladores trabajando simultáneamente" en tres años no se sostiene hoy ni a nivel de proceso. `git shortlog` no muestra un segundo colaborador humano — todo el historial es un único autor más dependabot. Es un repo personal privado, sin `CODEOWNERS`, con la regla de protección de rama "dormida" (nota que ya arrastra la propia auditoría de julio sin resolver). Cada PR se autoaprueba. Funciona porque hoy no hay nadie más — es una costumbre de trabajo, no una arquitectura, y las costumbres no escalan solas cuando llega la primera persona nueva. Si de verdad el horizonte incluye equipo, esto se resuelve barato *ahora* (mover el repo a una organización, activar la regla, escribir una guía de onboarding) y se vuelve mucho más caro resolverlo *con alguien ya dentro y sin red de seguridad*.

---

## 1. Arquitectura

La separación scraper → ETL → API → web se mantiene limpia y es la decisión correcta, ya validada en las auditorías previas. El CI bloquea de verdad (typecheck, tests, lint, migraciones desde cero, build de imagen, audit de dependencias) — nivel de disciplina poco habitual para un proyecto de un solo desarrollador.

Dos cosas específicas de la mirada a 3 años, no cubiertas antes:

**El esquema ya es multi-deporte sobre el papel (`sports`, `clubs.sport_id`), pero el código de dominio no.** Toda la lógica de parsing de actas, reglas de playoff, faltas/penaltis y el crono de cuenta atrás 25→0 está cableada a hockey sobre patines en `apps/scraper` y `apps/etl`. La tabla `sports` compra la mitad de la portabilidad a un segundo deporte, no toda — no hay que resolverlo ahora (sería especular sobre un requisito que no está confirmado), pero conviene no asumir que ya está resuelto solo porque el esquema lo sugiere.

**La API y la web comparten hoy el mismo ciclo de vida y el mismo despliegue**, lo cual es correcto mientras la API solo sirva a la propia web. En el momento en que exista un consumidor externo (bloque 4), hay que decidir explícitamente si la API pasa a tener su propio contrato de compatibilidad y SLA, o si sigue siendo "la API interna que además usan terceros" — la segunda opción es donde las plataformas se hacen daño: un cambio "interno" rompe a un cliente de pago sin que nadie lo haya decidido a propósito.

---

## 2. Modelo de datos

El avance desde julio es real y va en la dirección correcta: nombres de competición i18n (038), `players.position` derivado de alineaciones en vez de texto libre (039), zona horaria por competición (042), y sobre todo el modelo de Entity Resolution (044-046), que separa correctamente identidad de club, nombre comercial con vigencia temporal y "sección" (género × categoría × filial). Es el diseño correcto para lo que pides a 3 años — el propio informe de arquitectura del ER (`ARQUITECTURA_ENTITY_RESOLUTION.md`) es, de hecho, uno de los documentos técnicos mejor razonados del repo.

Tres cosas abiertas que esta mirada añade sobre lo ya señalado en julio:

- **`match_events` sin particionar deja de ser un problema de "cuando lleguemos a varios millones" en cuanto se ejecute la tarea #1 del propio backlog** (volcar el histórico de 25 temporadas al servidor). Particionar una tabla vacía o casi vacía es barato; particionar la misma tabla con millones de filas ya cargadas y en uso en producción es una migración con bloqueo real. El orden correcto es invertir la secuencia: particionar primero, volcar después.
- **No existe ningún concepto de tenant/cliente en el esquema.** Ninguna tabla modela "organización" u "API key" — la propia documentación de analítica lo confirma sin rodeos ("no hay cuentas multi-usuario"). Si el producto B2B de scouting (ya anotado como idea estratégica en el propio backlog) avanza, hace falta este modelo desde el primer commit de esa feature, no como refactor posterior.
- **"Estadísticas avanzadas" no es una feature de interfaz sobre el dato actual — es un modelo de datos que no existe.** Hoy el evento más granular es gol/tarjeta/falta con instante de juego; nada modela secuencias, posesión o posición en pista. No es urgente, pero conviene no prometer "estadísticas avanzadas" en un roadmap de producto sin tener claro que implica diseño de esquema nuevo, no solo un dashboard.

No repito el punto 9/3.1 de julio (i18n de campos libres como `rounds.name` o `match_events.detail`) salvo para confirmar que sigue siendo el bloqueante correcto antes de la segunda federación — y que además es, como explico en el bloque de SEO, el mismo problema visto desde otro ángulo.

---

## 3. ETL y scrapers

Robusto y con buena trazabilidad: registro de fuentes por prefijo (`core/sources.ts`), paralelización con límite pensada explícitamente para escalar a ~45 ligas (#76), lock del scheduler, watchdog de directos fantasma, purga de `scrape_logs` con retención, golden files para los parsers de acta con tests verificados por mutación. Es infraestructura de nivel producción de verdad, no un prototipo.

Dos riesgos que crecen con el número de fuentes y no están cubiertos por auditorías previas:

**Dependencia total de una única plataforma blanca (sidgad).** Es una apuesta razonable — una sola forma de scrapear cubre FEP, World Skate y previsiblemente PT/IT — pero es también un único punto de fallo estructural: si sidgad cambia su API interna de forma agresiva, la ingesta de *todas* las ligas cae a la vez, no de una en una. Antes de dar por sentado que `BaseScraper`/`core/sources.ts` generaliza de verdad a fuentes no-sidgad, vale la pena probarlo con una fuente real que no lo sea, aunque sea pequeña — la generalización no verificada es una suposición, no un hecho.

**La ausencia de datos es invisible.** Existe Sentry y existe `scrape_logs`, pero nadie consulta `scrape_logs` en caliente (ya lo señaló julio: solo tiene retención, ningún consumidor). El `stale-live-watchdog` cubre el síntoma de un partido fantasma en directo, pero no cubre "el scraper de calendario lleva tres días sin insertar nada para la federación autonómica X" — con 45 fuentes activas, un scraper roto en silencio por un cambio de HTML es indistinguible de "no hay partidos hoy" hasta que un usuario se queja. Una alerta activa de tipo "N horas sin ingesta nueva para una fuente que debería tenerla" es barata y cierra ese hueco.

Tampoco hay una capa de validación de rango/esquema sobre lo que entra del scraper antes de persistir (marcador negativo, fecha fuera de temporada, dorsal duplicado). Hoy la robustez depende de que el parser explote de forma visible o de revisión manual; con fuentes más heterogéneas la probabilidad de HTML "raro pero no roto" —que no dispara ninguna excepción y aun así ensucia el dato— sube.

---

## 4. API

Este es el bloque con menor cobertura de cara a "API pública" y "integraciones con terceros", porque hoy ese concepto sencillamente no existe en el diseño:

- **Sin versionado.** Rutas planas (`/matches`, `/teams`, `/players`...), ningún `/v1/`. Cualquier cambio de forma de respuesta rompe a todos los consumidores a la vez — hoy eso solo afecta a la propia web; con un cliente de pago del B2B de scouting, es incompatibilidad no negociada.
- **Sin autenticación de servicio a servicio.** Solo hay sesión de usuario (magic link / Google) y un `ADMIN_TOKEN` compartido. No hay API keys, ni scopes, ni cuota por cliente — exactamente lo que necesita el producto B2B ya anotado en el backlog, y hoy no existe ni el esqueleto.
- **CORS cerrado a un único origen**, correcto para hoy, pero significa que la API no es consumible desde fuera del navegador de la propia web sin tocar código.
- **Sin documentación machine-readable** (OpenAPI/Swagger). La única "documentación" es la lista de rutas del `GET /` del propio Hono. Insuficiente para que un tercero integre, o para generar un SDK, o para validar contratos en CI.
- **Rate limiting sin concepto de plan o cliente** — limita por ruta+IP, que es exactamente lo que hace falta hoy y exactamente lo que no basta para monetizar acceso a datos.

Nada de esto es urgente porque no hay terceros esperando. Pero es barato hacerlo bien desde el principio y caro migrarlo después: introducir un prefijo `/v1/` en las rutas nuevas (con redirección desde las actuales) y una tabla mínima de `api_clients` (key hasheada igual que las sesiones, cuota, scopes) el día que exista un primer cliente piloto del B2B, en vez de reutilizar el patrón de `ADMIN_TOKEN` para eso.

---

## 5. Tiempo real

Julio ya diagnosticó esto en detalle (1.1-1.4, 3.4) y ha habido progreso real desde entonces: LISTEN/NOTIFY sustituye parte del polling interno (#75), las alineaciones se cachean en el hub, hay índices compuestos. No repito ese diagnóstico.

Lo que añade la mirada a 3 años: LISTEN/NOTIFY resuelve el flujo pull→push *dentro* de un único proceso/Postgres, pero no resuelve el techo de una sola réplica de API — los hubs SSE siguen en memoria de proceso. Con "picos de tráfico en directo" y cientos de miles de usuarios, el primer estrangulamiento real no va a ser Postgres (ya aliviado) sino cuántas conexiones SSE concurrentes aguanta un solo proceso Node en un VPS de 4 GB. Antes de invertir en Redis pub/sub (correctamente identificado en julio como la solución de fondo), vale la pena una prueba de carga real — simular N conexiones SSE simultáneas con k6 o artillery — para conocer el techo actual en vez de dimensionar a ciegas. Puede que el techo actual aguante sobradamente el tráfico real de aquí a que haga falta Redis; puede que no. Hoy no se sabe.

---

## 6. Performance

Cubierto en gran parte por julio (índices, micro-caché, materialización de estadísticas de temporada). Un ángulo que no estaba: no hay evidencia de que se mida Core Web Vitals reales (LCP/INP/CLS) en producción, pese a que el tráfico va a ser mayoritariamente orgánico. Con fichas que hacen varias queries y OG images generadas dinámicamente vía `next/og`, merece la pena tener datos reales (Vercel Speed Insights o CrUX) antes de que el volumen de páginas indexadas se multiplique — es mucho más barato corregir un patrón de renderizado con 500 páginas indexadas que con 50.000.

---

## 7. Seguridad

El nivel es notablemente alto para el tamaño del equipo: comparación en tiempo constante de tokens, sesiones hasheadas en BD (nunca en claro), `state` de OAuth firmado con HMAC contra CSRF, rate limiting en los endpoints sensibles, límite de tamaño de payload, validación de entorno "fail fast", y un error handler que nunca filtra detalles internos al cliente. Es código escrito por alguien que ya se ha quemado antes con estas cosas o las ha estudiado bien.

Lo que queda abierto para el horizonte de 3 años:

- **`ADMIN_TOKEN` único y compartido**, ya señalado como pendiente en el propio `ESTADO_PROYECTO.md` ("admin nivel 2: roles de usuario"). En cuanto haya más de una persona operando —el propio escenario de "varios desarrolladores"— un token compartido sin roles ni auditoría de quién hizo qué deja de ser un detalle y pasa a ser el primer problema de seguridad operativa.
- **Gestión de secretos por variables de entorno sin vault ni rotación.** Razonable en un VPS único operado por una persona; deja de serlo con un segundo operador o un pipeline de CI/CD con más superficie de acceso.
- **Nada protege explícitamente el propio sitio de ser raspado por terceros** más allá de lo que dé Caddy por defecto — irónico dado que el modelo de negocio del proyecto es exactamente eso aplicado a la FEP, y previsible que ocurra si el B2B de scouting no llega a existir como vía oficial de acceso a los datos.
- Cuando exista la API pública/B2B (bloque 4), la superficie de autenticación crece con las API keys, y con ella el riesgo de fuga. Hoy no hay ni el mecanismo, así que tampoco hay el riesgo todavía — pero merece diseñarse bien desde el primer día (keys hasheadas igual que las sesiones, scopes, expiración) en vez de improvisarlo sobre el patrón de `ADMIN_TOKEN`.

---

## 8. SEO

`ESTADO_PROYECTO.md` describe una base madura: sitemap multiidioma dinámico, hreflang con `x-default`, `schema.org` (SportsEvent/SportsTeam/Person), OG dinámicas por partido, alta en Search Console. Dado el nivel de cuidado que se ve en el resto del código, no tengo motivo para dudarlo, y no voy a repetir una auditoría SEO completa sin tener delante datos reales de Search Console.

Lo que sí es un riesgo concreto a 3 años, y que conecta directamente con el modelo de datos: **el punto de i18n de datos (no de interfaz) señalado en julio es, mirado desde SEO, más grave de lo que parecía.** Que Google indexe "Jornada 1" en español para una URL servida en italiano no es solo una inconsistencia de UX — es contenido no canónico en el idioma declarado de la página, justo lo que penaliza relevancia y CTR en resultados fuera de España. Cuanto más tráfico orgánico multiidioma se acumule sobre URLs con texto mal traducido, más caro es corregirlo después: no es solo cambiar el dato, es gestionar el impacto en un ranking ya conseguido con la señal equivocada. Razón de más para no aplazar ese punto.

Con cientos de miles de usuarios y contenido en varios países, el volumen de páginas indexables (fichas de jugador, de equipo, de partido histórico de 25 temporadas) se dispara. Falta decidir la política de indexación del histórico —¿se indexan fichas de partidos de 1999 con datos parciales, o solo lo reciente?— antes de que Google la decida por defecto marcando *thin content*.

---

## 9. Observabilidad

Hay Sentry en las tres apps (api, etl, web edge+server), logger compartido (pino), healthchecks Docker. Es una base razonable para el tamaño actual del equipo y del tráfico.

Lo que falta para sostener "varios desarrolladores + cientos de miles de usuarios":

- **Sentry captura errores, no tendencias.** No hay un dashboard de métricas de negocio/infra (latencia p95 por endpoint, throughput, tasa de error a lo largo del tiempo). Hoy "cómo de bien está la API" se sabe mirando incidentes puntuales, no degradaciones graduales — que son las que más cuesta detectar sin métricas.
- **No hay alertado activo** más allá de lo que Sentry dispare por excepción no capturada. Nada avisa de "la fuente X lleva 6 horas sin insertar nada" o "la tasa de 5xx subió al 2% en la última hora" salvo que alguien mire. Un canal de alertas — aunque sea un webhook simple a un chat — es barato y es justo lo que evita depender de que un usuario reporte el problema antes que el sistema.
- `tracesSampleRate` al 10% en producción es razonable por cuota, pero vale la pena confirmar que alguien revisa Sentry Performance con regularidad y no solo la bandeja de Issues.
- Con un solo operador esto es sostenible porque la única persona que necesita enterarse ya lo hace. En cuanto haya un segundo desarrollador, o soporte a usuarios, "mirar los logs del contenedor cuando algo huele mal" deja de escalar como estrategia de guardia.

---

## 10. Testing

La infraestructura de integración (Postgres real, sin emuladores, con guardarraíles contra ejecutar `TRUNCATE` sobre una base que no sea de test) es de un nivel poco habitual y ya se elogió en julio. 27 ficheros de test entre unitarios e integración cubren justo las zonas de más riesgo: `replaceMatchEvents`, el watchdog de directos fantasma, el embudo de Entity Resolution, los snapshots del `push-dispatcher`.

Huecos reales para el horizonte de 3 años:

- **Cero tests end-to-end de interfaz.** Con SSE, PWA, cinco idiomas y ahora un panel de moderación HITL, la superficie de regresión funcional del frontend ha crecido mucho sin ninguna red de seguridad automatizada — hoy depende de prueba manual antes de cada release.
- Los parsers de acta tienen golden files, pero —ya señalado en julio y todavía abierto— faltan capturas de descanso, prórroga, penaltis e incomparecencia: exactamente los casos raros que un usuario reporta como "bug" cuando fallan en pleno directo de un partido importante.
- **No hay tests de carga** (k6, autocannon) contra `/matches/live`, `/current` o el hub SSE. Con "picos de tráfico" como hipótesis explícita de tres años, es la única forma de conocer el techo real antes de que lo descubra un domingo de playoff con usuarios de verdad.

---

## 11. Experiencia de desarrollo

Monorepo Turborepo con scripts consistentes, documentación viva fuera de lo común para el tamaño del proyecto (más de una decena de documentos técnicos activos, historial de auditorías, runbooks operativos) y CI que bloquea de verdad. Es mérito real y poco frecuente en proyectos de un solo desarrollador.

El gap real es exactamente el que señalaba la lectura previa: **el proceso de desarrollo está diseñado, sin decirlo, para una sola persona.** Repo personal privado, sin `CODEOWNERS`, protección de rama dormida, cada PR autoaprobado por su propio autor. No hay una guía de onboarding (`CONTRIBUTING.md` o equivalente) más allá de reconstruir el porqué de cada decisión leyendo la bitácora cronológica de documentos — funciona perfectamente para quien los escribió, no funciona igual de bien para alguien que entra en agosto de 2026 sin ese contexto acumulado. Si el horizonte de tres años incluye de verdad un segundo desarrollador, esto se resuelve barato ahora y caro después.

---

## Roadmap técnico

No es una lista exhaustiva — son las recomendaciones con impacto real a tres años, más allá de lo que ya recogen las auditorías previas.

| # | Problema | Riesgo | Impacto a 3 años | Solución propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| 1 | No hay ninguna cifra de tracción real citada en el repo (WAU, seguimientos en directo, retención) pese a tener el plan de medición ya escrito | Se sigue invirtiendo en escalado especulativo (PT/IT, Fase 4 LLM) sin saber si hay demanda | Meses de trabajo de ingeniería mal secuenciado frente a las palancas de mayor retorno probable (histórico, monetización, APK) | Activar la instrumentación del plan de analítica y fijar un checkpoint explícito de revisión antes del próximo sprint de escalado | S | 🔴 Crítico |
| 2 | `match_events` sin particionar, y el volcado del histórico (25 temporadas) es la tarea #1 del backlog | Particionar con la tabla ya llena en producción es una migración con bloqueo real | Con millones de eventos históricos, cualquier query o mantenimiento sobre la tabla se degrada y la migración de partición se vuelve arriesgada | Particionar por temporada/rango de fecha ANTES de ejecutar el volcado, no después | M | 🔴 Crítico |
| 3 | Gobierno de repo diseñado implícitamente para un solo desarrollador (sin `CODEOWNERS`, protección de rama dormida, PRs autoaprobados) | El primer colaborador nuevo entra sin red de seguridad de revisión | Bloquea de facto la hipótesis de "varios desarrolladores en paralelo" hasta que se resuelva bajo presión | Mover el repo a una organización, activar la regla de protección, `CODEOWNERS`, plantilla de PR, `CONTRIBUTING.md` mínimo | S | 🟠 Importante |
| 4 | i18n de datos incompleto (`rounds.name`, `match_events.detail` y otros campos libres) — es a la vez deuda de producto y de SEO | Contenido no canónico indexado en el idioma equivocado; cuesta más corregir cuanto más tráfico orgánico se acumule encima | Bloquea la 2ª federación y penaliza el SEO multiidioma que sostiene la adquisición orgánica prevista | Enumerables → claves canónicas traducidas; nombres propios → `jsonb` i18n (ya diseñado en julio, ejecutar) | M | 🟠 Importante |
| 5 | La API no tiene versión, autenticación de servicio ni cuota — necesario para el producto B2B ya anotado en el backlog | Cualquier cambio de forma de respuesta rompe a un futuro cliente de pago sin aviso | El B2B de scouting no tiene ni el esqueleto técnico cuando llegue el primer cliente piloto | Prefijo `/v1/` en rutas nuevas + tabla `api_clients` (key hasheada, scopes, cuota) activada con el primer cliente | S/M | 🟠 Importante |
| 6 | Ausencia de datos invisible: nadie consulta `scrape_logs` en caliente ni hay alerta de "fuente sin ingesta" | Con 45 fuentes activas, un scraper roto por HTML cambiado pasa inadvertido hasta que un usuario se queja | Fallos de datos silenciosos multiplicados por el número de ligas | Alerta activa tipo "N horas sin ingesta nueva para una fuente que debería tenerla" | S | 🟠 Importante |
| 7 | `ADMIN_TOKEN` único compartido, sin roles ni auditoría de acciones | Con más de un operador, no hay forma de saber quién hizo qué | Bloqueante operativo en cuanto haya un segundo colaborador con acceso admin | Admin nivel 2 con roles de usuario (ya en el backlog propio) | M | 🟡 Conveniente |
| 8 | No hay prueba de carga real del hub SSE / `/current` | Se podría invertir en Redis pub/sub sin saber si el techo actual ya aguanta el tráfico real esperado | Sobre-ingeniería o, al contrario, sorpresa en el primer pico real de usuarios | Prueba de carga con k6/artillery simulando N conexiones SSE concurrentes antes de decidir sobre Redis | S | 🟡 Conveniente |
| 9 | Cero tests end-to-end de interfaz sobre flujos críticos (directo, favoritos, login, PWA) | Regresiones de frontend solo se detectan en producción o por prueba manual | Con más superficie (apps nativas, más idiomas) el coste de no tener red automática crece más rápido que el equipo | Suite mínima de Playwright sobre los 4-5 flujos más críticos | M | 🟡 Conveniente |
| 10 | Sin métricas de negocio/infra en dashboard ni alertado activo más allá de Sentry por excepción | Degradaciones graduales (no caídas) pasan inadvertidas | "Mirar los logs cuando algo huele mal" no escala con más operadores ni más tráfico | Dashboard mínimo de latencia/error-rate + canal de alertas (webhook a chat) | S/M | 🟡 Conveniente |
| 11 | Modelo de tenant/API-key/cuota para el producto B2B no existe en el esquema | Cuando llegue un cliente piloto, no hay dónde colgar su acceso | Retrasa el lanzamiento del único producto de monetización B2B ya identificado como oportunidad | Diseñar tabla de tenants/API keys junto con el punto 5, no antes de tener un cliente real | M | 🟢 Futuro |
| 12 | Resúmenes de partido generados por IA (hipótesis de producto a 3 años) | Ninguno hoy — es una apuesta de producto, no una decisión ya tomada que haya que corregir | Feature vistosa sin usuarios que la vean si se construye antes de validar la NSM actual | Evaluar solo tras confirmar tracción real (punto 1) y con volumen de partidos suficiente para que el resumen aporte algo que el timeline no dé ya | M | 🟢 Futuro |

---

## Revisión del backlog

El backlog vivo hoy (`ESTADO_PROYECTO.md`, actualizado en un PR sin mergear a fecha de este informe) ordena así lo pendiente: (1) volcar el histórico al servidor y reprocesar actas con crono exacto, (2) federaciones autonómicas / expansión a Portugal e Italia, y detrás de eso, Fase 4 del Entity Resolution, APK Android, monetización, admin nivel 2 y el producto B2B de scouting.

Pedías que desafiara esto si hacía falta, y hace falta.

**El punto 2 (PT/IT) es una apuesta de producto tan grande como cualquiera de las de más abajo en la lista, y no está justificada con ningún dato.** El propio runbook del Entity Resolution dice, literalmente, que PT/IT "es lo que activa de verdad el embudo" — es decir, se ha construido primero la solución técnica para la expansión internacional y se espera a que la expansión llegue para justificarla, en vez de al revés. Antes de comprometer el siguiente sprint a esto, el ejercicio de mayor retorno es mucho más barato: mirar los números que la propia instrumentación de analítica (escrita ayer) ya está lista para dar, y decidir con datos si el mayor palanca disponible es de verdad expandir a dos países nuevos, o si es activar dos cosas que ya están construidas y paradas — la monetización (Stripe implementado, solo falta el flag) y la APK Android (Capacitor sobre una PWA que ya es instalable, coste bajo, y que el propio plan de medición identifica como fuertemente correlacionada con retención).

**Antes del punto 1 (volcado del histórico), hay un trabajo técnico de mayor retorno que no está en ningún backlog: particionar `match_events`.** Es el ítem #2 de la tabla de roadmap de arriba. Hacerlo antes del volcado es una migración barata sobre una tabla pequeña; hacerlo después es una migración con bloqueo sobre una tabla de millones de filas en producción. No es una tarea nueva que compita por prioridad con el volcado — es una condición previa para que el volcado no se vuelva más caro de lo necesario.

En resumen: no cambiaría el orden de "qué construir" tanto como añadiría un paso de "mirar antes de construir" entre el punto 1 y el punto 2, y colaría la partición de `match_events` delante del propio punto 1. El resto del backlog (Fase 4 del ER, admin nivel 2, B2B) me parece correctamente pospuesto — son apuestas legítimas, pero ninguna es urgente hoy, y el propio equipo ya lo ha entendido así al diferirlas "a propósito".

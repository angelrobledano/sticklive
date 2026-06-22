# Auditoría integral de Stick Live

**Fecha:** 22/06/2026 · **Equipo simulado:** PM senior · Staff Engineer · UX Designer · QA Lead
**Encargo:** auditar como si asumiéramos la evolución del producto 3 años.

## Nota de método y alcance (honestidad)

No he podido hacer un *click-through* real en un navegador contra producción (sin acceso a la app en ejecución desde mi entorno). **La evidencia es el código fuente del repo y las capturas que el equipo ha compartido esta sesión** (home, ficha en directo, OG, el duplicado del 23/06), más la depuración real del directo de hoy. Por tanto:

- **[HECHO]** = verificado en código o captura.
- **[HIPÓTESIS]** = inferencia razonable no verificada en vivo.
- **[REC]** = recomendación.

Las afirmaciones de UX fina (contraste exacto, foco de teclado, lectores de pantalla, responsive real en dispositivos) están marcadas como hipótesis: requieren una pasada con axe/Lighthouse y dispositivos reales que no he podido ejecutar.

---

## 1. Resumen ejecutivo — 10 hallazgos

1. **[HECHO] El producto vive o muere con el scraping de una sola fuente frágil (sidgad/FEP).** Toda la data depende de parsear HTML de un tercero. Esta sesión sola ha destapado 7+ fallos del camino en vivo (lados de eventos invertidos, alineaciones ausentes, faltas mal contadas, partido omitido por mismatch de IDs, duplicado por TZ, sin descanso/crono, OG cacheado). Es el riesgo nº1 a 3 años.
2. **[HECHO] El directo se desplegó con poca prueba sobre partido real.** El volumen y obviedad de bugs encontrados hoy (todo a un lado, faltas = tarjetas azules, duplicado visible en la home) indica que el flujo estrella no se validó end-to-end con un encuentro en vivo antes de producción.
3. **[HECHO] Estacionalidad brutal sin colchón de retención.** Hoy (22/06, fin de temporada) la home dice "No hay partidos para hoy" y el próximo es en días. En verano la app queda vacía → acantilado de retención. No hay contenido que sostenga el uso fuera de jornada.
4. **[HECHO] Cobertura mínima tras el reset.** Solo OK Liga masculina + playoff; histórico borrado sin backup. Una app de resultados con 1–2 competiciones tiene techo de adopción bajo.
5. **[HECHO] Monetización dormida y sin modelo activo.** Premium oculto, anuncios ocultos, Stripe/Redsys implementados pero inactivos. No hay hipótesis de negocio en marcha que validar.
6. **[HECHO] Notificaciones por debajo del estándar** (auditoría separada): sin descanso/tarjeta/expulsión/penalti, gol sin goleador ni minuto, doble push, latencia 1–3 min.
7. **[HECHO] Infra de un solo nodo (Hetzner CX23, 4 GB) con todo co-localizado** (Postgres+API+web+ETL+Caddy). SPOF total, sin HA ni réplica; el hub SSE es **en memoria por proceso** → no escala horizontalmente.
8. **[HECHO] TS se ejecuta con `tsx` en producción, sin paso de build/typecheck como puerta.** Hoy un error de tipos solo afloró al reconstruir el contenedor. Sin CI que bloquee, los fallos de tipos llegan a deploy.
9. **[HECHO] Observabilidad casi nula.** Depuramos a base de `docker logs | grep`. Sin agregación de logs, sin error tracking (Sentry), sin alertas de caída ni de "el scraper dejó de traer datos".
10. **[HECHO+REC] La mayor oportunidad es también la defensa: ser EL producto de hockey patines.** Flashscore/Sofascore ignoran el deporte. SEO de nicho + OG + schema ya están bien hechos. La ventaja competitiva es la profundidad (todas las competiciones, autonómicas, histórico, jugadores, B2B), no competir en features genéricas.

---

## 2. Inventario de evidencias

| Pantalla / flujo | Evidencia observada | Impacto potencial |
|---|---|---|
| Home (captura) | "No hay partidos para hoy · Estos son los próximos encuentros"; tira de fechas larga | [HECHO] Estado vacío correcto, pero revela la estacionalidad: días enteros sin contenido |
| Home — sidebar | Solo 3 items: Partidos, Competiciones, Ajustes | [HIPÓTESIS] Favoritos/Login/Perfil poco descubribles; features escondidas |
| Ficha en directo (captura) | Eventos pintados todos en el lado del Liceo | [HECHO] Bug crítico de fiabilidad (corregido hoy: el SSE no mandaba `isHomeTeam`) |
| Ficha — alineaciones | No aparecían en directo | [HECHO] El SSE no mandaba `lineups` (corregido) |
| Ficha — faltas de equipo | Mostraba 1-0 (tarjetas azules) en vez de 9-9 | [HECHO] Cálculo erróneo en el SSE (corregido) |
| Ficha — falta directa fallada | "Falta directa · Fallada" sin lanzador | [HECHO] La fuente no da el lanzador en FD falladas (mitigado: mostramos el equipo) |
| Ficha — descanso/crono | No reflejaba descanso ni minuto:segundo | [HECHO] No estaba implementado (añadido hoy: fase + crono cuenta atrás) |
| Home 23/06 (captura) | Mismo partido dos veces (00:00 y 20:30) | [HECHO] Dedup de placeholders sintéticos falla por comparar fecha en UTC (corregido) |
| OG al compartir directo | Tarjeta no reflejaba el directo | [HECHO] `opengraph-image` sin `revalidate` → cacheado (corregido) |
| Cron-live (logs VPS) | Partido en vivo OMITIDO: "competición no indexada o equipos no registrados" | [HECHO] `rfep_mc_1.php` da `fep_club_XX` no resoluble; el partido nunca entraba |
| Notificaciones (código) | `cardAlert()` definido pero nunca invocado; gol sin goleador/minuto | [HECHO] Cobertura y calidad de push insuficientes |
| analytics.tsx | Plan de eventos explícito, autocapture off, rutas normalizadas | [HECHO] Buena base de analítica (mejor de lo esperado) |
| Infra (compose) | 1 VPS 4 GB, todo en Docker Compose, Postgres loopback | [HECHO] SPOF; sin HA; hub SSE en memoria |
| Runtime | `command: npx tsx ...` en prod | [HECHO] Sin typecheck como puerta; error TS visto hoy solo en build |
| Migraciones | Se corren a mano tras `up -d --build` | [HECHO] Ventana en la que el código nuevo consulta columnas que aún no existen |

---

## 3. Problemas críticos (corregir antes de seguir construyendo)

1. **[HECHO] Fragilidad y opacidad del pipeline de datos.** Sin tests de parseo contra HTML fijado (golden files) ni alertas de "estructura cambió / 0 eventos en partido live", cualquier cambio de sidgad rompe el producto en silencio. → Tests de parser con fixtures + alerta de frescura/volumen.
2. **[HECHO] Camino en vivo sin red de seguridad.** Los bugs de hoy estaban en producción. → Suite de pruebas del flujo en directo (parser→ETL→API REST/SSE→render) con un acta real fijada; checklist de validación por partido.
3. **[HECHO] Paridad SSE/REST no garantizada.** El SSE servía menos que el REST (lados, alineaciones, faltas). → Tipar un único contrato de respuesta compartido y testear que ambos lo cumplen.
4. **[HECHO] Sin idempotencia de notificaciones ni de eventos.** Dedup en memoria; un reinicio a mitad de partido puede perder/duplicar. → Ledger de eventos notificados.
5. **[HECHO] Observabilidad y alertas inexistentes.** Si el scraper cae un domingo de jornada, nadie se entera hasta que un usuario se queja. → Error tracking + alerta de "sin actualizaciones en X min durante un live".

## 4. Quick wins (bajo esfuerzo, alto impacto)

1. **[REC] CI que bloquee merge si falla `tsc`/lint** (hoy los errores de tipo llegan a deploy). Esfuerzo: bajo.
2. **[REC] Alerta simple "el scraper no ha insertado nada en N min con partidos live"** (cron + webhook a tu móvil/Slack).
3. **[REC] Goleador + minuto en el push de gol** (el dato ya existe tras los cambios de hoy) y deduplicar gol equipo+jugador.
4. **[REC] Notificar descanso/2ª parte/final de parte y roja** (datos ya disponibles).
5. **[REC] Sentry (o similar) en web y API** — 1 tarde, cambia el juego en diagnóstico.
6. **[REC] Backups automáticos verificados de Postgres** (existe `backup-db.sh`; programarlo + probar restore). Tras el reset sin backup, esto es higiene mínima.
7. **[REC] Estado vacío de temporada/verano** con valor: "La liga vuelve en septiembre" + histórico/estadísticas/última jornada, en vez de una home vacía.

## 5. Deuda técnica y de producto

**Técnica**
- [HECHO] `tsx` en prod sin build compilado: arranque más lento, sin puerta de tipos, sin tree-shaking.
- [HECHO] Hub SSE en memoria por proceso: imposible escalar a >1 instancia de API sin estado compartido (Redis/pub-sub).
- [HECHO] Todo en un VPS 4 GB: Postgres compite con web/ETL; sin réplica de lectura.
- [HECHO] Migraciones manuales post-deploy con ventana de incoherencia (caso 027).
- [HECHO] Cobertura de tests muy baja fuera de un par de transformers; el área con más bugs (live) es la menos testeada.
- [HECHO] Acoplamiento al formato de un único proveedor sin capa anticorrupción testeada.

**Producto**
- [HECHO] Histórico borrado sin backup → pérdida de un activo diferencial (datos 1999→2026).
- [HECHO] Monetización a medio implementar (Stripe+Redsys) sin estrategia → deuda de decisión.
- [HECHO] Cobertura mínima (1–2 competiciones) frente a la promesa "resultados de hockey patines".
- [HIPÓTESIS] Features escondidas (favoritos, ajustes de notificación por entidad) con bajo descubrimiento.

## 6. Riesgos futuros (aparecerán al crecer)

1. **[HECHO→escala] Bloqueo/anti-scraping de la fuente** (rate limit, cambios, captcha). Cuantas más competiciones, más peticiones y más superficie de rotura. Mitigación: caché, backoff, múltiples portales, monitor de salud.
2. **[HECHO→escala] SSE no escala**: con muchos partidos y usuarios simultáneos, un solo proceso/VPS no aguanta; el hub en memoria impide repartir carga.
3. **[HECHO→escala] Postgres co-localizado** se convierte en cuello de botella con histórico grande + tráfico de jornada.
4. **[HIPÓTESIS] Coste/cumplimiento de notificaciones y datos personales** (push, emails, OAuth, GDPR) al crecer la base.
5. **[HECHO] Dependencia de una sola persona** (operación manual: scraping desde PC residencial, deploys y migraciones a mano). Bus factor = 1.
6. **[HECHO] Federaciones/ligas podrían reclamar derechos sobre datos** o lanzar su propia app; relación con la fuente es un riesgo estratégico.

## 7. Roadmap recomendado (Impacto × Esfuerzo)

**Alto impacto / Bajo esfuerzo (hacer ya)**
- CI con typecheck; Sentry; alerta de scraper caído; backups verificados.
- Quick wins de notificaciones (goleador+minuto, descanso, roja, dedup).
- Estado vacío de temporada con histórico/estadísticas.

**Alto impacto / Alto esfuerzo (planificar)**
- Tests del camino en vivo con fixtures + capa anticorrupción del proveedor.
- Re-onboarding de TODAS las competiciones (cobertura) + re-importar histórico.
- Reducir latencia del directo (sondeo 15–20 s → push inmediato) y ledger de eventos.
- Separar Postgres / introducir réplica; estado SSE compartido.

**Bajo impacto / Bajo esfuerzo (oportunista)**
- Limpieza de copy ("[Stick Live]", abreviaturas), microcopys, descubrimiento de favoritos.

**Bajo impacto / Alto esfuerzo (evitar por ahora)**
- Monetización compleja (Redsys/Stripe) antes de tener retención probada.
- Apps nativas completas antes de estabilizar el core web.

## 8. Lista priorizada de acciones

| Problema | Evidencia | Impacto | Esfuerzo | Prioridad | Justificación |
|---|---|---|---|---|---|
| Bugs del live en prod | Capturas de hoy | Alto | Medio | **P0** | El flujo estrella falla; erosiona confianza |
| Sin alerta de scraper caído | Depuración por logs | Alto | Bajo | **P0** | Una jornada sin datos = producto inútil ese día |
| Sin CI/typecheck | Error TS solo en build | Alto | Bajo | **P0** | Evita regresiones que llegan a prod |
| Sin error tracking | `docker logs | grep` | Alto | Bajo | **P0** | Diagnóstico hoy es manual y lento |
| Notificaciones pobres | Auditoría push | Alto | Bajo-Medio | **P1** | Principal palanca de retención |
| Estacionalidad/retención | Home vacía 22/06 | Alto | Medio | **P1** | Sin contenido fuera de jornada se pierde al usuario |
| Cobertura mínima | Solo OK Liga | Alto | Alto | **P1** | Techo de adopción |
| Tests del parser/live | Bugs repetidos | Alto | Medio | **P1** | Estabilidad del activo principal |
| SPOF / 1 VPS | docker-compose.prod | Medio | Alto | **P2** | Riesgo creciente con tráfico |
| SSE no escala | Hub en memoria | Medio | Alto | **P2** | Bloqueante solo al escalar |
| Backups verificados | Reset sin backup | Alto | Bajo | **P1** | Higiene mínima de datos |
| North Star sin definir | analytics.tsx | Medio | Bajo | **P2** | Sin foco, las mejoras no se priorizan por dato |

## 9. Lo que yo haría como PM en los próximos 90 días (10 decisiones)

1. **Congelar features nuevas 2–3 semanas y estabilizar el core en vivo.** Razón: el activo es la fiabilidad del directo; hoy no la tenemos. Sin esto, todo lo demás se construye sobre arena.
2. **Instrumentar la operación: Sentry + alerta de scraper caído + alerta de "0 eventos en partido live".** Razón: no se puede gestionar lo que no se mide; hoy nos enteramos por el usuario.
3. **Montar CI (typecheck+lint+tests) que bloquee deploy.** Razón: cortar de raíz que errores de tipo lleguen a producción.
4. **Tests del camino en vivo con un acta real fijada (golden file) y capa anticorrupción del proveedor.** Razón: el 80% de los bugs vienen del parseo y la paridad SSE/REST.
5. **Definir North Star y 1 funnel.** Propuesta: North Star = "minutos de partido seguidos en vivo por semana"; funnel = visita→sigue equipo→activa notificación→vuelve en la siguiente jornada. Razón: enfocar el roadmap por impacto medible.
6. **Arreglar y subir el listón de notificaciones (P0 de su auditoría).** Razón: es la palanca de retención más barata y la que acerca al estándar del mercado.
7. **Resolver la estacionalidad con contenido permanente:** re-importar histórico, páginas de estadísticas de jugador/equipo, "así quedó la liga". Razón: convertir el verano de acantilado en uso de baja frecuencia pero vivo, y alimentar SEO.
8. **Ampliar cobertura de forma controlada:** OK Liga femenina + 2–3 autonómicas, una a una, con la cobertura como métrica. Razón: subir el techo de adopción manteniendo calidad.
9. **Backups automáticos verificados y reducir el bus-factor:** documentar y automatizar scraping/deploy/migraciones. Razón: hoy depende de una persona y de un PC residencial.
10. **Decidir el modelo de negocio explícitamente (o aparcarlo formalmente):** o se prueba premium/ads con un experimento acotado, o se retira el código dormido para reducir deuda. Razón: el "ni sí ni no" de la monetización es deuda de producto que confunde el foco.

### Lo que cuestiono explícitamente
- **El reset sin backup del 16/06** sacrificó un diferencial (histórico) por limpieza de datos. [REC] Re-importarlo es estratégico, no opcional.
- **Desplegar el directo sin pruebas con partido real** ha costado credibilidad esta misma jornada.
- **Invertir en monetización (Redsys/Stripe) antes que en fiabilidad y retención** es, en mi opinión, una priorización discutible.

### Incertidumbres que declaro (necesitan verificación real)
- Accesibilidad (contraste, foco teclado, lectores) y responsive en dispositivos: requieren axe/Lighthouse + pruebas reales.
- Profundidad de validación/seguridad de la API (rate-limit existe; falta revisar autorización por endpoint, validación de entrada en push/favoritos/pagos).
- Métricas reales de adopción/retención: no he visto los datos de PostHog.
- Estado real de los estados de carga/error en cada pantalla (solo verifiqué los del timeline y la home por captura).

# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Usuario primario: el **aficionado al hockey sobre patines**, siguiendo un partido desde el móvil —en la grada o en el sofá—, normalmente en fin de semana y a menudo con conexión pobre. Su trabajo es seguir el marcador de su equipo o su liga en tiempo real sin tener que recargar, y enterarse al instante de lo que pasa (goles, faltas, fases del partido).

Afición de nicho pero fiel y muy localizada. La consola del anotador y las federaciones/clubes quedan fuera del alcance de producto documentado: son fuentes de datos, no audiencias de diseño.

## Product Purpose

Stick Live es una plataforma de resultados deportivos en directo para hockey sobre patines. Extrae los datos de las fuentes oficiales (federaciones, ligas, actas, calendarios, webs de clubes) mediante scraping y ETL, los normaliza y los sirve en tiempo real al móvil del aficionado.

Existe porque la experiencia digital oficial para seguir este deporte en el móvil es incómoda: lenta, sin UX writing, difícil de navegar, obliga a recargar para ver si el marcador se movió. El producto solo es producto cuando el marcador se mueve solo, en tiempo real, de forma fiable, en el móvil.

Éxito = validar la hipótesis de tracción la próxima temporada (volcar energía en adquisición). Hoy es un hobby en producción, técnicamente serio pero sin validar como negocio (orden de 29 usuarios registrados, ~1.400 visitas acumuladas a fecha del caso de estudio).

## Positioning

El valor es el directo: seguimiento en tiempo real, fiable y cómodo en móvil de un deporte de nicho cuya oferta oficial no lo resuelve. El diferencial no es un catálogo de datos sino la calidad de la experiencia en vivo —latencia del marcador, reconexión robusta, notificaciones push del gol— en un nicho donde no existe validación barata: hay que construir el directo para que valga.

## Operating Context

- Uso mayoritariamente móvil, en directo, durante los partidos; condiciones de red adversas (grada).
- Momento "aha": recibir la primera notificación push de un gol en tiempo real.
- Embudo pensado en clave AARRR; favoritos (clubes y competiciones que sigue el usuario) como señal de preferencia; app multiidioma.
- Analítica con PostHog **con autocapture apagado** a propósito: medir poco pero con intención real. Se mide interacción con el directo (partidos/pestañas), configuración de preferencias y fiabilidad del tiempo real (caídas y reconexión).

## Capabilities and Constraints

Funcionalidad confirmada en producción:
- OK Liga en directo; fichas de partido con goles y actas; clasificaciones; favoritos; notificaciones push; analítica; auditoría técnica aplicada.
- Cobertura de 50+ equipos y competiciones seguidos.

Arquitectura (monorepo): scraper (Playwright + Cheerio) → ETL de normalización y crons (live + emisor push) → API en Hono (REST + SSE) → web en Next.js 16 (App Router). PostgreSQL como BD; despliegue en un único VPS pequeño de Hetzner con Docker tras servidor web. Objetivo explícito: arquitectura sólida, escalable y mantenible orientada a producción, no prototipo visual rápido.

Restricciones / terminología clave:
- El directo se sirve por SSE (conexión abierta que empuja cada cambio), con poll de respaldo.
- Nunca asumir que un identificador de fuente externa es universal: calendario y acta del directo identifican a los equipos de forma distinta; hay una capa de reconciliación (club_id vs team_id).
- Las fuentes deben fallar con error explícito, nunca en silencio.
- Coste de infraestructura deliberadamente bajo (orden de decenas de € al mes).

Roadmap (Now/Next/Later) como decisiones de producto, no compromisos firmes:
- Next: mejores notificaciones del directo (palanca de retención), ligas autonómicas (piloto FMP), app Android. *(OK Liga femenina: en producción desde junio 2026; histórico núcleo: volcado v1 hecho, enriquecimiento en curso.)*
- Later: Portugal, Italia, Francia, estadísticas avanzadas, app iOS, modelo de negocio.

Plataforma registrada como **adaptive**: web en producción; **app Android (Expo) en preparación —release interno de Google Play pendiente—**; iOS compilable pero sin publicar (sin cuenta de Apple en v1). Detalle: `docs/app.md`.

## Brand Commitments

- Nombre: **Stick Live**. Dominio en producción: sticklive.eu.
- Proyecto unipersonal del autor (Product Manager), construido con IA; tono honesto y sin humo en su comunicación externa.
- Multiidioma como parte del producto.

## Evidence on Hand

- Producto real en producción en sticklive.eu.
- Caso de estudio escrito: `stick-live-caso-estudio.md` (narrativa, métricas, arquitectura).
- Auditoría técnica: `AUDITORIA_TECNICA.md`; informe de refactor: `REFACTOR_REPORT.md`.
- Diagramas: `diagrama-arquitectura.svg`, `diagrama-club-vs-team.svg`, `diagrama-roadmap.svg`.
- Documentación en `docs/` (estado, changelog, notificaciones, runbook, deploy, arquitectura).
- Métricas de uso reales son todavía bajas y NO validadas: no fabricar testimonios, cifras de tracción, ni claims de adopción.

## Product Principles

- El valor es el directo: la fiabilidad y latencia del marcador en tiempo real mandan sobre todo lo demás.
- Móvil primero, en condiciones reales de grada (una mano, sol, red mala).
- Medir poco pero con intención; la fiabilidad del tiempo real es la métrica que de verdad importa.
- Empezar pequeño y ampliar competiciones una a una; preferir solidez a cobertura.
- Honestidad: no inflar tracción ni prometer lo no validado.

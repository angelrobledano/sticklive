# Changelog — Stick Live

Historial de hitos de producto y plataforma. El estado vivo está en [ESTADO_PROYECTO.md](./ESTADO_PROYECTO.md).

---

## Hito junio 2026 (16–17 jun) — Multi-competición, avisos completos y robustez de cuenta

Salto de "OK Liga en directo" a **plataforma multi-competición** con un sistema de notificaciones cerrado, app instalable y cuenta sólida entre dispositivos.

### Producto (CPO)

**Cobertura de competiciones.** El directo deja de ser solo OK Liga masculina: se ingieren **todas las competiciones senior y copas de la temporada actual**, con marcadores en vivo para todas. La **OK Liga Femenina** queda unificada (liga + playoff en una sola competición, como la masculina). Las copas/campeonatos de España se modelan como rondas de playoff. En las listas de la home cada partido indica **a qué competición pertenece** (antes se asumía OK Liga masculina).

**Notificaciones, de básicas a completas.** Además de inicio/gol/final, ahora se emiten avisos de **inicio y fin de jornada**, **competición seguida** y **gol de jugador seguido**. Se añade **on/off por entidad concreta** (silenciar un equipo, liga o jugador sin dejar de seguirlo) y un **botón "enviar notificación de prueba"** para verificar permiso + suscripción + Service Worker al instante. La pantalla de Ajustes → Notificaciones se rediseñó con banner de estado del permiso, filas de navegación por tipo y subpantallas por entidad. Detalle en [NOTIFICACIONES.md](./NOTIFICACIONES.md).

**App instalable (PWA).** Botón de "instalar app" desde el navegador (`beforeinstallprompt` en Android/Chrome) con instrucciones manuales para iOS. En iOS la instalación es **requisito** para recibir Web Push.

**Favoritos que viajan de verdad.** Sincronización en la nube **write-through**: cada estrella se refleja al instante en la cuenta (no solo al hacer login), con **tombstones** para que una baja hecha sin conexión no reaparezca al reconciliar. Se unificó el estado entre la estrella, "Mis ligas", Ajustes y "Gestionar favoritos" (antes había desconexión).

**Usabilidad en competición.** Toolbar de filtros (jornada / fecha / equipo) con **estado en la URL** y exclusión mutua, estados vacíos claros, ocultación de fases de playoff vacías, y UX limpia para eliminatorias **a partido único** (se muestra el marcador real, no "1–0" de victorias). El botón "Volver" devuelve a la **página anterior exacta** (mantiene día y filtros) en vez de a la home.

**Compartir y SEO.** Imágenes **Open Graph dinámicas por partido** (escudos + marcador vía `next/og`) más una OG estática de marca. Compartir la alineación como imagen se pre-genera para que iOS no se quede "pensando".

### Plataforma (CTO)

**Modelo de datos multi-competición.** Equipos deduplicados **por referencia FEP** (`source_ref`/`alt_source_refs`), no por slug, para que un club que juega varias competiciones sea una sola entidad. `import-history.ts` admite `--only-idc=` (lista) y `--fichas`; `run-pipeline.ts` trata ciertas `idc` como playoff/copa. Operativa completa en [RUNBOOK_COMPETICIONES.md](./RUNBOOK_COMPETICIONES.md).

**Directo aislado por capas.** El cron de directo conserva su camino crítico para la OK Liga y añade una **pasada adicional aislada** para el resto de competiciones: si falla, no arrastra a la OK Liga.

**Emisor de avisos (ETL).** `push-dispatcher.ts` hace snapshot/diff de rondas y goles por ciclo y segmenta por equipo, liga y jugador; los eventos de jornada son globales. `push_subscriptions` guarda `fav_leagues`/`fav_players` (**migración 025**).

**Migraciones.** 025 (favoritos de liga/jugador en suscripciones) y 026 (fusión del playoff femenino dentro de la liga femenina, espejo de la 014).

**Robustez de cuenta.** Magic link de un solo uso endurecido contra el doble disparo del efecto de verificación (un token se consumía dos veces y daba "caducado"); `resolveUserByEmail` tolera colisiones de `device_id`; mensajes de error de Google OAuth más claros cuando el email ya existe por otro método. Derivación de temporada en runtime para no depender de `NEXT_PUBLIC_SEASON_ID` horneado vacío en build.

**Detalle visual de datos.** Normalización de mayúsculas en nombres de club (`clubName()`: conectores en minúscula, acrónimos ≤3 en mayúscula).

### Operación destacada

La BD de producción se **reconstruyó el 16/06** partiendo solo de la OK Liga vigente (histórico borrado, se vuelca aparte). Tras una reconstrucción así hay que **reaplicar todas las migraciones** (`$DC exec api npx tsx packages/db/src/migrate.ts`); omitirlo reproduce el 500 del magic link por columnas inexistentes.

### Pendiente inmediato

Prueba **end-to-end de notificaciones en directo** durante un partido real de playoff (19/21/23 junio).

---

## Hito anterior (≤11 jun 2026)

Salida a producción en `sticklive.eu`: OK Liga en directo con SSE y push básicas, histórico RFEP 1999/00→2025/26, favoritos con auth progresiva (magic link + Google OAuth), i18n en 5 idiomas, SEO base y analítica PostHog. Ver el estado de esa fecha en el historial de `ESTADO_PROYECTO.md`.

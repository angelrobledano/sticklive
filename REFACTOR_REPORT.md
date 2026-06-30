# REFACTOR_REPORT.md — Auditoría y limpieza de Stick Live

**Fecha:** 30/06/2026
**Enfoque:** A — limpieza segura verificada con evidencia + documentación de lo arriesgado.
**Alcance:** monorepo completo (`apps/{web,api,etl,scraper}`, `packages/{db,analytics,logger,shared-types}`).

> Restricción autoimpuesta: no se ha ejecutado ningún cambio que altere comportamiento, contratos públicos, reglas de negocio ni diseño. Todo lo que tenía riesgo de romper compatibilidad se documenta en "Mejoras pendientes" y **no** se ha tocado. La verificación final (`typecheck`/`lint`/`test`) la corre el usuario: el entorno de trabajo no puede typechequear de forma fiable por el montaje de ficheros.

---

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Archivos de código modificados | 5 |
| Archivos a eliminar (vía `git rm`) | 3 |
| Componentes simplificados | 0 (split de gigantes → documentado, no ejecutado) |
| Hooks refactorizados | 0 (sin hooks problemáticos detectados) |
| Bloques de código muerto/temporal eliminados | 3 |
| Líneas eliminadas (aprox.) | ~115 (≈50 de lógica temporal + ~65 de ficheros borrados) |
| Dependencias eliminadas | 5 (`html2canvas`, `pg`, `@types/pg`, `zod` scraper, `@sports/shared-types` api) |
| Riesgos detectados | Componentes gigantes (>1000 líneas), tipos duplicados entre paquetes |

**Estado general de salud: bueno.** El código está más sano de lo que sugiere "muchas iteraciones": **0 usos de `any`** en las 4 apps, sin ficheros huérfanos en el frontend, sin `TODO`/`FIXME` reales (los detectados eran palabras españolas tipo "TODO el calendario"), sin `try/catch` vacíos problemáticos. La deuda real está concentrada en **unos pocos componentes gigantes** y en **código de diagnóstico temporal** que se quedó dentro.

---

## Cambios realizados

### Limpieza

**1. Bloque de debug temporal en el scraper de marcadores** — `apps/scraper/src/scrapers/fep/fep-matches.scraper.ts`
Se eliminó el `console.log('[SCRAPER PARSE]', …)` y el bloque que escribía `debug-playoff.txt` en disco **en cada ciclo de scraping**. El propio comentario lo marcaba como temporal: *"Eliminar este bloque una vez identificado el selector"*. Se eliminaron también los imports `fs` y `path`, que solo se usaban ahí.

**2. Log de diagnóstico por petición en la API** — `apps/api/src/routes/match-detail.ts`
Se eliminó el bloque `console.log('[match-detail] RESPONSE for', …)` que volcaba un objeto completo (incluyendo `Object.keys(match)` y un evento de muestra) en **cada** llamada a `GET /matches/:id`. Ruido en producción, sin valor operativo. El `console.error` del `catch` se mantiene.

**3. Ficheros sueltos / temporales** (eliminar con `git rm`, ver Handoff):
- `get-season-id.ts` — script suelto en la raíz, sin ninguna referencia en el repo.
- `debug-playoff.txt` — artefacto de debug que ya nadie escribe tras el cambio (1).
- `apps/web/src/app/[locale]/sentry-test/page.tsx` — página de prueba de Sentry, routeable en producción (`/[locale]/sentry-test`), sin enlazar desde ningún sitio. El comentario decía *"Página temporal SOLO para verificar Sentry. BORRAR"*.

### Dependencias

Eliminadas por **0 imports reales** (verificado con grep sobre todo el `src` de cada workspace):

| Paquete | Workspace | Motivo |
|---|---|---|
| `html2canvas` | `apps/web` | Sustituido por render server-side con `next/og` (el propio código lo documenta). |
| `pg` + `@types/pg` | `apps/scraper` | El scraper accede a BD a través de `@sports/db`, nunca importa `pg` directo. |
| `zod` | `apps/scraper` | No se importa en ningún fichero del scraper (la migración a zod 4 solo afectaba de verdad a `apps/etl`). |
| `@sports/shared-types` | `apps/api` | Declarado pero no importado en `apps/api/src`. |

> Tras estos cambios hay que regenerar el lockfile (`npm install`). Ver Handoff.

### Tipado

Sin acción ejecutada: **0 `any`** en las apps. El tipado está centralizado y limpio. La única deuda de tipos (duplicación entre paquetes) es estructural y se documenta abajo.

### Performance

Sin optimizaciones prematuras añadidas (por diseño). La mejora de rendimiento real de esta pasada es indirecta: quitar el `writeFileSync` síncrono por ciclo en el scraper y el volcado de objeto por petición en la API reduce I/O y trabajo en caliente.

### Arquitectura / Componentes / Hooks / Organización

Sin cambios ejecutados: todo lo detectado en estas categorías implica mover código o partir componentes grandes, con riesgo de alterar comportamiento y sin posibilidad de verificar `typecheck` aquí. Se traslada íntegro a "Mejoras pendientes".

---

## Mejoras pendientes (requieren cambio con riesgo — NO ejecutadas)

Ordenadas por relación valor/riesgo. Recomendación: abordarlas de una en una, en su propia rama, con tests delante.

**1. Componentes gigantes (la deuda real).** Varios superan con creces las 250 líneas y mezclan UI + lógica de negocio + fetching:

| Fichero | Líneas |
|---|---|
| `apps/web/src/components/match/MatchCenterClient.tsx` | 1561 |
| `apps/web/src/components/competition/CompetitionClient.tsx` | 1067 |
| `apps/web/src/app/[locale]/settings/page.tsx` | 1023 |
| `apps/scraper/.../fep-ficha.scraper.ts` | 989 |
| `apps/etl/src/push-dispatcher.ts` | 862 |
| `apps/web/src/lib/api/client.ts` | 773 |
| `apps/web/src/components/competition/CompetitionsList.tsx` | 644 |
| `apps/web/src/components/team/TeamCenterClient.tsx` | 606 |

Recomendación priorizada: empezar por `MatchCenterClient.tsx`. Extraer subcomponentes ya identificables (cabecera/marcador, lista de eventos, alineaciones, tanda de penaltis, bloque de imagen-OG) y mover el fetching/estado a hooks (`useMatchDetail`, `useMatchStream`). Es el de mayor impacto en mantenibilidad. Riesgo: medio-alto (mucho estado y efectos). Hacerlo con la UI a la vista para no cambiar nada visual.

**2. Tipos duplicados entre paquetes.** `Match`, `MatchEvent`, `MatchStatus` y `NotificationPreset` están declarados en más de un sitio (`packages/shared-types` y, en paralelo, redeclarados en `apps/web/src/lib/api/client.ts`). Riesgo de drift entre el contrato real de la API y lo que el front asume. Recomendación: que `apps/web` dependa de `@sports/shared-types` y consuma esos tipos desde una sola fuente. Es un cambio de arquitectura (nueva dependencia de workspace + reescritura de imports) → fuera de esta pasada.

**3. `apps/web/src/lib/api/client.ts` (773 líneas).** Hace de capa de API + redefinición de tipos + mapeo. Trocear por dominio (`client/matches.ts`, `client/competitions.ts`, …) y apoyarse en (2) para los tipos.

**4. Logging del scraper (227 `console.log`).** Es logging operativo, no basura, por eso **no se ha tocado**. Pero conviene migrarlo a `@sports/logger` (pino, ya disponible) para tener niveles y silenciar en producción. Afecta a la salida → tratarlo como cambio consciente, no como limpieza.

**5. Dependencias mayores pendientes (Dependabot).** `node-cron` 3→4 (#7/#10), `eslint` 9→10 (#5). Requieren revisar breaking changes; no entran en una pasada de limpieza sin verificación.

---

## Riesgos y notas de verificación

- **El entorno no puede typechequear de forma fiable** (el montaje de ficheros devuelve copias truncadas de los ficheros editados). Por eso esta pasada se limita a borrados de bajo riesgo y la verificación la corre el usuario.
- Las eliminaciones de dependencias son seguras pero **deben confirmarse con `typecheck` + `build`** tras `npm install`. Si alguna rompiera (improbable, 0 imports verificados), revertir esa línea concreta del `package.json`.
- Ningún cambio toca rutas públicas, contratos de API, esquema de BD ni UI.

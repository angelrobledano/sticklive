# Home y Directos: relevancia por país y rendimiento — auditoría y plan

Fecha: 25/10/2026 · Estado: **plan pendiente de aprobación** (no se ha tocado código)

## 1. Diagnóstico

### 1.1 Cómo funciona hoy

- **No hay pestaña de Directos propia.** La home (`app/[locale]/(home)/page.tsx`) y «En directo» son la misma vista, `MatchesView`. El directo es un chip de filtro (`DayChips`, `filter='live'`).
- **Una sola petición alimenta todo.** `getCurrentMatches()` llama a `GET /matches/current` (`apps/api/src/routes/live.ts`). Devuelve todos los partidos de todas las temporadas `is_current` en la ventana [hoy−8 d, hoy+15 d]. Se pinta en SSR con `revalidate: 60`.
- **Refresco del marcador.** `useLiveScores` vuelve a pedir el `/matches/current` completo (sin caché) cada 25 s mientras haya un partido en directo o un saque en la ventana de −30 min a +3 h. La ficha de partido usa SSE. La lista no.
- **Agrupación** (`lib/day-view.ts`): se filtra por el día elegido y se arma un bloque «Siguiendo» con los equipos favoritos y un bloque por competición. Los bloques se ordenan así: ligas seguidas, después importancia (`tier`/`featured_rank`, migración 089) y después alfabético. **Todos los bloques salen desplegados** (`MatchGroupCard`, `useState(true)`).
- **Favoritos** (`hooks/useFavorites.ts`): equipos, ligas y jugadores en localStorage, sincronizados con `user_favorites` si hay sesión (magic link / Google). Los anónimos funcionan sin cuenta.
- **País.** `competitions.country` (ISO-2, `W` = mundial) está relleno en todo lo actual: ES, PT, IT y W. Además existe el árbol `federations` (migración 089). **No hay preferencia de país** en ningún sitio. `LocaleHint` solo sugiere el idioma.
- La **app móvil** (`apps/mobile`) también consume `/matches/current`. Cualquier cambio en ese endpoint tiene que ser compatible hacia atrás.

### 1.2 Problemas demostrados (medidos en producción el 25/10/2026, domingo, 11:50)

| Medida | Valor |
|---|---|
| `/matches/current`: partidos | **3.472** (144 competiciones; ES 2.964 · IT 350 · PT 149 · W 9) |
| `/matches/current`: tamaño | **3,38 MB** sin comprimir · **478 KB** transferidos (zstd) · 680 ms |
| `/matches/live` (solo directos) | 2 KB |
| HTML de la home (lleva incrustados los 3.472 partidos en el payload RSC) | **734 KB** transferidos |
| Partidos de hoy / competiciones de hoy / en directo | 380 / 90 / 2 |
| Filas pintadas / nodos DOM | 380 / 6.272 |
| TTFB / DCL / LCP (escritorio, red buena) | 241 / 863 / 876 ms |

1. **El polling es lo más caro.** Con 2 partidos en directo, cada cliente se baja 478 KB cada 25 s (unos 69 MB/hora) para refrescar dos marcadores que caben en 2 KB. En fin de semana de base hay saques todo el día, así que el sondeo no se para nunca. Lo paga el móvil del usuario (datos y batería) y el servidor (CPU de serialización).
2. **La página arrastra 23 días × 144 competiciones** para enseñar un solo día. Casi todo lo que se descarga no se ve.
3. **Todo desplegado.** 90 competiciones abiertas a la vez dan una lista de 380 filas. Encontrar tu partido obliga a hacer scroll.
4. **No hay país.** Un usuario de Portugal ve primero las competiciones españolas, porque el orden lo marcan `tier`/`featured_rank` globales y España tiene más volumen.
5. **Base y élite al mismo nivel.** Un prebenjamín de Lleida compite por espacio con la OK Liga. `tier` existe pero no se usa para plegar ni para separar secciones.

### 1.3 Hipótesis (por verificar)

- H1: el LCP en móvil de gama media y 4G será bastante peor que los 876 ms de escritorio (734 KB de HTML más la hidratación de 6.000 nodos). *Verificación:* Lighthouse móvil y web-vitals reales en PostHog (ya está integrado).
- H2: la hidratación y el re-render cada 25 s de 380 filas generan INP alto mientras hay directo. *Verificación:* el Profiler de React y el INP de web-vitals.
- H3: plegar por defecto los bloques que no son relevantes reduce el tiempo hasta el partido buscado. *Verificación:* eventos de PostHog (expandir bloque, clic en partido, tiempo hasta el clic).

### 1.4 Limitaciones y riesgos

- La app móvil depende de `/matches/current`: no se cambia su contrato, se añaden endpoints o parámetros opcionales.
- El refresco de directos no puede empeorar: el marcador de la lista tiene que seguir actualizándose. Se cambia *qué* se pide, no *si* se pide.
- La caché de 60 s de la home (#351) se mantiene. El país del usuario no puede entrar en el HTML cacheado en el edge, así que la personalización tiene que ser en cliente o ir por cookie, con cuidado de no romper la caché.
- `tier` está sin clasificar (NULL) en parte del catálogo, y la importancia depende de que esté bien rellenado.

### 1.5 Métricas base a registrar

LCP, INP y CLS (web-vitals → PostHog), bytes iniciales (HTML + API), bytes por minuto en directo, nodos y filas iniciales, tiempo hasta el primer clic en un partido, uso de la sección de favoritos y cambios de país.

## 2. Solución de producto propuesta

### 2.1 País preferido

- **Fuente de verdad:** una preferencia `country` (ES/PT/IT/…) guardada en localStorage, junto a los favoritos, y sincronizada con el servidor cuando hay sesión. Reutiliza el mismo mecanismo de `user_favorites` y no crea un sistema nuevo.
- **Primera visita:** se sugiere a partir de la *región* del navegador (`navigator.language` = `pt-PT` → PT, `es-ES` → ES, `it-IT` → IT). Nunca solo por el idioma: `pt-BR` no implica Portugal y `es-AR` no implica España. Si no hay región fiable, no se elige ninguno y se muestra el selector.
- **Cambio:** un selector de país en la cabecera de la home (chip «🇵🇹 Portugal ▾») y en Ajustes. Basta un toque y se puede cambiar cuando se quiera.
- **Sin país conocido:** orden global de hoy (importancia), con el selector visible.
- **Favoritos de otros países:** siempre arriba, por delante del país. El país ordena el resto, nunca excluye nada.

### 2.2 Jerarquía de la home (de un día)

1. **En directo ahora** de favoritos y del país, desplegado. Si no hay directo, no aparece.
2. **Siguiendo**: partidos del día de tus equipos y ligas, de cualquier país. Desplegado.
3. **Competiciones de tu país**, por importancia. Abiertas solo las de máxima categoría (tier 1–2 o destacadas). Las de base salen plegadas, con su recuento y los resultados resumidos.
4. **Otros países**: un bloque por país, plegado, con el número de partidos.
5. Enlace al catálogo completo de competiciones.

Un partido aparece en una sola sección: la primera que le corresponde en este orden. Si no hay partidos ese día, se mantiene la «Próxima jornada» de hoy, filtrada por favoritos y país.

### 2.3 Plegado

- Favoritos y directo siempre abiertos.
- El resto se abre según su importancia. El estado abierto o cerrado se recuerda durante la sesión (sessionStorage).
- Un bloque plegado no renderiza sus filas: reduce DOM y trabajo de render. Sí muestra el número de partidos y el de directos.

### 2.4 Directos

El chip «En directo» se mantiene, pero se alimenta de `/matches/live` (2 KB) y no del listado completo.

## 3. Solución técnica

- **T1 — Polling ligero.** `useLiveScores` sondea `/matches/live` y fusiona el resultado con la lista que ya tiene (`mergeMatchList` ya existe). Para los partidos que terminan (dejan de aparecer en live), una consulta corta por ids o un `/matches/current` cada pocos minutos. *Impacto:* de 478 KB a unos 2 KB por sondeo. Sin migración. Compatible con la app móvil.
- **T2 — Cargar solo el día visible.** `GET /matches/current?from=&to=` ya admite rango (`resolveCurrentWindow`). La home pide hoy en SSR y los demás días bajo demanda al cambiar de fecha, con caché en cliente por día. Para la «Próxima jornada» se pide un rango corto. *Impacto:* HTML y API de 3.472 partidos a unos 380.
- **T3 — Preferencia de país.** Hook `usePreferredCountry` (localStorage, más sincronización en `user_favorites` como tipo `country` o columna en `users`; se decide al implementar, sin borrar nada). La ordenación sigue en el cliente (`buildDayView`), con el país como criterio nuevo. Así el HTML cacheado sigue sirviendo a todos.
- **T4 — Secciones y plegado** en `day-view.ts` (lógica pura con TDD) y `MatchGroupCard` (`defaultOpen` y estado de sesión). Las filas no se montan si el bloque está plegado.
- **T5 — Instrumentación**: web-vitals a PostHog y eventos de expandir bloque, cambiar país y clic en partido.

## 4. Plan por iteraciones (en orden de impacto, confianza, esfuerzo y riesgo)

| # | Iteración | Cambios | Riesgo | Pruebas | Aceptación | Métrica |
|---|---|---|---|---|---|---|
| 0 | Línea base y métricas | web-vitals → PostHog y eventos de home | Bajo | unitarias del adaptador | Eventos visibles en PostHog | LCP/INP/CLS base |
| 1 | Polling con `/matches/live` | `useLiveScores`, `live-merge` | Medio: que un final no se refleje | TDD de la fusión (gol, inicio, final, partido que desaparece) | El marcador se actualiza igual que hoy | Bytes por minuto en directo: −99 % |
| 2 | Solo el día visible | `(home)/page.tsx`, `MatchesView`, cliente API | Medio: días vacíos y próxima jornada | Tests de `day-view` y de navegación entre días | Cambiar de día funciona y no hay peticiones duplicadas | HTML y API iniciales |
| 3 | Plegado inteligente | `day-view` (secciones), `MatchGroupCard` | Bajo | TDD de las reglas de plegado | Favoritos y directo abiertos, base plegada | Nodos DOM iniciales e INP |
| 4 | País preferido | `usePreferredCountry`, selector, Ajustes, orden en `day-view`, sincronización | Medio: sugerencia equivocada | TDD de la sugerencia por región y del orden con favoritos de varios países | Escenarios ES, PT e IT y cambio de país | Uso del selector y tiempo hasta el clic |
| 5 | Pulido visual | densidad, estados vacío/carga/error, accesibilidad | Bajo | Revisión en navegador (móvil y escritorio) | Coherente con la marca | — |

Las iteraciones 1 a 3 son las imprescindibles por rendimiento y no necesitan migraciones. La 4 puede llevar una migración aditiva (columna o tipo de favorito), nunca destructiva.

## 5. Escenarios de validación

Los 15 del brief, más uno: la app móvil sigue funcionando con `/matches/current` sin cambios.

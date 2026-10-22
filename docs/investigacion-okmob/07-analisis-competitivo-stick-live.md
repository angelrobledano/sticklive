# 07 · Análisis competitivo frente a Stick Live

**Fecha de observación:** 21/10/2026 (UTC)
**Base:** evidencia de [01](./01-inventario-producto.md)–[06](./06-comparacion-fuentes-oficiales.md) + repositorio de Stick Live.
**Confianza:** A para el código y los artefactos; B para el estado de producción cuando no se pudo verificar.

---

## 1. Resumen

OKMob y Stick Live no son el mismo producto con distinto diseño. Son dos estrategias:

- **OKMob**: visor independiente, catalán, móvil, ads-only, con una capa de identidad y reglas muy trabajada, construido sobre una CDN estática y los portales Sidgad. Su fuerza es la **cobertura FECAPA + experiencia + distribución**.
- **Stick Live**: plataforma de datos con PostgreSQL, API Hono, SSE, SSR, ER de clubes/equipos, observabilidad y una app Expo. Su fuerza es la **calidad transaccional + SEO + RFEP/World Skate histórico + modelo de negocio**.

La conclusión no es «OKMob es mejor» ni «Stick Live es mejor». Es:

> OKMob ha ganado la **carrera de experiencia y cobertura en Cataluña**. Stick Live puede ganar la **carrera de confianza, SEO y operación**, pero solo si activa FECAPA, añade catalán, completa las actas y publica la app.

---

## 2. Matriz de capacidades

Valores: **Sí**, **Parcial**, **No**, **N/D** (no determinado).

| Capacidad | OKMob | Stick Live | Comentario |
|---|---|---|---|
| Cobertura FECAPA | **Sí** (159 comps; 110 vigentes) | **Parcial** (parser/registro; activación pendiente) | La brecha más importante. |
| Cobertura RFEP | **Sí** (37 comps) | **Sí** | Stick Live tiene histórico profundo. |
| Cobertura World Skate | **Sí** (17 comps) | **Sí** | OKMob: acta profunda no verificada. |
| Cobertura FISR | **Sí** (no declarada) | **No** | Transparencia de OKMob mejorable. |
| Federaciones autonómicas FMP/FAP/FPCV/FGP | **No** | **Parcial** (registro; pendiente) | Stick Live puede superar a OKMob si las activa. |
| UI en catalán | **Sí** | **No** | Brecha directa en el mercado local. |
| Idiomas | CA/ES/EN (aprox.) | **5** (ES/EN/PT/FR/IT) | Stick Live tiene más alcance internacional; OKMob tiene el idioma local. |
| SSR/SEO de entidades | **No** (CSR) | **Sí** | Stick Live lidera. |
| Sitemap de partidos/jugadores | **No** | **Sí** | Stick Live lidera. |
| `lastmod` de datos | **No** (uniforme) | **Sí** | Stick Live lidera. |
| Directo | Polling 15 s + board 10 s | **SSE** + ETL 45 s | Ambos near-real-time; SSE más eficiente. |
| Latencia percibida | Muy buena (sin medir) | Buena (sin medir) | No hay benchmark. |
| Acta completa | **Parcial** (4 eventos en la muestra) | **Parcial** (actas en proceso) | Ninguno puede prometer «acta completa» hoy. |
| Tarjetas/banquillo | **Parcial** (banquillo sí; jugador a cero) | **Parcial** (sin `yellow_card` en el check) | Gap de modelo en ambos. |
| Reglamento como datos | **Sí** (43 + 23 reglas) | **No** | OKMob lidera. |
| Identidad de jugador entre federaciones | **Sí** (1.004; 85,2 %) | **No** | OKMob lidera. |
| Identidad de club entre federaciones | **Parcial** (56 mappings) | **Parcial** (ER documentado) | Enfoques distintos. |
| Comparador/H2H | **Sí** | **Parcial** (`PreviousMeeting`) | OKMob tiene página dedicada. |
| Pabellón/geolocalización | **Sí** (`/pv/:venue`, GEO) | **Parcial** (`venue_name`/`venue_city`) | OKMob lidera. |
| Meteorología | **Sí** (MET Norway) | **No** | Nice-to-have. |
| Calendario `.ics` | **Sí** (equipo) | **No** | Bajo coste, alto valor. |
| Live Activities | **Sí** (iOS) | **No** | OKMob lidera. |
| App en tiendas | **Sí** | **No/No verificado** | OKMob lidera. |
| Cuenta y sincronización | **No** | **Sí** | Stick Live lidera. |
| Premium/pagos | **No** (ads-only) | **Sí** (Stripe) | Stick Live lidera. |
| Push nativo | **Sí** | **Sí** | Paridad. |
| Push web con pestaña cerrada | **No (declarado)** | **Sí** (push web/nativo) | Stick Live lidera. |
| Offline | **Sí** (IndexedDB/caches) | **Parcial** (app Expo) | OKMob tiene más rodaje. |
| Observabilidad/CI | **Parcial** (beacons; sin estado público) | **Sí** (Sentry/PostHog, tests/CI) | Stick Live lidera. |
| Histórico RFEP | **Parcial** (`arxiu`) | **Sí** (1999–2025) | Stick Live lidera. |
| Modelo de datos | Documentos ad hoc | PostgreSQL normalizado | Stick Live lidera. |
| Coste por lectura | **Muy bajo** | Moderado | OKMob lidera. |
| Transparencia de fuentes | **Parcial** (FISR no declarada) | **Sí** (docs, aunque con imprecisión JSON/HTML) | Ambos tienen deberes. |

---

## 3. Fortalezas y debilidades

### 3.1 OKMob

**Fortalezas**

- **Cobertura FECAPA**: 159 competiciones, 110 vigentes, categorías base. Es el producto que un aficionado catalán necesita.
- **Catalán primero**: idioma, nombres, navegación y contenidos. Stick Live no lo tiene.
- **Reglamento como datos**: zonas, cascadas, fuentes y notas. Es una función difícil de copiar y muy visible en la clasificación.
- **Identidad de jugador**: 1.004 personas, 855 multi-federación. Permite agregar carrera, comparar y cruzar RFEP/FECAPA/World Skate.
- **UX móvil**: rápida, offline, Live Activities, push, calendario `.ics`, comparador, pabellón/tiempo.
- **Distribución**: App Store, Google Play y PWA. Stick Live aún no.
- **Coste**: CDN estática + worker; marginal por lectura muy bajo.
- **Caché**: TTLs bien pensados para directo, histórico y reglas.

**Debilidades**

- **Acta incompleta** en la muestra: 4 eventos vs acta oficial; tarjetas/faltas de jugador a cero.
- **CSR/SEO frágil**: rutas profundas con canonical de portada; sitemap sin partidos/jugadores; `lastmod` uniforme.
- **Sin cuenta**: seguidos y preferencias locales; no hay sincronización.
- **Ads-only**: dependencia de AdSense/AdMob; sin ingresos recurrentes.
- **Búsqueda limitada** a la temporada actual (declarado).
- **Sin push web** con la pestaña cerrada (declarado en la FAQ).
- **FISR no declarada** y términos opacos sobre el archivo/copia.
- **Namespace frágil**: `idc=260` devuelve otra federación.
- **Cache inmutable de un año** sin plan de rollback visible.
- **Un solo desarrollador** (persona física): riesgo de continuidad.
- **Dependencia total de Sidgad HTML**: un cambio de maquetación rompe la ingesta.

### 3.2 Stick Live

**Fortalezas**

- **SSR/SEO**: Next.js, sitemap por secciones, `lastmod` de datos, `hreflang` por locale, páginas de competición/equipo/jugador/temporada/partido.
- **Modelo transaccional**: PostgreSQL, migraciones, claves, particiones, tests de integración.
- **RFEP/World Skate**: cobertura oficial e histórico profundo.
- **SSE**: directo eficiente y push por partido.
- **ER de clubes/equipos**: `team_aliases`, `source_ref`, resolución documentada.
- **Observabilidad/CI**: Sentry/PostHog, typecheck, lint, tests, auditoría, build.
- **Producto**: auth, favoritos, premium/Stripe, push, admin.
- **App Expo**: paridad funcional, 5 idiomas, arquitectura más nativa que Capacitor.
- **Cinco idiomas**: alcance internacional.

**Debilidades**

- **Sin catalán**: brecha en el mercado principal de FECAPA.
- **FECAPA no activa**: el código existe, pero la cobertura no; según la documentación interna, no verificado en producción.
- **Sin crosswalk de jugadores**: OKMob ya tiene 1.004 personas.
- **Sin reglamento como datos**.
- **Sin `.ics`**.
- **Sin tabla de pabellones/geolocalización**.
- **Sin Live Activities**.
- **App no publicada** (según la documentación interna).
- **Actas en proceso**: no se puede prometer acta completa.
- **Sin comparador dedicado** (solo `PreviousMeeting`).
- **Documentación imprecisa** en al menos un punto: dice «APIs JSON internas» donde el cliente usa PHP/HTML.

---

## 4. Qué no copiar de OKMob

1. **CSR con canonical de portada.** Es un lastre SEO. Stick Live debe mantener SSR/ISR y metadatos por entidad.
2. **Sitemap uniforme.** Un `lastmod` igual para 2.958 URLs no ayuda a los buscadores. Stick Live ya deriva `lastmod` de los datos; conservarlo.
3. **Reescritura completa como CDN estática.** OKMob puede hacerlo porque es solo lectura. Stick Live tiene auth, favoritos, premium, push y SSE; una CDN estática no cubre eso.
4. **Modelo ads-only.** Stick Live tiene premium/Stripe; no debe degradar la experiencia para imitar un modelo de ingresos inferior.
5. **Asistente LLM amplio sin base determinista.** OKMob tiene un clasificador local + fallback; el coste/riesgo no está probado. Stick Live debe empezar por respuestas deterministas y citadas.
6. **Previsión sin calibración.** Un motor Poisson es fácil de implementar y difícil de validar. No lanzarlo sin backtesting y sin etiqueta de incertidumbre.
7. **Ticker HTML inyectado.** Es cómodo, pero es un riesgo de XSS y de fragilidad. Mejor parsear a datos.
8. **Cache inmutable de un año sin rollback.** Si se publica un error, queda un año. Stick Live debe tener versionado + purga.
9. **Búsqueda limitada a la temporada actual.** Stick Live puede hacer búsqueda global con entidades e histórico.
10. **Publicar fecha de nacimiento sin revisión de privacidad.** OKMob lo hace; no significa que sea correcto.
11. **Scraping de OKMob.** Sus términos lo prohíben y su acta es incompleta. Usar fuentes oficiales.

---

## 5. Implicaciones estratégicas

### 5.1 La materia prima es común; la ventaja es la capa de producto

OKMob y Stick Live leen Sidgad. Ninguno tiene exclusividad. La ventaja sostenible está en:

- **Cobertura** (qué federaciones y categorías).
- **Identidad** (personas, clubes, partidos).
- **Confianza** (actas completas, fuentes citadas, errores explícitos).
- **Experiencia** (idioma, móvil, directo, calendario).
- **Distribución** (tiendas, SEO, notificaciones).

La guerra no es por el dato; es por la **interpretación** del dato.

### 5.2 Cataluña es el campo de batalla inmediato

OKMob es catalán primero, cubre FECAPA y está en las tiendas. Stick Live no tiene catalán ni FECAPA activa. En el mercado local, OKMob tiene una ventaja de producto difícil de revertir solo con SEO.

**Movimiento:** activar FECAPA + añadir catalán es la combinación de mayor impacto y menor coste relativo. Ya hay parser, registro y fixture; falta operación y traducción.

### 5.3 La identidad de jugador es una ventaja que se compone

OKMob tiene 1.004 personas cruzadas y 85,2 % multi-federación. Cada temporada que pasa, su crosswalk mejora y su capacidad de agregar carrera/comparar aumenta. Stick Live tiene `players.source_ref`, pero no un mapa entre fuentes.

**Movimiento:** crear `player_source_map` con `person_id`, `source`, `source_player_id`, `confidence`, `method`, `reviewed_at`; empezar por los jugadores que aparecen en RFEP + FECAPA + World Skate. Es un trabajo de datos, no de UI, y habilita palmarés, H2H y comparador.

### 5.4 La confianza es la debilidad de OKMob

OKMob publica 4 eventos donde el acta oficial tiene decenas; no marca la falta como «acta resumida»; su sitemap dice que todo se actualizó el mismo día. Stick Live puede ganar en **transparencia**:

- Mostrar `events_complete` y `source_detail_level`.
- Enlazar al acta oficial.
- Explicar qué falta y por qué.
- No prometer «acta completa» si no lo es.

Esto es más valioso que igualar el asistente o la previsión.

### 5.5 La app es una deuda de distribución, no de código

La app Expo de Stick Live tiene paridad funcional en código y builds locales en verde, pero el release sigue pendiente. OKMob ya está en tiendas, con Live Activities. Cada mes sin app es un mes de ventaja para OKMob en el móvil.

**Movimiento:** priorizar el release (EAS, TestFlight/Play interno, ficha, push, deep links) por encima de nuevas funciones web.

### 5.6 No competir en alcance, competir en profundidad

OKMob tiene asistente, previsión, meteorología y comparador. Stick Live no necesita todo eso para ganar. Necesita:

- Cobertura FECAPA.
- Catalán.
- Actas completas y verificables.
- Identidad de jugador.
- Reglamento.
- App publicada.
- SEO/SSR que ya tiene.

El resto es opcional.

---

## 6. Escenarios

### 6.1 Escenario base (12 meses)

- Stick Live activa FECAPA y catalán.
- OKMob mantiene su ventaja en Live Activities y experiencia móvil.
- Stick Live gana en SEO, RFEP/World Skate histórico y confianza de actas.
- La lucha se desplaza a la calidad del dato y la retención.

### 6.2 Escenario favorable a Stick Live

- Stick Live publica la app y añade Live Activities.
- Activa FMP/FAP/FPCV/FGP antes que OKMob.
- Completa actas y reglamento.
- OKMob no puede seguir el ritmo por su modelo estático y su equipo unipersonal.

### 6.3 Escenario favorable a OKMob

- Stick Live retrasa FECAPA/catalán/app.
- OKMob mejora SEO/SSR y añade cuentas/sincronización.
- OKMob amplía a FISR/Portugal y se convierte en el «default» catalán.
- Stick Live queda como producto de nicho para RFEP/World Skate.

---

## 7. Recomendación de posicionamiento

**Stick Live no debería posicionarse como «el OKMob con más datos».** Debería posicionarse como:

> «El hockey sobre patines en directo, con la cobertura oficial de RFEP y World Skate, datos verificables, actas completas cuando la fuente lo permite y una experiencia en tu idioma.»

Atributos:

- **Oficial y verificable** (frente al visor independiente).
- **Completo** (frente a la cronología parcial).
- **Multi-federación** (frente a la especialización catalana).
- **Multiidioma** (incluido catalán).
- **Multiplataforma** (web SSR + app).

No hace falta imitar el asistente ni la previsión para tener una propuesta clara.

---

## 8. Riesgos competitivos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| OKMob añade SSR/SEO | Media | Alto | Mantener ventaja SSR y publicar entidades; no copiar CSR. |
| OKMob añade cuentas/sync | Baja/Media | Medio | Stick Live ya tiene auth; usarlo. |
| OKMob amplía a FISR/Portugal | Media | Medio | Cobertura multi-federación y ER. |
| OKMob mejora actas | Media | Alto | Ser el primero en actas verificables y completas. |
| Sidgad cambia el HTML | Alta | Alto | Parsers robustos, tests, alertas, no depender de selectores frágiles. |
| Stick Live retrasa la app | Media | Alto | Release EAS como prioridad. |
| Stick Live no activa FECAPA | Media | Alto | Ejecutar el piloto ya existente. |
| Confusión legal/ToS | Baja | Medio | No ingerir OKMob; usar fuentes oficiales. |

---

## 9. Conclusión

OKMob es un competidor creíble en el mercado catalán: cubre FECAPA, habla catalán, está en las tiendas y ha construido capas de producto (reglas, identidad, comparador, Live Activities) que Stick Live no tiene. Su debilidad es la profundidad y la transparencia del dato, y su arquitectura estática limita su capacidad de convertirse en plataforma transaccional.

Stick Live tiene la mejor base técnica y el mejor SEO, pero le faltan cuatro cosas concretas: **FECAPA, catalán, actas verificables y app publicada**. Si las resuelve, no necesita copiar a OKMob; puede superarlo en el eje que más importa a largo plazo: **confianza**.

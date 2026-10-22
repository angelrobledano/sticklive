# 09 · Evidencias, confianza y reproducción

**Fecha de cierre:** 21/10/2026 (UTC)
**Objetivo:** dejar trazabilidad de qué se observó, cómo, con qué confianza y qué queda sin resolver. Este documento no añade hallazgos nuevos: ordena la evidencia de [01](./01-inventario-producto.md)–[08](./08-recomendaciones.md).

---

## 1. Regla de evidencia

Una afirmación solo se presenta como **hecho** si cumple una de estas condiciones:

1. Se leyó en una respuesta HTTP pública (cabeceras, cuerpo, redirección).
2. Se leyó en el DOM de una página pública o en el bundle JavaScript servido por el sitio.
3. Se leyó en el repositorio de Stick Live (código, migraciones, tests, documentación).
4. Se contrastó con un portal oficial de una federación en una muestra pequeña y razonada.

Todo lo demás es **inferencia** y se marca como B. Las afirmaciones del operador son **declaraciones** (C) hasta que un artefacto las corrobora. Lo que no se pudo verificar es **D** y se deja explícito; no se rellena con plausibilidad.

---

## 2. Registro de evidencias

### 2.1 Artefactos principales

| Evidencia | Ubicación | Fecha/hora (UTC) | Método | Confianza |
|---|---|---|---|---|
| Landing y metadatos | `https://okmob.app/` | 21/10/2026 | HTTP + DOM | A |
| `robots.txt` | `https://okmob.app/robots.txt` | 21/10/2026 | HTTP | A |
| `sitemap.xml` (2.958 URLs) | `https://okmob.app/sitemap.xml` | 21/10/2026 | HTTP + parseo | A |
| Configuración y flags | `https://push.okmob.app/config.json` | 21/10/2026 | HTTP | A |
| Catálogo de competiciones | `https://push.okmob.app/comps` | 21/10/2026 16:04 | HTTP | A |
| Calendario FECAPA `4858` | `https://push.okmob.app/calendar.json?idc=4858` | 21/10/2026 | HTTP | A |
| Calendario RFEP `R3575` | `https://push.okmob.app/calendar.json?idc=R3575` | 21/10/2026 | HTTP | A |
| Calendario World Skate `W260` | `https://push.okmob.app/calendar.json?idc=W260` | 21/10/2026 | HTTP | A |
| Colisión `idc=260` | `https://push.okmob.app/calendar.json?idc=260` | 21/10/2026 | HTTP | A |
| Clasificación FECAPA | `https://push.okmob.app/standings.json?idc=4858` | 21/10/2026 | HTTP | A |
| Acta FECAPA `164291` | `https://push.okmob.app/acta.json?idp=164291&idc=4858` | 21/10/2026 | HTTP | A |
| Archivo de acta | `https://live.okmob.app/arc/acta/164291/1b07bce2a1a06171.json` | 21/10/2026 | HTTP | A |
| Reglamento | `https://push.okmob.app/rules.json?v=7` | 21/10/2026 | HTTP | A |
| Goleadores | `https://push.okmob.app/scorers.json?idc=4858` | 21/10/2026 | HTTP | A |
| Perfil de jugador | `https://push.okmob.app/profiles.json?...` | 21/10/2026 | HTTP | A |
| Crosswalk de personas | `https://live.okmob.app/ref/person-xwalk.json` | 21/10/2026 | HTTP | A |
| Calendario `.ics` | `https://push.okmob.app/team.ics?id=...` | 21/10/2026 | HTTP | A |
| Manifiesto de directo | `https://live.okmob.app/live/board.json` | 21/10/2026 16:58:32 | HTTP | A |
| Índice caliente | `https://live.okmob.app/live/docs/d38611cd042ec1b5.json` | 21/10/2026 | HTTP | A |
| Bundle de directo | `https://live.okmob.app/live/x/100b9e666a099cdb.json` | 21/10/2026 | HTTP | A |
| Ticker FISR | `https://push.okmob.app/ticker?f=fisr` | 21/10/2026 | HTTP | A |
| Bundle JS principal | `https://okmob.app/assets/index-DaXZKQVK.js` | 21/10/2026 | HTTP | A |
| Chunk de consultas | `https://okmob.app/assets/queries-X981_b0k.js` | 21/10/2026 | HTTP | A |
| Chunk del asistente | `https://okmob.app/assets/AssistantScreen-Cp7oTiy_.js` | 21/10/2026 | HTTP | A |
| Chunk de push | `https://okmob.app/assets/push-CVdkmiEk.js` | 21/10/2026 | HTTP | A |
| Ficha App Store | `https://apps.apple.com/es/app/id6803087016` | 21/10/2026 | HTTP + DOM | A |
| Ficha Google Play | `https://play.google.com/store/apps/details?id=app.okmob.mobile` | 21/10/2026 | HTTP + DOM | A |
| Términos | `https://okmob.app/legal/termes` | 21/10/2026 | DOM | C |
| «Sobre» | `https://okmob.app/info/sobre` | 21/10/2026 | DOM | C |
| FAQ | `https://okmob.app/info/faq` | 21/10/2026 | DOM | C |
| Portal FECAPA | `https://www.hoqueipatins.fecapa.cat/league/4858` | 21/10/2026 | Navegador | A |
| Acta oficial FECAPA | `https://www.server2.sidgad.es/fecapa/fecapa_gr_164291_1.php` | 20–21/10/2026 | Navegador (sesión) | A |
| Portal RFEP | `https://www.hockeypatines.fep.es/league/R3575` | 21/10/2026 | Navegador | A |
| Portal World Skate | `https://wse.sidgad.com/league/W260` | 21/10/2026 | Navegador | A |
| Stick Live: locales | `apps/web/src/lib/locales.ts` | 21/10/2026 | Repositorio | A |
| Stick Live: sitemap | `apps/web/src/lib/sitemap.ts` | 21/10/2026 | Repositorio | A |
| Stick Live: cliente Sidgad | `apps/scraper/src/scrapers/fep/sidgad-client.ts` | 21/10/2026 | Repositorio | A |
| Stick Live: federaciones | `apps/etl/src/federations.ts` | 21/10/2026 | Repositorio | A |
| Stick Live: eventos | `packages/db/migrations/008_foul_event_types.sql`, `047_partition_match_events.sql` | 21/10/2026 | Repositorio | A |
| Stick Live: app | `docs/app.md`, `apps/mobile` | 21/10/2026 | Repositorio | A/B |

### 2.2 Cuerpos crudos

Los cuerpos completos están en `.tmp-okmob/bodies` (45 archivos, ~5,14 MB). Es un directorio de trabajo **no versionado**; no forma parte del informe y no debe commitearse.

Los nombres siguen el patrón `host_ruta` para poder auditar la respuesta exacta. Ejemplos:

- `push.okmob.app_comps`
- `push.okmob.app_calendar.json_idc_R3575`
- `live.okmob.app_live_board.json`
- `live.okmob.app_live_docs_d38611cd042ec1b5.json`
- `live.okmob.app_live_x_100b9e666a099cdb.json`
- `push.okmob.app_ticker_f_fisr`
- `okmob.app_sitemap.xml`
- `apps.apple.com_es_app_id6803087016`
- `play.google.com_store_apps_details_id_app.okmob.mobile_hl_es`

### 2.3 Scripts de evidencia

Los scripts `.mjs` de `.tmp-okmob/` se usaron para:

- Descargar y guardar respuestas (`probe.mjs`, `deep.mjs`).
- Parsear el sitemap y contar URLs (`sitemap.mjs`).
- Extraer rutas, endpoints y claves del bundle (`bundle*.mjs`, `routes.mjs`, `endpoints.mjs`).
- Analizar el crosswalk (`xwalk*.mjs`).
- Verificar el `.ics` (`ics.mjs`).
- Inspeccionar el protocolo de directo (`livecode*.mjs`).

No son herramientas de producción ni se integran en el repositorio. Se conservan solo como trazabilidad local.

---

## 3. Notas de reproducción

### 3.1 Requisitos

- Node.js 20+ (los scripts usan `fetch` nativo).
- Acceso a Internet.
- Navegador de escritorio para los portales oficiales que requieren sesión.
- No se necesita cuenta, token ni cookie propia.

### 3.2 Ejemplo mínimo

```powershell
# Manifiesto de directo
Invoke-RestMethod https://live.okmob.app/live/board.json | ConvertTo-Json -Depth 6

# Catálogo (grande; guardar, no imprimir entero)
Invoke-WebRequest https://push.okmob.app/comps -OutFile .tmp-okmob/bodies/comps.json

# Acta de la muestra
Invoke-WebRequest "https://push.okmob.app/acta.json?idp=164291&idc=4858" -OutFile .tmp-okmob/bodies/acta-164291.json
```

En los scripts `.mjs` se usó `fetch` y `fs.writeFileSync`; el patrón es el mismo.

### 3.3 Comparación oficial

1. Abrir el portal oficial de la federación en el navegador.
2. Navegar a la competición y al partido.
3. Copiar los campos relevantes a mano (marcador, árbitros, eventos, faltas, tarjetas).
4. Contrastar con la respuesta de OKMob.
5. Anotar la fecha/hora y la URL exacta.

La muestra FECAPA se hizo así porque el acta oficial está **gated por sesión**: un `fetch` directo devuelve 0 bytes. El navegador, en cambio, la carga. Esa limitación es relevante para la reproducibilidad: no se puede automatizar la comparación sin credenciales, y no se usaron.

### 3.4 Límites de tasa y ética

- Se hicieron peticiones de bajo volumen, sin concurrencia agresiva, sin reintentos masivos y sin crawling.
- No se descargó el sitio completo ni se reutilizó contenido.
- Se respetaron los términos de OKMob, que prohíben el scraping de su producto. La auditoría se limitó a una muestra razonada.
- No se evadió autenticación, CAPTCHA, geobloqueo ni limitación de tasa.
- No se probaron endpoints de escritura (`/chat`, `/event`, `/report`).
- No se hizo prueba de carga.

---

## 4. Redacciones y privacidad

Se han redactado u omitido:

| Dato | Dónde aparece | Tratamiento |
|---|---|---|
| Correo de contacto del operador | JSON-LD de la landing y página «Sobre» | Redactado; no se reproduce. |
| Fecha de nacimiento de jugadores | Perfiles públicos | Redactada; solo se menciona que el campo existe. |
| Identificadores de Firebase | CSP y bundle | Redactados; no se reproducen. |
| IDs de AdSense/AdMob | CSP, HTML y bundle | Redactados; no se reproducen. |
| Tokens, cookies, claves | Cabeceras/respuestas | No se guardaron ni se reproducen. |
| Datos de contacto personales | Fichas de tienda/legales | No se usan salvo el nombre público del desarrollador. |

**Nombres de jugadores, árbitros y entrenadores:** se usan solo como evidencia deportiva de la comparación FECAPA. Son datos públicos del acta; no se listan de forma exhaustiva ni se cruzan con información privada.

**Coordenadas y direcciones:** no se publican direcciones personales. Las sedes deportivas son lugares públicos; aun así, el informe evita reproducir geolocalizaciones innecesarias.

---

## 5. Incógnitas y preguntas abiertas

| # | Incógnita | Por qué importa | Cómo verificarla | Confianza actual |
|---|---|---|---|---|
| 1 | ¿La cronología incompleta es parser o decisión de producto? | Afecta a la promesa de «acta completa». | Comparar 10–20 actas de competiciones distintas y revisar el parser. | D |
| 2 | ¿World Skate tiene el mismo detalle que FECAPA? | Es una de las tres fuentes declaradas. | Conseguir una sesión de portal y comparar 3 actas. | D |
| 3 | ¿FISR es permanente o experimental? | No está en los términos; puede ser cobertura efímera. | Seguir el ticker y el catálogo durante varias semanas. | B |
| 4 | ¿Cómo se genera el `person-xwalk`? | La precisión del cruce no se puede auditar. | Entrevista/observación; no hay documentación pública. | D |
| 5 | ¿Los 56 mappings de club son exhaustivos? | Afecta a la agregación por club. | Cruzar clubes de FECAPA/RFEP/WSE y medir cobertura. | B |
| 6 | ¿Dónde almacena el worker? ¿R2, KV o ambos? | Explica la inmutabilidad y el coste. | No es observable desde fuera; requiere información del operador. | D |
| 7 | ¿Cómo se purga un hash incorrecto? | Un error puede quedar cacheado un año. | Probar un cambio controlado; no se hizo. | D |
| 8 | ¿`/chat`, `/event` y `/report` tienen rate limit? | Riesgo de abuso/coste. | No se probaron; requeriría autorización. | D |
| 9 | ¿`/debug` está protegido en producción? | Podría exponer información interna. | No se auditó; no se debe probar sin permiso. | D |
| 10 | ¿El ticker HTML se sanea? | Riesgo de XSS. | Revisar el render interno; no se inspeccionó el DOM con payloads. | D |
| 11 | ¿Cuál es la latencia real frente a Sidgad? | No se midió extremo a extremo. | Instrumentar worker + fuente en un partido en vivo. | D |
| 12 | ¿Stick Live tiene FECAPA activa en producción? | El repositorio no lo prueba. | Revisar producción/feature flags con el equipo. | D |
| 13 | ¿La app de Stick Live está publicada? | `docs/app.md` describe pasos pendientes, no el estado actual. | Revisar tiendas y EAS. | D |
| 14 | ¿OKMob tiene algún acuerdo con las federaciones? | Los términos dicen que es independiente. | No hay evidencia pública; no se asumió. | C |

---

## 6. Contradicciones y limitaciones documentadas

### 6.1 FISR no declarada

- Los términos, «Sobre» y FAQ nombran FECAPA, RFEP y World Skate Europe.
- El bundle activa `fedFisr`, el ticker responde y hay un partido FISR en el documento `x`.
- **No es una prueba de ilegalidad**, pero sí una brecha de transparencia sobre las fuentes.

### 6.2 «No mantiene copia propia» vs archivo inmutable

- «Sobre» declara que OKMob no mantiene copia propia.
- `acta.json` redirige a `live.okmob.app/arc/acta/...` con `max-age=31536000, immutable`.
- `config.flags.arcActa` está en `true`.
- **Interpretación:** puede que la frase se refiera a no tener una base de datos propia, pero técnicamente hay un snapshot normalizado y cacheado durante un año. La formulación es ambigua.

### 6.3 Stick Live: «APIs JSON internas» vs PHP/HTML

- `docs/pipeline-datos.md` describe los endpoints de Sidgad como «APIs JSON internas».
- El cliente real (`apps/scraper/src/scrapers/fep/sidgad-client.ts`) hace GET/POST a `{portal}_*.php`, mantiene cookies y devuelve **texto**; los parsers trabajan con HTML.
- **Acción:** corregir la documentación. No es un fallo funcional, pero induce a error sobre el contrato de la fuente.

### 6.4 Sitemap con `lastmod` uniforme

- 2.958 URLs comparten `lastmod` 2026-10-21.
- El contenido cambia a diario en partidos y clasificaciones.
- **Lectura:** el `lastmod` no refleja la frescura real; es una señal SEO débil. Stick Live ya deriva `lastmod` de los datos y no debería copiar este patrón.

### 6.5 El falso positivo `P10`

- OKMob devuelve `clockPeriod: "P10"`.
- El acta oficial también muestra `P10 00:00`.
- **No es un bug.** Cualquier informe que lo marque como error está mal.

### 6.6 World Skate bloqueado

- El portal oficial carga, pero no abrió la competición 260 en la sesión.
- Las rutas directas devolvieron 404/0 bytes.
- **No se concluye** que OKMob falle; simplemente no hay evidencia profunda.

### 6.7 Muestra pequeña

- 1 acta FECAPA profunda + 7 resultados RFEP + 1 intento World Skate + 1 partido FISR.
- Es suficiente para detectar una diferencia material (acta incompleta) y para confirmar resultados, pero **no** para afirmar fidelidad universal.
- Las conclusiones se limitan a la muestra y se marcan como tales.

---

## 7. Calibración de la confianza

| Nivel | Se usó para | Ejemplos | No se usó para |
|---|---|---|---|
| **A** | Respuestas HTTP, cabeceras, bundle, repositorio, portal oficial | `board.json`, `comps`, `person-xwalk`, `team.ics`, migraciones, acta oficial | Inferir intención del operador. |
| **B** | Conclusión a partir de varios artefactos | Pipeline worker → CDN, almacenamiento de objetos, plugins nativos, latencia aproximada | Afirmar una arquitectura interna no observada. |
| **C** | Declaraciones del operador | Términos, «Sobre», FAQ, ficha de tienda | Probar que la declaración es cierta. |
| **D** | No verificado | Acta World Skate, tráfico móvil, purga de caché, rate limits de escritura | Rellenar con suposiciones. |

**Regla práctica:** si una frase empieza por «OKMob hace…» y no tiene A o B, se reformula como «OKMob declara…» (C) o «no se sabe…» (D).

---

## 8. Glosario

| Término | Significado en este informe |
|---|---|
| **Sidgad** | Plataforma y portales PHP que alimentan FECAPA, RFEP, World Skate y FISR. |
| **`idc`** | ID de competición en Sidgad. FECAPA numérico; RFEP `R`; World Skate `W`; FISR `I`. |
| **`idp`** | ID de partido/acta en Sidgad. |
| **`fx`** | Identidad compuesta de partido que usa OKMob: `{idc}|{iso}|{homeTeamId}|{awayTeamId}`; puede llevar `|tHH:MM`. |
| **`av`** | Versión/hash del acta; cambia cuando cambia el contenido. |
| **`pv`** | Hash del pabellón en el bundle de directo. |
| **`temp`** | ID de temporada Sidgad (39 = 2025/26; 41 = 2026/27). |
| **Acta** | Documento oficial del partido con marcador, árbitros, eventos, faltas y tarjetas. |
| **FD** | Falta directa. |
| **`P10`** | Etiqueta de periodo del acta oficial para el estado final; no es un error de OKMob. |
| **Play-off / play-out** | Fases de ascenso/descenso; OKMob las modela en `rules.json`. |
| **Cascada** | Recalculo de zonas de descenso según el número de ascensos (`byN`). |
| **Door** | Réplica de fallback en `okmob-door-*.pages.dev`. |
| **Hot / cold** | Índices de documentos con ventanas de validez; `hot` es el conjunto activo. |
| **`board.json`** | Manifiesto de directo con punteros a documentos y `nextPoll`. |
| **`x/{hash}.json`** | Bundle de directo con partidos, actas, tickers y días. |
| **`stale`** | Indicador de dato servido desde una copia vieja. |
| **CSR / SSR** | Render en cliente / render en servidor. OKMob es CSR; Stick Live es SSR. |
| **SSE** | Server-Sent Events; transporte de directo de Stick Live. |
| **`.ics`** | Formato iCalendar; OKMob lo usa para suscripción de equipo. |
| **Live Activity** | Notificación persistente de iOS en pantalla bloqueada/Dynamic Island. |

---

## 9. Cadena de custodia

1. **Observación:** 21/10/2026, desde el entorno de trabajo, con red pública.
2. **Captura:** respuestas guardadas en `.tmp-okmob/bodies`; scripts en `.tmp-okmob/*.mjs`.
3. **Análisis:** extracción de campos, conteos y comparación manual con portales oficiales.
4. **Redacción:** informe en `docs/investigacion-okmob/` (01–09 + README).
5. **Verificación:** enlaces internos, Mermaid, ausencia de secretos, estado de git.
6. **Publicación:** no se publica nada fuera del repositorio; no se commitea sin decisión del usuario.

**No se modificó** ningún dato de producción, ni de OKMob, ni de Stick Live. No se ejecutaron migraciones ni se tocó la base de datos.

---

## 10. Checklist de cierre

- [x] Nueve documentos + README en `docs/investigacion-okmob/`.
- [x] Cada conclusión importante tiene evidencia, fecha y confianza.
- [x] Observado, inferido, declarado y desconocido están separados.
- [x] Sin correo, fecha de nacimiento, IDs de Firebase/AdSense, tokens ni cookies.
- [x] Sin endpoints inventados: solo los observados o los marcados como no verificados.
- [x] Sin cambios en producción ni en datos.
- [x] `.tmp-okmob/` queda como evidencia local no versionada.
- [x] Enlaces internos (16) y Mermaid (4) verificados (ver sección 11).
- [x] `git diff` vacío en tracked; solo nuevos no versionados y un directorio local ajeno a la auditoría.

---

## 11. Verificación final

| Comprobación | Resultado | Fecha |
|---|---|---|
| Enlaces relativos entre documentos | 16/16 resueltos; 0 roto | 21/10/2026 |
| Bloques Mermaid | 4 bloques; tipos válidos y fences balanceados | 21/10/2026 |
| Secretos/PII | 0 coincidencias de correo/API keys; IDs y fecha de nacimiento redactados | 21/10/2026 |
| `git diff` | Vacío en tracked; 0 archivos modificados | 21/10/2026 |
| Estado de archivos no versionados | `.tmp-okmob/`, `docs/investigacion-okmob/` y `apps/web/src/app/[locale]/upcoming-preview/` (este último ajeno a la auditoría y no modificado) | 21/10/2026 |

---

## 12. Qué cambiaría las conclusiones

- Que Stick Live ya tenga FECAPA activa en producción: reduciría la brecha de cobertura a cero.
- Que la app de Stick Live ya esté publicada: eliminaría la ventaja de distribución de OKMob.
- Que el acta FECAPA `164291` sea una excepción y el resto esté completo: debilitaría la conclusión sobre actas incompletas.
- Que World Skate tenga actas completas y verificables: reforzaría la cobertura europea de OKMob.
- Que el `person-xwalk` tenga baja precisión: reduciría el valor de la ventaja de identidad.
- Que el worker publique con menos frecuencia que la observada: cambiaría la lectura sobre latencia.
- Que OKMob añada SSR/SEO y cuentas: cambiaría el equilibrio competitivo.

Mientras estas condiciones no se verifiquen, las conclusiones se mantienen en el ámbito de la muestra y de la evidencia disponible.

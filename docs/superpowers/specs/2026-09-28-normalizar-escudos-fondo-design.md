# Normalizar los escudos (fondo sólido, recorte y tamaño)

- **Fecha:** 2026-09-28
- **Estado:** diseño aprobado, pendiente de plan de implementación
- **Ámbito:** `apps/etl` (normalizador + pipeline de escudos) y `apps/web`
  (`TeamShield`, imagen OG)
- **Origen:** petición de producto — «los escudos hay que rellenarlos con un
  fondo para que se vean bien; unos están con transparencias y hay que
  normalizarlos».

## Problema

Los escudos se guardan como PNG en `apps/web/public/escudos/{teamId}.png` (los
escribe el ETL con `download-logos` / la entidad `download-logos` de
`run-pipeline`) y se sirven por `GET /teams/:id/logo` (API sobre el volumen
compartido, con proxy del CDN como fallback).

Evidencia medida sobre los 366 PNG actuales:

- **288 de 366 (≈79 %)** tienen transparencia.
- Muchos son enormes: hasta 4624×4624 y >1 MB.
- Margen transparente irregular: unos escudos llenan el lienzo y otros quedan
  diminutos por márgenes vacíos.

Consecuencia visual: en superficies oscuras (modo oscuro de la web y tarjeta OG
con fondo `#0b1220`) los escudos de colores oscuros **desaparecen o pierden
contraste**, y el tamaño aparente de los escudos es inconsistente.

## Objetivo

Que cualquier escudo se vea legible sobre cualquier fondo (claro, oscuro y
tarjeta OG), con un tamaño visual consistente y con menos peso, sin cambiar el
modelo de datos ni la resolución de escudos de la API.

## Decisiones

1. **Relleno en blanco `#ffffff`.** Es el estándar para escudos y maximiza el
   contraste con cualquier color de crest, tanto en claro como en oscuro.
2. **Recorte al contenido + margen uniforme + reducción a 512 px**, para
   homogeneizar el tamaño aparente y recortar peso.
3. **Se normaliza en el ETL, no en la API.** En producción el volumen de
   escudos que ve la API es de **solo lectura** (`escudos:/app/apps/web/public/escudos:ro`
   en `docker-compose.prod.yml`), así que la API no puede reescribir ni cachear
   ficheros. El ETL ya es el único escritor del volumen.
4. **Idempotente.** Relanzar la normalización no debe degradar la imagen ni
   repetir el recorte/padding.

## Diseño

### 1. Normalizador compartido — `apps/etl/src/logo-normalize.ts` (nuevo)

Único sitio donde vive la lógica de imagen. Se implementa con **`sharp`**.

Transformación, en este orden (el orden importa):

1. **Recortar** el borde sobrante con `trim()` sobre la imagen con alfa,
   *antes* de aplanar. `trim()` elimina filas/columnas del borde que coinciden
   con el fondo (transparente en los PNG con alfa; el color de la esquina en los
   opacos), que es justo el margen irregular actual.
2. **Aplanar** la transparencia sobre blanco (`flatten({ background: '#ffffff' })`)
   y **quitar el canal alfa** (`removeAlpha()`), para que la salida sea opaca de
   verdad y la detección de idempotencia funcione.
3. **Escalar** al contenido dentro de un cuadrado con margen uniforme y fondo
   blanco, a **512×512** finales. El margen objetivo es ≈ **6 % por lado**.
4. **Codificar** como PNG.

API del módulo:

```ts
export const LOGO_BACKGROUND = '#ffffff';
export const LOGO_SIZE = 512;
export const LOGO_MARGIN = 0.06;

/** Normaliza un PNG en memoria. Devuelve el PNG normalizado. */
export function normalizeLogoBuffer(input: Buffer): Promise<Buffer>;

/**
 * Normaliza un fichero in-place si lo necesita.
 * - 'skipped'   → ya estaba normalizado (sin alfa y 512×512), no se toca.
 * - 'normalized'→ se reescribió.
 */
export function normalizeLogoFile(filePath: string): Promise<'normalized' | 'skipped'>;
```

**Detección de idempotencia** (`normalizeLogoFile`): se salta el fichero si
`metadata().hasAlpha === false` **y** `width === 512` **y** `height === 512`.
Tras aplanar y quitar alfa, los ficheros generados cumplen esto, así que una
segunda pasada no los toca. Un original opaco que no sea 512×512 sí se procesa
(no tiene transparencia pero se recorta/redimensiona).

**Manejo de errores:** un fichero ilegible o no-PNG no debe tumbar el lote.
`normalizeLogoFile` propaga el error para que el llamante lo registre por ítem y
continúe (mismo criterio que el resto del pipeline: el fallo es explícito, nunca
silencioso, pero no aborta el lote).

### 2. Integración en el ETL

- **`apps/etl/src/download-logos.ts`** (script operativo, se ejecuta a mano):
  - Normaliza **cada fichero descargado** antes de escribirlo.
  - Para los ficheros que **ya existen**, en vez del `SKIP` ciego actual, llama a
    `normalizeLogoFile` y registra `NORM`/`SKIP`. Así la misma ejecución sirve
    como pasada de normalización de los 366 existentes.
  - Alinea la resolución de `OUT_DIR` con la de `run-pipeline.ts`
    (`ESCUDOS_DIR` → ruta del volumen), porque hoy usa `process.cwd()` y puede
    escribir fuera del volumen (el mismo bug documentado en `run-pipeline`).
- **`apps/etl/src/run-pipeline.ts`, entidad `download-logos`:**
  - Mismo tratamiento: normaliza los ficheros existentes (en vez de `SKIP`
    ciego) y normaliza lo descargado antes de escribir.
  - Mantiene el resto de la lógica (mapa `LOGO_MAP`, `UPDATE teams SET logo_url`)
    intacta.
- **`apps/etl/package.json`:** declarar `sharp` (`^0.35.4`) como dependencia
  directa. Hoy solo existe como `overrides` en la raíz y llega de forma
  transitiva por Next; el código del ETL no debe depender de una transitiva de
  otro workspace. `scripts/build-server.mjs` ya deja fuera del bundle toda
  dependencia declarada, así que `sharp` (nativo) quedará `external`
  automáticamente; no requiere cambios.

### 3. Frontend

- **`apps/web/src/components/shared/TeamShield.tsx`:**
  - Fondo del contenedor a **blanco en ambos temas** (`bg-white`) para que el
    relleno horneado y el margen se fundan con el badge; hoy es
    `bg-slate-100 dark:bg-slate-800`, que en modo oscuro deja un anillo oscuro
    alrededor del escudo normalizado.
  - **Quitar el padding interno**: el margen uniforme ya viene horneado en la
    imagen, y el padding actual encogería el escudo por segunda vez.
  - El fallback a iniciales (`imgState === 'initials'`) **no cambia**.
- **`apps/web/src/app/[locale]/matches/[id]/opengraph-image.tsx`:**
  - Aplicar `borderRadius` circular al `<img>` del escudo para que el cuadrado
    blanco normalizado se vea como un badge sobre el fondo oscuro `#0b1220`.

### 4. Documentación

- Nota breve en `docs/pipeline-datos.md` (entidad `download-logos`): el paso de
  escudos rellena la transparencia en blanco, recorta y reduce a 512 px.

## Flujo de datos

```
teams.logo_url (CDN sidgad)  ──download──►  bytes
       │                                      │
       │                          normalizeLogoBuffer (trim → flatten blanco
       │                           → quitar alfa → 512 con margen)
       ▼                                      ▼
`download-logos` / `run-pipeline`      escudos/{teamId}.png (opaco, 512×512)
                                               │
                                               ▼
                     GET /teams/:id/logo  ←  volumen (API, :ro)
                                               │
                                               ▼
                        TeamShield (badge blanco) / OG (badge circular)
```

La pasada sobre ficheros existentes es el mismo `normalizeLogoFile`, así que
descarga y normalización comparten una sola implementación.

## Testing

Test unitario en `apps/etl/src/logo-normalize.test.ts` (vitest, junto al
módulo, como el resto del ETL):

- **Relleno + tamaño:** buffer RGBA con borde transparente → salida `512×512`,
  `hasAlpha === false`, y esquinas opacas de color blanco.
- **Recorte + margen:** una forma opaca excéntrica dentro de un lienzo
  transparente grande → el contenido queda centrado con margen > 0 en los cuatro
  lados (no pegado al borde).
- **Idempotencia:** `normalizeLogoBuffer` aplicado dos veces produce el mismo
  `512×512` opaco, y `normalizeLogoFile` sobre el resultado devuelve `'skipped'`.
- **Opaco no cuadrado:** un PNG opaco 300×100 → sale `512×512` opaco (se
  redimensiona/reencuadra sin romper).
- **Alpha totalmente opaco:** PNG con canal alfa pero 100 % opaco → no debe
  generar franjas ni fallar.

Sin test de red: `normalizeLogoBuffer` no descarga nada.

## Verificación

1. `npm run typecheck && npm run lint && npm run test` en verde.
2. Pasada real sobre los 366 escudos y comprobación automatizada:
   - **0** PNG con transparencia (`hasAlpha` falso o alfa 100 % opaco),
   - todos `512×512`,
   - peso total del directorio reducido,
   - `default-team.png` incluido y correcto.
3. Regenerar la comparativa visual (sin relleno vs. con relleno, sobre fondo
   claro y oscuro) y revisar una muestra representativa, prestando atención a
   escudos con detalles claros en el borde (riesgo de recorte excesivo).
4. Comprobar en la web (`TeamShield` en modo claro y oscuro) y en la imagen OG
   de un partido real que los badges se ven bien.

## Fuera de alcance

- Normalizar el **proxy directo del CDN** de la API (equipos sin fichero local):
  el volumen es `:ro` y añadir `sharp` al runtime de la API no compensa. Con 366
  ficheros locales la web queda cubierta; se documenta como límite.
- Rediseñar el fallback de iniciales o el escudo genérico.
- Cambiar el modo de servir escudos (los PNG locales siguen siendo la caché; no
  se toca la resolución de la API ni `teams.logo_url`).
- `apps/etl/src/scripts/download-team-logos.ts`: duplicado antiguo sin
  referencias; no se toca en este cambio.

## Riesgos y límites conocidos

- **Recorte agresivo:** `trim()` es heurístico. Un escudo con un píxel suelto
  fuera del cuerpo principal podría recortarse de más o de menos; se mitiga con
  el margen horneado y la revisión de la muestra visual. El cambio es reversible
  re-descargando desde `logo_url` y relanzando el pipeline.
- **Peso de la primera pasada:** reescribir 366 ficheros en la primera ejecución
  tarda algo más, pero es una operación puntual y luego es no-op.
- **Modo oscuro:** los badges pasan a ser blancos (fondo claro dentro del
  escudo). Es el patrón habitual para escudos y el precio de que un relleno
  único funcione en ambos temas.

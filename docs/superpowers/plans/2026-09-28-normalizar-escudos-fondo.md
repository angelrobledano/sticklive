# Normalizar escudos (fondo blanco, recorte y 512px) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cualquier escudo se vea legible sobre cualquier fondo (claro, oscuro y tarjeta OG), con relleno blanco, tamaño visual consistente y menos peso.

**Architecture:** Un único módulo `logo-normalize.ts` en `apps/etl` con la lógica `sharp` (recorte → aplanado blanco → margen → 512px, idempotente). Lo usan un CLI `normalize-logos.ts` (pasada completa del repositorio/volumen) y el flujo de descarga (`download-logos.ts` y la entidad `download-logos` de `run-pipeline.ts`). En la web, `TeamShield` y la imagen OG se ajustan para apoyar el relleno horneado.

**Tech Stack:** TypeScript ESM, `sharp` (nativo, ya presente vía Next), vitest, Next.js/React. Spec: `docs/superpowers/specs/2026-09-28-normalizar-escudos-fondo-design.md`.

**Comportamiento verificado en prototipo (referencia):** cadena `sharp(input).trim().flatten({background:'#fff'}).removeAlpha().resize(450,450,{fit:'inside'}).png()` + `extend` a 512 da `512×512`, `channels=3`, `hasAlpha=false`, borde blanco, e idempotente (bytes idénticos en la segunda pasada). Pasada completa sobre los 366: 0 fallos, 97.1 MB → 55.8 MB, ~25 s.

---

## File structure

| Fichero | Responsabilidad |
|---|---|
| `apps/etl/src/logo-normalize.ts` **(nuevo)** | Lógica de imagen: `normalizeLogoBuffer` / `normalizeLogoFile`. Único sitio con `sharp`. |
| `apps/etl/src/logo-normalize.test.ts` **(nuevo)** | Tests unitarios del normalizador (fixtures generados en memoria). |
| `apps/etl/src/normalize-logos.ts` **(nuevo)** | CLI: recorre `ESCUDOS_DIR` y normaliza todos los `.png`. Sin BD ni red. |
| `apps/etl/src/download-logos.ts` **(modificar)** | Descarga + normaliza; normaliza los existentes en vez de `SKIP` ciego. |
| `apps/etl/src/run-pipeline.ts` **(modificar)** | Entidad `download-logos`: idem. |
| `apps/etl/package.json` **(modificar)** | Declarar `sharp` como dependencia directa. |
| `scripts/build-server.mjs` **(modificar)** | Empaquetar `normalize-logos.ts` como script operativo. |
| `apps/web/src/components/shared/TeamShield.tsx` **(modificar)** | Contenedor blanco, sin padding interno. |
| `apps/web/src/app/[locale]/matches/[id]/opengraph-image.tsx` **(modificar)** | Badge circular del escudo. |
| `docs/pipeline-datos.md` **(modificar)** | Nota del paso de escudos. |

---

## Task 1: Módulo normalizador + tests

**Files:**
- Create: `apps/etl/src/logo-normalize.ts`
- Create: `apps/etl/src/logo-normalize.test.ts`
- Modify: `apps/etl/package.json` (dependencias)

- [ ] **Step 1: Declarar `sharp` como dependencia del ETL**

En `apps/etl/package.json`, dentro de `"dependencies"`, añade la línea (orden alfabético, entre `@sports/shared-types` y `web-push`):

```json
    "sharp": "^0.35.4",
```

Luego instala para actualizar el lockfile:

```bash
npm install
```

Salida esperada: `npm install` termina sin errores y `git status` muestra `package-lock.json` modificado.

- [ ] **Step 2: Escribir los tests (RED)**

Crea `apps/etl/src/logo-normalize.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { normalizeLogoBuffer, normalizeLogoFile, LOGO_SIZE } from './logo-normalize.js';

/**
 * PNG cuadrado `size`×`size` con un cuadrado opaco de `size - 2*inset` centrado
 * y el resto transparente. `inset = 0` produce un PNG con canal alfa 100 % opaco.
 */
async function fixture(size = 400, inset = 100): Promise<Buffer> {
  const inner = size - 2 * inset;
  const solid = await sharp({
    create: { width: inner, height: inner, channels: 4, background: { r: 20, g: 40, b: 200, alpha: 1 } },
  }).png().toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: solid, left: inset, top: inset }]).png().toBuffer();
}

const isWhite = (d: Buffer, i: number) => d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255;

describe('normalizeLogoBuffer', () => {
  it('aplana la transparencia: 512×512, opaco, esquina blanca', async () => {
    const out = await normalizeLogoBuffer(await fixture());
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(LOGO_SIZE);
    expect(meta.height).toBe(LOGO_SIZE);
    expect(meta.hasAlpha).toBe(false);

    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect(isWhite(data, 0)).toBe(true);
  });

  it('recorta el borde transparente y deja margen alrededor del contenido', async () => {
    const out = await normalizeLogoBuffer(await fixture(400, 150));
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });

    const rowAllWhite = (y: number) => {
      for (let x = 0; x < info.width; x++) {
        if (!isWhite(data, (y * info.width + x) * info.channels)) return false;
      }
      return true;
    };
    expect(rowAllWhite(0)).toBe(true);
    expect(rowAllWhite(info.height - 1)).toBe(true);

    const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(isWhite(data, center)).toBe(false);
  });

  it('redimensiona un PNG opaco no cuadrado a 512×512', async () => {
    const opaque = await sharp({
      create: { width: 300, height: 100, channels: 3, background: '#3366cc' },
    }).png().toBuffer();
    const meta = await sharp(await normalizeLogoBuffer(opaque)).metadata();
    expect(meta.width).toBe(LOGO_SIZE);
    expect(meta.height).toBe(LOGO_SIZE);
    expect(meta.hasAlpha).toBe(false);
  });

  it('no falla con un PNG que declara alfa pero es 100 % opaco', async () => {
    const meta = await sharp(await normalizeLogoBuffer(await fixture(200, 0))).metadata();
    expect(meta.width).toBe(LOGO_SIZE);
    expect(meta.hasAlpha).toBe(false);
  });

  it('es idempotente', async () => {
    const once = await normalizeLogoBuffer(await fixture());
    const twice = await normalizeLogoBuffer(once);
    expect(Buffer.compare(once, twice)).toBe(0);
  });
});

describe('normalizeLogoFile', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('normaliza un fichero con transparencia y en la segunda pasada lo salta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logo-'));
    dirs.push(dir);
    const file = join(dir, 'team.png');
    writeFileSync(file, await fixture());

    expect(await normalizeLogoFile(file)).toBe('normalized');
    const meta = await sharp(readFileSync(file)).metadata();
    expect(meta.width).toBe(LOGO_SIZE);
    expect(meta.height).toBe(LOGO_SIZE);
    expect(meta.hasAlpha).toBe(false);

    expect(await normalizeLogoFile(file)).toBe('skipped');
  });
});
```

- [ ] **Step 3: Ejecutar los tests y verlos fallar (RED)**

Run: `npm run test --workspace=apps/etl`
Expected: FAIL — `Cannot find module './logo-normalize.js'` (o similar) porque aún no existe el módulo.

- [ ] **Step 4: Implementar el módulo (GREEN)**

Crea `apps/etl/src/logo-normalize.ts`:

```ts
/**
 * Normalización de escudos (PNG) para que se vean bien sobre cualquier fondo.
 *
 * Los escudos de origen llegan con transparencia y márgenes irregulares: en
 * fondos oscuros (modo oscuro y tarjeta OG) los de colores oscuros desaparecen.
 * Aquí se rellena la transparencia en blanco, se recorta el borde sobrante, se
 * añade un margen uniforme y se reduce a un tamaño común.
 *
 * Es idempotente: un PNG ya normalizado (sin alfa y de LOGO_SIZE×LOGO_SIZE) no
 * se vuelve a tocar.
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

/** Color de relleno de la transparencia. Debe coincidir con el fondo de TeamShield. */
export const LOGO_BACKGROUND = '#ffffff';
/** Lado final en px (cuadrado). */
export const LOGO_SIZE = 512;
/** Margen por lado como fracción del lado final (6 %). */
export const LOGO_MARGIN = 0.06;

const PAD = Math.round(LOGO_SIZE * LOGO_MARGIN);
const INNER_SIZE = LOGO_SIZE - 2 * PAD;

/**
 * Normaliza un PNG en memoria y devuelve el PNG normalizado (512×512, opaco).
 *
 * Orden importante: `trim()` va ANTES de `flatten()` porque necesita el canal
 * alfa para saber qué es fondo; `removeAlpha()` va después para que la salida
 * sea realmente opaca (y la detección de idempotencia funcione).
 */
export async function normalizeLogoBuffer(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .trim()
    .flatten({ background: LOGO_BACKGROUND })
    .removeAlpha()
    .resize(INNER_SIZE, INNER_SIZE, { fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.floor((LOGO_SIZE - info.width) / 2);
  const top = Math.floor((LOGO_SIZE - info.height) / 2);

  return sharp(data)
    .extend({
      top,
      bottom: LOGO_SIZE - info.height - top,
      left,
      right: LOGO_SIZE - info.width - left,
      background: LOGO_BACKGROUND,
    })
    .png()
    .toBuffer();
}

/**
 * Normaliza un fichero PNG in-place si lo necesita.
 *
 * - `'skipped'`    → ya estaba normalizado (sin alfa y 512×512).
 * - `'normalized'` → se reescribió.
 *
 * Propaga el error si el fichero es ilegible: el llamante lo registra por ítem
 * y continúa con el resto del lote.
 */
export async function normalizeLogoFile(filePath: string): Promise<'normalized' | 'skipped'> {
  const meta = await sharp(filePath).metadata();
  if (!meta.hasAlpha && meta.width === LOGO_SIZE && meta.height === LOGO_SIZE) {
    return 'skipped';
  }
  const input = await readFile(filePath);
  await writeFile(filePath, await normalizeLogoBuffer(input));
  return 'normalized';
}
```

- [ ] **Step 5: Ejecutar los tests y verlos pasar (GREEN)**

Run: `npm run test --workspace=apps/etl`
Expected: PASS — 6 tests (5 de `normalizeLogoBuffer`, 1 de `normalizeLogoFile`).

- [ ] **Step 6: Typecheck y lint**

Run: `npm run typecheck --workspace=apps/etl && npm run lint --workspace=apps/etl`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/etl/src/logo-normalize.ts apps/etl/src/logo-normalize.test.ts apps/etl/package.json package-lock.json
git commit -m "feat(etl): normalizador de escudos (fondo blanco, recorte, 512px)"
```

---

## Task 2: CLI `normalize-logos`

**Files:**
- Create: `apps/etl/src/normalize-logos.ts`
- Modify: `scripts/build-server.mjs`

- [ ] **Step 1: Crear el CLI**

Crea `apps/etl/src/normalize-logos.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLogoFile } from './logo-normalize.js';

// Destino: apps/web/public/escudos/*.png
// Misma resolución que run-pipeline/download-logos: ESCUDOS_DIR (volumen en
// producción) o, si no, la ruta del repo relativa a ESTE módulo (no a cwd).
//   npx tsx apps/etl/src/normalize-logos.ts
const OUT_DIR =
  process.env['ESCUDOS_DIR'] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/escudos');

async function main() {
  const files = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter((f) => f.toLowerCase().endsWith('.png'))
    : [];

  console.log('Escudos encontrados:', files.length);
  console.log('Directorio:', OUT_DIR);
  console.log('');

  let normalized = 0, skipped = 0, failed = 0;

  for (const file of files) {
    const full = path.join(OUT_DIR, file);
    try {
      const action = await normalizeLogoFile(full);
      if (action === 'normalized') {
        console.log('NORM  ', file);
        normalized++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.error('FAIL  ', file, String(e));
      failed++;
    }
  }

  console.log('');
  console.log('Resumen:', normalized, 'normalizados,', skipped, 'ya normalizados,', failed, 'fallidos');
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
```

- [ ] **Step 2: Empaquetarlo como operativo**

En `scripts/build-server.mjs`, dentro del array `OPERATIVOS`, añade tras `'apps/etl/src/download-logos.ts',` (línea 98):

```js
  'apps/etl/src/normalize-logos.ts',
```

- [ ] **Step 3: Verificar que arranca contra un directorio temporal**

Crea un directorio temporal con un escudo de prueba y ejecuta el CLI apuntando ahí:

```bash
mkdir -p /tmp/escudos-test
cp apps/web/public/escudos/default-team.png /tmp/escudos-test/
ESCUDOS_DIR=/tmp/escudos-test npx tsx apps/etl/src/normalize-logos.ts
```

Salida esperada: `1 normalizados, 0 ya normalizados, 0 fallidos`. Segunda ejecución: `0 normalizados, 1 ya normalizados, 0 fallidos`.

(Los `ESCUDOS_DIR=... npx ...` son para bash; en PowerShell: `$env:ESCUDOS_DIR='/tmp/escudos-test'; npx tsx apps/etl/src/normalize-logos.ts`.)

- [ ] **Step 4: Typecheck, lint y build del bundle**

Run: `npm run typecheck --workspace=apps/etl && npm run lint --workspace=apps/etl && npm run build:server`
Expected: sin errores; el log de esbuild incluye `dist/apps/etl/src/normalize-logos.js`.

- [ ] **Step 5: Commit**

```bash
git add apps/etl/src/normalize-logos.ts scripts/build-server.mjs
git commit -m "feat(etl): CLI normalize-logos para la pasada completa de escudos"
```

---

## Task 3: Normalizar en `download-logos.ts`

**Files:**
- Modify: `apps/etl/src/download-logos.ts` (fichero completo)

- [ ] **Step 1: Reescribir el fichero**

Sustituye TODO el contenido de `apps/etl/src/download-logos.ts` por:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, closeDb } from '@sports/db';
import { normalizeLogoBuffer, normalizeLogoFile } from './logo-normalize.js';

// Destino: apps/web/public/escudos/{teamId}.png
// Ejecutar desde la raiz del monorepo:
//   npx tsx --env-file .env apps/etl/src/download-logos.ts
// Misma resolución que run-pipeline.ts: ESCUDOS_DIR (volumen en producción) o,
// si no, la ruta del repo relativa a ESTE módulo. Antes usaba process.cwd(), que
// al lanzarlo desde apps/etl escribía fuera del volumen.
const OUT_DIR =
  process.env['ESCUDOS_DIR'] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/escudos');

async function downloadLogo(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: {
        'Referer':    'https://www.hockeypatines.fep.es/',
        'User-Agent': 'Mozilla/5.0 (compatible; SportsBot/1.0)',
      },
    });
    if (!res.ok) return false;
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length < 100) return false;
    const buf = await normalizeLogoBuffer(raw);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { rows } = await db.query<{ id: string; name: string; logo_url: string | null }>(
    'SELECT id, name, logo_url FROM teams ORDER BY name'
  );

  console.log('Equipos encontrados:', rows.length);
  console.log('Destino:', OUT_DIR);
  console.log('');

  let ok = 0, norm = 0, skip = 0, fail = 0;

  for (const team of rows) {
    const dest = path.join(OUT_DIR, team.id + '.png');

    if (fs.existsSync(dest)) {
      // Ya existe: si aún tiene transparencia o tamaño irregular, lo normalizamos
      // (idempotente: si ya está normalizado, se salta).
      try {
        const action = await normalizeLogoFile(dest);
        if (action === 'normalized') { console.log('NORM  ', team.name); norm++; }
        else { console.log('SKIP  ', team.name); skip++; }
      } catch (e) {
        console.log('FAIL  ', team.name, '(normalizando:', String(e), ')');
        fail++;
      }
      continue;
    }

    if (!team.logo_url) {
      console.log('NULL  ', team.name, '(sin logo_url en DB)');
      fail++;
      continue;
    }

    const success = await downloadLogo(team.logo_url, dest);
    if (success) {
      const size = fs.statSync(dest).size;
      console.log('OK    ', team.name, '(' + size + ' bytes)');
      ok++;
    } else {
      console.log('FAIL  ', team.name, '<-', team.logo_url);
      fail++;
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  console.log('');
  console.log('Resumen:', ok, 'descargados,', norm, 'normalizados,', skip, 'ya normalizados,', fail, 'fallidos');
  await closeDb();
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
```

- [ ] **Step 2: Typecheck y lint**

Run: `npm run typecheck --workspace=apps/etl && npm run lint --workspace=apps/etl`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/etl/src/download-logos.ts
git commit -m "feat(etl): download-logos normaliza escudos nuevos y existentes"
```

---

## Task 4: Normalizar en la entidad `download-logos` de `run-pipeline.ts`

**Files:**
- Modify: `apps/etl/src/run-pipeline.ts` (import + entidad `download-logos`, ~línea 492)

- [ ] **Step 1: Importar el normalizador**

En `apps/etl/src/run-pipeline.ts`, tras `import { forEachLimited } from './concurrency.js';` (línea 28), añade:

```ts
import { normalizeLogoBuffer, normalizeLogoFile } from './logo-normalize.js';
```

- [ ] **Step 2: Normalizar los existentes y lo descargado**

En la entidad `download-logos` (bloque que empieza en `if (entity === 'download-logos')`), sustituye el contador y el bucle:

Actual:
```ts
    log.info({ total: rows.length, outDir }, 'Descargando logos de equipos desde sidgad.cloud');
    let ok = 0, skip = 0, fail = 0;

    for (const team of rows) {
      const dest = path.join(outDir, team.id + '.png');
      if (fs.existsSync(dest)) { log.info({ name: team.name }, 'SKIP'); skip++; continue; }
```

Nuevo:
```ts
    log.info({ total: rows.length, outDir }, 'Descargando logos de equipos desde sidgad.cloud');
    let ok = 0, norm = 0, skip = 0, fail = 0;

    for (const team of rows) {
      const dest = path.join(outDir, team.id + '.png');
      if (fs.existsSync(dest)) {
        // Normaliza el escudo existente (idempotente). Antes se saltaba siempre,
        // así que los ficheros con transparencia nunca se corregían.
        try {
          const action = await normalizeLogoFile(dest);
          if (action === 'normalized') { log.info({ name: team.name }, 'NORM'); norm++; }
          else { log.info({ name: team.name }, 'SKIP'); skip++; }
        } catch (e) {
          log.error({ name: team.name, err: String(e) }, 'FAIL normalizando escudo existente');
          fail++;
        }
        continue;
      }
```

- [ ] **Step 3: Normalizar antes de escribir**

En el mismo bloque, sustituye:

Actual:
```ts
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 500) throw new Error('respuesta demasiado pequenya');
        fs.writeFileSync(dest, buf);
```

Nuevo:
```ts
        const raw = Buffer.from(await res.arrayBuffer());
        if (raw.length < 500) throw new Error('respuesta demasiado pequenya');
        const buf = await normalizeLogoBuffer(raw);
        fs.writeFileSync(dest, buf);
```

Ajusta también el `log.info({ name: team.name, bytes: buf.length }, 'OK');` si querías el tamaño original: déjalo como está (ahora reporta el tamaño ya normalizado, que es el que se guarda).

- [ ] **Step 4: Actualizar el resumen y quitar el aviso obsoleto**

Sustituye:

Actual:
```ts
    log.info({ ok, skip, fail }, 'Logos completado');
    if (ok > 0) {
      log.warn(
        '⚠️  Next fotografía public/ al arrancar: reinicia el contenedor web ' +
          'para que sirva los escudos nuevos →  docker compose ... restart web'
      );
    }
```

Nuevo:
```ts
    log.info({ ok, norm, skip, fail }, 'Logos completado');
```

(Se elimina el aviso de reiniciar `web`: desde la auditoría A3 la API sirve `/teams/:id/logo` leyendo el volumen en cada request, así que escudos nuevos o normalizados aparecen sin reinicio.)

- [ ] **Step 5: Typecheck y lint**

Run: `npm run typecheck --workspace=apps/etl && npm run lint --workspace=apps/etl`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/etl/src/run-pipeline.ts
git commit -m "feat(etl): la entidad download-logos normaliza escudos y avisa sin reinicio"
```

---

## Task 5: `TeamShield` con fondo blanco

**Files:**
- Modify: `apps/web/src/components/shared/TeamShield.tsx`

- [ ] **Step 1: Contenedor blanco (ambos temas)**

Sustituye el bloque de clases del contenedor:

Actual:
```tsx
  const containerCls = [
    rounded,
    'bg-slate-100 dark:bg-slate-800',
    'shrink-0 flex items-center justify-center overflow-hidden',
    className,
  ].filter(Boolean).join(' ');
```

Nuevo:
```tsx
  // Fondo blanco en AMBOS temas: el escudo normalizado ya trae relleno blanco
  // horneado, así que el contenedor debe casar con él (si no, en modo oscuro
  // aparecería un anillo oscuro alrededor del badge).
  const containerCls = [
    rounded,
    'bg-white',
    'shrink-0 flex items-center justify-center overflow-hidden',
    className,
  ].filter(Boolean).join(' ');
```

- [ ] **Step 2: Quitar el padding interno**

El margen uniforme ya viene horneado en la imagen; el padding encogería el escudo por segunda vez y dejaría ver el contenedor detrás del borde.

Actual:
```tsx
  // Aire interior: el clip circular recorta las esquinas de los escudos
  // cuadrados (FCB, etc.); un padding proporcional los deja respirar.
  const pad = Math.max(2, Math.round(size * 0.12));

  return (
    <div className={containerCls} style={{ width: size, height: size, padding: pad }}>
```

Nuevo:
```tsx
  // Sin padding: el margen uniforme ya viene horneado en el escudo normalizado.
  return (
    <div className={containerCls} style={{ width: size, height: size }}>
```

- [ ] **Step 3: Verificar typecheck y lint de la web**

Run: `npm run typecheck --workspace=apps/web && npm run lint --workspace=apps/web`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/shared/TeamShield.tsx
git commit -m "fix(web): escudo sobre badge blanco sin padding doble"
```

---

## Task 6: Badge circular en la imagen OG

**Files:**
- Modify: `apps/web/src/app/[locale]/matches/[id]/opengraph-image.tsx` (línea ~59-62)

- [ ] **Step 1: Envolver el escudo en un círculo blanco**

Sustituye, dentro de `side(...)`:

Actual:
```tsx
      {id ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo(id)} width={170} height={170} style={{ objectFit: 'contain' }} alt="" />
      ) : null}
```

Nuevo:
```tsx
      {id ? (
        // El escudo normalizado trae fondo blanco: lo recortamos en círculo para
        // que se vea como un badge sobre el fondo oscuro de la tarjeta.
        <div style={{
          display: 'flex', width: '170px', height: '170px',
          borderRadius: '9999px', overflow: 'hidden', background: '#ffffff',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo(id)} width={170} height={170}
               style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="" />
        </div>
      ) : null}
```

- [ ] **Step 2: Verificar que la tarjeta OG se genera**

Arranca la web en local (`npm run dev --workspace=apps/web`) con la API arriba y abre en el navegador:

```text
http://localhost:3001/es/matches/<id-de-un-partido-real>/opengraph-image
```

Expected: PNG 1200×630 con los dos escudos dentro de círculos blancos, legibles sobre el fondo oscuro. Si un escudo aún se viera sin relleno, es que esa imagen no estaba normalizada (Task 8 lo corrige) o que cae al proxy del CDN.

- [ ] **Step 3: Typecheck y lint**

Run: `npm run typecheck --workspace=apps/web && npm run lint --workspace=apps/web`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[locale]/matches/[id]/opengraph-image.tsx"
git commit -m "fix(web): escudos de la tarjeta OG en badge circular"
```

---

## Task 7: Documentación

**Files:**
- Modify: `docs/pipeline-datos.md` (línea ~33)

- [ ] **Step 1: Documentar el paso**

Sustituye la línea:

Actual:
```md
- **`run-pipeline.ts`** — entidades: `calendar`, `standings`, `matches`, `ficha`, `fichas-pendientes`, `refichas` (re-procesar actas), `download-logos`, `all`. Con `COMPETITION_SOURCES_DRIVEN=1` (producción), calendar/standings/fichas-pendientes iteran todas las competiciones activas de `competition_sources`; sin el flag, modo single con `--season-id`/`--idc`.
```

Nuevo (se añade una frase al final):
```md
- **`run-pipeline.ts`** — entidades: `calendar`, `standings`, `matches`, `ficha`, `fichas-pendientes`, `refichas` (re-procesar actas), `download-logos`, `all`. Con `COMPETITION_SOURCES_DRIVEN=1` (producción), calendar/standings/fichas-pendientes iteran todas las competiciones activas de `competition_sources`; sin el flag, modo single con `--season-id`/`--idc`.
- **Escudos** (`download-logos`, `normalize-logos`): los PNG se normalizan con `sharp` — se rellena la transparencia en blanco, se recorta el borde sobrante, se añade margen uniforme y se reduce a 512×512 (`logo-normalize.ts`, idempotente). La pasada completa sobre el volumen se lanza con `node dist/apps/etl/src/normalize-logos.js`. El escudo servido por `/teams/:id/logo` es siempre opaco y de tamaño uniforme.
```

- [ ] **Step 2: Commit**

```bash
git add docs/pipeline-datos.md
git commit -m "docs(etl): documentar la normalizacion de escudos"
```

---

## Task 8: Pasada completa sobre los 366 escudos y verificación

**Files:**
- Modify: los 366 PNG de `apps/web/public/escudos/` (datos versionados)

> **Checkpoint de producto:** este paso modifica 366 ficheros binarios versionados (`~97 MB → ~56 MB`). Confirma con el dueño del producto antes de commitear. Si se prefiere no versionarlos, saltar el Step 5 y aplicar solo la pasada en producción (Step 4b).

- [ ] **Step 1: Ejecutar la normalización sobre el repositorio**

Desde la raíz del monorepo (sin `ESCUDOS_DIR`, para que use `apps/web/public/escudos`):

```bash
npx tsx apps/etl/src/normalize-logos.ts
```

Salida esperada: `366 normalizados, 0 ya normalizados, 0 fallidos` (el conteo `ya normalizados` puede ser 1 si `default-team.png` ya estaba a 512).

- [ ] **Step 2: Verificar el resultado de forma automatizada**

```bash
node -e "
const sharp=require('sharp');const fs=require('fs');
const dir='apps/web/public/escudos';
(async()=>{
 const files=fs.readdirSync(dir).filter(f=>f.endsWith('.png'));
 let bad=[],total=0;
 for(const f of files){
  const m=await sharp(dir+'/'+f).metadata();
  total+=fs.statSync(dir+'/'+f).size;
  if(m.width!==512||m.height!==512||m.hasAlpha) bad.push(f+' ('+m.width+'x'+m.height+',alpha='+m.hasAlpha+')');
 }
 console.log('ficheros',files.length,'no normalizados',bad.length);
 bad.slice(0,10).forEach(b=>console.log('  ',b));
 console.log('peso total MB',(total/1048576).toFixed(1));
})();
"
```

Expected: `366 ficheros, no normalizados 0` y peso total ~56 MB.

- [ ] **Step 3: Regenerar la comparativa visual y revisarla**

```bash
node -e "
const sharp=require('sharp');
const picks=['00b39b98-fe2c-4be9-aa52-2fab93752edb.png','01fe00ff-0889-402f-85b0-16b8db71cc14.png','18561e5a-e0c4-4382-90f8-a20bbb91fa02.png','0e8b987b-3c4b-428b-80d0-1c534ece192c.png'];
const S=150,gap=10;
(async()=>{
 const dir='apps/web/public/escudos';const comps=[];let x=gap;
 for(const f of picks){
  const buf=await sharp(dir+'/'+f).resize(S,S,{fit:'contain',background:'#fff'}).png().toBuffer();
  comps.push({input:buf,left:x,top:gap});x+=S+gap;
 }
 await sharp({create:{width:x,height:S+2*gap,channels:3,background:'#0b1220'}}).composite(comps).png().toFile('escudos-normalizados.png');
 console.log('OK escudos-normalizados.png');
})();
"
```

Abre `escudos-normalizados.png` y comprueba que los escudos oscuros se ven bien sobre el fondo oscuro. Revisa también 5-6 escudos con detalles claros en el borde por si `trim()` recortó de más.

- [ ] **Step 4: Revisar la web (modo claro y oscuro)**

Con API y web en local, abre una competición y un partido y comprueba los badges en ambos temas. Borra `escudos-normalizados.png` al terminar (es un artefacto temporal, no debe commitearse).

- [ ] **Step 4b (alternativa a 5): pasada en producción sin redeploy**

Si no se versionan los PNG, aplicar en el servidor (dentro del contenedor `etl`, que tiene el volumen montado en lectura/escritura):

```bash
docker compose -f docker-compose.prod.yml exec etl node dist/apps/etl/src/normalize-logos.js
```

La API sirve los escudos normalizados al instante (los lee del volumen en cada request, auditoría A3); no hace falta reiniciar `web`.

- [ ] **Step 5: Commit de los escudos normalizados**

```bash
git add apps/web/public/escudos
git status --short | head -20
git commit -m "chore(escudos): normalizar 366 escudos (fondo blanco, recorte, 512px)"
```

- [ ] **Step 6: Verificación global**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: todo en verde (incluye los tests de `logo-normalize`).

---

## Self-review (cobertura del spec)

- **Relleno blanco #ffffff** → Task 1 (`LOGO_BACKGROUND`).
- **Recorte + margen uniforme + 512px** → Task 1 (cadena `trim`/`flatten`/`resize`/`extend`).
- **Idempotencia** → Task 1 (detección en `normalizeLogoFile` + test).
- **Normalizar en ETL, no en API** → Tasks 2/3/4 (volumen `:ro` de la API).
- **Pasada sobre los existentes** → Task 2 (CLI) + Task 8 (ejecución + verificación).
- **Descargas futuras normalizadas** → Task 3 y Task 4.
- **`OUT_DIR` alineado con el volumen** → Tasks 2/3 (`ESCUDOS_DIR` → ruta del módulo).
- **TeamShield blanco sin padding** → Task 5.
- **Badge circular OG** → Task 6.
- **Docs** → Task 7.
- **Verificación (tests + 366 + visual + typecheck/lint/test)** → Tasks 1 y 8.
- **Límites** (proxy CDN transparente, `download-team-logos.ts` muerto) → documentados en el spec, fuera de alcance.

**Consistencia de tipos:** `normalizeLogoBuffer(Buffer): Promise<Buffer>` y `normalizeLogoFile(string): Promise<'normalized'|'skipped'>` se usan con esos mismos nombres y firmas en Tasks 2, 3 y 4. `LOGO_SIZE` se importa en los tests. Sin placeholders pendientes.

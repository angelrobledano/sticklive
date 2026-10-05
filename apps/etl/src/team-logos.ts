/**
 * Sincronización del volumen de escudos con `teams.logo_url` (fuente única).
 *
 * Antes esta lógica estaba triplicada y divergente: el script
 * `download-logos.ts`, `scripts/download-team-logos.ts` y la entidad
 * `download-logos` de `run-pipeline.ts` — esta última con un mapa de 14 equipos
 * hardcodeado. El scheduler solo ejecutaba la de `run-pipeline`, así que programarla
 * apenas servía: cualquier equipo fuera de ese mapa se quedaba sin fichero local
 * y pagaba BD+CDN en cada visita (incidente 2026-10-05: trazas de 5–13 s y
 * timeouts de conexión).
 *
 * Ahora hay UNA implementación, alineada con `/teams/:id/logo`: `teams.logo_url`
 * es la fuente de verdad. Se descarga del CDN con Referer, se normaliza (recorte
 * + fondo blanco + margen uniforme) y se guarda en `escudos/{teamId}.png`. Los
 * ficheros ya existentes solo se normalizan (idempotente).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '@sports/db';
import { createLogger } from '@sports/logger';
import { normalizeLogoBuffer, normalizeLogoFile } from './logo-normalize.js';

const log = createLogger({ module: 'team-logos' });

/**
 * Ruta del volumen de escudos. Resuelta desde ESTE módulo (no `process.cwd()`):
 * así da igual desde dónde se lance. Override con `ESCUDOS_DIR` (volumen Docker
 * en producción).
 */
export function escudosDir(): string {
  return process.env['ESCUDOS_DIR'] ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/escudos');
}

export type LogoAction =
  | { kind: 'normalize' }
  | { kind: 'download'; url: string }
  | { kind: 'skip'; reason: 'no-logo-url' };

/**
 * Decide qué hacer con el escudo de un equipo. Función pura (sin I/O), testeable:
 *   · ya hay fichero → normalizarlo (por si lo escribió una versión antigua);
 *   · no hay fichero pero sí `logo_url` → descargarlo;
 *   · ni fichero ni `logo_url` → no hay fuente (hueco de datos, no un fallo).
 */
export function planLogoAction(logoUrl: string | null, fileExists: boolean): LogoAction {
  if (fileExists) return { kind: 'normalize' };
  if (logoUrl) return { kind: 'download', url: logoUrl };
  return { kind: 'skip', reason: 'no-logo-url' };
}

/** Descarga un escudo con Referer y lo guarda normalizado. Nunca lanza. */
export async function downloadLogo(url: string, destPath: string): Promise<boolean> {
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

export interface LogoSummary {
  total: number;
  /** Ficheros nuevos descargados del CDN. */
  ok: number;
  /** Ficheros existentes que se reescribieron normalizados. */
  norm: number;
  /** Ficheros existentes que ya estaban normalizados. */
  skip: number;
  /** Equipos sin `logo_url` y sin fichero local (hueco de datos). */
  noSource: number;
  /** Descargas o normalizaciones que fallaron. */
  fail: number;
}

/**
 * Recorre TODOS los equipos y sincroniza `escudos/`. Idempotente: sin equipos
 * nuevos solo revalida los existentes. Devuelve un resumen para el log y tests.
 */
export async function downloadTeamLogos(outDir: string = escudosDir()): Promise<LogoSummary> {
  const { rows } = await db.query<{ id: string; name: string; logo_url: string | null }>(
    'SELECT id, name, logo_url FROM teams ORDER BY name'
  );
  fs.mkdirSync(outDir, { recursive: true });
  const summary: LogoSummary = { total: rows.length, ok: 0, norm: 0, skip: 0, noSource: 0, fail: 0 };

  for (const team of rows) {
    const dest = path.join(outDir, team.id + '.png');
    const action = planLogoAction(team.logo_url, fs.existsSync(dest));
    try {
      if (action.kind === 'normalize') {
        const result = await normalizeLogoFile(dest);
        if (result === 'normalized') { summary.norm++; log.info({ name: team.name }, 'escudo normalizado'); }
        else summary.skip++;
        continue;
      }
      if (action.kind === 'skip') {
        summary.noSource++;
        continue;
      }
      const success = await downloadLogo(action.url, dest);
      if (success) { summary.ok++; log.info({ name: team.name }, 'escudo descargado'); }
      else { summary.fail++; log.warn({ name: team.name, url: action.url }, 'fallo al descargar escudo'); }
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      summary.fail++;
      log.error({ name: team.name, err: String(e) }, 'fallo procesando escudo');
    }
  }

  log.info(summary, 'escudos sincronizados');
  return summary;
}

/**
 * Sincroniza `competitions.logo_url` con el logo que publica la fuente en su
 * catálogo (`{portal}_ls_1.php` → `a.idc_master[logo]`).
 *
 * - Dry-run por defecto; `--write` para aplicar. Idempotente.
 * - `--org` admite varios organizadores separados por coma (misma portal).
 * - Si el idc actual no trae logo, usa el de otra entrada del catálogo con el
 *   MISMO nombre (caso FECAPA 4858 ↔ 1319).
 * - Solo competiciones de los organizadores indicados (los idc locales no están
 *   namespaced entre portales).
 *
 * Uso:
 *   npx tsx --env-file=../../.env src/sync-competition-logos.ts --portal=rfep --org=RFEP
 *   npx tsx --env-file=../../.env src/sync-competition-logos.ts --portal=worldskate --org=WSE,"World Skate" --referer=https://www.rinkhockey.worldskate.org/ --write
 */
import * as cheerio from 'cheerio';
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';
import { competitionLogoUrl } from './competition-logo.js';
import { FEDERATIONS } from './federations.js';

const log = createLogger({ service: 'sync-competition-logos' });

const argv = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }),
) as Record<string, string>;

const PORTAL = argv['portal'] ?? process.env['SIDGAD_PORTAL'] ?? 'rfep';
const DEFAULT_ORG = PORTAL === 'rfep' ? 'RFEP'
  : PORTAL === 'worldskate' ? 'WSE,World Skate'
  : PORTAL.toUpperCase();
const ORGS = (argv['org'] ?? DEFAULT_ORG).split(',').map((s) => s.trim()).filter(Boolean);
const REFERER = argv['referer']
  ?? (PORTAL === 'rfep'
    ? 'https://www.hockeypatines.fep.es/'
    : PORTAL === 'worldskate'
      ? 'https://www.rinkhockey.worldskate.org/'
      : FEDERATIONS.find((f) => f.prefix === PORTAL)?.referer ?? `https://www.${PORTAL}.cat/`);
const WRITE = argv['write'] === 'true' || argv['write'] === '1';
const ONLY = new Set((argv['only-idc'] ?? '').split(',').map((s) => s.trim()).filter(Boolean));

/** `FRIT RAVICH LLIGA CATALANA` → `FRIT RAVICH LLIGA CATALANA` (sin tildes ni espacios extra). */
function normName(raw: string): string {
  return raw.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Excepciones de la fuente: competiciones cuyo idc actual no trae logo pero
 * otra entrada del catálogo sí. Se fija el fichero para que el sync sea
 * reproducible (no depende de que el nombre coincida).
 *   4858 = FRIT RAVICH LLIGA CATALANA 2026/27 (sin `logo`); 1319 lleva el logo.
 */
const LOGO_OVERRIDES: Record<string, string> = {
  'fecapa:4858': '1319.png',
};

interface CatalogEntry { idc: string; name: string; logo: string | null }

async function fetchCatalog(): Promise<CatalogEntry[]> {
  const url = `https://www.server2.sidgad.es/${PORTAL}/${PORTAL}_ls_1.php`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: REFERER,
      Origin: REFERER.replace(/\/$/, ''),
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'text/html,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`${PORTAL}_ls_1.php → HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 500) throw new Error(`${PORTAL}: catálogo sospechosamente corto (${html.length}b)`);

  const $ = cheerio.load(html);
  const out: CatalogEntry[] = [];
  $('a.idc_master').each((_, el) => {
    const $el = $(el);
    const idc = $el.attr('id');
    if (!idc) return;
    const attr = $el.attr('logo') ?? null;
    const src = attr ? null : $el.find('img').first().attr('src') ?? null;
    const fromSrc = src ? src.split('logos_competiciones/')[1]?.split('?')[0] ?? null : null;
    out.push({
      idc,
      name: ($el.attr('name') ?? $el.attr('idc_name') ?? '').trim(),
      logo: attr ?? fromSrc,
    });
  });
  return out;
}

async function main() {
  const catalog = await fetchCatalog();
  const byIdc = new Map(catalog.map((c) => [c.idc, c]));
  // Fallback: mismo nombre de competición en otra temporada/edición.
  const logoByName = new Map<string, string>();
  for (const c of catalog) {
    if (c.logo && c.logo !== 'default.png' && c.name) logoByName.set(normName(c.name), c.logo);
  }

  const comps = (await db.query<{ id: string; name: string; source_ref: string | null }>(
    `SELECT id, name, source_ref FROM competitions
      WHERE organizer = ANY($1::text[]) AND archived_at IS NULL`,
    [ORGS],
  )).rows;

  log.info({ portal: PORTAL, orgs: ORGS, catalog: catalog.length, competitions: comps.length, write: WRITE }, 'Catálogo leído');

  let updated = 0;
  let skipped = 0;
  for (const comp of comps) {
    const idc = (comp.source_ref ?? '').replace(/^(fep|wse)_competition_/, '');
    if (!idc) { skipped++; continue; }
    if (ONLY.size > 0 && !ONLY.has(idc)) continue;

    const logoFile = byIdc.get(idc)?.logo
      ?? LOGO_OVERRIDES[`${PORTAL}:${idc}`]
      ?? logoByName.get(normName(comp.name));
    const logoUrl = competitionLogoUrl(PORTAL, logoFile);
    if (!logoUrl) { skipped++; continue; }

    if (WRITE) {
      const res = await db.query(
        `UPDATE competitions SET logo_url = $2, updated_at = NOW()
          WHERE id = $1 AND (logo_url IS DISTINCT FROM $2)`,
        [comp.id, logoUrl],
      );
      updated += res.rowCount ?? 0;
    } else {
      console.log(`${idc.padEnd(6)} ${logoUrl}  ${comp.name}`);
      updated++;
    }
  }

  log.info({ updated, skipped, write: WRITE }, WRITE ? '✅ Logos actualizados' : 'ℹ dry-run (usa --write)');
}

main()
  .catch((err) => { log.error({ err }, 'sync-competition-logos falló'); process.exitCode = 1; })
  .finally(() => closeDb());

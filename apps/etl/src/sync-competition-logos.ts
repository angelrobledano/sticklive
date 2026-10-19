/**
 * Sincroniza `competitions.logo_url` con el logo que publica la fuente en su
 * catálogo (`{portal}_ls_1.php` → `a.idc_master[logo]`).
 *
 * Dry-run por defecto; `--write` para aplicar. Idempotente. Solo actualiza
 * competiciones de la federación indicada (`--org`) para no cruzar refs locales
 * entre portales (los idc no están namespaced).
 *
 * Uso:
 *   npx tsx --env-file=../../.env src/sync-competition-logos.ts --portal=rfep --org=RFEP
 *   npx tsx --env-file=../../.env src/sync-competition-logos.ts --portal=rfep --org=RFEP --write
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
const ORG = argv['org'] ?? (PORTAL === 'rfep' ? 'RFEP' : PORTAL.toUpperCase());
const REFERER = argv['referer']
  ?? (PORTAL === 'rfep'
    ? 'https://www.hockeypatines.fep.es/'
    : FEDERATIONS.find((f) => f.prefix === PORTAL)?.referer ?? `https://www.${PORTAL}.cat/`);
const WRITE = argv['write'] === 'true' || argv['write'] === '1';
const ONLY = new Set((argv['only-idc'] ?? '').split(',').map((s) => s.trim()).filter(Boolean));

async function fetchCatalog(): Promise<Array<{ idc: string; logo: string | null }>> {
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
  const out: Array<{ idc: string; logo: string | null }> = [];
  $('a.idc_master').each((_, el) => {
    const $el = $(el);
    const idc = $el.attr('id');
    if (!idc) return;
    const attr = $el.attr('logo') ?? null;
    const src = attr ? null : $el.find('img').first().attr('src') ?? null;
    const fromSrc = src ? src.split('logos_competiciones/')[1]?.split('?')[0] ?? null : null;
    out.push({ idc, logo: attr ?? fromSrc });
  });
  return out;
}

async function main() {
  const catalog = await fetchCatalog();
  log.info({ portal: PORTAL, org: ORG, competitions: catalog.length, write: WRITE }, 'Catálogo leído');

  let updated = 0;
  let skipped = 0;
  for (const c of catalog) {
    if (ONLY.size > 0 && !ONLY.has(c.idc)) continue;
    const logoUrl = competitionLogoUrl(PORTAL, c.logo);
    if (!logoUrl) { skipped++; continue; }

    if (WRITE) {
      const res = await db.query(
        `UPDATE competitions
            SET logo_url = $2, updated_at = NOW()
          WHERE organizer = $3
            AND regexp_replace(COALESCE(source_ref, ''), '^(fep|wse)_competition_', '') = $1
            AND (logo_url IS DISTINCT FROM $2)`,
        [c.idc, logoUrl, ORG],
      );
      updated += res.rowCount ?? 0;
    } else {
      const res = await db.query(
        `SELECT id, name FROM competitions
          WHERE organizer = $2
            AND regexp_replace(COALESCE(source_ref, ''), '^(fep|wse)_competition_', '') = $1`,
        [c.idc, ORG],
      );
      if (res.rowCount) {
        console.log(`${c.idc.padEnd(6)} ${logoUrl}  ${res.rows.map((r) => r.name).join(' | ')}`);
        updated++;
      }
    }
  }

  log.info({ updated, skipped, write: WRITE }, WRITE ? '✅ Logos actualizados' : 'ℹ dry-run (usa --write)');
}

main()
  .catch((err) => { log.error({ err }, 'sync-competition-logos falló'); process.exitCode = 1; })
  .finally(() => closeDb());

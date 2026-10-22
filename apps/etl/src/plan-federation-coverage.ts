/**
 * B3 — CLI del plan de cobertura (ver federation-coverage.ts). Solo lee.
 *
 *   npx tsx apps/etl/src/plan-federation-coverage.ts --portal=fecapa [--temp=41]
 */
import * as cheerio from 'cheerio';
import { db, closeDb } from '@sports/db';
import { SidgadClient } from '../../scraper/src/scrapers/fep/sidgad-client.js';
import { sourceForPortal } from '../../scraper/src/core/sources.js';
import { planCoverage, type CatalogEntry } from './federation-coverage.js';

async function fetchCatalog(portal: string): Promise<CatalogEntry[]> {
  // El listado necesita la sesión del portal (cookies): sin ella sidgad responde vacío.
  const html = await new SidgadClient(sourceForPortal(portal).client).get('rfep_ls_1.php');
  const $ = cheerio.load(html);
  const out: CatalogEntry[] = [];
  $('a.idc_master').each((_, el) => {
    const $el = $(el);
    const idc = $el.attr('id') ?? '';
    if (!idc) return;
    out.push({
      idc,
      name: ($el.attr('idc_name') ?? $el.attr('name') ?? '').trim(),
      group: '',
      tempId: (($el.attr('class') ?? '').match(/temp_(\d{1,5})/) ?? [])[1] ?? null,
    });
  });
  return out;
}

async function main(): Promise<void> {
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const portal = arg('portal') ?? 'fecapa';
  const temp = arg('temp');
  const catalog = (await fetchCatalog(portal)).filter((c) => !temp || c.tempId === temp);
  const refs = new Set((await db.query<{ source_ref: string }>(
    `SELECT source_ref FROM competitions WHERE source_ref IS NOT NULL`)).rows.map((r) => r.source_ref));
  const plan = planCoverage(portal, catalog, refs);
  console.log(`# Cobertura ${portal}: ${catalog.length} en catálogo, ${plan.existing.length} ya en Stick Live, ${plan.pending.length} pendientes\n`);
  for (const p of plan.pending) {
    console.log(`## ${p.name} (idc ${p.idc}) — ${p.gender}/${p.ageCategory}${p.review ? ` · REVISAR: ${p.reason}` : ''}`);
    console.log(`${p.command}\n`);
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => closeDb());

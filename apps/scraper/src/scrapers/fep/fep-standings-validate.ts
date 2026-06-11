/**
 * Validador local del FepStandingsScraper.
 * Parsea el HTML capturado en logs/rfep_clasif_idc_3150_1.php
 * SIN hacer llamadas de red — útil para iterar el parser offline.
 *
 * Uso: npx ts-node --esm apps/scraper/src/scrapers/fep/fep-standings-validate.ts
 */
import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE_ID = 'FEP_HOCKEY_PLACEHOLDER';

function parseStatInt(text: string): number {
  const n = parseInt(text.trim(), 10);
  return isNaN(n) ? 0 : n;
}

function parseStandings(html: string) {
  const $ = cheerio.load(html);
  const results: Array<Record<string, unknown>> = [];
  let currentGroup: string | undefined;

  // Iterar nodos del body para mantener orden DOM
  $('body').children().each((_, node) => {
    const $node = $(node);

    if ($node.hasClass('div_titulo_fase_idc')) {
      const rawText =
        $node.find('.lang_label.lang_es').first().text().trim() ||
        $node.text().trim();
      if (rawText && rawText.toUpperCase() !== 'CLASIFICACIÓN') {
        currentGroup = rawText;
      }
    }

    const $table = $node.is('table.tabla_clasif')
      ? $node
      : $node.find('table.tabla_clasif').first();

    if (!$table.length) return;

    $table.find('tbody tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 10) return;

      const posText = cells.eq(0).text().trim();
      const position = parseInt(posText, 10);
      if (!position || isNaN(position)) return;

      const logoSrc = cells.eq(1).find('img').attr('src') ?? '';
      const logoFile = logoSrc.split('/').pop() ?? '';
      const teamName =
        cells.eq(2).find('.no_mobile').first().text().trim() ||
        cells.eq(2).text().trim();
      const abbreviation = cells.eq(2).find('.mobile').first().text().trim();

      if (!teamName) return;

      results.push({
        position,
        teamName,
        abbreviation,
        logoFile,
        group: currentGroup ?? null,
        points: parseStatInt(cells.eq(3).text()),
        played: parseStatInt(cells.eq(4).text()),
        won: parseStatInt(cells.eq(5).text()),
        drawn: parseStatInt(cells.eq(6).text()),
        lost: parseStatInt(cells.eq(7).text()),
        goalsFor: parseStatInt(cells.eq(8).text()),
        goalsAgainst: parseStatInt(cells.eq(9).text()),
      });
    });
  });

  // Fallback si el HTML viene sin wrapper body
  if (results.length === 0) {
    $('table.tabla_clasif tbody tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 10) return;
      const position = parseInt(cells.eq(0).text().trim(), 10);
      if (!position || isNaN(position)) return;
      const teamName =
        cells.eq(2).find('.no_mobile').first().text().trim() ||
        cells.eq(2).text().trim();
      if (!teamName) return;
      results.push({
        position,
        teamName,
        abbreviation: cells.eq(2).find('.mobile').first().text().trim(),
        logoFile: (cells.eq(1).find('img').attr('src') ?? '').split('/').pop(),
        group: null,
        points: parseStatInt(cells.eq(3).text()),
        played: parseStatInt(cells.eq(4).text()),
        won: parseStatInt(cells.eq(5).text()),
        drawn: parseStatInt(cells.eq(6).text()),
        lost: parseStatInt(cells.eq(7).text()),
        goalsFor: parseStatInt(cells.eq(8).text()),
        goalsAgainst: parseStatInt(cells.eq(9).text()),
      });
    });
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────

const htmlPath = join(process.cwd(), 'logs', 'rfep_clasif_idc_3150_1_full.html');
let html: string;
try {
  html = readFileSync(htmlPath, 'utf-8');
} catch {
  console.error(`❌ No se encuentra el archivo: ${htmlPath}`);
  console.error('   Ejecuta primero fep-clasif-probe2.ts para capturar el HTML.');
  process.exit(1);
}

console.log(`📄 HTML cargado: ${html.length} bytes\n`);
const standings = parseStandings(html);

if (standings.length === 0) {
  console.log('⚠️  No se encontraron filas. Revisa el selector tabla_clasif.');
  console.log('\n── Primeros 2000 chars del HTML ──');
  console.log(html.slice(0, 2000));
} else {
  console.log(`✅ ${standings.length} equipos encontrados:\n`);
  console.log('Pos  Equipo                          Abr  Pts  PJ  PG  PE  PP  GF  GC');
  console.log('───  ──────────────────────────────  ───  ───  ──  ──  ──  ──  ──  ──');
  for (const s of standings) {
    const name = String(s.teamName).padEnd(32);
    const abbr = String(s.abbreviation).padEnd(4);
    console.log(
      `${String(s.position).padStart(3)}  ${name}  ${abbr}` +
      `  ${String(s.points).padStart(3)}  ${String(s.played).padStart(2)}  ${String(s.won).padStart(2)}` +
      `  ${String(s.drawn).padStart(2)}  ${String(s.lost).padStart(2)}  ${String(s.goalsFor).padStart(2)}  ${String(s.goalsAgainst).padStart(2)}`
    );
  }
}

console.log('\n⚠️  Nota: el HTML capturado está truncado a 8000 chars.');
console.log('   Para validar la tabla completa, ejecuta una sonda con límite de bytes ampliado.');

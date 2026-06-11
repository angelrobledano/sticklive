/**
 * Probe: Mapear club_XX (CSS class de rfep_mc_1.php) → source_ref del equipo en DB.
 *
 * El endpoint rfep_mc_1.php identifica los equipos con clases CSS como
 * "club_44 club_45", que son IDs distintos al sistema de IDs de la API
 * de competición (3373, 3408...) que usa el calendario.
 *
 * Este script:
 *  1. Descarga rfep_mc_1.php
 *  2. Extrae todos los pares (clubId, abbr) de cada partido
 *  3. Cruza las abreviaturas con los short_name de equipos en DB
 *  4. Genera las sentencias SQL para poblar alt_source_refs
 *  5. Ejecuta los UPDATEs directamente si se pasa --apply
 *
 * Uso:
 *   npx tsx --env-file .env apps/scraper/src/scrapers/fep/fep-club-id-probe.ts
 *   npx tsx --env-file .env apps/scraper/src/scrapers/fep/fep-club-id-probe.ts --apply
 */
import * as cheerio from 'cheerio';
import { sidgadPost } from './sidgad-client.js';
import { db, closeDb } from '@sports/db';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log('📡 Descargando rfep_mc_1.php...');
  const html = await sidgadPost('rfep_mc_1.php', {});

  const $ = cheerio.load(html);

  // Mapa: clubId (string) → Set de abreviaturas vistas con ese ID
  const clubAbbrs = new Map<string, Set<string>>();

  $('a.scorer_game, div.scorer_game').each((_, el) => {
    const $el = $(el);
    const classes = ($el.attr('class') ?? '').split(/\s+/);
    const clubClasses = classes.filter(c => c.startsWith('club_') && c !== 'club_');

    const homeClubId = clubClasses[0]?.replace('club_', '');
    const awayClubId = clubClasses[1]?.replace('club_', '');
    const homeAbbr   = $el.find('.scorer_team_left').text().trim();
    const awayAbbr   = $el.find('.scorer_team_right').text().trim();

    if (homeClubId && homeAbbr) {
      if (!clubAbbrs.has(homeClubId)) clubAbbrs.set(homeClubId, new Set());
      clubAbbrs.get(homeClubId)!.add(homeAbbr);
    }
    if (awayClubId && awayAbbr) {
      if (!clubAbbrs.has(awayClubId)) clubAbbrs.set(awayClubId, new Set());
      clubAbbrs.get(awayClubId)!.add(awayAbbr);
    }
  });

  console.log(`\n🔍 Club IDs encontrados en el feed: ${clubAbbrs.size}`);

  // Obtener todos los equipos de hockey patines
  const { rows: teams } = await db.query<{
    id: string;
    name: string;
    short_name: string | null;
    source_ref: string | null;
    alt_source_refs: string[];
  }>(
    `SELECT id, name, short_name, source_ref, alt_source_refs
     FROM teams
     WHERE sport_id = (SELECT id FROM sports WHERE slug = 'hockey-patines')`
  );

  // Normalizar para comparación
  const normalize = (s: string) => s.toUpperCase().trim();

  const results: Array<{
    clubId: string;
    abbr: string;
    teamName: string;
    teamSourceRef: string;
    teamId: string;
    alreadyRegistered: boolean;
  }> = [];

  const unmatched: Array<{ clubId: string; abbrs: string[] }> = [];

  for (const [clubId, abbrs] of clubAbbrs.entries()) {
    const abbrList = [...abbrs];
    let matched = false;

    for (const abbr of abbrList) {
      const normalAbbr = normalize(abbr);
      const team = teams.find(t =>
        t.short_name && normalize(t.short_name) === normalAbbr
      );

      if (team) {
        const fepClubRef = `fep_club_${clubId}`;
        results.push({
          clubId,
          abbr,
          teamName: team.name,
          teamSourceRef: team.source_ref ?? '??',
          teamId: team.id,
          alreadyRegistered: team.alt_source_refs.includes(fepClubRef),
        });
        matched = true;
        break;
      }
    }

    if (!matched) {
      unmatched.push({ clubId, abbrs: abbrList });
    }
  }

  // ── Mostrar resultados ────────────────────────────────────────
  console.log('\n✅ Mapeos encontrados:');
  console.log('─'.repeat(70));
  for (const r of results) {
    const status = r.alreadyRegistered ? '(ya registrado)' : '← NUEVO';
    console.log(
      `  club_${r.clubId.padEnd(4)} | abbr=${r.abbr.padEnd(6)} | ${r.teamName} (${r.teamSourceRef}) ${status}`
    );
  }

  if (unmatched.length > 0) {
    console.log('\n⚠️  Sin match en DB (equipos de otras competiciones — esperado):');
    for (const u of unmatched) {
      console.log(`  club_${u.clubId.padEnd(4)} | abbrs=[${u.abbrs.join(', ')}]`);
    }
  }

  // ── SQL a ejecutar ────────────────────────────────────────────
  const newMappings = results.filter(r => !r.alreadyRegistered);

  if (newMappings.length === 0) {
    console.log('\n✅ No hay nuevos alt_source_refs que añadir.');
    return;
  }

  console.log('\n📝 SQL para poblar alt_source_refs:');
  console.log('─'.repeat(70));
  for (const r of newMappings) {
    const fepClubRef = `fep_club_${r.clubId}`;
    console.log(
      `UPDATE teams SET alt_source_refs = array_append(alt_source_refs, '${fepClubRef}'), updated_at = NOW() WHERE id = '${r.teamId}'; -- ${r.teamName}`
    );
  }

  if (APPLY) {
    console.log('\n⚡ Aplicando UPDATEs...');
    for (const r of newMappings) {
      const fepClubRef = `fep_club_${r.clubId}`;
      await db.query(
        `UPDATE teams
         SET alt_source_refs = array_append(alt_source_refs, $2),
             updated_at = NOW()
         WHERE id = $1
           AND NOT ($2 = ANY(alt_source_refs))`,
        [r.teamId, fepClubRef]
      );
      console.log(`  ✅ ${r.teamName} ← ${fepClubRef}`);
    }
    console.log('\n✅ alt_source_refs actualizados. El RefResolver ya puede resolver estos IDs.');
  } else {
    console.log('\n💡 Pasa --apply para ejecutar los UPDATEs directamente.');
  }
}

main()
  .catch((err) => { console.error('Error:', err); process.exit(1); })
  .finally(() => closeDb());

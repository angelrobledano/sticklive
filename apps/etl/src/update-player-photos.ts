/**
 * Actualiza photo_url de cada jugador a la foto más reciente disponible
 * en sidgad. El patrón es fichas/{id_player}_{n}.jpg — n parece ser el
 * índice de foto (1 = primera subida). Sondeamos de mayor a menor y nos
 * quedamos con el índice más alto que exista.
 *
 * Uso: npx tsx --env-file=.env apps/etl/src/update-player-photos.ts
 */
import { db, closeDb } from '@sports/db';

const CDN = 'https://sidgad.cloud/rfep/images/fichas';
const MAX_INDEX = 6; // sondear _6.._1
const HEADERS = {
  'Referer': 'https://www.hockeypatines.fep.es/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: HEADERS });
    if (res.ok) return true;
    // Algunos CDNs no soportan HEAD — reintentar con GET parcial
    if (res.status === 405 || res.status === 403) {
      const get = await fetch(url, { headers: { ...HEADERS, Range: 'bytes=0-0' } });
      return get.ok;
    }
    return false;
  } catch {
    return false;
  }
}

void (async () => {
  const { rows: players } = await db.query<{ id: string; source_ref: string; photo_url: string | null }>(
    `SELECT id, source_ref, photo_url FROM players WHERE source_ref LIKE 'fep_player_%'`
  );
  console.log(`${players.length} jugadores a comprobar\n`);

  let updated = 0, unchanged = 0, missing = 0;

  for (const p of players) {
    const idNum = p.source_ref.replace('fep_player_', '');
    let best: string | null = null;
    for (let n = MAX_INDEX; n >= 1; n--) {
      const url = `${CDN}/${idNum}_${n}.jpg`;
      // eslint-disable-next-line no-await-in-loop
      if (await exists(url)) { best = url; break; }
    }

    if (!best) {
      missing++;
      console.log(`  ∅ ${idNum} — sin foto en el CDN`);
    } else if (best !== p.photo_url) {
      await db.query(`UPDATE players SET photo_url = $2, updated_at = NOW() WHERE id = $1`, [p.id, best]);
      updated++;
      console.log(`  ✅ ${idNum} → ${best.split('/').pop()}`);
    } else {
      unchanged++;
    }
    // Pausa de cortesía
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n🏁 ${updated} actualizadas · ${unchanged} ya al día · ${missing} sin foto`);
  await closeDb();
})();

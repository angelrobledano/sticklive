/**
 * Repara `players.photo_url`: la deja apuntando a la foto que REALMENTE existe
 * en el CDN, o a NULL si el jugador no tiene ninguna.
 *
 * Antes solo sondeaba `{id}_{1..6}.jpg` y no limpiaba nunca, así que:
 *   · las fotos servidas como `{id}.jpg` (sin `_n`) quedaban en un `{id}_1.jpg`
 *     muerto → 404 → silueta en la web (≈29 % de la muestra auditada);
 *   · un jugador sin foto conservaba una URL inventada por el scraper.
 *
 * Ahora usa `player-photo-url.ts` (candidatos `{id}_{6..1}.jpg` + `{id}.jpg`) y
 * escribe el resultado verificado, incluido NULL. Pasada RÁPIDA: si la URL
 * guardada sigue existiendo, no re-sondea candidatos. Con concurrencia acotada
 * para poder programarlo a diario sin martillear el CDN.
 *
 * Uso: node dist/apps/etl/src/update-player-photos.js   (o tsx en local)
 */
import { db, closeDb } from '@sports/db';
import { forEachLimited } from './concurrency.js';
import { idNumFromSourceRef, resolvePlayerPhotoIfNeeded } from './player-photo-url.js';

const CONCURRENCY = Number(process.env['PLAYER_PHOTO_CONCURRENCY'] ?? 8);

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
  const { rows } = await db.query<{ id: string; source_ref: string; photo_url: string | null }>(
    `SELECT id, source_ref, photo_url FROM players WHERE source_ref LIKE 'fep_player_%'`
  );
  console.log(`${rows.length} jugadores a comprobar (concurrencia ${CONCURRENCY})\n`);

  let updated = 0, cleared = 0, unchanged = 0, skipped = 0, failed = 0;

  await forEachLimited(rows, CONCURRENCY, async (p) => {
    const idNum = idNumFromSourceRef(p.source_ref);
    if (!idNum) { skipped++; return; }

    try {
      const best = await resolvePlayerPhotoIfNeeded(idNum, p.photo_url, exists);
      if (best === p.photo_url) { unchanged++; return; }

      await db.query(`UPDATE players SET photo_url = $2, updated_at = NOW() WHERE id = $1`, [p.id, best]);
      if (best) {
        updated++;
        console.log(`  ✅ ${idNum} → ${best.split('/').pop()}`);
      } else {
        cleared++;
        console.log(`  ∅ ${idNum} — sin foto en el CDN; photo_url limpiado`);
      }
    } catch (e) {
      failed++;
      console.error(`  ⚠️  ${idNum}: ${String(e)}`);
    }
  });

  console.log(
    `\n🏁 ${updated} actualizadas · ${cleared} limpiadas (sin foto) · ${unchanged} ya al día` +
    (skipped ? ` · ${skipped} refs ilegibles` : '') +
    (failed ? ` · ${failed} fallidas` : '')
  );
  await closeDb();
})();

/**
 * Repara `players.photo_url`: la deja apuntando a la foto que REALMENTE existe
 * en el CDN, o a NULL si el jugador no tiene ninguna.
 *
 * El CDN está partido POR PORTAL (`/rfep/images/fichas` para clubes FEP,
 * `/worldskate/images/fichas` para selecciones) y los ids de cada portal son
 * espacios DISTINTOS: el mismo jugador tiene un id en cada uno (Marc Grau es
 * 4646 en el portal FEP y 192 en World Skate). El portal de cada jugador sale
 * de la ref de sus equipos (`wse_*` → World Skate; resto → rfep). Sondear el
 * portal equivocado no da un 404 limpio: cuando el número colisiona devuelve la
 * foto de OTRO jugador (la ficha de España mostraba caras de jugadores de club).
 *
 * La pasada RÁPIDA solo conserva la URL guardada si es candidata del jugador en
 * su portal; una URL de otro portal/id se re-resuelve (antes quedaba fijada).
 *
 * Uso: node dist/apps/etl/src/update-player-photos.js   (o tsx en local)
 */
import { db, closeDb } from '@sports/db';
import { forEachLimited } from './concurrency.js';
import {
  photoTargetFromRef,
  resolvePlayerPhotoIfNeeded,
} from './player-photo-url.js';

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
  // Portal por jugador desde la ref de sus equipos (`wse_*` → World Skate).
  const { rows } = await db.query<{
    id: string;
    source_ref: string;
    photo_url: string | null;
    team_refs: (string | null)[] | null;
  }>(
    `SELECT p.id, p.source_ref, p.photo_url,
            array_agg(DISTINCT t.source_ref) FILTER (WHERE t.source_ref IS NOT NULL) AS team_refs
       FROM players p
       LEFT JOIN team_players tp ON tp.player_id = p.id
       LEFT JOIN teams t ON t.id = tp.team_id
      WHERE p.source_ref LIKE '%\\_player\\_%'
      GROUP BY p.id, p.source_ref, p.photo_url`
  );
  console.log(`${rows.length} jugadores a comprobar (concurrencia ${CONCURRENCY})\n`);

  let updated = 0, cleared = 0, unchanged = 0, skipped = 0, failed = 0;

  await forEachLimited(rows, CONCURRENCY, async (p) => {
    const target = photoTargetFromRef(p.source_ref, p.team_refs ?? []);
    if (!target) { skipped++; return; }
    const { idNum, area } = target;

    try {
      const best = await resolvePlayerPhotoIfNeeded(idNum, area, p.photo_url, exists);
      if (best === p.photo_url) { unchanged++; return; }

      await db.query(`UPDATE players SET photo_url = $2, updated_at = NOW() WHERE id = $1`, [p.id, best]);
      if (best) {
        updated++;
        console.log(`  ✅ ${idNum} [${area}] → ${best.split('/').pop()}`);
      } else {
        cleared++;
        console.log(`  ∅ ${idNum} [${area}] — sin foto en el CDN; photo_url limpiado`);
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

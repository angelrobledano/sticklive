/**
 * A4 — la capa de club, viva y anclada en el id de CLUB de sidgad.
 *
 * Caso real: Calafell aparece en producción como cinco equipos ("CALAFELL LA
 * MENORQUINA", "PARLEM CALAFELL", "CP CALAFELL TOT L'ANY"…) y cuatro sin club,
 * porque `clubs` solo se rellenó una vez (backfill 1:1 del 03/08) y el nombre
 * comercial cambia con el patrocinador. Todos comparten escudo
 * `logos_clubes/calafell.png`: esa es la clave estable.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, ensureClubForTeam } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo, crearFuente } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

const clubDe = async (teamId: string) =>
  (await db.query<{ club_id: string | null }>(`SELECT club_id FROM teams WHERE id = $1`, [teamId])).rows[0]!.club_id;

describe('A4 — ensureClubForTeam', () => {
  it('crea el club la primera vez y registra su ref de fuente', async () => {
    const sportId = await crearDeporte();
    const sourceId = await crearFuente();
    const t = await crearEquipo(sportId, 'CALAFELL LA MENORQUINA');
    const clubId = await ensureClubForTeam({
      teamId: t, sourceId, clubRef: 'fep_club_calafell', name: 'CALAFELL LA MENORQUINA',
      crestUrl: 'https://sidgad.cloud/rfep/images/logos_clubes/calafell.png',
    });
    expect(await clubDe(t)).toBe(clubId);
    const map = await db.query(`SELECT club_id FROM source_entity_map WHERE source_ref = 'fep_club_calafell'`);
    expect(map.rows).toEqual([{ club_id: clubId }]);
  });

  it('otro equipo con la misma ref de club cuelga del MISMO club (cambio de patrocinador)', async () => {
    const sportId = await crearDeporte();
    const sourceId = await crearFuente();
    const actual = await crearEquipo(sportId, 'CALAFELL LA MENORQUINA');
    const antiguo = await crearEquipo(sportId, 'PARLEM CALAFELL');
    const c1 = await ensureClubForTeam({ teamId: actual, sourceId, clubRef: 'fep_club_calafell', name: 'CALAFELL LA MENORQUINA' });
    const c2 = await ensureClubForTeam({ teamId: antiguo, sourceId, clubRef: 'fep_club_calafell', name: 'PARLEM CALAFELL' });
    expect(c2).toBe(c1);
    const n = await db.query(`SELECT count(*)::int AS n FROM clubs`);
    expect(n.rows[0]!.n).toBe(1);
  });

  it('si el equipo ya tenía club (backfill 1:1), lo reutiliza y aprende la ref', async () => {
    const sportId = await crearDeporte();
    const sourceId = await crearFuente();
    const t = await crearEquipo(sportId, 'IGUALADA HC');
    const pre = (await db.query<{ id: string }>(
      `INSERT INTO clubs (sport_id, canonical_name, slug) VALUES ($1,'IGUALADA HC','igualada-hc') RETURNING id`, [sportId])).rows[0]!.id;
    await db.query(`UPDATE teams SET club_id = $1 WHERE id = $2`, [pre, t]);
    const c = await ensureClubForTeam({ teamId: t, sourceId, clubRef: 'fep_club_69', name: 'IGUALADA HC' });
    expect(c).toBe(pre);
    const map = await db.query(`SELECT club_id FROM source_entity_map WHERE source_ref = 'fep_club_69'`);
    expect(map.rows).toEqual([{ club_id: pre }]);
  });

  it('nunca reasigna un equipo que ya cuelga de OTRO club (eso es HITL)', async () => {
    const sportId = await crearDeporte();
    const sourceId = await crearFuente();
    const a = await crearEquipo(sportId, 'A');
    const b = await crearEquipo(sportId, 'B');
    const ca = await ensureClubForTeam({ teamId: a, sourceId, clubRef: 'fep_club_1', name: 'A' });
    await ensureClubForTeam({ teamId: b, sourceId, clubRef: 'fep_club_2', name: 'B' });
    const r = await ensureClubForTeam({ teamId: b, sourceId, clubRef: 'fep_club_1', name: 'B' });
    expect(r).not.toBe(ca);
    expect(await clubDe(b)).not.toBe(ca);
  });

  it('dos clubes con el mismo nombre no chocan por slug', async () => {
    const sportId = await crearDeporte();
    const sourceId = await crearFuente();
    const a = await crearEquipo(sportId, 'CP VILANOVA');
    const b = await crearEquipo(sportId, 'CP VILANOVA');
    const ca = await ensureClubForTeam({ teamId: a, sourceId, clubRef: 'fep_club_vilanova', name: 'CP VILANOVA' });
    const cb = await ensureClubForTeam({ teamId: b, sourceId, clubRef: 'fecapa_club_302', name: 'CP VILANOVA' });
    expect(cb).not.toBe(ca);
  });
});

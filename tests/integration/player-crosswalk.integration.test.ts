/**
 * B1 — una persona, varias refs de fuente (crosswalk entre portales).
 *
 * Martí Serra Molist es `fep_player_4095` (RFEP), `fecapa_player_14782` y
 * `wse_player_3801`. Tras A1 son tres filas separadas (correcto: no se fusiona
 * por número). B1 permite declarar que son la misma persona, con revisión
 * humana, pares prohibidos y redirección de la ficha absorbida. Es lo que hace
 * el `person-xwalk` de OKMob (persons + forbid + moved), dentro de nuestro modelo.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb, findPlayerIdBySourceRef, addPlayerSourceRef, linkPlayers, forbidPlayerLink,
  generatePlayerLinkCandidates, listPlayerLinkCandidates, resolveEntityRedirect,
  acceptPlayerLinkCandidate, rejectPlayerLinkCandidate,
} from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function jugador(sportId: string, first: string, last: string, ref: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref) VALUES ($1,$2,$3,$4,$4) RETURNING id`,
    [sportId, first, last, ref],
  );
  await addPlayerSourceRef(rows[0]!.id, ref, 'test');
  return rows[0]!.id;
}

describe('B1 — refs múltiples por persona', () => {
  it('la 084 rellena player_source_refs con la ref de cada jugador ya existente', async () => {
    const sportId = await crearDeporte();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref) VALUES ($1,'A','B','ab','fep_player_1') RETURNING id`, [sportId]);
    await db.query(`SELECT backfill_player_source_refs()`);
    await expect(findPlayerIdBySourceRef('fep_player_1')).resolves.toBe(rows[0]!.id);
  });

  it('una ref solo puede pertenecer a una persona', async () => {
    const sportId = await crearDeporte();
    const a = await jugador(sportId, 'A', 'A', 'fep_player_1');
    const b = await jugador(sportId, 'B', 'B', 'fep_player_2');
    await expect(addPlayerSourceRef(b, 'fep_player_1', 'test')).resolves.toBe(false);
    await expect(findPlayerIdBySourceRef('fep_player_1')).resolves.toBe(a);
  });
});

describe('B1 — linkPlayers', () => {
  it('absorbe la ficha FECAPA en la RFEP: refs, plantillas, alineaciones, eventos y redirección', async () => {
    const sportId = await crearDeporte();
    const rfep = await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fep_player_4095');
    const fecapa = await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fecapa_player_14782');
    const season = await crearTemporada(await crearCompeticion(sportId));
    const [t1, t2] = [await crearEquipo(sportId, 'CALAFELL'), await crearEquipo(sportId, 'BARÇA')];
    await db.query(`INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1,$2,$3)`, [season, t1, fecapa]);
    const m = (await db.query<{ id: string; scheduled_at: Date }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
       VALUES ($1,$2,$3,'finished','2026-10-18T18:00:00Z','fecapa_match_164291') RETURNING id, scheduled_at`,
      [season, t1, t2])).rows[0]!;
    await db.query(`INSERT INTO match_lineups (match_id, is_home, player_name, player_id) VALUES ($1, TRUE, 'SERRA MOLIST MARTÍ', $2)`, [m.id, fecapa]);
    await db.query(
      `INSERT INTO match_events (match_id, match_date, player_id, event_type, source_ref) VALUES ($1, $2::date, $3, 'goal', 'e1')`,
      [m.id, m.scheduled_at, fecapa]);

    await linkPlayers(rfep, fecapa, 'human:admin');

    await expect(findPlayerIdBySourceRef('fecapa_player_14782')).resolves.toBe(rfep);
    const cuenta = async (t: string) => (await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE player_id = $1`, [rfep])).rows[0]!.n;
    expect(await cuenta('team_players')).toBe(1);
    expect(await cuenta('match_lineups')).toBe(1);
    expect(await cuenta('match_events')).toBe(1);
    const sigue = await db.query(`SELECT count(*)::int AS n FROM players WHERE id = $1`, [fecapa]);
    expect(sigue.rows[0]!.n).toBe(0);
    await expect(resolveEntityRedirect('player', fecapa)).resolves.toEqual({ status: 'moved', newId: rfep });
  });

  it('un par prohibido no se enlaza', async () => {
    const sportId = await crearDeporte();
    const a = await jugador(sportId, 'JUAN', 'PEREZ', 'fep_player_1');
    const b = await jugador(sportId, 'JUAN', 'PEREZ', 'fecapa_player_9');
    await forbidPlayerLink('fep_player_1', 'fecapa_player_9', 'homónimos, clubes distintos');
    await expect(linkPlayers(a, b, 'human:admin')).rejects.toThrow(/prohibid/i);
  });
});

describe('B1 — candidatos', () => {
  it('propone el mismo nombre en portales distintos, nunca dentro del mismo portal ni pares prohibidos', async () => {
    const sportId = await crearDeporte();
    const rfep = await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fep_player_4095');
    const fecapa = await jugador(sportId, 'Martí', 'Serra  Molist', 'fecapa_player_14782');
    await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fep_player_9999');
    const x = await jugador(sportId, 'POL', 'GALBAS', 'fep_player_4716');
    await jugador(sportId, 'POL', 'GALBAS', 'wse_player_4716');
    await forbidPlayerLink('fep_player_4716', 'wse_player_4716', 'personas distintas (A2)');

    const n = await generatePlayerLinkCandidates();
    const cands = await listPlayerLinkCandidates('pending');
    expect(n).toBe(2);
    expect(cands.every((c) => c.playerA !== x && c.playerB !== x)).toBe(true);
    expect(cands.some((c) => [c.playerA, c.playerB].sort().join() === [rfep, fecapa].sort().join())).toBe(true);
    // Idempotente
    await expect(generatePlayerLinkCandidates()).resolves.toBe(0);
  });
});

describe('B1 — revisión de candidatos', () => {
  it('aceptar enlaza en la ficha más antigua', async () => {
    const sportId = await crearDeporte();
    const vieja = await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fep_player_4095');
    const nueva = await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fecapa_player_14782');
    await generatePlayerLinkCandidates();
    const [c] = await listPlayerLinkCandidates('pending');
    await expect(acceptPlayerLinkCandidate(c!.id, 'human:admin')).resolves.toEqual({ keepId: vieja, absorbedId: nueva });
    await expect(findPlayerIdBySourceRef('fecapa_player_14782')).resolves.toBe(vieja);
  });

  it('aceptar conserva la ficha RFEP aunque la autonómica sea más antigua', async () => {
    const sportId = await crearDeporte();
    const fecapa = await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fecapa_player_14782');
    await db.query(`UPDATE players SET created_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [fecapa]);
    const rfep = await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fep_player_4095');
    await generatePlayerLinkCandidates();
    const [c] = await listPlayerLinkCandidates('pending');
    await expect(acceptPlayerLinkCandidate(c!.id, 'human:admin')).resolves.toEqual({ keepId: rfep, absorbedId: fecapa });
    await expect(findPlayerIdBySourceRef('fecapa_player_14782')).resolves.toBe(rfep);
  });

  it('rechazar prohíbe el par: no se vuelve a proponer', async () => {
    const sportId = await crearDeporte();
    await jugador(sportId, 'JUAN', 'PEREZ GARCIA', 'fep_player_1');
    await jugador(sportId, 'JUAN', 'PEREZ GARCIA', 'fecapa_player_1');
    await generatePlayerLinkCandidates();
    const [c] = await listPlayerLinkCandidates('pending');
    await expect(rejectPlayerLinkCandidate(c!.id)).resolves.toBe(true);
    await db.query(`DELETE FROM player_link_candidates`);
    await expect(generatePlayerLinkCandidates()).resolves.toBe(0);
  });
});

describe('B1 — contexto de cada candidato para el panel', () => {
  it('cada lado trae sus refs, su foto y sus equipos por temporada y competición', async () => {
    const sportId = await crearDeporte();
    const rfep = await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fep_player_4095');
    const fecapa = await jugador(sportId, 'MARTÍ', 'SERRA MOLIST', 'fecapa_player_14782');
    await db.query(`UPDATE players SET photo_url = 'https://x/4095_1.jpg' WHERE id = $1`, [rfep]);
    const comp = (await db.query<{ id: string }>(
      `INSERT INTO competitions (sport_id, name, slug) VALUES ($1,'OK LIGA MASCULINA','okl') RETURNING id`, [sportId])).rows[0]!.id;
    const season = (await db.query<{ id: string }>(
      `INSERT INTO seasons (competition_id, name, slug) VALUES ($1,'2025/26','2025-26') RETURNING id`, [comp])).rows[0]!.id;
    const calafell = await crearEquipo(sportId, 'CALAFELL LA MENORQUINA');
    await db.query(`INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1,$2,$3)`, [season, calafell, rfep]);

    await generatePlayerLinkCandidates();
    const [c] = await listPlayerLinkCandidates('pending');
    const lado = c!.a.id === rfep ? c!.a : c!.b;
    const otro = c!.a.id === rfep ? c!.b : c!.a;
    expect(lado).toMatchObject({
      name: 'MARTÍ SERRA MOLIST',
      refs: ['fep_player_4095'],
      photoUrl: 'https://x/4095_1.jpg',
      teams: [{ team: 'CALAFELL LA MENORQUINA', season: '2025/26', competition: 'OK LIGA MASCULINA' }],
    });
    expect(otro).toMatchObject({ id: fecapa, refs: ['fecapa_player_14782'], teams: [] });
  });
});

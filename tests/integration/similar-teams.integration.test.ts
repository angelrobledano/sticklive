/**
 * Candidatos por similitud de NOMBRE contra equipos reales (findSimilarTeamNames).
 *
 * Es el escalón que evita crear un duplicado cuando un club cambia de
 * patrocinador entre temporadas: el generador por alias no lo ve (esos alias aún
 * no existen) y el slug tampoco ("vicio-phc-sant-cugat" ≠ "oxigen-phc-sant-cugat").
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, findSimilarTeamNames } from '@sports/db';
import { limpiar } from './support/db.js';

beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

async function sembrarDeporte(): Promise<string> {
  const s = await db.query<{ id: string }>(
    `INSERT INTO sports (name, slug) VALUES ('Hockey patines', 'hockey-patines') RETURNING id`
  );
  return s.rows[0]!.id;
}

async function sembrarEquipo(
  sportId: string, name: string, slug: string,
  gender: string | null, ageCategory: string | null,
): Promise<string> {
  const t = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, gender, age_category)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [sportId, name, slug, gender, ageCategory]
  );
  return t.rows[0]!.id;
}

describe('findSimilarTeamNames', () => {
  it('detecta el club renombrado por patrocinio (mismo club, otro nombre)', async () => {
    const sportId = await sembrarDeporte();
    const oxigen = await sembrarEquipo(sportId, 'OXIGEN PHC SANT CUGAT', 'oxigen-phc-sant-cugat', 'female', 'senior');

    const cands = await findSimilarTeamNames('VICIO PHC SANT CUGAT', sportId, { gender: 'female', ageCategory: 'senior' });
    expect(cands.map((c) => c.teamId)).toContain(oxigen);
    expect(cands[0]!.score).toBeGreaterThanOrEqual(0.35);
  });

  it('no inventa candidatos para un equipo realmente nuevo', async () => {
    const sportId = await sembrarDeporte();
    await sembrarEquipo(sportId, 'OXIGEN PHC SANT CUGAT', 'oxigen-phc-sant-cugat', 'female', 'senior');

    const cands = await findSimilarTeamNames('MARINEDA HOCKEY', sportId, { gender: 'female', ageCategory: 'senior' });
    expect(cands).toEqual([]);
  });

  it('bloquea por género (no propone la sección masculina)', async () => {
    const sportId = await sembrarDeporte();
    await sembrarEquipo(sportId, 'OXIGEN PHC SANT CUGAT', 'oxigen-phc-sant-cugat', 'female', 'senior');

    const cands = await findSimilarTeamNames('VICIO PHC SANT CUGAT', sportId, { gender: 'male', ageCategory: 'senior' });
    expect(cands).toEqual([]);
  });
});

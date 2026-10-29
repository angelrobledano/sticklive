/**
 * Asignar club a un equipo sin fusionar: el equipo sigue siendo una plantilla
 * independiente (p. ej. «HC ALPICAT» sin letra, que puede ser el B o el C).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, setTeamClub, SetTeamClubError, setTeamSection } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function club(sportId: string, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO clubs (sport_id, canonical_name, slug) VALUES ($1, $2, $2) RETURNING id`, [sportId, slug])).rows[0]!.id;
}

describe('setTeamClub', () => {
  it('cuelga el equipo del club y lo puede soltar, sin tocar al resto', async () => {
    const sportId = await crearDeporte();
    const alpicat = await club(sportId, 'hc-alpicat');
    const suelto = await crearEquipo(sportId, 'HC ALPICAT');
    const otro = await crearEquipo(sportId, 'HOQUEI CLUB ALPICAT');

    await expect(setTeamClub(suelto, alpicat)).resolves.toEqual({
      teamId: suelto, club: { id: alpicat, name: 'hc-alpicat', slug: 'hc-alpicat' },
    });
    const clubDe = async (id: string) => (await db.query<{ club_id: string | null }>(`SELECT club_id FROM teams WHERE id = $1`, [id])).rows[0]!.club_id;
    expect(await clubDe(suelto)).toBe(alpicat);
    expect(await clubDe(otro)).toBeNull();

    await expect(setTeamClub(suelto, null)).resolves.toEqual({ teamId: suelto, club: null });
    expect(await clubDe(suelto)).toBeNull();
  });

  it('rechaza un club de otro deporte o un equipo inexistente', async () => {
    const hockey = await crearDeporte();
    const otroDeporte = await crearDeporte('futbol');
    const equipo = await crearEquipo(hockey, 'X');
    await expect(setTeamClub(equipo, await club(otroDeporte, 'ajeno'))).rejects.toBeInstanceOf(SetTeamClubError);
    await expect(setTeamClub('00000000-0000-0000-0000-000000000000', null)).rejects.toBeInstanceOf(SetTeamClubError);
  });
});

describe('setTeamSection', () => {
  it('completa género, categoría y plantilla de un equipo creado sin sección', async () => {
    const sportId = await crearDeporte();
    const t = await crearEquipo(sportId, 'ROTOTANK CHP BIGUES I RIELLS B');
    await expect(setTeamSection(t, { gender: 'male', ageCategory: 'prebenjamin', squadLevel: 2 }))
      .resolves.toEqual({ teamId: t, gender: 'male', ageCategory: 'prebenjamin', squadLevel: 2 });
    const { rows: [r] } = await db.query(`SELECT gender, age_category, squad_level FROM teams WHERE id = $1`, [t]);
    expect(r).toEqual({ gender: 'male', age_category: 'prebenjamin', squad_level: 2 });
    await expect(setTeamSection('00000000-0000-0000-0000-000000000000', { gender: null, ageCategory: null, squadLevel: 1 }))
      .rejects.toBeInstanceOf(SetTeamClubError);
  });
});

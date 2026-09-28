import { describe, it, expect } from 'vitest';
import { buildPlayerCareer } from './player-career.js';
import type { CareerRow } from './player-career.js';

/**
 * Carrera del jugador (#217): la ruta `GET /players/:id` entrega filas ya
 * agregadas por (temporada, equipo) desde `team_players` y `match_events`; aquí
 * se fija la lógica pura: agrupación por temporada, totales y orden.
 */

function row(over: Partial<CareerRow> = {}): CareerRow {
  return {
    season_id: 's-2025',
    season_name: '2025/26',
    season_start: '2025-08-01',
    is_current: true,
    competition_id: 'c1',
    competition_name: 'OK Liga',
    competition_short: 'OKL',
    team_id: 't1',
    team_name: 'IGUALADA RIGAT',
    team_short_name: 'IGU',
    team_logo_url: null,
    jersey_number: 7,
    pj: 10,
    goals: 4,
    blue_cards: 1,
    red_cards: 0,
    penalties_total: 2,
    penalties_scored: 1,
    ...over,
  };
}

describe('buildPlayerCareer', () => {
  it('sin filas devuelve una carrera vacía con totales a cero', () => {
    expect(buildPlayerCareer([])).toEqual({
      seasons: [],
      totals: { pj: 0, goals: 0, blueCards: 0, redCards: 0, penaltiesTotal: 0, penaltiesScored: 0 },
    });
  });

  it('agrupa por temporada y por equipo dentro de cada temporada', () => {
    const career = buildPlayerCareer([
      row({ season_id: 's-2025', team_id: 't1', team_name: 'IGUALADA RIGAT' }),
      row({ season_id: 's-2025', team_id: 't2', team_name: 'SIMAR IGUALADA', jersey_number: 9 }),
      row({ season_id: 's-2024', season_name: '2024/25', season_start: '2024-08-01', is_current: false, team_id: 't3', team_name: 'MANLLEU' }),
    ]);

    expect(career.seasons).toHaveLength(2);
    const current = career.seasons.find((s) => s.seasonId === 's-2025')!;
    expect(current.teams.map((t) => t.teamName)).toEqual(['IGUALADA RIGAT', 'SIMAR IGUALADA']);
    expect(current.isCurrent).toBe(true);
    const past = career.seasons.find((s) => s.seasonId === 's-2024')!;
    expect(past.isCurrent).toBe(false);
    expect(past.teams).toHaveLength(1);
  });

  it('expone la competición a nivel de temporada (una sola por campaña)', () => {
    const career = buildPlayerCareer([
      row({ season_id: 's-2025', competition_id: 'c-okl', competition_name: 'OK Liga', competition_short: 'OKL' }),
      row({ season_id: 's-2024', season_name: '2024/25', season_start: '2024-08-01', is_current: false, competition_id: 'c-plata', competition_name: 'Plata', competition_short: null }),
    ]);

    expect(career.seasons.find((s) => s.seasonId === 's-2025')).toMatchObject({
      competitionId: 'c-okl', competitionName: 'OK Liga', competitionShort: 'OKL',
    });
    expect(career.seasons.find((s) => s.seasonId === 's-2024')).toMatchObject({
      competitionId: 'c-plata', competitionName: 'Plata', competitionShort: null,
    });
  });

  it('suma los totales de temporada y de carrera', () => {
    const career = buildPlayerCareer([
      row({ season_id: 's-2025', team_id: 't1', pj: 10, goals: 4, blue_cards: 1, red_cards: 2, penalties_total: 3, penalties_scored: 2 }),
      row({ season_id: 's-2025', team_id: 't2', pj: 5, goals: 1, blue_cards: 0, red_cards: 0, penalties_total: 1, penalties_scored: 0 }),
      row({ season_id: 's-2024', season_name: '2024/25', season_start: '2024-08-01', is_current: false, team_id: 't3', pj: 20, goals: 10, blue_cards: 3, red_cards: 1, penalties_total: 2, penalties_scored: 1 }),
    ]);

    const current = career.seasons.find((s) => s.seasonId === 's-2025')!;
    expect(current.totals).toEqual({ pj: 15, goals: 5, blueCards: 1, redCards: 2, penaltiesTotal: 4, penaltiesScored: 2 });
    expect(career.totals).toEqual({ pj: 35, goals: 15, blueCards: 4, redCards: 3, penaltiesTotal: 6, penaltiesScored: 3 });
  });

  it('ordena las temporadas de la más reciente a la más antigua', () => {
    const career = buildPlayerCareer([
      row({ season_id: 's-2022', season_name: '2022/23', season_start: '2022-08-01', is_current: false }),
      row({ season_id: 's-2024', season_name: '2024/25', season_start: '2024-08-01', is_current: false }),
      row({ season_id: 's-2023', season_name: '2023/24', season_start: '2023-08-01', is_current: false }),
    ]);

    expect(career.seasons.map((s) => s.seasonId)).toEqual(['s-2024', 's-2023', 's-2022']);
  });

  it('la temporada marcada como actual va primero aunque no tenga la fecha más nueva', () => {
    const career = buildPlayerCareer([
      row({ season_id: 's-current', season_name: '2025/26', season_start: '2026-01-01', is_current: true }),
      row({ season_id: 's-other', season_name: '2025/26', season_start: '2026-02-01', is_current: false }),
    ]);

    expect(career.seasons.map((s) => s.seasonId)).toEqual(['s-current', 's-other']);
  });

  it('las temporadas sin fecha quedan al final, ordenadas por nombre descendente', () => {
    const career = buildPlayerCareer([
      row({ season_id: 's-null-2023', season_name: '2023/24', season_start: null, is_current: false }),
      row({ season_id: 's-fecha', season_name: '2021/22', season_start: '2021-08-01', is_current: false }),
      row({ season_id: 's-null-2024', season_name: '2024/25', season_start: null, is_current: false }),
    ]);

    expect(career.seasons.map((s) => s.seasonId)).toEqual(['s-fecha', 's-null-2024', 's-null-2023']);
  });

  it('normaliza fechas Date/string a YYYY-MM-DD', () => {
    const career = buildPlayerCareer([
      row({ season_id: 's-a', season_start: new Date(2025, 7, 1) }),
      row({ season_id: 's-b', season_name: '2024/25', season_start: '2024-08-01T00:00:00.000Z', is_current: false }),
    ]);

    expect(career.seasons.find((s) => s.seasonId === 's-a')!.startDate).toBe('2025-08-01');
    expect(career.seasons.find((s) => s.seasonId === 's-b')!.startDate).toBe('2024-08-01');
  });

  it('convierte los COUNT de Postgres (bigint como string) y fusiona filas repetidas', () => {
    const career = buildPlayerCareer([
      row({ season_id: 's-2025', team_id: 't1', pj: '3', goals: '2', blue_cards: '1', red_cards: '0', penalties_total: '0', penalties_scored: '0' }),
      row({ season_id: 's-2025', team_id: 't1', pj: '2', goals: '1', blue_cards: '0', red_cards: '1', penalties_total: '1', penalties_scored: '1' }),
    ]);

    const team = career.seasons[0]!.teams[0]!;
    expect(team.pj).toBe(5);
    expect(team.goals).toBe(3);
    expect(team.redCards).toBe(1);
    expect(career.totals).toEqual({ pj: 5, goals: 3, blueCards: 1, redCards: 1, penaltiesTotal: 1, penaltiesScored: 1 });
  });

  it('marca is_current si cualquier fila de la temporada lo indica', () => {
    const career = buildPlayerCareer([
      row({ season_id: 's-2025', team_id: 't1', is_current: false }),
      row({ season_id: 's-2025', team_id: 't2', is_current: true }),
    ]);

    expect(career.seasons[0]!.isCurrent).toBe(true);
  });
});

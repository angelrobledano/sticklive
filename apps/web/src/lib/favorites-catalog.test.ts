import { describe, it, expect } from 'vitest';
import {
  selectSeasonCandidates,
  mergeStandingTeams,
  filterFavorites,
  MAX_SEASON_FETCHES,
} from './favorites-catalog';
import type { FavoriteComp } from './favorites-catalog';

function comp(id: string, season: FavoriteComp['season']): FavoriteComp {
  return { id, season };
}

describe('selectSeasonCandidates', () => {
  it('prefiere las temporadas actuales, ordenadas por nº de equipos', () => {
    const comps = [
      comp('c1', { id: 's-old', isCurrent: false, teamCount: 40 }),
      comp('c2', { id: 's-small', isCurrent: true, teamCount: 6 }),
      comp('c3', { id: 's-big', isCurrent: true, teamCount: 16 }),
    ];
    // solo las actuales; la de más equipos primero; la antigua (aunque grande) fuera
    expect(selectSeasonCandidates(comps)).toEqual(['s-big', 's-small']);
  });

  it('deduplica temporadas repetidas conservando la señal de más equipos', () => {
    const comps = [
      comp('c1', { id: 's-1', isCurrent: true, teamCount: 4 }),
      comp('c2', { id: 's-1', isCurrent: true, teamCount: 12 }),
      comp('c3', { id: 's-2', isCurrent: true, teamCount: 8 }),
    ];
    // s-1 queda con teamCount 12 (mayor) y por eso va antes que s-2
    expect(selectSeasonCandidates(comps)).toEqual(['s-1', 's-2']);
  });

  it('si no hay ninguna actual, usa todas las disponibles ordenadas por equipos', () => {
    const comps = [
      comp('c1', { id: 's-a', isCurrent: false, teamCount: 3 }),
      comp('c2', { id: 's-b', isCurrent: false, teamCount: 9 }),
    ];
    expect(selectSeasonCandidates(comps)).toEqual(['s-b', 's-a']);
  });

  it('ignora competiciones sin temporada o sin id de temporada', () => {
    const comps = [comp('c1', null), comp('c2', undefined), comp('c3', { id: '', isCurrent: true })];
    expect(selectSeasonCandidates(comps)).toEqual([]);
  });

  it('usa el env como último recurso cuando no hay temporadas en las competiciones', () => {
    expect(selectSeasonCandidates([], { envSeasonId: 'env-1' })).toEqual(['env-1']);
    expect(selectSeasonCandidates([comp('c1', null)], { envSeasonId: 'env-1' })).toEqual(['env-1']);
  });

  it('no duplica el env si ya figura entre las candidatas', () => {
    const comps = [comp('c1', { id: 'env-1', isCurrent: true, teamCount: 2 })];
    expect(selectSeasonCandidates(comps, { envSeasonId: 'env-1' })).toEqual(['env-1']);
  });

  it('limita el número de temporadas a consultar (rendimiento)', () => {
    const comps = Array.from({ length: 20 }, (_, i) =>
      comp(`c${i}`, { id: `s-${i}`, isCurrent: true, teamCount: i }),
    );
    const ids = selectSeasonCandidates(comps);
    expect(ids).toHaveLength(MAX_SEASON_FETCHES);
    // las de más equipos entran; las de menos se descartan
    expect(ids[0]).toBe('s-19');
    expect(ids).not.toContain('s-0');
  });

  it('respeta un límite explícito', () => {
    const comps = [
      comp('c1', { id: 's-1', isCurrent: true, teamCount: 5 }),
      comp('c2', { id: 's-2', isCurrent: true, teamCount: 4 }),
    ];
    expect(selectSeasonCandidates(comps, { limit: 1 })).toEqual(['s-1']);
  });

  it('no muta la lista de competiciones recibida', () => {
    const comps = [
      comp('c1', { id: 's-a', isCurrent: true, teamCount: 1 }),
      comp('c2', { id: 's-b', isCurrent: true, teamCount: 2 }),
    ];
    const copia = JSON.parse(JSON.stringify(comps));
    selectSeasonCandidates(comps);
    expect(comps).toEqual(copia);
  });
});

describe('mergeStandingTeams', () => {
  it('agrega equipos de varias temporadas y ordena por nombre', () => {
    const a = [{ team_id: 't1', team_name: 'Zeta', team_short_name: 'ZET' }];
    const b = [{ team_id: 't2', team_name: 'Alfa', team_short_name: null }];
    expect(mergeStandingTeams([a, b])).toEqual([
      { id: 't2', name: 'Alfa', shortName: null },
      { id: 't1', name: 'Zeta', shortName: 'ZET' },
    ]);
  });

  it('deduplica por id de equipo (una fila por equipo)', () => {
    const a = [{ team_id: 't1', team_name: 'Uno', team_short_name: null }];
    const b = [{ team_id: 't1', team_name: 'Uno', team_short_name: 'UNO' }];
    const out = mergeStandingTeams([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: 't1', name: 'Uno', shortName: 'UNO' });
  });

  it('completa nombre/abreviatura que faltaban en la primera aparición', () => {
    const a = [{ team_id: 't1', team_name: '', team_short_name: null }];
    const b = [{ team_id: 't1', team_name: 'Completo', team_short_name: 'CMP' }];
    expect(mergeStandingTeams([a, b])).toEqual([{ id: 't1', name: 'Completo', shortName: 'CMP' }]);
  });

  it('acepta claves camelCase además de snake_case e ignora filas sin id', () => {
    const rows = [
      { teamId: 't1', teamName: 'Camel', teamShortName: 'CAM' },
      { team_name: 'Sin id' },
      { team_id: null, team_name: 'Nulo' },
    ];
    expect(mergeStandingTeams([rows])).toEqual([
      { id: 't1', name: 'Camel', shortName: 'CAM' },
    ]);
  });

  it('tolera listas vacías o nulas (p. ej. temporada sin standings / 404)', () => {
    expect(mergeStandingTeams([])).toEqual([]);
    expect(mergeStandingTeams([[], []])).toEqual([]);
  });

  it('caso 404: una temporada vacía no impide mostrar los equipos de la siguiente', () => {
    const vacia: Array<{ team_id: string; team_name: string }> = [];
    const buena = [
      { team_id: 't1', team_name: 'Equipo A', team_short_name: 'A' },
      { team_id: 't2', team_name: 'Equipo B', team_short_name: 'B' },
    ];
    // Simula [standingsTemporadaActual=404 vacío, standingsTemporadaFallback=ok]
    expect(mergeStandingTeams([vacia, buena]).map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('filterFavorites (#258)', () => {
  const teams = [
    { id: 't1', name: 'CLUB PATÍN ALCORCÓN', shortName: 'CPA' },
    { id: 't2', name: 'CH MATARÓ', shortName: 'CHM' },
    { id: 't3', name: 'IRUÑA HP', shortName: null },
  ];

  it('encuentra nombres acentuados tecleando sin tilde ni ñ', () => {
    expect(filterFavorites(teams, 'patin').map((t) => t.id)).toEqual(['t1']);
    expect(filterFavorites(teams, 'mataro').map((t) => t.id)).toEqual(['t2']);
    expect(filterFavorites(teams, 'iruna').map((t) => t.id)).toEqual(['t3']);
  });

  it('sigue casando con tilde y con mayúsculas', () => {
    expect(filterFavorites(teams, 'PATÍN').map((t) => t.id)).toEqual(['t1']);
  });

  it('casa también por abreviatura', () => {
    expect(filterFavorites(teams, 'chm').map((t) => t.id)).toEqual(['t2']);
  });

  it('sin término devuelve todo; sin coincidencias, vacío', () => {
    expect(filterFavorites(teams, '   ')).toHaveLength(3);
    expect(filterFavorites(teams, 'zzz')).toEqual([]);
  });
});

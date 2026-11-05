import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  getPlayerTeams,
  getPersistedFavoriteName,
  getPersistedPlayerTeam,
  PLACEHOLDER_KEY,
  resolveFavoriteName,
  saveFavoriteName,
  savePlayerTeam,
} from './favorite-names';
import { qk } from '../hooks/queries';
import type {
  CompetitionsResponse,
  CurrentMatchesResponse,
  PlayerDetail,
  TeamDetail,
} from './api/types';

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void store.delete(k)),
  },
}));

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('favorite-names', () => {
  it('tiene placeholders definidos para team, league y player', () => {
    expect(PLACEHOLDER_KEY.team).toBe('favorites.placeholder_team');
    expect(PLACEHOLDER_KEY.league).toBe('favorites.placeholder_league');
    expect(PLACEHOLDER_KEY.player).toBe('favorites.placeholder_player');
  });

  it('guarda y recupera nombres de favoritos en memoria y AsyncStorage', () => {
    saveFavoriteName('t1', 'Barça');
    expect(getPersistedFavoriteName('t1')).toBe('Barça');
  });

  it('guarda y recupera la relación de equipo de un jugador', () => {
    savePlayerTeam('p1', 't-barca');
    expect(getPersistedPlayerTeam('p1')).toBe('t-barca');
    expect(getPlayerTeams(['p1', 'p-unknown'])).toEqual(['t-barca']);
  });

  it('resuelve nombre de equipo desde la query de team', () => {
    const qc = newClient();
    qc.setQueryData<Partial<TeamDetail>>(qk.team('t-liceo'), {
      team: {
        id: 't-liceo', name: 'Deportivo Liceo', shortName: 'Liceo', gender: 'M', sectionSuffix: '',
        city: null, country: 'ES', logoUrl: null, websiteUrl: null, club: null,
      },
    });

    const resolved = resolveFavoriteName(qc, 'team', 't-liceo');
    expect(resolved).toBe('Deportivo Liceo');
    expect(getPersistedFavoriteName('t-liceo')).toBe('Deportivo Liceo');
  });

  it('resuelve nombre de equipo desde partidos actuales (home o away)', () => {
    const qc = newClient();
    qc.setQueryData<Partial<CurrentMatchesResponse>>(qk.current, {
      matches: [
        {
          id: 'm1',
          seasonId: 's1',
          roundId: null,
          competitionId: 'c1',
          competitionName: 'OK Liga',
          competitionSlug: 'ok-liga',
          competitionTimezone: 'Europe/Madrid',
          status: 'live',
          isHalftime: false,
          winType: null,
          winnerTeamId: null,
          penalties: null,
          scheduledAt: '2026-10-22T20:00:00Z',
          startedAt: '2026-10-22T20:00:00Z',
          venue: null,
          score: { home: 1, away: 0 },
          homeTeam: { id: 't-reus', name: 'Reus Deportiu', shortName: 'Reus', logoUrl: null },
          awayTeam: { id: 't-noia', name: 'CE Noia Freixenet', shortName: 'Noia', logoUrl: null },
        },
      ] as any,
    });

    expect(resolveFavoriteName(qc, 'team', 't-reus')).toBe('Reus Deportiu');
    expect(resolveFavoriteName(qc, 'team', 't-noia')).toBe('CE Noia Freixenet');
  });

  it('resuelve nombre de jugador desde la query de player', () => {
    const qc = newClient();
    qc.setQueryData<Partial<PlayerDetail>>(qk.player('p-bargallo'), {
      player: {
        id: 'p-bargallo',
        firstName: 'Pau',
        lastName: 'Bargalló',
        nationality: 'ES',
        isGoalkeeper: false,
        photoUrl: null,
        birthDate: null,
        sourceRef: null,
      },
    });

    const resolved = resolveFavoriteName(qc, 'player', 'p-bargallo');
    expect(resolved).toBe('Pau Bargalló');
    expect(getPersistedFavoriteName('p-bargallo')).toBe('Pau Bargalló');
  });

  it('resuelve nombre de liga desde la query de competiciones', () => {
    const qc = newClient();
    qc.setQueryData<Partial<CompetitionsResponse>>(qk.competitions, {
      competitions: [
        { id: 'c-okliga', name: 'OK Liga Masculina', shortName: 'OK Liga', slug: 'ok-liga' } as any,
      ],
    });

    const resolved = resolveFavoriteName(qc, 'league', 'c-okliga');
    expect(resolved).toBe('OK Liga Masculina');
    expect(getPersistedFavoriteName('c-okliga')).toBe('OK Liga Masculina');
  });

  it('devuelve null si no está en caché ni en queries conocidas', () => {
    const qc = newClient();
    expect(resolveFavoriteName(qc, 'team', 'unknown-team')).toBeNull();
    expect(resolveFavoriteName(qc, 'player', 'unknown-player')).toBeNull();
    expect(resolveFavoriteName(qc, 'league', 'unknown-league')).toBeNull();
  });
});

import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CompetitionSummary,
  CurrentMatchesResponse,
  MatchSummary,
  StandingsResponse,
  StandingsRow,
} from '../lib/api/types';
import {
  favoritesEnabled,
  fetchCompetitions,
  fetchCompetitionSeasons,
  fetchCurrentMatches,
  fetchDayMatches,
  fetchFeedMatches,
  fetchFollowingMatches,
  feedQueryString,
  fetchSearch,
  fetchSeasonOverview,
  fetchSeasonStats,
  fetchStandings,
  qk,
  searchEnabled,
  selectCompetitions,
  selectCurrentMatches,
  selectStandings,
  standingsEnabled,
} from './queries';

/**
 * Tests de los hooks de datos SIN renderizar (Task 2.2, ajuste sancionado):
 * en lugar de @testing-library/react-native (frágil bajo vitest+node con
 * react 19 en Windows), se testean las piezas puras de las que se componen
 * los hooks:
 * - gating de `enabled` → funciones puras (searchEnabled, standingsEnabled,
 *   favoritesEnabled);
 * - aplanado de envoltorios del API → selectores puros (selectCurrentMatches,
 *   selectCompetitions, selectStandings);
 * - queryFns → `QueryClient.fetchQuery` con `fetch` global stubeado
 *   (verifica URL y payload). El cableado del provider vive en
 *   app/_layout.tsx y se verifica con el build de export.
 */

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// retry: false para que un fallo no ralentice el test con reintentos.
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Fixtures completos (sin casts): dejan invariantes a la vista y fallan al
// compilar si los tipos de types.ts derivan.
const matchSummary = (id: string): MatchSummary => ({
  id,
  seasonId: 'season-1',
  roundId: null,
  competitionId: 'comp-1',
  competitionName: 'OK Liga',
  competitionSlug: 'ok-liga',
  competitionTimezone: 'Europe/Madrid',
  status: 'live',
  isHalftime: false,
  winType: null,
  winnerTeamId: null,
  penalties: null,
  scheduledAt: '2026-10-05T17:00:00.000Z',
  startedAt: '2026-10-05T17:02:00.000Z',
  finishedAt: null,
  homeTeamId: 't1',
  awayTeamId: 't2',
  sourceRef: null,
  venue: { name: 'Pabellón', city: null },
  score: { home: 1, away: 0 },
  homeTeam: { id: 't1', name: 'Local', shortName: null, logoUrl: null },
  awayTeam: { id: 't2', name: 'Visitante', shortName: null, logoUrl: null },
});

const standingsRow = (teamId: string): StandingsRow => ({
  id: `st-${teamId}`,
  season_id: 'season-1',
  team_id: teamId,
  group_name: null,
  position: 1,
  played: 5,
  won: 4,
  drawn: 1,
  lost: 0,
  goals_for: 12,
  goals_against: 3,
  goal_diff: 9,
  points: 13,
  form: ['W', 'W', 'D'],
  source_id: null,
  scraped_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  team_name: 'Equipo',
  team_short_name: null,
  team_logo_url: null,
});

const competition = (): CompetitionSummary => ({
  id: 'comp-1',
  name: 'OK Liga',
  nameI18n: null,
  shortName: null,
  slug: 'ok-liga',
  gender: null,
  category: null,
  country: 'ES',
  organizer: 'RFEP',
  scope: 'national',
  region: null,
  ageCategory: 'senior',
  dataQuality: 'verified',
  season: {
    id: 'season-1',
    name: '2025-2026',
    startDate: '2025-09-01',
    endDate: '2026-06-30',
    isCurrent: true,
    teamCount: 12,
    matchCount: 100,
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gating de queries (funciones puras)', () => {
  it('searchEnabled: NO consulta con menos de 2 caracteres efectivos tras trim', () => {
    expect(searchEnabled('  a  ')).toBe(false); // 1 carácter efectivo → deshabilitada
    expect(searchEnabled('   ')).toBe(false);
    expect(searchEnabled('')).toBe(false);
    expect(searchEnabled('ab')).toBe(true);
    expect(searchEnabled('  ab  ')).toBe(true);
  });

  it('standingsEnabled: deshabilitada sin seasonId', () => {
    expect(standingsEnabled(undefined)).toBe(false);
    expect(standingsEnabled('')).toBe(false);
    expect(standingsEnabled('season-1')).toBe(true);
  });

  it('favoritesEnabled: deshabilitada sin token', () => {
    expect(favoritesEnabled(null)).toBe(false);
    expect(favoritesEnabled(undefined)).toBe(false);
    expect(favoritesEnabled('')).toBe(false);
    expect(favoritesEnabled('token')).toBe(true);
  });
});

describe('queryFns y selectores (vía QueryClient.fetchQuery con fetch stubeado)', () => {
  it('fetchCurrentMatches pide /matches/current y devuelve el envoltorio {count, matches}', async () => {
    const envelope: CurrentMatchesResponse = { count: 0, matches: [] };
    const fetchMock = vi.fn(async () => ok(envelope));
    vi.stubGlobal('fetch', fetchMock);

    const data = await newClient().fetchQuery({ queryKey: qk.current, queryFn: fetchCurrentMatches });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/matches/current'), expect.anything());
    expect(data).toEqual(envelope);
  });

  it('feed: scope=feed con lo seguido; día: rango con margen; following sin follows no pide nada', async () => {
    const fetchMock = vi.fn(async () => ok({ count: 0, matches: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const f = { teams: ['t1'], leagues: ['l1', 'l2'] };
    expect(feedQueryString('feed', f)).toBe('scope=feed&teams=t1&leagues=l1,l2');
    await fetchFeedMatches(f);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/matches/current?scope=feed&teams=t1&leagues=l1,l2'), expect.anything());
    await fetchDayMatches('2026-10-31');
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/matches/current?from=2026-10-30&to=2026-11-01'), expect.anything());
    const calls = fetchMock.mock.calls.length;
    expect(await fetchFollowingMatches({ teams: [], leagues: [] })).toEqual({ count: 0, matches: [] });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('selectCurrentMatches aplana el envoltorio {count, matches} a la lista', () => {
    const envelope: CurrentMatchesResponse = { count: 2, matches: [matchSummary('m1'), matchSummary('m2')] };
    expect(selectCurrentMatches(envelope)).toEqual([matchSummary('m1'), matchSummary('m2')]);
    expect(selectCurrentMatches({ count: 0, matches: [] })).toEqual([]);
  });

  it('fetchSearch construye /search?q= con el término codificado', async () => {
    const fetchMock = vi.fn(async () =>
      ok({ query: 'a b', total: 0, teams: [], players: [], competitions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await newClient().fetchQuery({ queryKey: qk.search('a b'), queryFn: () => fetchSearch('a b') });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/search?q=a%20b'), expect.anything());
  });

  it('fetchStandings pide /seasons/:id/standings y selectStandings devuelve las filas', async () => {
    const rows = [standingsRow('t1')];
    const envelope: StandingsResponse = { seasonId: 'season-1', group: null, count: 1, standings: rows };
    const fetchMock = vi.fn(async () => ok(envelope));
    vi.stubGlobal('fetch', fetchMock);

    const data = await newClient().fetchQuery({
      queryKey: qk.standings('season-1'),
      queryFn: () => fetchStandings('season-1'),
    });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/seasons/season-1/standings'), expect.anything());
    expect(selectStandings(data)).toEqual(rows);
  });

  it('fetchCompetitions pide /competitions y selectCompetitions aplana el envoltorio', async () => {
    const envelope = { count: 1, competitions: [competition()] };
    const fetchMock = vi.fn(async () => ok(envelope));
    vi.stubGlobal('fetch', fetchMock);

    const data = await newClient().fetchQuery({ queryKey: qk.competitions, queryFn: fetchCompetitions });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/competitions'), expect.anything());
    expect(selectCompetitions(data)).toEqual([competition()]);
  });

  it('fetchSeasonOverview pide /seasons/:id/overview', async () => {
    const envelope = {
      season: { id: 's1', name: '2025-2026', competitionName: 'OK Liga' },
      standings: [],
      rounds: [],
      matches: [],
    };
    const fetchMock = vi.fn(async () => ok(envelope));
    vi.stubGlobal('fetch', fetchMock);

    const data = await newClient().fetchQuery({
      queryKey: qk.seasonOverview('s1'),
      queryFn: () => fetchSeasonOverview('s1'),
    });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/seasons/s1/overview'), expect.anything());
    expect(data).toEqual(envelope);
  });

  it('fetchCompetitionSeasons pide /competitions/:id/seasons', async () => {
    const envelope = { seasons: [{ id: 's1', name: '2025-2026', slug: '2025-2026', isCurrent: true }] };
    const fetchMock = vi.fn(async () => ok(envelope));
    vi.stubGlobal('fetch', fetchMock);

    const data = await newClient().fetchQuery({
      queryKey: qk.competitionSeasons('c1'),
      queryFn: () => fetchCompetitionSeasons('c1'),
    });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/competitions/c1/seasons'), expect.anything());
    expect(data).toEqual(envelope);
  });

  it('fetchSeasonStats pide /seasons/:id/stats y maneja 404 seguro', async () => {
    const statsEnvelope = {
      topScorers: [],
      topAssists: [],
      topCards: [],
    };
    const fetchMock = vi.fn(async () => ok(statsEnvelope));
    vi.stubGlobal('fetch', fetchMock);

    const data = await newClient().fetchQuery({
      queryKey: qk.seasonStats('s1'),
      queryFn: () => fetchSeasonStats('s1'),
    });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/seasons/s1/stats'), expect.anything());
    expect(data).toEqual(statsEnvelope);
  });
});

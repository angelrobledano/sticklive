import { describe, it, expect } from 'vitest';

process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';
const { buildClubDetail } = await import('./club-detail.js');

const club = { id: 'cl1', slug: 'cp-voltrega', canonical_name: 'CP Voltregà', city: 'Sant Hipòlit', country: 'ES', crest_url: null };

function team(over: Record<string, unknown>) {
  return {
    id: 't', name: 'CP Voltregà', short_name: null, gender: 'male', age_category: 'senior', squad_level: 1, team_type: 'club',
    season_id: 's1', competition_id: 'c1', competition_slug: 'ok-liga-masculina', competition_name: 'OK Liga',
    is_current: true, position: 3, ...over,
  };
}

function match(over: Record<string, unknown>) {
  return {
    id: 'm', scheduled_at: '2026-10-20T18:00:00Z', status: 'finished', home_score: 3, away_score: 2,
    home_team_id: 't1', home_name: 'CP Voltregà', away_team_id: 'x', away_name: 'Rival',
    competition_id: 'c1', competition_slug: 'ok-liga-masculina', competition_name: 'OK Liga', ...over,
  };
}

describe('buildClubDetail', () => {
  it('ordena secciones (M → F, filial detrás) y descarta equipos sin partidos', () => {
    const out = buildClubDetail(club, [
      team({ id: 'fem', gender: 'female' }),
      team({ id: 'b', squad_level: 2 }),
      team({ id: 'first' }),
      team({ id: 'empty', competition_id: null }),
    ], []);
    expect(out.teams.map((t) => t.id)).toEqual(['first', 'b', 'fem']);
    expect(out.teams.find((t) => t.id === 'fem')!.sectionSuffix).toBe('F');
    expect(out.teams.find((t) => t.id === 'b')!.sectionSuffix).toBe('B');
  });

  it('reparte recientes (más nuevo primero) y próximos (más cercano primero)', () => {
    const out = buildClubDetail(club, [team({ id: 't1' })], [
      match({ id: 'old', scheduled_at: '2026-10-01T18:00:00Z' }),
      match({ id: 'new', scheduled_at: '2026-10-15T18:00:00Z' }),
      match({ id: 'live', status: 'live', scheduled_at: '2026-10-23T18:00:00Z' }),
      match({ id: 'far', status: 'scheduled', scheduled_at: '2026-11-20T18:00:00Z' }),
      match({ id: 'near', status: 'scheduled', scheduled_at: '2026-10-30T18:00:00Z' }),
      match({ id: 'post', status: 'postponed' }),
    ]);
    expect(out.recent.map((m) => m.id)).toEqual(['live', 'new', 'old']);
    expect(out.upcoming.map((m) => m.id)).toEqual(['near', 'far']);
    expect(out.recent[0]!.competition.slug).toBe('ok-liga-masculina');
  });

  it('indexable solo si alguna sección juega la temporada en curso', () => {
    expect(buildClubDetail(club, [team({ is_current: true })], []).indexable).toBe(true);
    expect(buildClubDetail(club, [team({ is_current: false })], []).indexable).toBe(false);
    expect(buildClubDetail(club, [], []).indexable).toBe(false);
  });

  it('expone el club con nombre canónico', () => {
    expect(buildClubDetail(club, [], []).club).toEqual({
      id: 'cl1', slug: 'cp-voltrega', name: 'CP Voltregà', city: 'Sant Hipòlit', country: 'ES', crestUrl: null,
    });
  });
});

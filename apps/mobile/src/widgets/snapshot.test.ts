import { describe, expect, it } from 'vitest';
import {
  buildWidgetDeepLink,
  buildWidgetSnapshot,
  normalizeWidgetStatus,
  type MatchInput,
} from './snapshot';

describe('Widget Snapshot', () => {
  const sampleMatches: MatchInput[] = [
    {
      id: 'match-1',
      homeTeamName: 'Barça',
      awayTeamName: 'Deportivo Liceo',
      homeScore: 3,
      awayScore: 2,
      status: 'in_progress',
      minute: "18'",
      competitionName: 'OK Liga',
      isLive: true,
    },
    {
      id: 'match-2',
      homeTeamName: 'Reus Deportiu',
      awayTeamName: 'Noia Freixenet',
      homeScore: 1,
      awayScore: 1,
      status: 'in_progress',
      minute: "10'",
      competitionName: 'OK Liga',
      isLive: true,
    },
    {
      id: 'match-3',
      homeTeamName: 'Calafell',
      awayTeamName: 'Igualada',
      status: 'scheduled',
      competitionName: 'OK Liga',
    },
  ];

  it('normaliza estados deportivos a los 3 estados del widget', () => {
    expect(normalizeWidgetStatus('in_progress')).toBe('live');
    expect(normalizeWidgetStatus('live')).toBe('live');
    expect(normalizeWidgetStatus('scheduled', true)).toBe('live');
    expect(normalizeWidgetStatus('finished')).toBe('finished');
    expect(normalizeWidgetStatus('final')).toBe('finished');
    expect(normalizeWidgetStatus('scheduled')).toBe('scheduled');
  });

  it('genera el deep link canónico sticklive://match/:id', () => {
    expect(buildWidgetDeepLink('123-abc')).toBe('sticklive://match/123-abc');
  });

  it('maneja listas vacías de partidos sin romper', () => {
    const snap = buildWidgetSnapshot([]);
    expect(snap.hasMatches).toBe(false);
    expect(snap.featuredMatch).toBeNull();
    expect(snap.liveCount).toBe(0);
  });

  it('destaca el partido en vivo con marcador y conteo de directos', () => {
    const snap = buildWidgetSnapshot(sampleMatches);
    expect(snap.hasMatches).toBe(true);
    expect(snap.liveCount).toBe(2);
    expect(snap.featuredMatch?.matchId).toBe('match-1');
    expect(snap.featuredMatch?.homeScore).toBe(3);
    expect(snap.featuredMatch?.awayScore).toBe(2);
    expect(snap.featuredMatch?.status).toBe('live');
    expect(snap.featuredMatch?.deepLinkUrl).toBe('sticklive://match/match-1');
  });

  it('prioriza partidos en vivo de equipos favoritos del usuario', () => {
    // Si el usuario tiene como favorito a 'Reus Deportiu', destaca match-2 en vez de match-1
    const snap = buildWidgetSnapshot(sampleMatches, ['Reus Deportiu']);
    expect(snap.featuredMatch?.matchId).toBe('match-2');
    expect(snap.featuredMatch?.homeTeam).toBe('Reus Deportiu');
  });

  it('si no hay partidos en vivo, destaca el próximo programado', () => {
    const onlyScheduled: MatchInput[] = [
      {
        id: 'sch-1',
        homeTeamName: 'Voltregà',
        awayTeamName: 'Girona',
        status: 'scheduled',
        competitionName: 'OK Liga',
      },
    ];
    const snap = buildWidgetSnapshot(onlyScheduled);
    expect(snap.hasMatches).toBe(true);
    expect(snap.liveCount).toBe(0);
    expect(snap.featuredMatch?.matchId).toBe('sch-1');
    expect(snap.featuredMatch?.status).toBe('scheduled');
  });
});

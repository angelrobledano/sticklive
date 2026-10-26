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

  it('propaga faltas de equipo e indicador de descanso correctamente', () => {
    const liveWithFouls: MatchInput[] = [
      {
        id: 'foul-1',
        homeTeamName: 'Barça',
        awayTeamName: 'Liceo',
        homeScore: 2,
        awayScore: 1,
        homeFouls: 8,
        awayFouls: 9,
        isLive: true,
        isHalftime: true,
        status: 'live',
        competitionName: 'OK Liga',
      },
    ];
    const snap = buildWidgetSnapshot(liveWithFouls);
    expect(snap.hasMatches).toBe(true);
    expect(snap.featuredMatch?.homeFouls).toBe(8);
    expect(snap.featuredMatch?.awayFouls).toBe(9);
    expect(snap.featuredMatch?.isHalftime).toBe(true);
  });

  it('prioriza partidos programados del equipo favorito sobre otros programados', () => {
    const fixedNow = new Date('2026-10-26T14:00:00.000Z');
    const scheduledList: MatchInput[] = [
      {
        id: 'sch-child',
        homeTeamName: 'CP Sevilla',
        awayTeamName: 'CD Claret',
        status: 'scheduled',
        competitionName: 'Benjamín Andalucía',
        scheduledAt: '2026-10-26T17:00:00.000Z',
      },
      {
        id: 'sch-fav',
        homeTeamName: 'Barça',
        awayTeamName: 'Noia Freixenet',
        status: 'scheduled',
        competitionName: 'OK Liga',
        scheduledAt: '2026-10-26T19:00:00.000Z',
      },
    ];

    // Sin favoritos, prima el que empieza antes o categoría élite
    // Con favorito 'Barça', debe elegir sch-fav aunque empiece 2 horas más tarde
    const snap = buildWidgetSnapshot(scheduledList, ['Barça'], fixedNow);
    expect(snap.featuredMatch?.matchId).toBe('sch-fav');
    expect(snap.featuredMatch?.homeTeam).toBe('Barça');
  });

  it('prioriza el partido programado más inminente cuando no hay favoritos', () => {
    const fixedNow = new Date('2026-10-26T15:00:00.000Z');
    const scheduledList: MatchInput[] = [
      {
        id: 'sch-soon',
        homeTeamName: 'Voltregà',
        awayTeamName: 'Calafell',
        status: 'scheduled',
        competitionName: 'OK Liga',
        scheduledAt: '2026-10-26T16:00:00.000Z', // en 1 hora
      },
      {
        id: 'sch-later',
        homeTeamName: 'Liceo',
        awayTeamName: 'Reus Deportiu',
        status: 'scheduled',
        competitionName: 'OK Liga',
        scheduledAt: '2026-10-26T21:00:00.000Z', // en 6 horas
      },
    ];

    const snap = buildWidgetSnapshot(scheduledList, [], fixedNow);
    expect(snap.featuredMatch?.matchId).toBe('sch-soon');
  });

  it('no se queda atascado en el primer partido de ayer y elige el finalizado más reciente', () => {
    // Escenario real del bug: matches[0] era un partido de ayer a las 13:00.
    // El usuario se quejaba de que el widget siempre mostraba el mismo partido.
    const fixedNow = new Date('2026-10-26T22:00:00.000Z');
    const matchesFromApi: MatchInput[] = [
      {
        id: 'oldest-yesterday',
        homeTeamName: 'HC Ponteareas',
        awayTeamName: 'Dominicos A',
        homeScore: 0,
        awayScore: 13,
        status: 'finished',
        competitionName: 'Juvenil Galicia',
        scheduledAt: '2026-10-25T13:00:00.000Z', // Ayer mañana (índice 0 devuelto por la API)
      },
      {
        id: 'recent-today',
        homeTeamName: 'Barça',
        awayTeamName: 'Igualada',
        homeScore: 4,
        awayScore: 2,
        status: 'finished',
        competitionName: 'OK Liga',
        scheduledAt: '2026-10-26T19:00:00.000Z', // Hoy noche (reciente)
      },
    ];

    const snap = buildWidgetSnapshot(matchesFromApi, [], fixedNow);
    // Debe seleccionar el reciente de hoy, NO el primero devuelto en la lista de ayer
    expect(snap.featuredMatch?.matchId).toBe('recent-today');
    expect(snap.featuredMatch?.homeTeam).toBe('Barça');
    expect(snap.featuredMatch?.homeScore).toBe(4);
  });

  it('prioriza partidos finalizados de equipos favoritos', () => {
    const fixedNow = new Date('2026-10-26T22:00:00.000Z');
    const finishedMatches: MatchInput[] = [
      {
        id: 'fin-general',
        homeTeamName: 'Calafell',
        awayTeamName: 'Voltregà',
        homeScore: 2,
        awayScore: 1,
        status: 'finished',
        competitionName: 'OK Liga',
        scheduledAt: '2026-10-26T20:00:00.000Z',
      },
      {
        id: 'fin-fav',
        homeTeamName: 'Deportivo Liceo',
        awayTeamName: 'Reus',
        homeScore: 3,
        awayScore: 3,
        status: 'finished',
        competitionName: 'OK Liga',
        scheduledAt: '2026-10-26T19:30:00.000Z',
      },
    ];

    const snap = buildWidgetSnapshot(finishedMatches, ['Deportivo Liceo'], fixedNow);
    expect(snap.featuredMatch?.matchId).toBe('fin-fav');
    expect(snap.featuredMatch?.homeTeam).toBe('Deportivo Liceo');
  });
});

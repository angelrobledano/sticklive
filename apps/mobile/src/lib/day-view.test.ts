import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  buildDateKeys,
  buildDayView,
  computeCenterOffset,
  dayDiff,
  daysWithMatches,
  extractGestureStartX,
  getRelativeKey,
  hiddenForDay,
  isHorizontalSwipeGesture,
  isOutsideEdgeGuard,
  madridDateKey,
  nextMatchday,
  resolveDaySwipeDelta,
  countryRank,
  defaultOpenKeys,
} from './day-view';
import type { MatchSummary } from './api/types';

function createMatch(
  id: string,
  scheduledAt: string | null,
  compId: string | null = 'okliga',
  compSlug: string | null = 'ok-liga-masculina',
  extra: Partial<MatchSummary> = {},
): MatchSummary {
  return {
    id,
    seasonId: 'season-1',
    roundId: 'round-1',
    competitionId: compId,
    competitionName: compId ? 'OK Liga' : null,
    competitionSlug: compSlug,
    competitionTimezone: 'Europe/Madrid',
    // Destacada por defecto (OK Liga); los casos de visibilidad lo sobrescriben.
    competitionFeaturedRank: 1,
    competitionTier: 1,
    competitionCountry: 'ES',
    status: 'scheduled',
    isHalftime: false,
    winType: null,
    winnerTeamId: null,
    penalties: null,
    scheduledAt,
    startedAt: null,
    venue: null,
    score: { home: null, away: null },
    homeTeam: { id: `home-${id}`, name: `Home ${id}`, shortName: null, logoUrl: null },
    awayTeam: { id: `away-${id}`, name: `Away ${id}`, shortName: null, logoUrl: null },
    ...extra,
  };
}

describe('day-view date utilities', () => {
  it('madridDateKey formatea a YYYY-MM-DD en hora peninsular de Madrid', () => {
    // 23:30 UTC del día 20 = 01:30 CEST (UTC+2) del día 21 en Madrid
    expect(madridDateKey('2026-10-20T23:30:00Z')).toBe('2026-10-21');
    expect(madridDateKey(null)).toBe('');
  });

  it('addDaysToKey y dayDiff calculan correctamente diferencias y sumas de días', () => {
    expect(addDaysToKey('2026-10-21', 1)).toBe('2026-10-22');
    expect(addDaysToKey('2026-10-21', -1)).toBe('2026-10-20');
    expect(dayDiff('2026-10-22', '2026-10-21')).toBe(1);
    expect(dayDiff('2026-10-20', '2026-10-21')).toBe(-1);
  });

  it('getRelativeKey devuelve claves i18n para ayer, hoy y mañana', () => {
    expect(getRelativeKey('2026-10-21', '2026-10-21')).toBe('common.today');
    expect(getRelativeKey('2026-10-20', '2026-10-21')).toBe('common.yesterday');
    expect(getRelativeKey('2026-10-22', '2026-10-21')).toBe('common.tomorrow');
    expect(getRelativeKey('2026-10-25', '2026-10-21')).toBe(null);
  });

  it('buildDateKeys genera la ventana centrada en todayKey', () => {
    const keys = buildDateKeys('2026-10-21', 2, 2);
    expect(keys).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
  });
});

describe('buildDayView', () => {
  const DAY = '2026-10-21';

  it('filtra estrictamente solo los partidos del día seleccionado', () => {
    const matches = [
      createMatch('m-today', '2026-10-21T18:00:00Z'),
      createMatch('m-yesterday', '2026-10-20T18:00:00Z'),
      createMatch('m-tomorrow', '2026-10-22T18:00:00Z'),
    ];
    const view = buildDayView(matches, { dayKey: DAY });
    expect(view.total).toBe(1);
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['m-today']);
  });

  it('ordena partidos de cada competición por hora de inicio cronológica', () => {
    const matches = [
      createMatch('late', '2026-10-21T20:00:00Z'),
      createMatch('early', '2026-10-21T12:00:00Z'),
      createMatch('mid', '2026-10-21T16:00:00Z'),
    ];
    const view = buildDayView(matches, { dayKey: DAY });
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['early', 'mid', 'late']);
  });

  it('separa partidos de equipos seguidos en myTeams', () => {
    const followedMatch = createMatch('fav', '2026-10-21T15:00:00Z', 'okliga', 'ok-liga-masculina', {
      homeTeam: { id: 'team-barca', name: 'Barça', shortName: 'FCB', logoUrl: null },
    });
    const otherMatch = createMatch('other', '2026-10-21T16:00:00Z');

    const view = buildDayView([followedMatch, otherMatch], { dayKey: DAY, teamIds: ['team-barca'] });
    expect(view.myTeams.map((m) => m.id)).toEqual(['fav']);
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['other']);
  });

  it('cuenta partidos en directo y aplica filtro live', () => {
    const liveMatch = createMatch('live-1', '2026-10-21T18:00:00Z', 'okliga', 'ok-liga-masculina', {
      status: 'live',
    });
    const schedMatch = createMatch('sched-1', '2026-10-21T19:00:00Z');

    const view = buildDayView([liveMatch, schedMatch], { dayKey: DAY, filter: 'live' });
    expect(view.total).toBe(2);
    expect(view.liveCount).toBe(1);
    expect(view.filter).toBe('live');
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['live-1']);
  });

  it('daysWithMatches identifica los días con partidos', () => {
    const matches = [
      createMatch('m1', '2026-10-21T18:00:00Z'),
      createMatch('m2', '2026-10-25T18:00:00Z'),
    ];
    const days = daysWithMatches(matches);
    expect(days.has('2026-10-21')).toBe(true);
    expect(days.has('2026-10-25')).toBe(true);
    expect(days.has('2026-10-22')).toBe(false);
  });

  it('nextMatchday encuentra la siguiente jornada con partidos', () => {
    const matches = [
      createMatch('m-past', '2026-10-20T18:00:00Z'),
      createMatch('m-future', '2026-10-24T18:00:00Z'),
    ];
    const next = nextMatchday(matches, '2026-10-21');
    expect(next?.dayKey).toBe('2026-10-24');
    expect(next?.total).toBe(1);
  });

  describe('computeCenterOffset', () => {
    it('centra el elemento en el medio exacto del ancho de pantalla', () => {
      // Ancho pantalla 400. TotalItemWidth = 64 (58+6). Padding = 12.
      // Index 7 (Hoy): center = 12 + 7 * 64 + 29 = 489.
      // Offset = 489 - 200 = 289.
      expect(computeCenterOffset(7, 400, 58, 6, 12)).toBe(289);
    });

    it('devuelve 0 si el elemento está tan cerca del inicio que el offset sería negativo', () => {
      // Index 0: center = 12 + 0 + 29 = 41. Offset = 41 - 200 = -159 => 0
      expect(computeCenterOffset(0, 400, 58, 6, 12)).toBe(0);
      expect(computeCenterOffset(1, 400, 58, 6, 12)).toBe(0);
    });

    it('devuelve 0 con inputs inválidos o contenedor sin medir', () => {
      expect(computeCenterOffset(-1, 400)).toBe(0);
      expect(computeCenterOffset(7, 0)).toBe(0);
      expect(computeCenterOffset(7, -100)).toBe(0);
    });
  });

  describe('swipe gesture navigation', () => {
    it('isHorizontalSwipeGesture solo intercepta gestos predominantemente horizontales', () => {
      // Movimiento horizontal claro
      expect(isHorizontalSwipeGesture(30, 5)).toBe(true);
      expect(isHorizontalSwipeGesture(-40, 10)).toBe(true);

      // Movimiento vertical (scroll normal del feed de partidos)
      expect(isHorizontalSwipeGesture(5, 30)).toBe(false);
      expect(isHorizontalSwipeGesture(15, 20)).toBe(false);

      // Movimiento diagonal
      expect(isHorizontalSwipeGesture(30, 25)).toBe(false);

      // Movimiento diminuto / temblor por debajo del umbral mínimo
      expect(isHorizontalSwipeGesture(15, 2)).toBe(false);
      expect(isHorizontalSwipeGesture(-10, 0)).toBe(false);
    });

    it('resolveDaySwipeDelta resuelve correctamente navegación de día siguiente o anterior', () => {
      // Desplazamiento a la izquierda -> siguiente día (+1)
      expect(resolveDaySwipeDelta(-60, 0)).toBe(1);
      // Flick rápido a la izquierda -> siguiente día (+1)
      expect(resolveDaySwipeDelta(-30, -0.4)).toBe(1);

      // Desplazamiento a la derecha -> día anterior (-1)
      expect(resolveDaySwipeDelta(60, 0)).toBe(-1);
      // Flick rápido a la derecha -> día anterior (-1)
      expect(resolveDaySwipeDelta(30, 0.4)).toBe(-1);

      // Desplazamiento insuficiente o velocidad neutra -> sin cambio (0)
      expect(resolveDaySwipeDelta(15, 0.1)).toBe(0);
      expect(resolveDaySwipeDelta(-20, 0)).toBe(0);
      // Desplazamiento a la izquierda pero velocidad opuesta
      expect(resolveDaySwipeDelta(-30, 0.2)).toBe(0);
    });

    it('isOutsideEdgeGuard protege los bordes para el gesto Atrás de Android 15', () => {
      const screenWidth = 390;
      // Toque en el borde izquierdo (0..31dp) -> en zona de guarda (false)
      expect(isOutsideEdgeGuard(0, screenWidth)).toBe(false);
      expect(isOutsideEdgeGuard(15, screenWidth)).toBe(false);
      expect(isOutsideEdgeGuard(31, screenWidth)).toBe(false);

      // Toque en el borde derecho (359..390dp) -> en zona de guarda (false)
      expect(isOutsideEdgeGuard(359, screenWidth)).toBe(false);
      expect(isOutsideEdgeGuard(380, screenWidth)).toBe(false);
      expect(isOutsideEdgeGuard(390, screenWidth)).toBe(false);

      // Toques en el cuerpo central -> permitidos para swiping (true)
      expect(isOutsideEdgeGuard(32, screenWidth)).toBe(true);
      expect(isOutsideEdgeGuard(195, screenWidth)).toBe(true);
      expect(isOutsideEdgeGuard(358, screenWidth)).toBe(true);

      // Si no se pudo determinar x0 (undefined / null), ser permisivo para no romper navegación
      expect(isOutsideEdgeGuard(undefined, screenWidth)).toBe(true);
      expect(isOutsideEdgeGuard(null, screenWidth)).toBe(true);
    });

    it('extractGestureStartX deriva x0 fielmente a partir de pageX y dx', () => {
      // Evento nativo con pageX y dx
      expect(extractGestureStartX({ nativeEvent: { pageX: 180 } }, { dx: -30 })).toBe(210);
      expect(extractGestureStartX({ nativeEvent: { pageX: 180 } }, { dx: 40 })).toBe(140);

      // Fallback a moveX si no hay pageX
      expect(extractGestureStartX(null, { moveX: 200, dx: -20 })).toBe(220);

      // Fallback a x0 concedido si moveX es 0
      expect(extractGestureStartX(null, { x0: 150 })).toBe(150);

      // Indefinido si no hay datos de coordenadas
      expect(extractGestureStartX(null, { x0: 0, moveX: 0 })).toBeUndefined();
    });
  });

  describe('preferred country and smart folding', () => {
    it('countryRank prioriza país preferido, luego mundial/sin país, luego otros', () => {
      expect(countryRank('ES', 'ES')).toBe(0);
      expect(countryRank('W', 'ES')).toBe(1);
      expect(countryRank(null, 'ES')).toBe(1);
      expect(countryRank('PT', 'ES')).toBe(2);
      expect(countryRank('IT', 'ES')).toBe(2);
    });

    it('buildDayView ordena por país preferido cuando está presente', () => {
      const m1 = createMatch('1', '2026-10-21T18:00:00Z', 'comp-es', 'ok-liga', { competitionCountry: 'ES', competitionTier: 1 });
      const m2 = createMatch('2', '2026-10-21T18:00:00Z', 'comp-pt', '1-divisao', { competitionCountry: 'PT', competitionTier: 1 });
      const m3 = createMatch('3', '2026-10-21T18:00:00Z', 'comp-wse', 'wse-champions', { competitionCountry: 'W', competitionTier: 1 });

      // Con país preferido PT: Portugal primero, luego W, luego España
      const viewPt = buildDayView([m1, m2, m3], { dayKey: '2026-10-21', country: 'PT' });
      expect(viewPt.competitions.map((c) => c.country)).toEqual(['PT', 'W', 'ES']);

      // Con país preferido ES: España primero, luego W, luego Portugal
      const viewEs = buildDayView([m1, m2, m3], { dayKey: '2026-10-21', country: 'ES' });
      expect(viewEs.competitions.map((c) => c.country)).toEqual(['ES', 'W', 'PT']);
    });

    it('defaultOpenKeys abre seguidas, directos y máxima categoría del país preferido', () => {
      const blocks = [
        { key: 'followed', country: 'IT', followed: true, tier: 4, featuredRank: null, matches: [{ status: 'scheduled' }] },
        { key: 'live', country: 'IT', followed: false, tier: 4, featuredRank: null, matches: [{ status: 'live' }] },
        { key: 'es-top', country: 'ES', followed: false, tier: 1, featuredRank: null, matches: [{ status: 'scheduled' }] },
        { key: 'es-base', country: 'ES', followed: false, tier: 4, featuredRank: null, matches: [{ status: 'scheduled' }] },
        { key: 'pt-top', country: 'PT', followed: false, tier: 1, featuredRank: null, matches: [{ status: 'scheduled' }] },
      ];

      // Con preferencia ES: abre seguida, live, y la liga top de ES. La de base de ES y la de PT quedan plegadas.
      const open = defaultOpenKeys(blocks, 'ES');
      expect(open.has('followed')).toBe(true);
      expect(open.has('live')).toBe(true);
      expect(open.has('es-top')).toBe(true);
      expect(open.has('es-base')).toBe(false);
      expect(open.has('pt-top')).toBe(false);
    });
  });
});


describe('buildDayView — visibilidad (spec 2026-10-30, misma regla que la web)', () => {
  const D = '2026-10-31T16:00:00Z';
  const day = '2026-10-31';
  const small = (id: string, extra: Partial<MatchSummary> = {}) =>
    createMatch(id, D, 'provincial', 'liga-provincial', { competitionFeaturedRank: null, competitionTier: null, ...extra });

  it('destacada sí, pequeña no (contada en hiddenCount)', () => {
    const v = buildDayView([createMatch('1', D), small('2', { status: 'live' })], { dayKey: day });
    expect(v.competitions.map((b) => b.id)).toEqual(['okliga']);
    expect(v.hiddenCount).toBe(1);
    expect(v.liveCount).toBe(0);
  });

  it('pequeña seguida o con un equipo seguido: aparece', () => {
    expect(buildDayView([small('2')], { dayKey: day, leagueIds: ['provincial'] }).total).toBe(1);
    expect(buildDayView([small('3')], { dayKey: day, teamIds: ['home-3'] }).myTeams).toHaveLength(1);
  });

  it('includeOthers: el resto detrás, marcado fuera del feed', () => {
    const v = buildDayView([small('2'), createMatch('1', D)], { dayKey: day, includeOthers: true });
    expect(v.competitions.map((b) => [b.id, b.inFeed])).toEqual([['okliga', true], ['provincial', false]]);
  });
});

describe('hiddenForDay', () => {
  it('suma los ocultos por hora UTC que caen en el día de Madrid', () => {
    expect(hiddenForDay({ '2026-10-30T22': 4, '2026-10-30T23': 2, '2026-10-31T16': 5, '2026-10-31T23': 1 }, '2026-10-31')).toBe(7);
  });
});

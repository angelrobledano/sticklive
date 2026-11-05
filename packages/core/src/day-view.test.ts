import { describe, it, expect } from 'vitest';
import { buildDayView, nextMatchday, daysWithMatches, defaultOpenKeys, type DayViewMatch } from './day-view';

/**
 * Fixtures TZ-seguros: las horas UTC elegidas caen siempre en el mismo día de
 * Madrid (10:00-20:00 UTC), así que las claves de día no dependen del horario
 * de verano. Equipos 'h*'/'a*'; competiciones por id.
 */
const COMPS: Record<string, { name: string; slug: string | null; country: string | null; featuredRank: number | null; tier: number | null }> = {
  mundial: { name: 'Mundial Masculino', slug: 'mundial-masculino-worldskate', country: 'W', featuredRank: 1, tier: 1 },
  okliga: { name: 'OK Liga', slug: 'ok-liga-masculina', country: 'ES', featuredRank: 5, tier: 1 },
  plata: { name: 'OK Liga Plata Sur', slug: 'ok-liga-plata-sur', country: 'ES', featuredRank: null, tier: 2 },
  zeta: { name: 'Zeta Cup', slug: null, country: 'PT', featuredRank: null, tier: null },
  alfa: { name: 'Alfa Cup', slug: null, country: 'IT', featuredRank: null, tier: null },
};

function M(
  id: string,
  iso: string | null,
  comp: keyof typeof COMPS | null,
  extra: Partial<DayViewMatch> = {},
): DayViewMatch {
  const c = comp ? COMPS[comp] : null;
  return {
    id,
    status: 'scheduled',
    scheduledAt: iso,
    startedAt: null,
    homeTeamId: `h-${id}`,
    awayTeamId: `a-${id}`,
    competitionId: comp,
    competitionName: c?.name ?? null,
    competitionSlug: c?.slug ?? null,
    competitionCountry: c?.country ?? null,
    competitionFeaturedRank: c?.featuredRank ?? null,
    competitionTier: c?.tier ?? null,
    ...extra,
  };
}

const DAY = '2026-10-16';

describe('buildDayView', () => {
  it('solo incluye los partidos del día elegido (clave de Madrid)', () => {
    const view = buildDayView(
      [
        M('hoy', '2026-10-16T15:00:00Z', 'okliga'),
        M('ayer', '2026-10-15T15:00:00Z', 'okliga'),
        M('manana', '2026-10-17T15:00:00Z', 'okliga'),
        M('sin-fecha', null, 'okliga'),
      ],
      { dayKey: DAY },
    );
    expect(view.total).toBe(1);
    expect(view.competitions.flatMap((c) => c.matches.map((m) => m.id))).toEqual(['hoy']);
  });

  it('un partido de madrugada en Madrid cuenta para ese día, no para el anterior', () => {
    // 23:00 UTC del 16 = 01:00 del 17 en Madrid (CEST, UTC+2)
    const view = buildDayView([M('noche', '2026-10-16T23:00:00Z', 'mundial')], { dayKey: DAY });
    expect(view.total).toBe(0);
    const next = buildDayView([M('noche', '2026-10-16T23:00:00Z', 'mundial')], { dayKey: '2026-10-17' });
    expect(next.total).toBe(1);
  });

  it('los partidos de equipos seguidos van a "myTeams" y no se repiten en su competición', () => {
    const view = buildDayView(
      [
        M('mio', '2026-10-16T15:00:00Z', 'okliga', { homeTeamId: 'barca' }),
        M('otro', '2026-10-16T16:00:00Z', 'okliga'),
      ],
      { dayKey: DAY, teamIds: ['barca'] },
    );
    expect(view.myTeams.map((m) => m.id)).toEqual(['mio']);
    expect(view.competitions).toHaveLength(1);
    expect(view.competitions[0]!.matches.map((m) => m.id)).toEqual(['otro']);
  });

  it('un equipo seguido como visitante también cuenta', () => {
    const view = buildDayView(
      [M('mio', '2026-10-16T15:00:00Z', 'okliga', { awayTeamId: 'barca' })],
      { dayKey: DAY, teamIds: ['barca'] },
    );
    expect(view.myTeams.map((m) => m.id)).toEqual(['mio']);
    expect(view.competitions).toHaveLength(0);
  });

  it('ordena bloques: seguidas primero, luego importancia y luego nombre', () => {
    const view = buildDayView(
      [
        M('z', '2026-10-16T15:00:00Z', 'zeta'),
        M('p', '2026-10-16T15:00:00Z', 'plata'),
        M('a', '2026-10-16T15:00:00Z', 'alfa'),
        M('m', '2026-10-16T15:00:00Z', 'mundial'),
        M('o', '2026-10-16T15:00:00Z', 'okliga'),
      ],
      { dayKey: DAY, leagueIds: ['plata'], locale: 'es', includeOthers: true },
    );
    expect(view.competitions.map((c) => c.id)).toEqual(['plata', 'mundial', 'okliga', 'alfa', 'zeta']);
    expect(view.competitions[0]!.followed).toBe(true);
    expect(view.competitions[1]!.followed).toBe(false);
  });

  it('dentro de cada bloque ordena por hora y copia los datos de la competición', () => {
    const view = buildDayView(
      [
        M('tarde', '2026-10-16T19:00:00Z', 'mundial'),
        M('pronto', '2026-10-16T10:00:00Z', 'mundial'),
        M('medio', '2026-10-16T14:45:00Z', 'mundial'),
      ],
      { dayKey: DAY },
    );
    const block = view.competitions[0]!;
    expect(block.matches.map((m) => m.id)).toEqual(['pronto', 'medio', 'tarde']);
    expect(block).toMatchObject({
      key: 'mundial',
      id: 'mundial',
      name: 'Mundial Masculino',
      slug: 'mundial-masculino-worldskate',
      country: 'W',
    });
  });

  it('los directos se quedan en su bloque y no reordenan nada', () => {
    const view = buildDayView(
      [
        M('fin', '2026-10-16T10:00:00Z', 'okliga', { status: 'finished' }),
        M('vivo', '2026-10-16T15:00:00Z', 'okliga', { status: 'live' }),
        M('luego', '2026-10-16T19:00:00Z', 'okliga'),
      ],
      { dayKey: DAY },
    );
    expect(view.competitions[0]!.matches.map((m) => m.id)).toEqual(['fin', 'vivo', 'luego']);
    expect(view.liveCount).toBe(1);
  });

  it('partidos sin competición caen en un bloque propio con nombre nulo, al final', () => {
    const view = buildDayView(
      [M('suelto', '2026-10-16T15:00:00Z', null), M('o', '2026-10-16T15:00:00Z', 'okliga')],
      { dayKey: DAY, includeOthers: true },
    );
    expect(view.competitions.map((c) => c.name)).toEqual(['OK Liga', null]);
  });

  it('filtro "live": solo partidos en juego, también en myTeams', () => {
    const view = buildDayView(
      [
        M('vivo', '2026-10-16T15:00:00Z', 'okliga', { status: 'live' }),
        M('mio-vivo', '2026-10-16T15:00:00Z', 'plata', { status: 'live', homeTeamId: 'barca' }),
        M('mio-luego', '2026-10-16T19:00:00Z', 'plata', { homeTeamId: 'barca' }),
        M('luego', '2026-10-16T19:00:00Z', 'mundial'),
      ],
      { dayKey: DAY, teamIds: ['barca'], filter: 'live' },
    );
    expect(view.filter).toBe('live');
    expect(view.myTeams.map((m) => m.id)).toEqual(['mio-vivo']);
    expect(view.competitions.flatMap((c) => c.matches.map((m) => m.id))).toEqual(['vivo']);
  });

  it('filtro "following": equipos y ligas seguidos, nada más', () => {
    const view = buildDayView(
      [
        M('mio', '2026-10-16T15:00:00Z', 'mundial', { homeTeamId: 'esp' }),
        M('liga', '2026-10-16T15:00:00Z', 'plata'),
        M('resto', '2026-10-16T15:00:00Z', 'okliga'),
      ],
      { dayKey: DAY, teamIds: ['esp'], leagueIds: ['plata'], filter: 'following' },
    );
    expect(view.myTeams.map((m) => m.id)).toEqual(['mio']);
    expect(view.competitions.map((c) => c.id)).toEqual(['plata']);
  });

  it('un filtro sin coincidencias cae a "all" (p. ej. acabó el último directo)', () => {
    const view = buildDayView(
      [M('fin', '2026-10-16T10:00:00Z', 'okliga', { status: 'finished' })],
      { dayKey: DAY, filter: 'live' },
    );
    expect(view.filter).toBe('all');
    expect(view.total).toBe(1);
    expect(view.competitions[0]!.matches).toHaveLength(1);
  });

  it('los contadores se calculan sobre el día sin filtrar', () => {
    const view = buildDayView(
      [
        M('vivo', '2026-10-16T15:00:00Z', 'okliga', { status: 'live' }),
        M('mio', '2026-10-16T16:00:00Z', 'okliga', { homeTeamId: 'barca' }),
        M('liga', '2026-10-16T17:00:00Z', 'plata'),
        M('otro-dia', '2026-10-17T15:00:00Z', 'plata', { status: 'live' }),
      ],
      { dayKey: DAY, teamIds: ['barca'], leagueIds: ['plata'], filter: 'live' },
    );
    expect(view.total).toBe(3);
    expect(view.liveCount).toBe(1);
    expect(view.followingCount).toBe(2);
  });
});

describe('nextMatchday', () => {
  it('devuelve el primer día POSTERIOR con partidos, agrupado igual que el día', () => {
    const next = nextMatchday(
      [
        M('antes', '2026-10-15T15:00:00Z', 'okliga'),
        M('mismo', '2026-10-19T15:00:00Z', 'okliga'),
        M('lejos', '2026-10-24T15:00:00Z', 'mundial'),
        M('solo-pequena', '2026-10-20T15:00:00Z', 'plata'),
        M('cerca', '2026-10-21T15:00:00Z', 'mundial'),
      ],
      '2026-10-19',
    );
    // El día 20 solo tiene una competición fuera del feed: se salta.
    expect(next?.dayKey).toBe('2026-10-21');
    expect(next?.competitions.flatMap((c) => c.matches.map((m) => m.id))).toEqual(['cerca']);
    expect(next?.filter).toBe('all');
  });

  it('respeta los favoritos al agrupar la próxima jornada', () => {
    const next = nextMatchday(
      [M('mio', '2026-10-21T15:00:00Z', 'plata', { homeTeamId: 'barca' })],
      '2026-10-19',
      { teamIds: ['barca'] },
    );
    expect(next?.myTeams.map((m) => m.id)).toEqual(['mio']);
  });

  it('null si no hay nada después', () => {
    expect(nextMatchday([M('antes', '2026-10-15T15:00:00Z', 'okliga')], '2026-10-19')).toBeNull();
  });
});

describe('daysWithMatches', () => {
  it('claves de día de Madrid de los partidos con fecha', () => {
    const days = daysWithMatches([
      M('a', '2026-10-16T15:00:00Z', 'okliga'),
      M('b', '2026-10-16T23:00:00Z', 'okliga'), // 01:00 del 17 en Madrid
      M('c', null, 'okliga'),
    ]);
    expect([...days].sort()).toEqual(['2026-10-16', '2026-10-17']);
  });
});

/**
 * Plegado inteligente (plan 2026-10-25, iteración 3): con 90 competiciones en
 * un día de base, todo desplegado eran 380 filas. Abiertas solo las que
 * importan; si ninguna lo hace, la primera para no dejar la pantalla cerrada.
 */
describe('defaultOpenKeys', () => {
  const b = (key: string, o: Partial<{ followed: boolean; tier: number | null; featuredRank: number | null; live: boolean }> = {}) => ({
    key, followed: o.followed ?? false, tier: o.tier ?? null, featuredRank: o.featuredRank ?? null,
    matches: [{ status: o.live ? 'live' : 'scheduled' }],
  });
  it('abre seguidas, con directo, destacadas y de máxima categoría (tier 1-2)', () => {
    const keys = defaultOpenKeys([
      b('seguida', { followed: true }), b('directo', { live: true }), b('destacada', { featuredRank: 3 }),
      b('tier1', { tier: 1 }), b('tier2', { tier: 2 }), b('tier3', { tier: 3 }), b('base'),
    ]);
    expect([...keys].sort()).toEqual(['destacada', 'directo', 'seguida', 'tier1', 'tier2']);
  });
  it('si ninguna importa, abre solo la primera', () => {
    expect([...defaultOpenKeys([b('x'), b('y')])]).toEqual(['x']);
  });
  it('sin bloques, nada', () => {
    expect(defaultOpenKeys([]).size).toBe(0);
  });
  it('«otras competiciones»: abre las 3 primeras (ya vienen por importancia) y pliega el resto', () => {
    const o = (key: string) => ({ ...b(key), inFeed: false });
    const keys = defaultOpenKeys([b('feed', { featuredRank: 1 }), o('a'), o('b'), o('c'), o('d'), o('e')]);
    expect([...keys].sort()).toEqual(['a', 'b', 'c', 'feed']);
  });
});

/** País preferido (iteración 4): ordena, nunca excluye. Los favoritos mandan. */
describe('buildDayView con país preferido', () => {
  const day = [
    M('1', '2026-10-16T18:00:00Z', 'okliga'),
    M('2', '2026-10-16T18:00:00Z', 'zeta'),
    M('3', '2026-10-16T18:00:00Z', 'mundial'),
    M('4', '2026-10-16T18:00:00Z', 'alfa'),
  ];
  it('el país ordena dentro del feed y dentro de «otras competiciones»', () => {
    const v = buildDayView(day, { dayKey: DAY, country: 'PT', includeOthers: true });
    expect(v.competitions.map((b) => b.key)).toEqual(['mundial', 'okliga', 'zeta', 'alfa']);
  });
  it('una liga seguida de otro país va por delante de todo', () => {
    const v = buildDayView(day, { dayKey: DAY, country: 'PT', leagueIds: ['alfa'] });
    expect(v.competitions[0]!.key).toBe('alfa');
  });
  it('sin país, el orden global de siempre', () => {
    const v = buildDayView(day, { dayKey: DAY, includeOthers: true });
    expect(v.competitions.map((b) => b.key)).toEqual(['mundial', 'okliga', 'alfa', 'zeta']);
  });
});

describe('defaultOpenKeys con país preferido', () => {
  const b = (key: string, country: string, o: Partial<{ followed: boolean; tier: number | null; live: boolean }> = {}) => ({
    key, country, followed: o.followed ?? false, tier: o.tier ?? null, featuredRank: null,
    matches: [{ status: o.live ? 'live' : 'scheduled' }],
  });
  it('la máxima categoría de otro país sale plegada salvo que la sigas o tenga directo', () => {
    const keys = defaultOpenKeys([
      b('pt1', 'PT', { tier: 1 }), b('es1', 'ES', { tier: 1 }), b('esLive', 'ES', { live: true }),
      b('itSeg', 'IT', { followed: true }), b('mundial', 'W', { tier: 1 }),
    ], 'PT');
    expect([...keys].sort()).toEqual(['esLive', 'itSeg', 'mundial', 'pt1']);
  });
});

/** Los días se agrupan en la zona de quien mira (decisión 25/10/2026). */
describe('buildDayView con zona horaria de quien mira', () => {
  const late = [M('1', '2026-10-24T22:30:00Z', 'okliga')];
  it('en Madrid cae el 25; en Lisboa, el 24', () => {
    expect(buildDayView(late, { dayKey: '2026-10-25' }).total).toBe(1);
    expect(buildDayView(late, { dayKey: '2026-10-24', tz: 'Europe/Lisbon' }).total).toBe(1);
    expect(buildDayView(late, { dayKey: '2026-10-25', tz: 'Europe/Lisbon' }).total).toBe(0);
  });
});

describe('buildDayView — visibilidad (spec 2026-10-30)', () => {
  const D = '2026-10-31T16:00:00Z';
  const day = '2026-10-31';

  it('por defecto solo destacadas y lo seguido; el resto se cuenta en hiddenCount', () => {
    const v = buildDayView([M('1', D, 'okliga'), M('2', D, 'plata'), M('3', D, 'zeta', { status: 'live' })], { dayKey: day });
    expect(v.competitions.map((b) => b.id)).toEqual(['okliga']);
    expect(v.total).toBe(1);
    expect(v.hiddenCount).toBe(2);
    // El directo de una competición pequeña no cuenta para el chip «En directo».
    expect(v.liveCount).toBe(0);
  });

  it('una competición pequeña seguida aparece; un equipo seguido de otra pequeña, en «Siguiendo»', () => {
    const v = buildDayView([M('2', D, 'plata'), M('3', D, 'zeta')], { dayKey: day, leagueIds: ['plata'], teamIds: ['h-3'] });
    expect(v.competitions.map((b) => b.id)).toEqual(['plata']);
    expect(v.myTeams.map((m) => m.id)).toEqual(['3']);
    expect(v.hiddenCount).toBe(0);
  });

  it('un partido sin directo de lo seguido también sale (no se confunde directo con relevancia)', () => {
    const v = buildDayView([M('2', D, 'plata', { status: 'scheduled' })], { dayKey: day, leagueIds: ['plata'] });
    expect(v.total).toBe(1);
  });

  it('con includeOthers, el resto va detrás, marcado fuera del feed; sin duplicados', () => {
    const v = buildDayView([M('1', D, 'okliga'), M('2', D, 'plata'), M('1', D, 'okliga')], { dayKey: day, includeOthers: true });
    expect(v.competitions.map((b) => [b.id, b.inFeed, b.matches.length])).toEqual([['okliga', true, 1], ['plata', false, 1]]);
  });

  it('país preferido: la destacada de segundo nivel de otro país queda fuera del feed', () => {
    const extra = { competitionCountry: 'PT', competitionFeaturedRank: 30, competitionTier: 2 };
    const v = buildDayView([M('1', D, 'okliga'), M('9', D, 'zeta', extra)], { dayKey: day, country: 'ES' });
    expect(v.competitions.map((b) => b.id)).toEqual(['okliga']);
    expect(v.hiddenCount).toBe(1);
  });
});

// ─── Tests de origen app (apps/mobile/src/lib/day-view.test.ts) ───

import {
  addDaysToKey,
  buildDateKeys,
  computeCenterOffset,
  countryRank,
  dayDiff,
  getRelativeKey,
  hiddenForDay,
  madridDateKey,
} from './day-view';
import type { MatchSummary } from './api';

function createAppMatch(
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
      createAppMatch('m-today', '2026-10-21T18:00:00Z'),
      createAppMatch('m-yesterday', '2026-10-20T18:00:00Z'),
      createAppMatch('m-tomorrow', '2026-10-22T18:00:00Z'),
    ];
    const view = buildDayView(matches, { dayKey: DAY });
    expect(view.total).toBe(1);
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['m-today']);
  });

  it('ordena partidos de cada competición por hora de inicio cronológica', () => {
    const matches = [
      createAppMatch('late', '2026-10-21T20:00:00Z'),
      createAppMatch('early', '2026-10-21T12:00:00Z'),
      createAppMatch('mid', '2026-10-21T16:00:00Z'),
    ];
    const view = buildDayView(matches, { dayKey: DAY });
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['early', 'mid', 'late']);
  });

  it('separa partidos de equipos seguidos en myTeams', () => {
    const followedMatch = createAppMatch('fav', '2026-10-21T15:00:00Z', 'okliga', 'ok-liga-masculina', {
      homeTeam: { id: 'team-barca', name: 'Barça', shortName: 'FCB', logoUrl: null },
    });
    const otherMatch = createAppMatch('other', '2026-10-21T16:00:00Z');

    const view = buildDayView([followedMatch, otherMatch], { dayKey: DAY, teamIds: ['team-barca'] });
    expect(view.myTeams.map((m) => m.id)).toEqual(['fav']);
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['other']);
  });

  it('cuenta partidos en directo y aplica filtro live', () => {
    const liveMatch = createAppMatch('live-1', '2026-10-21T18:00:00Z', 'okliga', 'ok-liga-masculina', {
      status: 'live',
    });
    const schedMatch = createAppMatch('sched-1', '2026-10-21T19:00:00Z');

    const view = buildDayView([liveMatch, schedMatch], { dayKey: DAY, filter: 'live' });
    expect(view.total).toBe(2);
    expect(view.liveCount).toBe(1);
    expect(view.filter).toBe('live');
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['live-1']);
  });

  it('daysWithMatches identifica los días con partidos', () => {
    const matches = [
      createAppMatch('m1', '2026-10-21T18:00:00Z'),
      createAppMatch('m2', '2026-10-25T18:00:00Z'),
    ];
    const days = daysWithMatches(matches);
    expect(days.has('2026-10-21')).toBe(true);
    expect(days.has('2026-10-25')).toBe(true);
    expect(days.has('2026-10-22')).toBe(false);
  });

  it('nextMatchday encuentra la siguiente jornada con partidos', () => {
    const matches = [
      createAppMatch('m-past', '2026-10-20T18:00:00Z'),
      createAppMatch('m-future', '2026-10-24T18:00:00Z'),
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

  describe('preferred country and smart folding', () => {
    it('countryRank prioriza país preferido, luego mundial/sin país, luego otros', () => {
      expect(countryRank('ES', 'ES')).toBe(0);
      expect(countryRank('W', 'ES')).toBe(1);
      expect(countryRank(null, 'ES')).toBe(1);
      expect(countryRank('PT', 'ES')).toBe(2);
      expect(countryRank('IT', 'ES')).toBe(2);
    });

    it('buildDayView ordena por país preferido cuando está presente', () => {
      const m1 = createAppMatch('1', '2026-10-21T18:00:00Z', 'comp-es', 'ok-liga', { competitionCountry: 'ES', competitionTier: 1 });
      const m2 = createAppMatch('2', '2026-10-21T18:00:00Z', 'comp-pt', '1-divisao', { competitionCountry: 'PT', competitionTier: 1 });
      const m3 = createAppMatch('3', '2026-10-21T18:00:00Z', 'comp-wse', 'wse-champions', { competitionCountry: 'W', competitionTier: 1 });

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
    createAppMatch(id, D, 'provincial', 'liga-provincial', { competitionFeaturedRank: null, competitionTier: null, ...extra });

  it('destacada sí, pequeña no (contada en hiddenCount)', () => {
    const v = buildDayView([createAppMatch('1', D), small('2', { status: 'live' })], { dayKey: day });
    expect(v.competitions.map((b) => b.id)).toEqual(['okliga']);
    expect(v.hiddenCount).toBe(1);
    expect(v.liveCount).toBe(0);
  });

  it('pequeña seguida o con un equipo seguido: aparece', () => {
    expect(buildDayView([small('2')], { dayKey: day, leagueIds: ['provincial'] }).total).toBe(1);
    expect(buildDayView([small('3')], { dayKey: day, teamIds: ['home-3'] }).myTeams).toHaveLength(1);
  });

  it('includeOthers: el resto detrás, marcado fuera del feed', () => {
    const v = buildDayView([small('2'), createAppMatch('1', D)], { dayKey: day, includeOthers: true });
    expect(v.competitions.map((b) => [b.id, b.inFeed])).toEqual([['okliga', true], ['provincial', false]]);
  });
});

describe('hiddenForDay', () => {
  it('suma los ocultos por hora UTC que caen en el día de Madrid', () => {
    expect(hiddenForDay({ '2026-10-30T22': 4, '2026-10-30T23': 2, '2026-10-31T16': 5, '2026-10-31T23': 1 }, '2026-10-31')).toBe(7);
  });
});

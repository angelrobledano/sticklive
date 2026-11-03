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

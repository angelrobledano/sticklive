import { describe, it, expect } from 'vitest';
import type { SeasonMatch, SeasonPhase, SeasonRound, KnockoutStage } from '@/lib/api/client';
import { knockoutPhaseViews, knockoutLayout, finalPhaseStarted, knockoutTabLabelKey } from './season-phases';

let n = 0;
function phase(over: Partial<SeasonPhase> & Pick<SeasonPhase, 'kind'>): SeasonPhase {
  return { id: `p${++n}`, ordinal: n, isPlacement: false, name: null, hasStandings: false, stages: [], fromSource: true, ...over };
}
function round(p: SeasonPhase, stage: KnockoutStage | null, over: Partial<SeasonRound> = {}): SeasonRound {
  return { id: `r${++n}`, number: 1, name: null, roundType: 'playoff', phaseId: p.id, stage, ...over };
}
function match(p: SeasonPhase, stage: KnockoutStage | null, seriesGame: number | null = null): SeasonMatch {
  const t = (id: string) => ({ id, name: id, shortName: id, logoUrl: null });
  return {
    id: `m${++n}`, status: 'scheduled', scheduledAt: '2026-05-16T18:00:00Z', startedAt: null, finishedAt: null,
    score: { home: null, away: null }, venueName: null, roundId: null, roundNumber: null, roundName: null,
    roundType: 'playoff', phaseId: p.id, stage, seriesGame, homeTeam: t('a'), awayTeam: t('b'),
  };
}

describe('knockoutLayout — el cuadro sale de la estructura, no del formato declarado', () => {
  it('series al mejor de N (la fuente publica el 3.er partido) → series', () => {
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    expect(knockoutLayout(p, [match(p, 'quarters', 1), match(p, 'quarters', 3)])).toBe('series');
  });

  it('semis → final a partido único → final four (también tras una fase de grupos)', () => {
    const p = phase({ kind: 'knockout', stages: ['semis', 'final'] });
    expect(knockoutLayout(p, [match(p, 'semis'), match(p, 'semis')])).toBe('final_four');
  });

  it('cuartos → semis → final, o ida/vuelta (2 partidos, eliminatoria por goles) → cuadro', () => {
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    expect(knockoutLayout(p, [match(p, 'quarters')])).toBe('bracket');
    const iv = phase({ kind: 'knockout', stages: [] });
    expect(knockoutLayout(iv, [match(iv, null, 1), match(iv, null, 2)])).toBe('bracket');
  });
});

describe('knockoutPhaseViews', () => {
  it('payload antiguo (sin fases) o fases heredadas → null (presentación de siempre)', () => {
    expect(knockoutPhaseViews(undefined, [], [])).toBeNull();
    expect(knockoutPhaseViews([], [], [])).toBeNull();
    const legacy = phase({ kind: 'knockout', fromSource: false });
    expect(knockoutPhaseViews([legacy], [], [match(legacy, null)])).toBeNull();
  });

  it('liga + playoff + colocación: una vista por fase eliminatoria, con sus partidos y rondas', () => {
    const liga = phase({ kind: 'league', hasStandings: true });
    const po = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    const pl = phase({ kind: 'knockout', isPlacement: true, stages: ['placement'] });
    const qf = round(po, 'quarters');
    const ms = [match(po, 'quarters', 1), match(po, 'quarters', 3), match(pl, 'placement', 1)];
    const views = knockoutPhaseViews([liga, po, pl], [qf], ms)!;
    expect(views.map((v) => [v.phase.id, v.layout, v.matches.length, v.rounds.length])).toEqual([
      [po.id, 'series', 2, 1],
      [pl.id, 'series', 1, 0],
    ]);
  });

  it('grupos + final four: la fase eliminatoria se pinta como final four aunque el formato legado sea "league"', () => {
    const g = phase({ kind: 'groups', hasStandings: true });
    const ff = phase({ kind: 'knockout', stages: ['semis', 'final'] });
    const views = knockoutPhaseViews([g, ff], [round(ff, 'final')], [match(ff, 'semis'), match(ff, 'semis')])!;
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ layout: 'final_four' });
    // La final aún sin partidos forma parte de la vista (ronda declarada).
    expect(views[0]!.rounds.map((r) => r.stage)).toEqual(['final']);
  });

  it('sin fases eliminatorias → lista vacía', () => {
    expect(knockoutPhaseViews([phase({ kind: 'league' })], [], [])).toEqual([]);
  });
});

describe('finalPhaseStarted — la fase final ya manda en la competición', () => {
  const liga = () => phase({ kind: 'league', hasStandings: true });
  const reg = (status: string): SeasonMatch => ({ ...match(liga(), null), roundType: 'regular', status });
  const ko = (status: string): SeasonMatch => {
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    return { ...match(p, 'quarters'), status };
  };

  it('liga sin eliminatorias → no', () => {
    expect(finalPhaseStarted([reg('finished'), reg('scheduled')])).toBe(false);
  });

  it('cruces publicados pero la liga/grupos aún abiertos y nada jugado → no', () => {
    expect(finalPhaseStarted([reg('finished'), reg('scheduled'), ko('scheduled')])).toBe(false);
  });

  it('liga/grupos cerrados (terminados o cancelados) y cruces programados → sí', () => {
    expect(finalPhaseStarted([reg('finished'), reg('cancelled'), ko('scheduled')])).toBe(true);
  });

  it('una eliminatoria en juego o terminada → sí (aunque quede un partido de grupos colgado)', () => {
    expect(finalPhaseStarted([reg('scheduled'), ko('live')])).toBe(true);
    expect(finalPhaseStarted([reg('postponed'), ko('finished')])).toBe(true);
  });
});

describe('knockoutTabLabelKey — el nombre de la pestaña según cómo se juega', () => {
  it('series al mejor de N (OK Liga) → Playoffs', () => {
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    expect(knockoutTabLabelKey('league', [p], [], [match(p, 'quarters', 1), match(p, 'quarters', 3)])).toBe('match_tabs.playoffs');
  });

  it('partido único con cuartos (Mundial) → Eliminatorias', () => {
    const g = phase({ kind: 'groups', hasStandings: true });
    const p = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final', 'third_place', 'placement'] });
    expect(knockoutTabLabelKey('league', [g, p], [], [match(p, 'quarters'), match(p, 'placement')])).toBe('match_tabs.knockout');
  });

  it('final four (declarada o por estructura) → Final Four', () => {
    expect(knockoutTabLabelKey('final_four', undefined, [], [])).toBe('playoffs.final_four');
    const p = phase({ kind: 'knockout', stages: ['semis', 'final'] });
    expect(knockoutTabLabelKey('league', [p], [], [match(p, 'semis')])).toBe('playoffs.final_four');
  });

  it('temporada heredada sin fases de la fuente → Playoffs (como siempre)', () => {
    expect(knockoutTabLabelKey('league', undefined, [], [])).toBe('match_tabs.playoffs');
  });
});

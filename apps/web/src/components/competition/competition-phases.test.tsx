import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import type { KnockoutStage, SeasonMatch, SeasonPhase, SeasonRound, TeamSummary } from '@/lib/api/client';
import { PlayoffsTab } from './PlayoffsTab';
import { FinalFourBracket } from './FinalFourBracket';
import { groupByPhase, placementMatches } from '@/lib/playoff';
import { buildBracketRounds } from '@/lib/bracket';
import { buildKnockoutSummary } from '@/lib/knockout';
import { nearestMatchDay, pickDefaultFilter } from './GameweeksTab';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions/x',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * La web pinta la estructura EXPLÍCITA de la fuente (`season.phases`, `stage`,
 * `seriesGame`) en vez de deducirla del formato declarado, del nombre de la
 * ronda o de la cronología. Casos que antes fallaban:
 *  - grupos + final four: el formato legado "league" mostraba la final four
 *    como un playoff de series;
 *  - nombres basura ("FINAL" para semis y final) o roundNumber legado;
 *  - una eliminatoria en curso (solo cuartos jugados) se "deducía".
 */

const ES = {
  playoffs: {
    quarters: 'Cuartos', semis: 'Semis', final: 'Final', third_place: '3.er y 4.º puesto',
    semifinal_n: 'Semifinal {n}', quarter_n: 'Cuarto {n}', grand_final: 'Gran Final',
    champion: 'Campeón', live: 'En directo', tbd: 'Por determinar', series_wins: 'Victorias de la serie',
    other_places: 'Otros puestos', placement: '9º–10º',
  },
  match_states: { final: 'Final' },
  match_tabs: { playoffs: 'Playoffs' },
};

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={ES as never} referenceDict={ES as never}>{node}</I18nProvider>,
  );
}

function team(id: string): TeamSummary {
  return { id, name: `Equipo ${id.toUpperCase()}`, shortName: id.toUpperCase(), logoUrl: null };
}

let n = 0;
function phase(over: Partial<SeasonPhase> & Pick<SeasonPhase, 'kind'>): SeasonPhase {
  return { id: `p${++n}`, ordinal: n, isPlacement: false, name: null, hasStandings: false, stages: [], fromSource: true, ...over };
}
function round(p: SeasonPhase, stage: KnockoutStage | null, number: number, name: string | null = null): SeasonRound {
  return { id: `r${++n}`, number, name, roundType: 'playoff', phaseId: p.id, stage };
}
function match(
  p: SeasonPhase | null, r: SeasonRound | null, home: string, away: string, date: string,
  over: Partial<SeasonMatch> = {},
): SeasonMatch {
  return {
    id: `m${++n}`, status: 'scheduled', scheduledAt: `${date}T18:00:00Z`, startedAt: null, finishedAt: null,
    score: { home: null, away: null }, winnerTeamId: null, winType: null, venueName: null,
    roundId: r?.id ?? null, roundNumber: null, roundName: r?.name ?? null, roundType: 'playoff',
    phaseId: p?.id ?? null, stage: r?.stage ?? null, seriesGame: null,
    homeTeam: team(home), awayTeam: team(away), ...over,
  } as SeasonMatch;
}
const won = (h: number, a: number) => ({ status: 'finished', score: { home: h, away: a } }) as Partial<SeasonMatch>;

describe('PlayoffsTab con fases de la fuente', () => {
  it('grupos + final four: la fase eliminatoria se pinta como final four aunque el formato legado sea "league"', () => {
    const g = phase({ kind: 'groups', hasStandings: true });
    const ff = phase({ kind: 'knockout', stages: ['semis', 'final'] });
    const sf = round(ff, 'semis', 30, 'SEMIFINALES');
    const fin = round(ff, 'final', 40, 'FINAL');
    const ms = [
      match(g, null, 'a', 'b', '2026-10-05', { roundType: 'regular', roundNumber: 1 }),
      match(ff, sf, 'a', 'd', '2026-10-10', { roundNumber: 2 }),
      match(ff, sf, 'c', 'b', '2026-10-10', { roundNumber: 2 }),
    ];
    const html = render(<PlayoffsTab rounds={[sf, fin]} matches={ms} format="league" phases={[g, ff]} />);
    expect(html).toContain('Semifinal 1');
    expect(html).toContain('Semifinal 2');
    // Cuadro de final four: el hueco de la final (aún sin finalistas) se dibuja.
    expect(html).toContain('Por determinar');
    expect(html).not.toContain('Victorias de la serie');
  });

  it('liga + playoff al mejor de N (la fuente publica el 3.er partido): vista de series', () => {
    const liga = phase({ kind: 'league', hasStandings: true });
    const po = phase({ kind: 'knockout', stages: ['quarters'] });
    const qf = round(po, 'quarters', 20, 'CUARTOS');
    const ms = [
      match(po, qf, 'a', 'h', '2026-05-16', { seriesGame: 1, roundNumber: 1, ...won(4, 1) }),
      match(po, qf, 'h', 'a', '2026-05-23', { seriesGame: 2, roundNumber: 1 }),
      match(po, qf, 'a', 'h', '2026-05-30', { seriesGame: 3, roundNumber: 1 }),
    ];
    const html = render(<PlayoffsTab rounds={[qf]} matches={ms} format="league" phases={[liga, po]} />);
    expect(html).toContain('Victorias de la serie');
  });

  it('eliminatoria en curso (solo cuartos jugados): cuartos reconocidos y semis/final "por determinar"', () => {
    const ko = phase({ kind: 'knockout', stages: ['quarters', 'semis', 'final'] });
    const qf = round(ko, 'quarters', 20, 'CUARTOS DE FINAL');
    const sf = round(ko, 'semis', 30, null);
    const fin = round(ko, 'final', 40, null);
    const ms = [
      match(ko, qf, 'a', 'h', '2026-03-19', won(3, 1)), match(ko, qf, 'b', 'g', '2026-03-19', won(2, 0)),
      match(ko, qf, 'c', 'f', '2026-03-19', won(1, 0)), match(ko, qf, 'd', 'e', '2026-03-19', won(5, 2)),
    ];
    const html = render(<PlayoffsTab rounds={[qf, sf, fin]} matches={ms} format="bracket" phases={[ko]} />);
    expect(html).toContain('Cuartos');
    expect(html).toContain('Por determinar');
    // Las rondas declaradas sin partidos se rotulan por su fase, no por el nombre de la fuente.
    expect(html).toContain('Semis');
  });

  it('sin fases (payload antiguo): presentación de siempre por formato declarado', () => {
    const ms = [
      match(null, null, 'a', 'b', '2026-09-24', { roundName: 'Semifinales', roundNumber: 1 }),
      match(null, null, 'c', 'd', '2026-09-24', { roundName: 'Semifinales', roundNumber: 1 }),
    ];
    const html = render(<PlayoffsTab rounds={[]} matches={ms} format="final_four" />);
    expect(html).toContain('Semifinal 1');
  });
});

describe('FinalFourBracket — fase explícita', () => {
  it('nombre basura ("FINAL" para todo) y roundNumber legado: manda `stage`', () => {
    const ff = phase({ kind: 'knockout' });
    const sf = round(ff, 'semis', 30, 'FINAL');
    const fin = round(ff, 'final', 40, 'FINAL');
    const ms = [
      match(ff, sf, 'a', 'b', '2026-09-24', { roundNumber: 2, ...won(3, 1) }),
      match(ff, sf, 'c', 'd', '2026-09-24', { roundNumber: 2, ...won(2, 1) }),
      match(ff, fin, 'a', 'c', '2026-09-25', { roundNumber: 3, ...won(4, 2) }),
    ];
    const html = render(<FinalFourBracket matches={ms} />);
    expect(html).toContain('Semifinal 2');
    expect(html).toContain('Campeón');
  });
});

describe('helpers del cuadro — fase explícita primero', () => {
  it('groupByPhase: `stage` manda sobre roundNumber; 3.er puesto y colocación fuera de la escalera', () => {
    const p = phase({ kind: 'knockout' });
    const sf = match(p, round(p, 'semis', 30), 'a', 'b', '2026-05-29'); // roundNumber null
    const third = match(p, round(p, 'third_place', 50), 'c', 'd', '2026-06-01');
    const pl = match(p, round(p, 'placement', 60), 'i', 'j', '2026-05-16', { roundNumber: 0 });
    const out = groupByPhase([sf, third, pl]);
    expect(out.Semis.map((m) => m.id)).toEqual([sf.id]);
    expect(out.Cuartos).toEqual([]);
    expect(placementMatches([sf, third, pl]).map((m) => m.id)).toEqual([pl.id]);
  });

  it('buildBracketRounds: con `stage`, una sola fase jugada no se re-deduce', () => {
    const p = phase({ kind: 'knockout' });
    const qf = round(p, 'quarters', 20, 'X');
    const ms = [match(p, qf, 'a', 'h', '2026-03-19'), match(p, qf, 'b', 'g', '2026-03-19')];
    expect(buildBracketRounds(ms).map((r) => [r.key, r.matches.length])).toEqual([['quarters', 2]]);
  });

  it('buildKnockoutSummary: eliminado en semis aunque la final aún no tenga partidos', () => {
    const p = phase({ kind: 'knockout' });
    const qf = round(p, 'quarters', 20);
    const sf = round(p, 'semis', 30);
    const ms = [
      match(p, qf, 'a', 'h', '2026-03-19', won(3, 1)),
      match(p, qf, 'b', 'g', '2026-03-19', won(3, 1)),
      match(p, sf, 'a', 'b', '2026-03-21', won(1, 4)),
    ];
    const s = buildKnockoutSummary('a', ms)!;
    expect(s.incomplete).toBe(false);
    expect(s.phases.map((ph) => ph.phase)).toEqual(['quarters', 'semis']);
    expect(s.eliminatedIn).toBe('semis');
    expect(s.champion).toBe(false);
  });
});

describe('Jornadas durante un playoff', () => {
  it('la jornada propuesta es la de liga más cercana, no el roundNumber de la eliminatoria', () => {
    const liga = [29, 30].map((j) => match(null, null, 'a', 'b', j === 29 ? '2026-04-25' : '2026-05-02', { roundType: 'regular', roundNumber: j }));
    const po = phase({ kind: 'knockout' });
    const qf = match(po, round(po, 'quarters', 20), 'a', 'h', '2026-05-16', { roundNumber: 1 });
    const today = '2026-05-16';
    expect(nearestMatchDay([...liga, qf], today)).toEqual({ day: '2026-05-16', journey: 30 });
    expect(pickDefaultFilter([], [...liga, qf], today)).toEqual({ journey: 30, date: null });
  });
});

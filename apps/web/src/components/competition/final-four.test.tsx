import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import type { SeasonMatch, SeasonOverview, TeamSummary } from '@/lib/api/client';
import { FinalFourBracket } from './FinalFourBracket';
import { competitionVisibleTabs } from './CompetitionClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions/supercopa-de-espana-masculina',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Supercopa = torneo FINAL FOUR: Semifinal x2 → Final → campeón. No es una liga
 * (sin Jornadas ni Clasificación) ni una eliminatoria de ida/vuelta.
 */

const ES = {
  playoffs: {
    semis: 'Semis', final: 'Final', champion: 'Campeón', live: 'En directo',
    third_place: '3.er y 4.º puesto', semifinal_n: 'Semifinal {n}', tbd: 'Por determinar',
  },
  match_states: { final: 'Final' },
};

function team(id: string, name: string): TeamSummary {
  return { id, name, shortName: name.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase(), logoUrl: null };
}
function match(id: string, over: Partial<SeasonMatch> = {}): SeasonMatch {
  return {
    id,
    status: 'scheduled',
    scheduledAt: '2026-10-24T14:00:00Z',
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    winnerTeamId: null,
    winType: null,
    venueName: null,
    roundId: null,
    roundNumber: 1,
    roundName: null,
    roundType: 'playoff',
    homeTeam: team('h', 'Local'),
    awayTeam: team('a', 'Visitante'),
    ...over,
  } as SeasonMatch;
}

const HCL = team('hcl', 'Hockey Club Liceo');
const IHC = team('ihc', 'Igualada Rigat HC');
const BAR = team('bar', 'Barça');
const CAL = team('cal', 'Calafell');

const SF1 = match('sf1', { roundName: 'Semifinales', roundNumber: 1, homeTeam: HCL, awayTeam: BAR, status: 'finished', score: { home: 5, away: 3 }, winnerTeamId: 'hcl', scheduledAt: '2026-10-24T14:00:00Z' });
const SF2 = match('sf2', { roundName: 'Semifinales', roundNumber: 1, homeTeam: IHC, awayTeam: CAL, status: 'finished', score: { home: 4, away: 2 }, winnerTeamId: 'ihc', scheduledAt: '2026-10-24T16:30:00Z' });

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={ES as never} referenceDict={ES as never}>{node}</I18nProvider>,
  );
}

describe('FinalFourBracket', () => {
  it('compone semifinales → final y corona al campeón', () => {
    const final = match('f', { roundName: 'Final', roundNumber: 2, homeTeam: HCL, awayTeam: IHC, status: 'finished', score: { home: 2, away: 3 }, winnerTeamId: 'ihc', scheduledAt: '2026-10-25T16:00:00Z' });
    const html = render(<FinalFourBracket matches={[SF1, SF2, final]} />);
    expect(html).toContain('Semifinal 1');
    expect(html).toContain('Semifinal 2');
    expect(html).toContain('Campeón');
    expect(html).toContain('Igualada Rigat HC');
  });

  it('no corona a nadie con la final aún sin terminar', () => {
    const final = match('f', { roundName: 'Final', roundNumber: 2, homeTeam: HCL, awayTeam: IHC, status: 'scheduled', score: { home: null, away: null }, scheduledAt: '2026-10-25T16:00:00Z' });
    const html = render(<FinalFourBracket matches={[SF1, SF2, final]} />);
    expect(html).not.toContain('Campeón');
  });

  it('clasifica por número canónico cuando la fuente no nombra las rondas', () => {
    const s1 = match('n1', { roundName: null, roundNumber: 1, homeTeam: HCL, awayTeam: BAR, status: 'finished', score: { home: 5, away: 3 }, winnerTeamId: 'hcl' });
    const s2 = match('n2', { roundName: null, roundNumber: 1, homeTeam: IHC, awayTeam: CAL, status: 'finished', score: { home: 4, away: 2 }, winnerTeamId: 'ihc' });
    const f = match('nf', { roundName: null, roundNumber: 2, homeTeam: HCL, awayTeam: IHC, status: 'finished', score: { home: 1, away: 2 }, winnerTeamId: 'ihc' });
    const html = render(<FinalFourBracket matches={[s1, s2, f]} />);
    // La final (número 2) es la que corona.
    expect(html).toContain('Campeón');
    expect(html).toContain('Igualada Rigat HC');
  });

  it('sin final creada aún: muestra los finalistas proyectados (ganadores de semis)', () => {
    const html = render(<FinalFourBracket matches={[SF1, SF2]} />);
    // La final aún no existe: se dibuja el hueco con los ganadores de las semis.
    expect(html).toContain('Final');
    expect(html).toContain('Hockey Club Liceo');
    expect(html).toContain('Igualada Rigat HC');
    expect(html).not.toContain('Campeón');
  });

  it('sin final ni ganadores: el hueco de la final queda "por determinar"', () => {
    const s1 = match('q1', { roundName: 'Semifinales', roundNumber: 1, homeTeam: HCL, awayTeam: BAR });
    const s2 = match('q2', { roundName: 'Semifinales', roundNumber: 1, homeTeam: IHC, awayTeam: CAL });
    const html = render(<FinalFourBracket matches={[s1, s2]} />);
    expect(html).toContain('Por determinar');
  });

  it('incluye el 3er y 4º puesto cuando la fuente lo trae', () => {
    const third = match('t', { roundName: '3er y 4º puesto', roundNumber: 3, homeTeam: BAR, awayTeam: CAL, status: 'finished', score: { home: 1, away: 2 }, winnerTeamId: 'cal' });
    const html = render(<FinalFourBracket matches={[SF1, SF2, third]} />);
    expect(html).toContain('3.er y 4.º puesto');
  });
});

describe('competitionVisibleTabs — Final Four', () => {
  const overview = (matches: SeasonMatch[]) => ({ standings: [], matches } as Pick<SeasonOverview, 'standings' | 'matches'>);

  it('una final four solo ofrece el cuadro (ni Clasificación ni Jornadas)', () => {
    // Aunque el scrape aún traiga partidos como 'regular', un final_four no es liga.
    expect(competitionVisibleTabs(overview([match('r', { roundType: 'regular' })]), null, 'final_four')).toEqual(['Playoffs']);
  });

  it('una liga con partidos regulares ofrece Jornadas', () => {
    expect(competitionVisibleTabs(overview([match('r', { roundType: 'regular' })]), null, 'league')).toEqual(['Jornadas']);
  });
});

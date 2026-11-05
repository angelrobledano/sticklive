import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import type { SeasonMatch, TeamSummary } from '@/lib/api/client';
import { buildSeries } from '@sports/core/playoff';
import { SeriesCard } from './PlayoffsTab';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions/ok-liga',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Claridad del campeón: la Gran Final es una serie, no un partido único. La
 * tarjeta debe rotular las cifras como victorias de serie, numerar los partidos,
 * marcar penaltis/prórroga y destacar al campeón (solo en la final y con la
 * serie cerrada).
 */

const ES = {
  playoffs: {
    grand_final: 'Gran Final',
    series_wins: 'Victorias de la serie',
    champion: 'Campeón',
    live: 'En directo',
    pens_short: 'pen.',
    ot_short: 'pr.',
  },
};

function team(id: string, name: string): TeamSummary {
  return { id, name, shortName: name.slice(0, 3).toUpperCase(), logoUrl: null };
}

const HCL = team('hcl', 'Hockey Club Liceo');
const IHC = team('ihc', 'Igualada Rigat HC');

function match(id: string, home: TeamSummary, away: TeamSummary, h: number, a: number, extra: Partial<SeasonMatch> = {}): SeasonMatch {
  return {
    id,
    status: 'finished',
    scheduledAt: `2026-05-0${id.slice(1)}`,
    startedAt: null,
    finishedAt: null,
    score: { home: h, away: a },
    winnerTeamId: null,
    winType: null,
    venueName: null,
    roundId: null,
    roundNumber: 3,
    roundName: null,
    roundType: 'playoff',
    homeTeam: home,
    awayTeam: away,
    ...extra,
  } as SeasonMatch;
}

// Serie real de la final: HCL 2 – 3 IHC (la 5ª, 2-2, se decidió en penaltis).
const serie = buildSeries([
  match('g1', HCL, IHC, 8, 2),
  match('g2', HCL, IHC, 8, 2),
  match('g3', IHC, HCL, 5, 2),
  match('g4', IHC, HCL, 4, 2),
  match('g5', HCL, IHC, 2, 2, { winnerTeamId: 'ihc', winType: 'penalties' }),
])[0]!;

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={ES as never} referenceDict={ES as never}>
      {node}
    </I18nProvider>,
  );
}

describe('SeriesCard — serie y campeón', () => {
  it('rotula las victorias, numera los partidos y explica el penalti', () => {
    const html = render(<SeriesCard serie={serie} label="Gran Final" isFinal />);
    expect(html).toContain('Victorias de la serie');
    expect(html).toContain('pen.'); // la 5ª se resolvió en penaltis
    expect(html).toContain('>1<');
    expect(html).toContain('>5<');
  });

  it('destaca al campeón solo en la final', () => {
    const final = render(<SeriesCard serie={serie} label="Gran Final" isFinal />);
    expect(final).toContain('Campeón');
    expect(final).toContain('Igualada Rigat HC');

    const semi = render(<SeriesCard serie={serie} label="Semifinal 1" />);
    expect(semi).not.toContain('Campeón');
    // La aclaración de serie aplica a todas las fases.
    expect(semi).toContain('Victorias de la serie');
  });

  it('no declara campeón si la serie sigue abierta', () => {
    const open = buildSeries([
      match('g1', HCL, IHC, 8, 2),
      match('g2', HCL, IHC, 0, 0, { status: 'scheduled' }),
    ])[0]!;
    const html = render(<SeriesCard serie={open} label="Gran Final" isFinal />);
    expect(html).not.toContain('Campeón');
  });
});

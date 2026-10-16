import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import es from '@/locales/es.json';
import { GameweeksTab } from './GameweeksTab';
import type { SeasonMatch, SeasonRound } from '@/lib/api/client';

/**
 * Spec 2026-10-16: en un Mundial, Jornadas ofrece también Cuartos, Semifinales,
 * 3.er y 4.º puesto y Final, y durante la fase final abre en la eliminatoria
 * en curso. `?round=<id>` elige una eliminatoria y `?journey=1` sigue siendo
 * la jornada 1 (no los cuartos, cuyo número legado también es 1).
 */

const nav = vi.hoisted(() => ({ qs: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions/x',
  useSearchParams: () => new URLSearchParams(nav.qs),
}));

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T10:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const round = (id: string, number: number, over: Partial<SeasonRound> = {}): SeasonRound =>
  ({ id, number, name: null, roundType: 'regular', ...over });

function match(id: string, roundId: string, roundNumber: number, day: string, over: Partial<SeasonMatch> = {}): SeasonMatch {
  return {
    id, status: 'scheduled', competitionTimezone: 'Europe/Madrid',
    scheduledAt: `${day}T15:00:00.000Z`, startedAt: null, finishedAt: null,
    score: { home: null, away: null }, venueName: null,
    roundId, roundNumber, roundName: null, roundType: 'regular',
    homeTeam: { id: `${id}h`, name: 'Local', shortName: 'LOC', logoUrl: null },
    awayTeam: { id: `${id}a`, name: 'Visitante', shortName: 'VIS', logoUrl: null },
    ...over,
  };
}

const ROUNDS: SeasonRound[] = [
  round('j1', 1),
  round('qf', 90, { roundType: 'playoff', stage: 'quarters', name: 'Cuartos de final' }),
  round('sf', 95, { roundType: 'playoff', stage: 'semis', name: 'Semifinal' }),
  round('fi', 99, { roundType: 'playoff', stage: 'final', name: 'Final' }),
];
const MATCHES: SeasonMatch[] = [
  match('g1', 'j1', 1, '2026-10-12', { status: 'finished' }),
  match('q1', 'qf', 1, '2026-10-15', { roundType: 'playoff', stage: 'quarters', status: 'finished' }),
  match('s1', 'sf', 2, '2026-10-16', { roundType: 'playoff', stage: 'semis' }),
];

function render(qs: string): string {
  nav.qs = qs;
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={es as never} referenceDict={es as never}>
      <GameweeksTab rounds={ROUNDS} matches={MATCHES} />
    </I18nProvider>,
  );
}

describe('GameweeksTab con eliminatorias', () => {
  it('el selector incluye las eliminatorias con su nombre y abre en la semifinal en curso', () => {
    const html = render('');
    expect(html).toContain('>Cuartos de final</option>');
    expect(html).toContain('>Semifinales</option>');
    expect(html).toContain('>Final</option>');
    expect(html).toMatch(/<option[^>]*value="r:sf"[^>]*selected/);
    expect(html).toContain('/matches/s1');
    expect(html).not.toContain('/matches/g1');
  });

  it('?round= elige una eliminatoria por id', () => {
    const html = render('filter=round&round=qf');
    expect(html).toContain('/matches/q1');
    expect(html).not.toContain('/matches/s1');
  });

  it('?journey=1 es la jornada 1, no los cuartos (mismo número legado)', () => {
    const html = render('filter=round&journey=1');
    expect(html).toContain('/matches/g1');
    expect(html).not.toContain('/matches/q1');
  });

  it('una eliminatoria aún sin partidos se ofrece y sale vacía (por determinar)', () => {
    const html = render('filter=round&round=fi');
    expect(html).toContain('No hay partidos programados para esta selección.');
  });
});

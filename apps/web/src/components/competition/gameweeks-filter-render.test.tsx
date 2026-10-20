import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { GameweeksTab } from './GameweeksTab';
import type { SeasonMatch, SeasonRound } from '@/lib/api/client';

/**
 * El conmutador de modo revela sólo el control del modo activo. El estado por
 * defecto sigue abriendo con contenido (#157); los deep-links `?filter=&…`
 * seleccionan la dimensión correcta.
 */

const state = vi.hoisted(() => ({ params: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions/x',
  useSearchParams: () => new URLSearchParams(state.params),
}));

const ROUNDS: SeasonRound[] = [
  { id: 'r1', number: 1, name: null, roundType: 'regular' },
  { id: 'r2', number: 2, name: null, roundType: 'regular' },
];

function team(id: string, name: string): SeasonMatch['homeTeam'] {
  return { id, name, shortName: name.slice(0, 3).toUpperCase(), logoUrl: null };
}

function match(id: string, roundNumber: number, home: string, away: string, day: string): SeasonMatch {
  return {
    id,
    status: 'scheduled',
    competitionTimezone: 'Europe/Madrid',
    scheduledAt: `${day}T12:00:00.000Z`,
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venueName: null,
    roundId: null,
    roundNumber,
    roundName: null,
    roundType: 'regular',
    homeTeam: team(home, `Equipo ${home}`),
    awayTeam: team(away, `Equipo ${away}`),
  };
}

const MATCHES = [
  match('m-r1', 1, 'h1', 'a1', '2099-02-01'),
  match('m-r2', 2, 'h2', 'a2', '2099-02-08'),
];

function render(matches: SeasonMatch[] = MATCHES) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
      <GameweeksTab rounds={ROUNDS} matches={matches} />
    </I18nProvider>,
  );
}

describe('GameweeksTab — conmutador de modo', () => {
  it('sin parámetros abre en el modo del filtro por defecto (jornada cercana)', () => {
    state.params = '';
    const html = render();
    expect(html).toContain('/matches/m-r1');
    expect(html).not.toContain('/matches/m-r2');
    // Los tres modos del conmutador están disponibles.
    expect(html).toContain('Fecha');
    expect(html).toContain('Jornada');
    expect(html).toContain('Equipo');
  });

  it('modo equipo lista todos los partidos de ese equipo', () => {
    state.params = 'filter=team&team_id=h2';
    const html = render();
    expect(html).toContain('/matches/m-r2');
    expect(html).not.toContain('/matches/m-r1');
    expect(html).toContain('1 partido');
  });

  it('modo equipo deja los partidos sin fecha al final', () => {
    state.params = 'filter=team&team_id=h9';
    const dated = match('m-dated', 1, 'h9', 'a9', '2099-03-01');
    const undated: SeasonMatch = {
      ...match('m-undated', 2, 'h9', 'a9', '2099-01-01'),
      scheduledAt: null,
    };
    // Se pasan desordenados a propósito: el orden lo decide la lista, no la entrada.
    const html = render([undated, dated]);
    const datedAt = html.indexOf('/matches/m-dated');
    const undatedAt = html.indexOf('/matches/m-undated');
    expect(datedAt).toBeGreaterThan(-1);
    expect(undatedAt).toBeGreaterThan(-1);
    expect(datedAt).toBeLessThan(undatedAt);
    expect(html.indexOf('Sin fecha')).toBeGreaterThan(datedAt);
  });

  it('modo fecha filtra solo los partidos de ese día y ofrece navegación', () => {
    state.params = 'filter=date&date=2099-02-01';
    const html = render();
    expect(html).toContain('/matches/m-r1');
    expect(html).not.toContain('/matches/m-r2');
    expect(html).toContain('Fecha anterior');
    expect(html).toContain('Fecha siguiente');
  });

  it('modo jornada respeta ?journey=', () => {
    state.params = 'filter=round&journey=2';
    const html = render();
    expect(html).toContain('/matches/m-r2');
    expect(html).not.toContain('/matches/m-r1');
  });

  it('modo equipo sin equipo elegido pide elegir uno', () => {
    state.params = 'filter=team';
    const html = render();
    expect(html).toContain('Elige un equipo');
    expect(html).not.toContain('/matches/m-r1');
  });

  it('enlaces antiguos sin ?filter se infieren del valor', () => {
    state.params = 'team_id=h1';
    const html = render();
    expect(html).toContain('/matches/m-r1');
    expect(html).not.toContain('/matches/m-r2');
  });
});

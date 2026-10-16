import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import type { Match, TeamSummary } from '@/lib/api/client';
import { MatchCard, teamLinkTarget } from './MatchCard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es',
}));

/**
 * #339: la home enlazaba 12 partidos pero 0 equipos. El grafo de enlaces debe
 * aparecer en el HTML SSR: cada tarjeta enlaza a la ficha de sus dos equipos
 * además de al detalle del partido. `teamLinkTarget` es la extracción pura
 * (y la guarda contra `/teams/undefined` cuando el equipo no viene).
 */

const ES = { a11y: { view_match: 'Ver partido: {home} - {away}' } };

function team(over: Partial<TeamSummary> = {}): TeamSummary {
  return { id: 't1', name: 'Equipo Uno', shortName: 'EQ1', logoUrl: null, ...over };
}

function match(over: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    seasonId: 's',
    roundId: null,
    status: 'finished',
    scheduledAt: null,
    startedAt: null,
    finishedAt: null,
    score: { home: 1, away: 0 },
    venue: null,
    homeTeamId: 'h',
    awayTeamId: 'a',
    homeTeam: team({ id: 'h', name: 'Local FC', shortName: 'LOC' }),
    awayTeam: team({ id: 'a', name: 'Visitante', shortName: 'VIS' }),
    sourceRef: null,
    ...over,
  } as Match;
}

describe('teamLinkTarget — extracción de equipos enlazables (#339)', () => {
  it('sin equipo o sin id no produce enlace (evita /teams/undefined)', () => {
    expect(teamLinkTarget(undefined)).toBeNull();
    expect(teamLinkTarget(team({ id: '' }))).toBeNull();
  });

  it('prefiere el nombre corto para la etiqueta y construye la ruta del equipo', () => {
    expect(teamLinkTarget(team({ id: 'abc', name: 'Club Largo', shortName: 'CLC' }))).toEqual({
      id: 'abc',
      href: '/teams/abc',
      label: 'CLC',
    });
  });

  it('cae al nombre completo cuando no hay corto', () => {
    expect(teamLinkTarget(team({ id: 'abc', name: 'Club Largo', shortName: null }))?.label).toBe('Club Largo');
  });
});

describe('MatchCard — grafo de enlaces en HTML SSR (#339)', () => {
  function render(m: Match) {
    return renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={ES as never} referenceDict={ES as never}>
        <MatchCard match={m} />
      </I18nProvider>,
    );
  }

  it('emite enlaces server-side a ambos equipos y al partido', () => {
    const html = render(match());
    expect(html).toContain('href="/es/teams/h"');
    expect(html).toContain('href="/es/teams/a"');
    expect(html).toContain('href="/es/matches/m1"');
    expect(html).not.toContain('/teams/undefined');
  });

  it('no enlaza un equipo ausente pero conserva el enlace al partido', () => {
    const html = render(match({ awayTeam: undefined, awayTeamId: 'a' }));
    expect(html).toContain('href="/es/teams/h"');
    expect(html).not.toContain('href="/es/teams/a"');
    expect(html).toContain('href="/es/matches/m1"');
  });
});

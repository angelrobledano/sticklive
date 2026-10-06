import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import type { Match } from '@/lib/api/client';
import { UpcomingGroup } from './UpcomingGroup';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es',
}));

/** Diccionario mínimo — solo las claves que pinta UpcomingGroup/MatchCard. */
const DICT = {
  common: {
    other_competitions: 'Otras competiciones',
    match_lc: 'partido',
    matches_lc: 'partidos',
    live_now: 'En directo',
  },
  match_states: { in_play: 'En juego', half_time: 'Descanso' },
  a11y: { view_match: 'Ver partido: {home} - {away}' },
} as never;

/**
 * Grupo plegable de la vista de próximos (#414): en móvil arranca CONTRAÍDO
 * (índice compacto del día: caption + recuento + chevron) y el escritorio
 * siempre desplegado (el masonry necesita el contenido). El estado se fija por
 * atributos ARIA y clases — la interacción se verifica en navegador real.
 */

function match(id: string): Match {
  const team = (tid: string) => ({ id: tid, name: tid, shortName: tid.slice(0, 4), logoUrl: null });
  return {
    id,
    seasonId: 's1',
    roundId: null,
    competitionId: 'c1',
    competitionName: 'OK Liga',
    competitionSlug: 'ok-liga-masculina',
    status: 'scheduled',
    scheduledAt: '2026-10-10T17:00:00Z',
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venue: null,
    homeTeamId: 't1',
    awayTeamId: 't2',
    homeTeam: team('t1'),
    awayTeam: team('t2'),
    sourceRef: null,
  };
}

function render(collapsed: boolean, n: number): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={DICT} referenceDict={DICT}>
      <UpcomingGroup
        name="OK Liga Plata Norte"
        id="c1"
        matches={Array.from({ length: n }, (_, i) => match(`m${i}`))}
        defaultCollapsed={collapsed}
      />
    </I18nProvider>,
  );
}

describe('UpcomingGroup (grupo plegable de próximos)', () => {
  it('por defecto CONTRAÍDO: aria-expanded=false y la lista oculta en móvil (hidden md:block)', () => {
    const html = render(true, 2);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden md:block space-y-2');
    expect(html).toContain('2 partidos');
    expect(html).toContain('OK Liga Plata Norte');
  });

  it('expandido: aria-expanded=true y la lista sin clase de ocultación', () => {
    const html = render(false, 1);
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('hidden md:block space-y-2');
    expect(html).toContain('1 partido');
  });

  it('sin competición (null): usa la etiqueta i18n de otras competiciones', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={DICT} referenceDict={DICT}>
        <UpcomingGroup name={null} id={null} matches={[match('m1')]} defaultCollapsed={false} />
      </I18nProvider>,
    );
    expect(html).toContain('Otras competiciones');
  });

  it('el caption enlaza a la competición', () => {
    const html = render(false, 1);
    expect(html).toContain('href="/competitions/c1"');
  });
});

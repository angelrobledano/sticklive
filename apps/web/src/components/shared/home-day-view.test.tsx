import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import type { Match } from '@/lib/api/client';
import es from '@/locales/es.json';
import { MatchesView } from './MatchesView';

/**
 * Home (spec 2026-10-16): la jornada del día en una tarjeta por competición,
 * sin "Mi grada" ni tira/banda de directos en el flujo del día, y la próxima
 * jornada cuando el día está vacío. Render de servidor con el diccionario real.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es',
}));

// Viernes 16/10/2026 a las 12:00 en Madrid.
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T10:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

let n = 0;
function match(compId: string, compName: string, slug: string, iso: string, over: Partial<Match> = {}): Match {
  n += 1;
  const team = (id: string) => ({ id, name: `Equipo ${id}`, shortName: id.toUpperCase(), logoUrl: null });
  return {
    id: `m${n}`,
    seasonId: 's1',
    roundId: null,
    competitionId: compId,
    competitionName: compName,
    competitionSlug: slug,
    competitionTimezone: 'Europe/Madrid',
    competitionCountry: compId === 'mundial' ? 'W' : 'ES',
    status: 'scheduled',
    scheduledAt: iso,
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venue: null,
    homeTeamId: `h${n}`,
    awayTeamId: `a${n}`,
    homeTeam: team(`h${n}`),
    awayTeam: team(`a${n}`),
    sourceRef: null,
    ...over,
  };
}

function render(matches: Match[]): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={es as never} referenceDict={es as never}>
      <MatchesView matches={matches} />
    </I18nProvider>,
  );
}

describe('MatchesView (home por competición)', () => {
  it('agrupa el día en tarjetas por competición, en orden de importancia', () => {
    const html = render([
      match('plata', 'OK Liga Plata Sur', 'ok-liga-plata-sur', '2026-10-16T19:00:00Z'),
      match('mundial', 'Mundial Masculino — World Skate', 'mundial-masculino-worldskate', '2026-10-16T14:45:00Z'),
      match('mundial', 'Mundial Masculino — World Skate', 'mundial-masculino-worldskate', '2026-10-16T17:30:00Z'),
    ]);
    const mundial = html.indexOf('Mundial Masculino — World Skate');
    const plata = html.indexOf('OK Liga Plata Sur');
    expect(mundial).toBeGreaterThan(-1);
    expect(plata).toBeGreaterThan(mundial);
    expect(html).toContain('2 partidos');
    expect(html).toContain('1 partido');
  });

  it('no mete partidos de otros días en la jornada (antes lo hacía "Mi grada")', () => {
    const html = render([
      match('mundial', 'Mundial', 'mundial-masculino-worldskate', '2026-10-16T14:45:00Z'),
      match('mundial', 'Mundial', 'mundial-masculino-worldskate', '2026-10-15T17:30:00Z', { status: 'finished', score: { home: 3, away: 0 } }),
    ]);
    expect(html).toContain('1 partido');
    expect(html).not.toContain('Últimos resultados');
    expect(html).not.toContain('En directo ahora');
  });

  it('con un directo: chip "En directo" con el recuento y el partido dentro de su tarjeta', () => {
    const html = render([
      match('mundial', 'Mundial', 'mundial-masculino-worldskate', '2026-10-16T09:30:00Z', { status: 'live', score: { home: 2, away: 1 } }),
      match('mundial', 'Mundial', 'mundial-masculino-worldskate', '2026-10-16T17:30:00Z'),
    ]);
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*En directo.*1/s);
    expect(html).toContain('2 partidos');
  });

  it('día vacío: mensaje y SOLO la próxima jornada, con botón para ir a ella', () => {
    const html = render([
      match('plata', 'OK Liga Plata Sur', 'ok-liga-plata-sur', '2026-10-21T18:30:00Z'),
      match('plata', 'OK Liga Plata Sur', 'ok-liga-plata-sur', '2026-10-24T18:30:00Z'),
    ]);
    expect(html).toContain('No hay partidos para hoy');
    expect(html).toContain('Próxima jornada: miércoles 21 de octubre');
    expect(html).toContain('Ver el miércoles 21');
    expect(html).toContain('mié 21');
    expect(html).not.toContain('sáb 24');
  });

  it('día vacío sin nada después: aviso y enlace a competiciones', () => {
    const html = render([match('plata', 'OK Liga Plata Sur', 'ok-liga-plata-sur', '2026-10-14T18:30:00Z')]);
    expect(html).toContain('No hay próximos partidos programados');
    expect(html).toContain('href="/es/competitions"');
  });
});

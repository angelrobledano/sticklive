import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { I18nProvider } from '@/lib/i18n';
import type { Match } from '@/lib/api/client';
import es from '@/locales/es.json';
import { MatchRow, shortDayLabel } from './MatchRow';
import { MatchGroupCard, CompetitionIcon } from './MatchGroupCard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es',
}));

/**
 * Fila compacta y tarjeta por competición de la home (spec 2026-10-16). Se
 * renderizan con el diccionario REAL de `es` para que una clave que falte se
 * vea aquí y no en producción.
 */
const DICT = es as never;

function render(node: ReactElement): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={DICT} referenceDict={DICT}>
      {node}
    </I18nProvider>,
  );
}

function match(over: Partial<Match> = {}): Match {
  const team = (id: string, name: string) => ({ id, name, shortName: name.slice(0, 3).toUpperCase(), logoUrl: null });
  return {
    id: 'm1',
    seasonId: 's1',
    roundId: null,
    competitionId: 'c1',
    competitionName: 'Mundial Masculino — World Skate',
    competitionSlug: 'mundial-masculino-worldskate',
    competitionTimezone: 'Europe/Madrid',
    competitionCountry: 'W',
    status: 'scheduled',
    scheduledAt: '2026-10-16T14:45:00Z',
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venue: null,
    homeTeamId: 'ita',
    awayTeamId: 'chi',
    homeTeam: team('ita', 'Italia'),
    awayTeam: team('chi', 'Chile'),
    sourceRef: null,
    ...over,
  };
}

describe('MatchRow', () => {
  it('programado: hora en la zona de la competición y nombres completos', () => {
    const html = render(<MatchRow match={match()} />);
    expect(html).toContain('16:45');
    expect(html).toContain('Italia');
    expect(html).toContain('Chile');
  });

  it('enlaza al partido con una etiqueta accesible que incluye el estado', () => {
    const html = render(<MatchRow match={match()} />);
    expect(html).toContain('href="/es/matches/m1"');
    expect(html).toContain('aria-label="Ver partido: Italia - Chile, 16:45"');
    const live = render(<MatchRow match={match({ status: 'live', score: { home: 2, away: 1 } })} />);
    expect(live).toContain('aria-label="Ver partido: Italia - Chile, 2–1, En directo"');
  });

  it('con retransmisión: tele visible y dicha en la etiqueta accesible; sin enlace, nada', () => {
    const html = render(<MatchRow match={match({ videoUrl: 'https://www.youtube.com/watch?v=x' })} />);
    expect(html).toContain('data-video="1"');
    expect(html).toContain('aria-label="Ver partido: Italia - Chile, 16:45, Se puede ver en directo"');
    expect(render(<MatchRow match={match()} />)).not.toContain('data-video');
  });

  it('terminado: marcador y "Final"', () => {
    const html = render(<MatchRow match={match({ status: 'finished', score: { home: 9, away: 0 } })} />);
    expect(html).toMatch(/9<\/span>.*0<\/span>/s);
    expect(html).toContain('Final');
  });

  it('en directo: marcador y "En directo"', () => {
    const html = render(<MatchRow match={match({ status: 'live', score: { home: 2, away: 1 } })} />);
    expect(html).toContain('En directo');
    expect(html).toContain('text-live-deep');
  });

  it('en el descanso: "Descanso" en lugar de "En directo"', () => {
    const html = render(<MatchRow match={match({ status: 'live', isHalftime: true, score: { home: 1, away: 1 } })} />);
    expect(html).toContain('Descanso');
    expect(html).not.toContain('En directo');
  });

  it('aplazado y cancelado se dicen con palabras', () => {
    expect(render(<MatchRow match={match({ status: 'postponed' })} />)).toContain('Aplazado');
    expect(render(<MatchRow match={match({ status: 'cancelled' })} />)).toContain('Cancelado');
  });

  it('showDate añade la fecha corta (próxima jornada, Mi grada)', () => {
    const html = render(<MatchRow match={match({ scheduledAt: '2026-10-17T15:00:00Z' })} showDate />);
    expect(html).toContain('17:00');
    expect(html).toContain('sáb 17');
  });

  it('showDate en un terminado: "Final · fecha"', () => {
    const html = render(
      <MatchRow match={match({ status: 'finished', score: { home: 3, away: 0 }, scheduledAt: '2026-10-15T17:30:00Z' })} showDate />,
    );
    expect(html).toContain('Final · jue 15');
  });

  it('caption: nombre de la competición encima (tarjeta Siguiendo)', () => {
    const html = render(<MatchRow match={match()} caption="Mundial M" />);
    expect(html).toContain('Mundial M');
  });

  it('marca con estrella el equipo seguido', () => {
    const html = render(<MatchRow match={match()} followedTeamIds={new Set(['chi'])} />);
    expect(html).toContain('data-followed="away"');
  });
});

describe('shortDayLabel', () => {
  it('formato corto sin puntos ni comas en cada idioma', () => {
    expect(shortDayLabel('2026-10-17T15:00:00Z', 'es')).toBe('sáb 17');
    expect(shortDayLabel('2026-10-17T15:00:00Z', 'pt')).toBe('sáb 17');
    expect(shortDayLabel('2026-10-17T15:00:00Z', 'fr')).toBe('sam 17');
  });

  it('usa la zona horaria pedida', () => {
    // 23:30 UTC del 16 = 01:30 del 17 en Madrid
    expect(shortDayLabel('2026-10-16T23:30:00Z', 'es', 'Europe/Madrid')).toBe('sáb 17');
  });
});

describe('MatchGroupCard', () => {
  const card = (props: Partial<Parameters<typeof MatchGroupCard>[0]> = {}) =>
    render(
      <MatchGroupCard
        title="Mundial Masculino — World Skate"
        href="/competitions/c1"
        icon={<CompetitionIcon country="W" name="Mundial" />}
        count={5}
        {...props}
      >
        <MatchRow match={match()} />
      </MatchGroupCard>,
    );

  it('cabecera con título enlazado, recuento y filas desplegadas', () => {
    const html = card();
    expect(html).toContain('href="/es/competitions/c1"');
    expect(html).toContain('Mundial Masculino — World Skate');
    expect(html).toContain('5 partidos');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('href="/es/matches/m1"');
  });

  it('sin href el título no es enlace', () => {
    const html = card({ href: null });
    expect(html).not.toContain('href="/es/competitions/c1"');
  });

  it('marca las competiciones seguidas', () => {
    expect(card({ followed: true })).toContain('data-followed="true"');
  });

  it('no plegable: sin botón de plegar', () => {
    expect(card({ collapsible: false })).not.toContain('aria-expanded');
  });
});

describe('CompetitionIcon', () => {
  it('mundial (W): icono de mundo', () => {
    expect(render(<CompetitionIcon country="W" name="Mundial" />)).toContain('data-icon="world"');
  });

  it('país: bandera', () => {
    expect(render(<CompetitionIcon country="ES" name="OK Liga" />)).toContain('flagcdn.com/w80/es.png');
  });

  it('sin país: iniciales', () => {
    expect(render(<CompetitionIcon country={null} name="OK Liga" />)).toContain('>OK<');
  });
});

describe('MiGrada (fuera de la home, con fecha en cada fila)', () => {
  it('pinta próximos y resultados de lo que sigues con su fecha corta', async () => {
    const { MiGrada } = await import('./MiGrada');
    const html = render(
      <MiGrada
        matches={[
          match({ id: 'prox', scheduledAt: '2026-10-17T15:00:00Z', homeTeamId: 'esp' }),
          match({ id: 'res', status: 'finished', score: { home: 3, away: 0 }, scheduledAt: '2026-10-15T17:30:00Z', homeTeamId: 'esp' }),
          match({ id: 'ajeno', scheduledAt: '2026-10-17T15:00:00Z' }),
        ]}
        teamIds={['esp']}
        leagueIds={[]}
        todayKey="2026-10-16"
        showManage={false}
      />,
    );
    expect(html).toContain('href="/es/matches/prox"');
    expect(html).toContain('href="/es/matches/res"');
    expect(html).not.toContain('href="/es/matches/ajeno"');
    expect(html).toContain('sáb 17');
    expect(html).toContain('Final · jue 15');
    expect(html).not.toContain('href="/es/favorites"');
  });
});

describe('MatchGroupCard plegada (iteración 3)', () => {
  it('plegada no monta las filas y avisa de los directos en la cabecera', () => {
    const html = render(
      <MatchGroupCard title="Benjamí Plata" icon={null} count={12} defaultOpen={false} liveCount={2}>
        <p>FILA-DENTRO</p>
      </MatchGroupCard>,
    );
    expect(html).not.toContain('FILA-DENTRO');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/2 en directo/);
  });
  it('abierta por defecto sigue mostrando las filas', () => {
    const html = render(<MatchGroupCard title="OK Liga" icon={null} count={1}><p>FILA-DENTRO</p></MatchGroupCard>);
    expect(html).toContain('FILA-DENTRO');
  });
});

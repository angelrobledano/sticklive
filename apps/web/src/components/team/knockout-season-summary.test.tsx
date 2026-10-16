import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import type { TeamDetail, TeamMatchSummary } from '@/lib/api/client';
import { KnockoutSeasonSummary } from './KnockoutSeasonSummary';
import { buildKnockoutSummary } from '@/lib/knockout';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es',
}));

/**
 * Render SSR del resumen de eliminatoria en la ficha de equipo. Fijamos con
 * fixtures REALES (Supercopa 2025/26, producción) los requisitos de producto:
 * el campeón se anuncia, el eliminado se marca, y en ningún caso aparece el
 * "Sin datos de clasificación" que motivó el cambio.
 */

const BAR = 'f67b2d80-127d-41cc-a7f8-f5b4dd821621';
const HCL = 'ccc49524-8422-4e3e-883c-c0067cec913c';
const IHC = '2040ff0e-80e8-4bce-8105-528fa3c1216d';
const REUS = '536b6256-6c34-47c5-814d-72aea7dbcecf';

const ES = {
  match_tabs: { playoffs: 'Playoffs' },
  playoffs: {
    quarters: 'Cuartos', semis: 'Semis', final: 'Final', champion: 'Campeón',
    pens_short: 'pen.', ot_short: 'pr.',
  },
  team: {
    form_w: 'V', form_l: 'D',
    knockout_tag: 'Competición eliminatoria',
    knockout_empty: 'Sin partidos registrados en esta edición',
    knockout_incomplete: 'Datos incompletos de esta edición: se muestran los partidos registrados.',
    eliminated: 'Eliminado',
    view_competition: 'Ver competición',
  },
};

function tm(
  id: string,
  homeId: string,
  awayId: string,
  home: number | null,
  away: number | null,
  scheduledAt: string | null,
  status = 'finished',
): TeamMatchSummary {
  const mk = (tid: string) => ({ id: tid, name: tid, shortName: tid.slice(0, 3), logoUrl: null });
  return {
    id, status, competitionTimezone: 'Europe/Madrid',
    scheduledAt, startedAt: null, finishedAt: null,
    score: { home, away }, venue: null,
    homeTeam: mk(homeId), awayTeam: mk(awayId),
  };
}

/** Supercopa 2025/26 real: semis (s2) + final (s3), una única ronda. */
const SUP: TeamMatchSummary[] = [
  tm('s1', REUS, IHC, 3, 5, '2025-09-20T14:15:00Z'),
  tm('s2', BAR, HCL, 5, 2, '2025-09-20T16:45:00Z'),
  tm('s3', IHC, BAR, 1, 3, '2025-09-21T10:15:00Z'),
];

function teamDetail(teamId: string, matches: TeamMatchSummary[]): TeamDetail {
  return {
    team: { id: teamId, name: 'BARÇA', shortName: 'BAR', city: 'Barcelona', country: 'ES', logoUrl: null, websiteUrl: null, club: null },
    standing: null,
    season: {
      competitionId: 'c1', competitionSlug: 'supercopa-de-espana-masculina',
      competitionName: 'SUPERCOPA DE ESPAÑA MASCULINA', competitionShort: 'Supercopa',
      competitionFormat: 'final_four',
    },
    seasons: [{ id: 'se1', name: '2025/26', isCurrent: false, competitionName: 'SUPERCOPA', competitionShort: 'Supercopa' }],
    selectedSeasonId: 'se1',
    matches,
    squad: [],
  };
}

function render(data: TeamDetail, matches = data.matches) {
  const summary = buildKnockoutSummary(data.team.id, matches);
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={ES as never} referenceDict={ES as never}>
      <KnockoutSeasonSummary data={data} summary={summary} />
    </I18nProvider>,
  );
}

describe('KnockoutSeasonSummary — render SSR', () => {
  it('equipo CAMPEÓN: banner de campeón, fases y sin "sin datos de clasificación"', () => {
    const html = render(teamDetail(BAR, SUP));
    expect(html).toContain('Campeón');
    expect(html).toContain('Barça'); // clubName() normaliza el nombre en el banner
    expect(html).toContain('Semis');
    expect(html).toContain('Final');
    expect(html).toContain('Competición eliminatoria');
    expect(html).toContain('Supercopa · 2025/26');
    // Síntesis enlazada: los partidos del equipo enlazan a su ficha
    expect(html).toContain('href="/es/matches/s2"');
    expect(html).toContain('href="/es/matches/s3"');
    // Nunca el mensaje que motivó el cambio
    expect(html).not.toContain('Sin datos de clasificación');
  });

  it('equipo ELIMINADO en semis: marca la eliminación y no anuncia campeón', () => {
    const html = render(teamDetail(HCL, SUP));
    expect(html).toContain('Eliminado');
    expect(html).not.toContain('Campeón');
    expect(html).not.toContain('Sin datos de clasificación');
  });

  it('edición SIN partidos: mensaje específico, no de clasificación', () => {
    const html = render(teamDetail(BAR, []));
    expect(html).toContain('Sin partidos registrados en esta edición');
    expect(html).not.toContain('Sin datos de clasificación');
  });

  it('datos incompletos (Histórico): nota específica + lista de partidos', () => {
    const hist: TeamMatchSummary[] = [
      tm('h1', BAR, 'reus-id', 5, 3, null),
      tm('h2', 'lice-id', BAR, 7, 6, null),
    ];
    const data = teamDetail(BAR, hist);
    const summary = buildKnockoutSummary(BAR, hist);
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={ES as never} referenceDict={ES as never}>
        <KnockoutSeasonSummary
          data={data}
          summary={summary}
          renderMatch={(m) => <a key={m.id} href={`/matches/${m.id}`} data-testid="m" />}
        />
      </I18nProvider>,
    );
    expect(html).toContain('Datos incompletos de esta edición');
    expect(html).toContain('href="/matches/h1"');
    expect(html).not.toContain('Campeón');
    expect(html).not.toContain('Sin datos de clasificación');
  });
});

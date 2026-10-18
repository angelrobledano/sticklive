import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import es from '@/locales/es.json';
import type { SeasonMatch } from '@/lib/api/client';
import { KnockoutMatchCard } from './KnockoutBracket';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions/x',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Un empate en el cuadro tiene que explicarse solo: quién pasó (en negrita),
 * que fue en los penaltis y con qué marcador de tanda. Caso real: ANG 3-3 CHI
 * (Puestos 5º-6º del Mundial 2026), que salía como "Final" a secas.
 */
const ang = { id: 'ang', name: 'Angola', shortName: 'ANG', logoUrl: null };
const chi = { id: 'chi', name: 'Chile', shortName: 'CHI', logoUrl: null };

function partido(o: Partial<SeasonMatch>): SeasonMatch {
  return {
    id: 'm1', status: 'finished', competitionTimezone: 'Europe/Madrid',
    scheduledAt: '2026-10-17T22:00:00Z', startedAt: null, finishedAt: null,
    score: { home: 3, away: 3 }, winnerTeamId: null, winType: null, penalties: null,
    venueName: null, roundId: 'r', roundNumber: null, roundName: 'Puestos 5º-6º', roundType: 'playoff',
    homeTeam: ang, awayTeam: chi, ...o,
  };
}

const render = (m: SeasonMatch) => renderToStaticMarkup(
  <I18nProvider initialLocale="es" dict={es as never} referenceDict={es as never}>
    <KnockoutMatchCard m={m} />
  </I18nProvider>,
);

describe('KnockoutMatchCard', () => {
  it('empate decidido en penaltis: etiqueta, tanda y ganador en negrita', () => {
    const html = render(partido({ winType: 'penalties', winnerTeamId: 'ang', penalties: { home: 2, away: 1 } }));
    expect(html).toContain('Final (Penaltis)');
    expect(html).toMatch(/data-pen="home"[^>]*>\(2\)/);
    expect(html).toMatch(/data-pen="away"[^>]*>\(1\)/);
    expect(html).toMatch(/font-bold[^"]*"[^>]*>(<[^>]+>)*Angola/);
    expect(html).not.toMatch(/font-bold[^"]*"[^>]*>(<[^>]+>)*Chile/);
  });

  it('victoria en prórroga: etiqueta de prórroga, sin tanda', () => {
    const html = render(partido({ score: { home: 6, away: 3 }, winType: 'overtime' }));
    expect(html).toContain('Final (Prórroga)');
    expect(html).not.toContain('data-pen');
  });

  it('resultado normal: "Final" a secas', () => {
    const html = render(partido({ score: { home: 4, away: 1 }, winType: 'regular' }));
    expect(html).toContain('Final ·');
    expect(html).not.toContain('Penaltis');
  });
});

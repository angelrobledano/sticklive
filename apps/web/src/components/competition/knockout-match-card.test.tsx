import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import es from '@/locales/es.json';
import type { SeasonMatch } from '@/lib/api/client';
import { KnockoutBracket, KnockoutMatchCard } from './KnockoutBracket';
import { gameWinnerId } from '@sports/core/playoff';

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
  it('empate decidido en penaltis: chip, tanda y ganador en negrita', () => {
    const html = render(partido({ winType: 'penalties', winnerTeamId: 'ang', penalties: { home: 2, away: 1 } }));
    expect(html).toMatch(/data-decided="penalties"[^>]*>Penaltis</);
    expect(html).toMatch(/data-pen="home"[^>]*>\(2\)/);
    expect(html).toMatch(/data-pen="away"[^>]*>\(1\)/);
    expect(html).toMatch(/font-bold[^"]*"[^>]*>(<[^>]+>)*Angola/);
    expect(html).not.toMatch(/font-bold[^"]*"[^>]*>(<[^>]+>)*Chile/);
  });

  it('el perdedor se atenúa: el ganador se lee sin depender de la negrita', () => {
    const html = render(partido({ score: { home: 4, away: 1 }, winType: 'regular' }));
    expect(html).toMatch(/data-side="home" data-result="win"/);
    expect(html).toMatch(/data-side="away" data-result="loss"/);
  });

  it('penaltis: etiqueta visible aunque la tarjeta no lleve "Final" (cuadro)', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={es as never} referenceDict={es as never}>
        <KnockoutMatchCard m={partido({ winType: 'penalties', winnerTeamId: 'ang', penalties: { home: 2, away: 1 } })} showFinishedLabel={false} />
      </I18nProvider>,
    );
    expect(html).toMatch(/data-decided="penalties"[^>]*>Penaltis</);
  });

  it('victoria en prórroga: etiqueta de prórroga, sin tanda', () => {
    const html = render(partido({ score: { home: 6, away: 3 }, winType: 'overtime' }));
    expect(html).toMatch(/data-decided="overtime"[^>]*>Prórroga</);
    expect(html).not.toContain('data-pen');
  });

  it('resultado normal: "Final" a secas', () => {
    const html = render(partido({ score: { home: 4, away: 1 }, winType: 'regular' }));
    expect(html).toContain('Final ·');
    expect(html).not.toContain('Penaltis');
  });
});

describe('gameWinnerId', () => {
  it('empate sin ganador guardado: decide la tanda', () => {
    expect(gameWinnerId(partido({ penalties: { home: 1, away: 2 } }))).toBe('chi');
    expect(gameWinnerId(partido({ penalties: { home: 1, away: 1 } }))).toBeNull();
  });
});

describe('KnockoutBracket: campeón', () => {
  const t = (id: string, name: string) => ({ id, name, shortName: name.slice(0, 3).toUpperCase(), logoUrl: null });
  const [a, b, c, d] = [t('a', 'Argentina'), t('b', 'Francia'), t('c', 'España'), t('d', 'Portugal')];
  const semi1 = partido({ id: 's1', roundId: 'rs', stage: 'semis', homeTeam: a, awayTeam: c, score: { home: 3, away: 1 }, scheduledAt: '2026-10-16T20:00:00Z' });
  const semi2 = partido({ id: 's2', roundId: 'rs', stage: 'semis', homeTeam: b, awayTeam: d, score: { home: 2, away: 0 }, scheduledAt: '2026-10-16T22:00:00Z' });
  const final = (o: Partial<SeasonMatch>) => partido({ id: 'f', roundId: 'rf', stage: 'final', homeTeam: a, awayTeam: b, scheduledAt: '2026-10-18T22:00:00Z', ...o });
  const renderB = (ms: SeasonMatch[]) => renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={es as never} referenceDict={es as never}>
      <KnockoutBracket matches={ms} />
    </I18nProvider>,
  );

  it('final decidida: bloque de campeón con el ganador', () => {
    const html = renderB([semi1, semi2, final({ score: { home: 2, away: 2 }, winType: 'penalties', winnerTeamId: 'b', penalties: { home: 3, away: 4 } })]);
    expect(html).toMatch(/data-champion="b"/);
    expect(html).toMatch(/data-champion-row="b"/); // franja de móvil encima del cuadro
    expect(html).toContain('Campeón');
  });

  it('final sin jugar: sin campeón', () => {
    const html = renderB([semi1, semi2, final({ status: 'scheduled', score: { home: null, away: null } })]);
    expect(html).not.toContain('data-champion');
  });
});

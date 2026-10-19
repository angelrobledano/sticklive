import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import es from '@/locales/es.json';
import { TimelineRow } from './TimelineTab';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/matches/x',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * El eje central del timeline es absoluto y se pinta encima de lo que no esté
 * posicionado: tachaba «1ª PARTE», «Prórroga» y «Fin del periodo». Los
 * separadores van por encima del eje y su rótulo lleva fondo propio.
 */
const render = (eventType: 'period_divider' | 'period_end', period: number) => renderToStaticMarkup(
  <I18nProvider initialLocale="es" dict={es as never} referenceDict={es as never}>
    <TimelineRow
      ev={{ id: 'd', eventType, period, minute: null, clock: null, teamId: null, isHomeTeam: false, detail: null, player: null } as never}
      homeName="LOC" awayName="VIS"
    />
  </I18nProvider>,
);

describe('separadores del timeline sobre el eje', () => {
  for (const [type, period, text] of [
    ['period_divider', 1, '1ª parte'],
    ['period_divider', 3, 'Prórroga'],
    ['period_end', 1, 'Fin'],
  ] as const) {
    it(`${type} ${period}: por encima del eje y con fondo`, () => {
      const html = render(type, period);
      expect(html).toMatch(/^<div class="[^"]*\brelative\b[^"]*\bz-10\b/);
      expect(html).toMatch(new RegExp(`<span class="[^"]*\\bbg-slate-100\\b[^"]*">${text}`));
    });
  }
});

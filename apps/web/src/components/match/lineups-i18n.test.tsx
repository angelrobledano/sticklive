import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { LineupsTab } from './LineupsTab';

/**
 * #170: las insignias de alineación (5 inicial / capitán / portero) no deben ser
 * letras fijas en español. Salen del i18n activo y, si la clave no existe aún,
 * del respaldo español vía `tt` — nunca de la clave cruda.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/en',
}));

const homeTeam = { id: 't1', name: 'Team One', shortName: 'ONE' };
const awayTeam = { id: 't2', name: 'Team Two', shortName: 'TWO' };

const player = {
  jerseyNumber: 7,
  playerName: 'Ana Perez',
  playerId: null,
  isGoalkeeper: true,
  isCaptain: true,
  isStarter: true,
  goals: 1,
  assists: 0,
  photoUrl: null,
};

const data = {
  match: { id: 'm1', homeTeam, awayTeam },
  lineups: { home: [player], away: [] },
} as never;

const EN = {
  match_detail: {
    badge_starter: 'S5',
    badge_captain: 'C',
    badge_goalkeeper: 'GK',
    starter: 'Starting 5',
    captain: 'Captain',
    goalkeeper: 'Goalkeeper',
  },
};

function render(dict: unknown, referenceDict: unknown) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en" dict={dict as never} referenceDict={referenceDict as never}>
      <LineupsTab data={data} />
    </I18nProvider>,
  );
}

describe('LineupsTab insignias i18n (#170)', () => {
  it('usa las claves del idioma activo para las insignias', () => {
    const html = render(EN, {});
    expect(html).toContain('GK');
    expect(html).toContain('S5');
    expect(html).not.toContain('match_detail.badge_');
  });

  it('sin claves cae al respaldo español', () => {
    const html = render({}, {});
    // El portero español es "P" y el 5 inicial "5i".
    expect(html).toContain('>P</span>');
    expect(html).toContain('>5i</span>');
    expect(html).not.toContain('match_detail.badge_goalkeeper');
  });
});

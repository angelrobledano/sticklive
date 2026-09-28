import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { CompetitionsList } from './CompetitionsList';
import type { CompetitionSummary } from '@/lib/api/client';

/**
 * #339: el listado HTML debe enlazar TODAS las competiciones recibidas, no solo
 * las de la temporada vigente ni solo el primer país del acordeón (9/105 antes).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, prefetch: () => {}, refresh: () => {} }),
  usePathname: () => '/es/competitions',
}));

function comp(over: Partial<CompetitionSummary> & Pick<CompetitionSummary, 'id' | 'name' | 'slug' | 'season'>): CompetitionSummary {
  return {
    shortName: null, gender: null, category: null, country: 'ES', organizer: 'FEP',
    scope: 'national', region: null, ageCategory: 'senior',
    ...over,
  };
}

const COMPS: CompetitionSummary[] = [
  comp({ id: 'c-ok', name: 'OK Liga Masculina', slug: 'ok-liga-masculina',
    season: { id: 's1', name: '2026/27', isCurrent: true, teamCount: 12, matchCount: 182 } }),
  comp({ id: 'c-old', name: 'Plata 2025', slug: 'plata-2025', country: 'PT',
    season: { id: 's2', name: '2025/26', isCurrent: false, teamCount: 10, matchCount: 90 } }),
  comp({ id: 'c-hist', name: 'Histórico', slug: 'historico',
    season: { id: 's3', name: 'Histórico', isCurrent: false, teamCount: 8, matchCount: 40 } }),
];

describe('CompetitionsList índice enlazado (#339)', () => {
  it('enlaza todas las competiciones (incluidas las de temporadas no vigentes)', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
        <CompetitionsList competitions={COMPS} error={null} />
      </I18nProvider>,
    );
    expect(html).toContain('/competitions/c-ok');
    expect(html).toContain('/competitions/c-old');
    expect(html).toContain('/competitions/c-hist');
  });
});

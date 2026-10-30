import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import es from '@/locales/es.json';
import type { CompetitionSummary, Federation } from '@/lib/api/client';
import { CompetitionsList } from './CompetitionsList';

/**
 * Encontrabilidad de las federaciones autonómicas (30/10/2026): un toque desde
 * la portada de Competiciones, sin bajar hasta el final de España.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions',
}));

const fed = (code: string, slug: string, level: Federation['level'], region: string | null, order: number): Federation => ({
  code, slug, name: code, shortName: code, level, parentCode: level === 'regional' ? 'RFEP' : null,
  country: 'ES', region, website: null, displayOrder: order, competitionCount: 0,
});
const FEDS = [fed('RFEP', 'rfep', 'national', null, 10), fed('FECAPA', 'fecapa', 'regional', 'Cataluña', 110), fed('FGP', 'fgp', 'regional', 'Galicia', 130)];
const ref = (f: Federation) => ({ code: f.code, slug: f.slug, name: f.name, shortName: f.shortName, level: f.level, parentCode: f.parentCode, country: f.country, region: f.region });

function comp(slug: string, f: Federation, over: Partial<CompetitionSummary> = {}): CompetitionSummary {
  return {
    id: slug, name: slug.toUpperCase(), shortName: null, slug, gender: 'male', category: 'senior', country: 'ES',
    organizer: f.code, scope: f.level === 'regional' ? 'regional' : 'national', region: f.region, ageCategory: 'senior',
    tier: null, featuredRank: null, federation: ref(f),
    season: { id: `s-${slug}`, name: '2026/27', isCurrent: true, teamCount: 8, matchCount: 10 },
    ...over,
  } as CompetitionSummary;
}

describe('federaciones autonómicas en Competiciones', () => {
  it('Destacadas enseña las federaciones del país con enlace a su página', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={es as never} referenceDict={es as never}>
        <CompetitionsList
          competitions={[
            comp('ok-liga-plata-norte', FEDS[0]!, { featuredRank: 20, tier: 2 }),
            comp('primera-catalana', FEDS[1]!), comp('segona-catalana', FEDS[1]!),
            comp('liga-gallega', FEDS[2]!),
          ]}
          federations={FEDS}
          error={null}
        />
      </I18nProvider>,
    );
    expect(html).toContain('Federaciones autonómicas');
    expect(html).toContain('/competitions/federation/fecapa');
    expect(html).toContain('/competitions/federation/fgp');
    expect(html).toContain('Cataluña');
  });
});

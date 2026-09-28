import { describe, it, expect } from 'vitest';
import { groupCompetitionsForIndex } from './CompetitionsList';
import type { CompetitionSummary } from '@/lib/api/client';

/**
 * #339: el grafo de enlaces HTML del listado dependía de los acordeones
 * abiertos en cliente (9/105 competiciones enlazadas). Estas pruebas fijan el
 * ORDEN y la COBERTURA del listado completo indexable: internacional aparte,
 * resto por país (orden fijo) y dentro de cada país por importancia.
 */

function comp(over: Partial<CompetitionSummary> & Pick<CompetitionSummary, 'id' | 'name' | 'slug'>): CompetitionSummary {
  return {
    shortName: null,
    gender: null,
    category: null,
    country: null,
    organizer: 'FEP',
    scope: 'national',
    region: null,
    ageCategory: 'senior',
    season: null,
    ...over,
  };
}

const COMPS: CompetitionSummary[] = [
  comp({ id: 'es-2', name: 'Plata Norte', slug: 'ok-liga-plata-norte', country: 'ES' }),
  comp({ id: 'es-1', name: 'OK Liga Masculina', slug: 'ok-liga-masculina', country: 'ES' }),
  comp({ id: 'pt-1', name: 'Campeonato Portugal', slug: 'campeonato-portugal', country: 'PT' }),
  comp({ id: 'it-1', name: 'Serie A', slug: 'serie-a', country: 'IT' }),
  comp({ id: 'fr-1', name: 'Championnat France', slug: 'championnat-france', country: 'FR' }),
  comp({ id: 'int-2', name: 'Europeo', slug: 'europeo', scope: 'international' }),
  comp({ id: 'int-1', name: 'Mundial', slug: 'mundial', scope: 'international' }),
];

describe('groupCompetitionsForIndex (#339)', () => {
  it('separa internacional y lo ordena por importancia/nombre', () => {
    const { international } = groupCompetitionsForIndex(COMPS, 'es');
    // Sin rango conocido, ambos empatan y ordenan por nombre en el locale.
    expect(international.map((c) => c.id)).toEqual(['int-2', 'int-1']);
  });

  it('ordena los países con el orden estable del producto (ES, PT, IT, FR…)', () => {
    const { byCountry } = groupCompetitionsForIndex(COMPS, 'es');
    expect(byCountry.map(([code]) => code)).toEqual(['ES', 'PT', 'IT', 'FR']);
  });

  it('dentro de cada país ordena por importancia, no alfabéticamente', () => {
    const { byCountry } = groupCompetitionsForIndex(COMPS, 'es');
    const es = byCountry.find(([code]) => code === 'ES')![1];
    // OK Liga Masculina (importancia 1) antes que Plata Norte (7), a pesar del nombre.
    expect(es.map((c) => c.id)).toEqual(['es-1', 'es-2']);
  });

  it('no pierde ninguna competición: cobertura total del listado', () => {
    const { international, byCountry } = groupCompetitionsForIndex(COMPS, 'es');
    const flat = [...international, ...byCountry.flatMap(([, comps]) => comps)];
    expect(new Set(flat.map((c) => c.id))).toEqual(new Set(COMPS.map((c) => c.id)));
    expect(flat.length).toBe(COMPS.length);
  });
});

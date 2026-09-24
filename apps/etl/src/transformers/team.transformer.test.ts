import { describe, it, expect } from 'vitest';
import type { ScrapedTeam } from '@sports/shared-types';
import { transformTeam } from './team.transformer.js';

function raw(over: Record<string, unknown> = {}): ScrapedTeam {
  return {
    rawName: 'Deportivo Liceo',
    name: 'Deportivo Liceo',
    sourceId: '00000000-0000-0000-0000-000000000000',
    scrapedAt: new Date('2026-06-16T10:00:00Z'),
    ...over,
  } as unknown as ScrapedTeam;
}

describe('transformTeam', () => {
  it('genera slug desde rawName', () => {
    expect(transformTeam(raw({ rawName: 'C.P. Voltregà' }), 's').input.slug).toBe('c-p-voltrega');
  });
  it('sin ciudad deja city indefinida y avisa', () => {
    const r = transformTeam(raw(), 's');
    expect(r.input.city).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('Ciudad no disponible'))).toBe(true);
  });
  it('conserva la ciudad explícita sin warning de ciudad', () => {
    const r = transformTeam(raw({ city: 'A Coruña' }), 's');
    expect(r.input.city).toBe('A Coruña');
    expect(r.warnings.some((w) => w.includes('Ciudad no disponible'))).toBe(false);
  });
});

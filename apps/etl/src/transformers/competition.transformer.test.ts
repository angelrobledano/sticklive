import { describe, it, expect } from 'vitest';
import type { ScrapedCompetition } from '@sports/shared-types';
import { transformCompetition } from './competition.transformer.js';

function raw(over: Record<string, unknown> = {}): ScrapedCompetition {
  return {
    rawName: 'OK Liga',
    name: 'OK Liga',
    sourceId: '00000000-0000-0000-0000-000000000000',
    scrapedAt: new Date('2026-06-16T10:00:00Z'),
    ...over,
  } as unknown as ScrapedCompetition;
}

describe('transformCompetition — género', () => {
  it('infiere female desde el nombre', () => {
    expect(transformCompetition(raw({ rawName: 'OK Liga Femenina' }), 's').input.gender).toBe('female');
  });
  it('infiere male desde el nombre', () => {
    expect(transformCompetition(raw({ rawName: 'Liga Masculina' }), 's').input.gender).toBe('male');
  });
  it('sin pista deja gender indefinido y añade warning', () => {
    const r = transformCompetition(raw({ rawName: 'OK Liga' }), 's');
    expect(r.input.gender).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('Género no detectado'))).toBe(true);
  });
  it('respeta el gender explícito de la fuente', () => {
    expect(transformCompetition(raw({ gender: 'female' }), 's').input.gender).toBe('female');
  });
});

describe('transformCompetition — categoría y slug', () => {
  it('infiere categoría desde el nombre', () => {
    expect(transformCompetition(raw({ rawName: 'Liga Juvenil' }), 's').input.category).toBe('juvenil');
    expect(transformCompetition(raw({ rawName: 'Campeonato Cadete' }), 's').input.category).toBe('cadete');
  });
  it('sin categoría detectable añade warning', () => {
    const r = transformCompetition(raw({ rawName: 'OK Liga' }), 's');
    expect(r.warnings.some((w) => w.includes('Categoría no detectada'))).toBe(true);
  });
  it('genera slug desde rawName si la fuente no lo da', () => {
    expect(transformCompetition(raw({ rawName: 'Copa del Rey' }), 's').input.slug).toBe('copa-del-rey');
  });
});

import { describe, it, expect } from 'vitest';
import type { ScrapedMatch } from '@sports/shared-types';
import { normalizeStatus, transformMatch } from './match.transformer.js';

/** Factoría de ScrapedMatch válido (la validación real la hace zod en runtime). */
function raw(over: Record<string, unknown> = {}): ScrapedMatch {
  return {
    seasonId: 'season-1',
    homeTeamRef: '3408',
    awayTeamRef: '3358',
    sourceId: '00000000-0000-0000-0000-000000000000',
    scrapedAt: new Date('2026-06-16T10:00:00Z'),
    ...over,
  } as unknown as ScrapedMatch;
}

describe('normalizeStatus', () => {
  it('undefined → scheduled', () => {
    expect(normalizeStatus(undefined)).toBe('scheduled');
  });
  it('mapea variantes de la fuente (case-insensitive, con espacios)', () => {
    expect(normalizeStatus('FINALIZADO')).toBe('finished');
    expect(normalizeStatus('  en juego ')).toBe('live');
    expect(normalizeStatus('postponed')).toBe('postponed');
  });
  it('estado desconocido → scheduled (no rompe)', () => {
    expect(normalizeStatus('xyz-desconocido')).toBe('scheduled');
  });
});

describe('transformMatch', () => {
  it('con source_ref de la fuente NO genera ref sintética ni warning', () => {
    const r = transformMatch(raw({ sourceRef: 'fep_match_34267', status: 'finalizado' }));
    expect(r.input.sourceRef).toBe('fep_match_34267');
    expect(r.input.status).toBe('finished');
    expect(r.warnings).toHaveLength(0);
  });

  it('sin source_ref genera ref sintética determinista + warning', () => {
    const r = transformMatch(raw({ scheduledAt: '2026-06-19T17:00:00.000Z' }));
    expect(r.input.sourceRef).toBe('synthetic:season-1:3408:3358:2026-06-19T17:00:00.000Z');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('fecha válida → Date; fecha inválida → undefined + warning', () => {
    expect(transformMatch(raw({ scheduledAt: '2026-06-19T17:00:00.000Z' })).input.scheduledAt)
      .toBeInstanceOf(Date);
    const bad = transformMatch(raw({ scheduledAt: 'no-es-fecha' }));
    expect(bad.input.scheduledAt).toBeUndefined();
    expect(bad.warnings.some((w) => w.includes('Fecha de partido inválida'))).toBe(true);
  });

  it('preserva los refs de equipo para que el loader los resuelva', () => {
    const r = transformMatch(raw());
    expect(r.homeTeamRef).toBe('3408');
    expect(r.awayTeamRef).toBe('3358');
  });
});

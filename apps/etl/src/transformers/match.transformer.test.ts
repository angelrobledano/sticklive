import { describe, it, expect } from 'vitest';
import type { ScrapedMatch } from '@sports/shared-types';
import { normalizeStatus, isKnownStatus, transformMatch } from './match.transformer.js';

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
  it('undefined → sin señal (undefined): la fuente no dice nada del estado', () => {
    expect(normalizeStatus(undefined)).toBeUndefined();
  });
  it('mapea variantes de la fuente (case-insensitive, con espacios)', () => {
    expect(normalizeStatus('FINALIZADO')).toBe('finished');
    expect(normalizeStatus('  en juego ')).toBe('live');
    expect(normalizeStatus('postponed')).toBe('postponed');
  });
  it('estado desconocido → sin señal (no rompe y no inventa un estado)', () => {
    expect(normalizeStatus('xyz-desconocido')).toBeUndefined();
  });
});

describe('isKnownStatus (#377/P3-13)', () => {
  it('reconoce etiquetas mapeadas (case-insensitive)', () => {
    expect(isKnownStatus('FINALIZADO')).toBe(true);
    expect(isKnownStatus('  en juego ')).toBe(true);
    expect(isKnownStatus('live')).toBe(true);
  });

  it('no reconoce vacío ni etiquetas desconocidas', () => {
    expect(isKnownStatus(undefined)).toBe(false);
    expect(isKnownStatus('')).toBe(false);
    expect(isKnownStatus('nueva-etiqueta-de-la-fuente')).toBe(false);
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

  it('groupName de la fase de grupos se valida y pasa al input', () => {
    const r = transformMatch(raw({ groupName: 'A' }));
    expect(r.input.groupName).toBe('A');
    // Vacío/null → no llega al input (el loader escribirá NULL).
    expect(transformMatch(raw({ groupName: undefined })).input.groupName).toBeUndefined();
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

  it('#377(P3-13): una etiqueta desconocida no es una señal de estado, pero avisa', () => {
    const r = transformMatch(raw({ sourceRef: 'fep_match_1', status: 'etiqueta-nueva' }));
    expect(r.input.status).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('Estado desconocido'))).toBe(true);
  });
});

describe('transformMatch — estructura de la fuente', () => {
  it('propaga fase, ronda y nº de partido de serie ya resueltos por el ETL', () => {
    const r = transformMatch(raw({
      sourceRef: 'fep_match_9',
      roundId: '11111111-1111-1111-1111-111111111111',
      phaseId: '22222222-2222-2222-2222-222222222222',
      seriesGame: 3,
    }));
    expect(r.input.roundId).toBe('11111111-1111-1111-1111-111111111111');
    expect(r.input.phaseId).toBe('22222222-2222-2222-2222-222222222222');
    expect(r.input.seriesGame).toBe(3);
  });

  it('una fila de calendario sin estado no lleva estado (no "scheduled" por defecto)', () => {
    const r = transformMatch(raw({ sourceRef: 'fep_match_10' }));
    expect(r.input.status).toBeUndefined();
  });
});

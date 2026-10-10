import { describe, it, expect } from 'vitest';
import {
  resolveStatusTransition,
  matchDisplayState,
  isLiveStatus,
  isCoreMatchStatus,
} from './index.js';

const H = 3_600_000;
const KICKOFF = Date.parse('2026-10-10T18:00:00Z');

describe('resolveStatusTransition — una única regla para todos los escritores', () => {
  it('una fuente SIN información de estado no toca el estado actual', () => {
    // El calendario sin resultado no sabe si el partido está en juego.
    expect(resolveStatusTransition('live', undefined)).toEqual({ status: 'live', changed: false, correction: false });
    expect(resolveStatusTransition('finished', null)).toEqual({ status: 'finished', changed: false, correction: false });
  });

  it('un partido nuevo sin señal nace programado', () => {
    expect(resolveStatusTransition(null, undefined)).toEqual({ status: 'scheduled', changed: true, correction: false });
  });

  it('UPCOMING → LIVE solo con señal explícita', () => {
    expect(resolveStatusTransition('scheduled', 'live')).toEqual({ status: 'live', changed: true, correction: false });
  });

  it('LIVE → FINISHED', () => {
    expect(resolveStatusTransition('live', 'finished')).toEqual({ status: 'finished', changed: true, correction: false });
  });

  it('un partido que aparece ya empezado se da de alta directamente en live', () => {
    expect(resolveStatusTransition(null, 'live')).toEqual({ status: 'live', changed: true, correction: false });
    expect(resolveStatusTransition(undefined, 'finished')).toEqual({ status: 'finished', changed: true, correction: false });
  });

  it('la misma señal repetida no es un cambio', () => {
    expect(resolveStatusTransition('live', 'live')).toEqual({ status: 'live', changed: false, correction: false });
  });

  it('las correcciones de la fuente se aplican pero quedan marcadas', () => {
    expect(resolveStatusTransition('finished', 'live')).toEqual({ status: 'live', changed: true, correction: true });
    expect(resolveStatusTransition('live', 'scheduled')).toEqual({ status: 'scheduled', changed: true, correction: true });
    expect(resolveStatusTransition('finished', 'scheduled')).toEqual({ status: 'scheduled', changed: true, correction: true });
  });

  it('aplazado y cancelado explícitos se aplican desde cualquier estado', () => {
    expect(resolveStatusTransition('scheduled', 'postponed').status).toBe('postponed');
    expect(resolveStatusTransition('live', 'cancelled').status).toBe('cancelled');
    expect(resolveStatusTransition('postponed', 'live')).toEqual({ status: 'live', changed: true, correction: false });
  });

  it('un estado desconocido de la fuente se ignora (no inventa nada)', () => {
    expect(resolveStatusTransition('live', 'halftime')).toEqual({ status: 'live', changed: false, correction: false });
    expect(resolveStatusTransition(null, 'garbage')).toEqual({ status: 'scheduled', changed: true, correction: false });
  });
});

describe('matchDisplayState — la hora NUNCA convierte un partido en LIVE', () => {
  it('scheduled antes del saque', () => {
    expect(matchDisplayState('scheduled', new Date(KICKOFF), KICKOFF - H)).toBe('scheduled');
  });

  it('scheduled con el saque pasado y sin señal → pendiente de inicio, no LIVE', () => {
    // Partido previsto 18:00 que empieza 18:15: a las 18:10 no está en juego.
    expect(matchDisplayState('scheduled', new Date(KICKOFF), KICKOFF + 10 * 60_000)).toBe('awaiting_start');
  });

  it('scheduled muy pasado (sin resultado) → atrasado, no LIVE', () => {
    expect(matchDisplayState('scheduled', new Date(KICKOFF), KICKOFF + 6 * H)).toBe('overdue');
  });

  it('live aunque la hora prevista no coincida (la fuente manda)', () => {
    expect(matchDisplayState('live', new Date(KICKOFF), KICKOFF - 2 * H)).toBe('live');
    expect(matchDisplayState('live', null, KICKOFF)).toBe('live');
  });

  it('estados terminales y sin fecha', () => {
    expect(matchDisplayState('finished', new Date(KICKOFF), KICKOFF)).toBe('finished');
    expect(matchDisplayState('postponed', new Date(KICKOFF), KICKOFF + H)).toBe('postponed');
    expect(matchDisplayState('cancelled', null, KICKOFF)).toBe('cancelled');
    expect(matchDisplayState('scheduled', null, KICKOFF)).toBe('scheduled');
  });
});

describe('helpers', () => {
  it('isLiveStatus solo mira el estado', () => {
    expect(isLiveStatus('live')).toBe(true);
    expect(isLiveStatus('scheduled')).toBe(false);
    expect(isLiveStatus('finished')).toBe(false);
  });

  it('isCoreMatchStatus valida los estados de la BD', () => {
    for (const s of ['scheduled', 'live', 'finished', 'postponed', 'cancelled']) expect(isCoreMatchStatus(s)).toBe(true);
    for (const s of ['halftime', '', 'LIVE', undefined, null]) expect(isCoreMatchStatus(s)).toBe(false);
  });
});

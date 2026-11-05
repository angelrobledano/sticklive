import { describe, it, expect } from 'vitest';
import {
  madridDateKey,
  madridTodayKey,
  addDaysToKey,
  dayDiff,
  classifyMatch,
  isTimeTbd,
  timeTbdLabel,
} from './match-time';

// Origen web (apps/web/src/lib/match-time.test.ts)
/**
 * Cobertura de la lógica horaria que provocó el bug de producción (la home
 * agrupaba en Madrid pero anclaba "hoy" en la hora del runtime). Estos casos
 * fijan el comportamiento correcto: Europe/Madrid como autoridad única.
 */
describe('madridDateKey', () => {
  it('agrupa un partido de 20:00 Madrid (junio, CEST) en su día local', () => {
    // 2026-06-16 18:00Z = 20:00 Madrid
    expect(madridDateKey('2026-06-16T18:00:00.000Z')).toBe('2026-06-16');
  });

  it('00:00 Madrid (junio) cae en el día de Madrid, no en el UTC anterior', () => {
    // 2026-06-15T22:00Z = 2026-06-16 00:00 Madrid
    expect(madridDateKey('2026-06-15T22:00:00.000Z')).toBe('2026-06-16');
  });

  it('devuelve YYYY-MM-DD directo, sin parsear strings localizados', () => {
    expect(madridDateKey('2026-06-16T18:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('null / fecha inválida → string vacío', () => {
    expect(madridDateKey(null)).toBe('');
    expect(madridDateKey('basura')).toBe('');
    expect(madridDateKey(undefined)).toBe('');
  });
});

describe('madridTodayKey', () => {
  it('ignora la TZ del runtime: instante 00:30 Madrid da el día de Madrid aunque el server sea UTC', () => {
    const instant = new Date('2026-06-15T22:30:00.000Z'); // 00:30 Madrid (CEST)
    expect(madridTodayKey(instant)).toBe('2026-06-16');
  });
});

describe('addDaysToKey / dayDiff', () => {
  it('suma días sin romperse en el cambio de horario de verano', () => {
    expect(addDaysToKey('2026-03-28', 1)).toBe('2026-03-29'); // DST spring forward
    expect(addDaysToKey('2026-06-16', 7)).toBe('2026-06-23');
    expect(addDaysToKey('2026-06-16', -8)).toBe('2026-06-08');
  });

  it('dayDiff es simétrico y correcto', () => {
    expect(dayDiff('2026-06-19', '2026-06-16')).toBe(3);
    expect(dayDiff('2026-06-16', '2026-06-19')).toBe(-3);
    expect(dayDiff('2026-06-16', '2026-06-16')).toBe(0);
  });
});

describe('classifyMatch', () => {
  const now = new Date('2026-06-16T18:30:00.000Z'); // 20:30 Madrid

  it('estado de BD manda sobre la heurística', () => {
    expect(classifyMatch({ status: 'finished', scheduledAt: '2026-06-16T18:00:00Z', startedAt: null }, now)).toBe('past');
    expect(classifyMatch({ status: 'live', scheduledAt: '2026-06-16T22:00:00Z', startedAt: null }, now)).toBe('live');
  });

  it('scheduled con la hora pasada NO es en juego (la hora no fabrica directos): pendiente', () => {
    expect(classifyMatch({ status: 'scheduled', scheduledAt: '2026-06-16T18:00:00Z', startedAt: null }, now)).toBe('future');
  });

  it('scheduled aún por empezar → futuro', () => {
    expect(classifyMatch({ status: 'scheduled', scheduledAt: '2026-06-16T20:30:00Z', startedAt: null }, now)).toBe('future');
  });

  it('a las 4 h sin señal de la fuente sigue pendiente, no en juego', () => {
    expect(classifyMatch({ status: 'scheduled', scheduledAt: '2026-06-16T14:30:00Z', startedAt: null }, now)).toBe('future');
  });

  it('scheduled empezado hace >5h y nunca cerró → pasado (dato muerto)', () => {
    expect(classifyMatch({ status: 'scheduled', scheduledAt: '2026-06-16T13:00:00Z', startedAt: null }, now)).toBe('past');
  });

  it('aplazado/cancelado no son "jugados" → futuro', () => {
    expect(classifyMatch({ status: 'postponed', scheduledAt: '2026-06-16T18:00:00Z', startedAt: null }, now)).toBe('future');
  });
});

// Origen web (apps/web/src/lib/match-time-tbd.test.ts). El caso de formatTime
// (componente MatchCard) sigue en apps/web, aquí solo la parte pura.
describe('hora por confirmar', () => {
  it('medianoche en Madrid o en Lisboa = sin hora, una hora real no', () => {
    expect(isTimeTbd('2026-11-06T23:00:00Z')).toBe(true); // 00:00 Madrid (invierno)
    expect(isTimeTbd('2026-11-07T00:00:00Z')).toBe(true); // 00:00 Lisboa
    expect(isTimeTbd('2026-11-07T17:00:00Z')).toBe(false);
    expect(isTimeTbd(null)).toBe(false);
  });

  it('con la zona de la sede solo cuenta su medianoche', () => {
    expect(isTimeTbd('2026-11-07T00:00:00Z', 'Europe/Madrid')).toBe(false);
  });

  it('timeTbdLabel localiza el texto y cae a español', () => {
    expect(timeTbdLabel('pt')).toBe('A confirmar');
    expect(timeTbdLabel('en-GB')).toBe('TBC');
    expect(timeTbdLabel()).toBe('Por confirmar');
    expect(timeTbdLabel('xx')).toBe('Por confirmar');
  });
});

// Origen app (apps/mobile/src/lib/time.test.ts, casos de formatDayKey). La app
// usaba formatDayKey con la misma regla que madridDateKey.
describe('madridDateKey (casos de formatDayKey de la app)', () => {
  it('pinta YYYY-MM-DD en Europe/Madrid', () => {
    expect(madridDateKey('2026-10-03T17:00:00.000Z')).toBe('2026-10-03');
  });

  it('cruza el día según Madrid (22:30 UTC de octubre = 00:30 del día siguiente)', () => {
    expect(madridDateKey('2026-10-03T22:30:00.000Z')).toBe('2026-10-04');
  });

  it('sin fecha o inválida → ""', () => {
    expect(madridDateKey(null)).toBe('');
    expect(madridDateKey('no-fecha')).toBe('');
  });

  it('con TZ de runtime UTC sigue anclando en Madrid (medianoche local de verano)', () => {
    expect(madridDateKey('2026-06-30T22:00:00.000Z')).toBe('2026-07-01');
  });
});

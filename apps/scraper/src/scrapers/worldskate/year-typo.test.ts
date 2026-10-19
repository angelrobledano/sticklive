import { describe, it, expect } from 'vitest';
import { fixYearTypos } from './year-typo.js';

/**
 * Caso real (WSG Asunción, 17/10/2026): la fuente publicó la final con
 * gamedate="20271018" (18/10/2027) en un torneo del 12 al 18/10/2026. El
 * loader la rechazaba por caer fuera de la ventana de la temporada (#229) y
 * la final no aparecía en el cuadro.
 */
describe('fixYearTypos', () => {
  const torneo = [
    '2026-10-12T17:00:00.000Z', '2026-10-13T17:00:00.000Z', '2026-10-15T14:45:00.000Z',
    '2026-10-16T20:15:00.000Z', '2026-10-17T19:15:00.000Z', '2026-10-18T19:15:00.000Z',
  ];

  it('corrige un año desplazado +1 cuando así cae dentro del calendario', () => {
    const { dates, corrected } = fixYearTypos([...torneo, '2027-10-18T22:00:00.000Z']);
    expect(dates.at(-1)).toBe('2026-10-18T22:00:00.000Z');
    expect(corrected).toEqual([{ index: 6, from: '2027-10-18T22:00:00.000Z', to: '2026-10-18T22:00:00.000Z' }]);
  });

  it('también un año desplazado −1', () => {
    const { dates } = fixYearTypos([...torneo, '2025-10-14T18:00:00.000Z']);
    expect(dates.at(-1)).toBe('2026-10-14T18:00:00.000Z');
  });

  it('no toca fechas coherentes ni las ausentes', () => {
    const input = [...torneo, null];
    const { dates, corrected } = fixYearTypos(input);
    expect(dates).toEqual(input);
    expect(corrected).toEqual([]);
  });

  it('no inventa: una fecha lejana que ni con ±1 año encaja se deja (la rechazará el loader)', () => {
    const { dates, corrected } = fixYearTypos([...torneo, '2027-03-01T18:00:00.000Z']);
    expect(dates.at(-1)).toBe('2027-03-01T18:00:00.000Z');
    expect(corrected).toEqual([]);
  });

  it('una liga de temporada larga (sept→mayo) no se corrige', () => {
    const liga = ['2026-09-20T18:00:00.000Z', '2026-12-10T18:00:00.000Z', '2027-02-14T18:00:00.000Z', '2027-05-01T18:00:00.000Z'];
    expect(fixYearTypos(liga).corrected).toEqual([]);
  });

  it('con menos de 3 fechas no hay referencia fiable: no corrige', () => {
    expect(fixYearTypos(['2026-10-12T17:00:00.000Z', '2027-10-18T22:00:00.000Z']).corrected).toEqual([]);
  });
});

describe('parseWorldskateCalendar — final con errata de año (calendario real 17/10/2026)', () => {
  it('la final ARG-FRA sale el 18/10/2026, no en 2027', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { parseWorldskateCalendar } = await import('./worldskate.scraper.js');
    const html = readFileSync(fileURLToPath(new URL('./__fixtures__/cal-325-final-2027.html', import.meta.url)), 'utf8');
    const { matches } = parseWorldskateCalendar(html, { seasonId: 's', sourceId: 'x', timezone: 'America/Asuncion' });
    const final = matches.find((m) => m.stage === 'final');
    expect(final?.scheduledAt?.startsWith('2026-10-18')).toBe(true);
    expect(matches.every((m) => !m.scheduledAt || m.scheduledAt.startsWith('2026-10'))).toBe(true);
  });
});

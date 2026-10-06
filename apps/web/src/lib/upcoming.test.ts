import { describe, it, expect } from 'vitest';
import { groupUpcomingByDay, type UpcomingMatch } from './upcoming';

/**
 * Fixtures TZ-seguros: mediodía UTC cae siempre en el mismo día de Madrid, así
 * que las claves de día no dependen del horario de verano.
 */
const M = (id: string, iso: string | null, compName?: string | null, compId?: string | null, slug?: string | null): UpcomingMatch => ({
  id,
  scheduledAt: iso,
  competitionName: compName ?? null,
  competitionId: compId ?? null,
  competitionSlug: slug ?? null,
});

describe('groupUpcomingByDay', () => {
  it('solo días posteriores al seleccionado, en orden ascendente', () => {
    const groups = groupUpcomingByDay(
      [
        M('a', '2026-10-06T12:00:00Z', 'Plata'), // día seleccionado: fuera
        M('b', '2026-10-05T12:00:00Z', 'Plata'), // pasado: fuera
        M('c', '2026-10-12T12:00:00Z', 'Plata'),
        M('d', '2026-10-10T12:00:00Z', 'Plata'),
      ],
      '2026-10-06',
    );
    expect(groups.map((g) => g.dateKey)).toEqual(['2026-10-10', '2026-10-12']);
  });

  it('agrupa por competición dentro del día y ordena partidos por hora', () => {
    const groups = groupUpcomingByDay(
      [
        M('tarde', '2026-10-10T17:00:00Z', 'Plata Norte', 'c1', 'ok-liga-plata-norte'),
        M('medio', '2026-10-10T16:00:00Z', 'Plata Norte', 'c1', 'ok-liga-plata-norte'),
        M('otra', '2026-10-10T18:00:00Z', 'Bronce', 'c2', 'ok-liga-bronce-masculina-norte'),
      ],
      '2026-10-06',
    );
    expect(groups).toHaveLength(1);
    const day = groups[0]!;
    expect(day.total).toBe(3);
    // Importancia (como /competiciones): Plata (7) antes que Bronce (12).
    expect(day.competitions.map((c) => c.name)).toEqual(['Plata Norte', 'Bronce']);
    const plata = day.competitions.find((c) => c.name === 'Plata Norte')!;
    expect(plata.matches.map((m) => m.id)).toEqual(['medio', 'tarde']); // por hora dentro del grupo
  });

  it('las competiciones se ordenan por IMPORTANCIA, no por hora (#414)', () => {
    // Bronce empieza a las 11:00 y la OK Liga a las 20:00: la OK Liga va primero,
    // el mismo criterio que el listado de /competiciones y la jornada del día.
    const groups = groupUpcomingByDay(
      [
        M('bronce', '2026-10-10T09:00:00Z', 'Bronce', 'c2', 'ok-liga-bronce-masculina-norte'),
        M('okliga', '2026-10-10T18:00:00Z', 'OK Liga Masculina', 'c1', 'ok-liga-masculina'),
      ],
      '2026-10-06',
    );
    expect(groups[0]!.competitions.map((c) => c.name)).toEqual(['OK Liga Masculina', 'Bronce']);
  });

  it('partidos sin competición caen en un grupo propio (el llamante pone la etiqueta)', () => {
    const groups = groupUpcomingByDay([M('x', '2026-10-10T12:00:00Z', null)], '2026-10-06');
    expect(groups[0]!.competitions).toHaveLength(1);
    expect(groups[0]!.competitions[0]!.name).toBeNull();
  });

  it('agrupa por ID de competición aunque el nombre venga vacío en algún partido', () => {
    const groups = groupUpcomingByDay(
      [
        M('a', '2026-10-10T12:00:00Z', 'Plata', 'c1'),
        M('b', '2026-10-10T13:00:00Z', null, 'c1'),
      ],
      '2026-10-06',
    );
    expect(groups[0]!.competitions).toHaveLength(1);
    expect(groups[0]!.competitions[0]!.matches).toHaveLength(2);
    expect(groups[0]!.competitions[0]!.name).toBe('Plata'); // el 1.º que llega da el nombre
  });

  it('sin partidos futuros devuelve vacío (y los sin fecha se ignoran)', () => {
    expect(groupUpcomingByDay([M('a', '2026-10-06T12:00:00Z')], '2026-10-06')).toEqual([]);
    expect(groupUpcomingByDay([M('b', null, 'Plata')], '2026-10-06')).toEqual([]);
  });
});

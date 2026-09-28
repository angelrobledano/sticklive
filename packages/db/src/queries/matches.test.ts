import { describe, it, expect } from 'vitest';
import type { UpsertMatchEventInput } from './matches.js';

// `@sports/db` exige DATABASE_URL al importarse (el pool no conecta hasta la
// primera query). Fijamos una de mentira ANTES del import dinámico para poder
// testear la lógica pura sin levantar Postgres.
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';

const { dedupeMatchEventsBySourceRef } = await import('./matches.js');

/**
 * #375 P3-2: si dos eventos llegan con la misma `source_ref`, el upsert sólo
 * puede conservar uno. Antes ganaba el último en silencio, perdiendo el evento
 * que traía más información observable.
 */
describe('dedupeMatchEventsBySourceRef', () => {
  const base: UpsertMatchEventInput = {
    eventType: 'foul',
    minute: 5,
    period: 1,
    teamId: null,
    playerId: null,
    detail: null,
    sourceRef: 'fep_event_X_p1_0500_foul_H',
  };

  it('sin colisiones conserva todos los eventos', () => {
    const out = dedupeMatchEventsBySourceRef([
      { ...base, sourceRef: 'a' },
      { ...base, sourceRef: 'b' },
    ]);
    expect(out.map((e) => e.sourceRef)).toEqual(['a', 'b']);
  });

  it('prefiere el evento con más información, llegue antes o después', () => {
    const pobre: UpsertMatchEventInput = { ...base, teamId: null, playerId: null, detail: null };
    const rico: UpsertMatchEventInput = { ...base, teamId: 't', playerId: 'p', detail: '1-0' };

    expect(dedupeMatchEventsBySourceRef([pobre, rico])[0]).toBe(rico);
    // Antes el último ganaba siempre; con el rico primero se perdía su detalle.
    expect(dedupeMatchEventsBySourceRef([rico, pobre])[0]).toBe(rico);
  });

  it('en empate de información conserva el último (comportamiento previo)', () => {
    const a: UpsertMatchEventInput = { ...base, detail: 'a' };
    const b: UpsertMatchEventInput = { ...base, detail: 'b' };
    expect(dedupeMatchEventsBySourceRef([a, b])[0]).toBe(b);
  });
});

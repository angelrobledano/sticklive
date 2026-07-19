import { describe, it, expect } from 'vitest';
import { freshEvents, collapsePerScorer, type EventSnap } from './push-diff.js';

/** Evento mínimo: sólo importan eventId, matchId, playerId y minute. */
function snap(over: Partial<EventSnap> & Pick<EventSnap, 'eventId'>): EventSnap {
  return {
    matchId: 'match-1',
    playerId: 'player-1',
    playerName: 'Jugador',
    scorerTeamId: 'team-1',
    competitionId: 'comp-1',
    homeTeamId: 'team-1',
    awayTeamId: 'team-2',
    homeShort: 'LOC',
    awayShort: 'VIS',
    homeScore: 1,
    awayScore: 0,
    period: 1,
    minute: 10,
    ...over,
  };
}

const mapOf = (...events: EventSnap[]) => new Map(events.map((e) => [e.eventId, e]));

describe('freshEvents', () => {
  it('no devuelve nada cuando el snapshot no ha cambiado', () => {
    const cur = mapOf(snap({ eventId: 'a' }), snap({ eventId: 'b' }));
    expect(freshEvents(cur, cur)).toEqual([]);
  });

  it('detecta sólo los eventos cuyo id no estaba antes', () => {
    const prev = mapOf(snap({ eventId: 'a' }));
    const cur = mapOf(snap({ eventId: 'a' }), snap({ eventId: 'b' }));
    expect(freshEvents(prev, cur).map((e) => e.eventId)).toEqual(['b']);
  });

  it('trata todo como nuevo si no había snapshot previo', () => {
    const cur = mapOf(snap({ eventId: 'a' }), snap({ eventId: 'b' }));
    expect(freshEvents(new Map(), cur)).toHaveLength(2);
  });

  it('ignora los eventos que desaparecen (no genera notificación al borrar)', () => {
    const prev = mapOf(snap({ eventId: 'a' }), snap({ eventId: 'b' }));
    const cur = mapOf(snap({ eventId: 'a' }));
    expect(freshEvents(prev, cur)).toEqual([]);
  });

  it('detecta la corrección del acta: sustituir un evento por otro', () => {
    // ESTE es el caso que el diff por CONTEO perdía: la fuente quita un evento
    // y añade otro en el mismo ciclo, así que el total no varía y no se emitía
    // ninguna notificación. Con ids, el nuevo se ve.
    const prev = mapOf(snap({ eventId: 'a' }), snap({ eventId: 'b' }));
    const cur = mapOf(snap({ eventId: 'a' }), snap({ eventId: 'c' }));

    const fresh = freshEvents(prev, cur);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.eventId).toBe('c');
  });

  it('ordena por minuto para que la ráfaga salga en orden cronológico', () => {
    const cur = mapOf(
      snap({ eventId: 'tarde', minute: 40 }),
      snap({ eventId: 'pronto', minute: 5 }),
      snap({ eventId: 'medio', minute: 20 }),
    );
    expect(freshEvents(new Map(), cur).map((e) => e.eventId))
      .toEqual(['pronto', 'medio', 'tarde']);
  });

  it('coloca los eventos sin minuto al principio en vez de romper el orden', () => {
    const cur = mapOf(
      snap({ eventId: 'con-minuto', minute: 12 }),
      snap({ eventId: 'sin-minuto', minute: null }),
    );
    expect(freshEvents(new Map(), cur).map((e) => e.eventId))
      .toEqual(['sin-minuto', 'con-minuto']);
  });

  it('el periodo manda sobre el minuto al ordenar', () => {
    // `minute` es RELATIVO al periodo: se reinicia en cada uno. Ordenar sólo
    // por minuto pondría el minuto 3 del segundo periodo antes que el 20 del
    // primero, y la notificación que el dispositivo acaba mostrando (mismo tag)
    // sería la del evento más antiguo.
    const cur = mapOf(
      snap({ eventId: 'p2-pronto', period: 2, minute: 3 }),
      snap({ eventId: 'p1-tarde', period: 1, minute: 20 }),
    );
    expect(freshEvents(new Map(), cur).map((e) => e.eventId))
      .toEqual(['p1-tarde', 'p2-pronto']);
  });
});

describe('collapsePerScorer', () => {
  it('deja una sola notificación si el jugador marca dos veces en el mismo ciclo', () => {
    const events = [
      snap({ eventId: 'gol-1', minute: 10 }),
      snap({ eventId: 'gol-2', minute: 22 }),
    ];
    const out = collapsePerScorer(events);
    expect(out).toHaveLength(1);
    // Con la entrada ordenada por minuto (lo hace freshEvents), gana el último.
    expect(out[0]!.eventId).toBe('gol-2');
  });

  it('mantiene una notificación por goleador distinto', () => {
    const events = [
      snap({ eventId: 'gol-1', playerId: 'player-1' }),
      snap({ eventId: 'gol-2', playerId: 'player-2' }),
    ];
    expect(collapsePerScorer(events).map((e) => e.eventId)).toEqual(['gol-1', 'gol-2']);
  });

  it('no mezcla goles del mismo jugador en partidos distintos', () => {
    const events = [
      snap({ eventId: 'gol-1', matchId: 'match-1' }),
      snap({ eventId: 'gol-2', matchId: 'match-2' }),
    ];
    expect(collapsePerScorer(events)).toHaveLength(2);
  });

  it('agrupa los eventos sin jugador por partido (falta directa sin lanzador)', () => {
    const events = [
      snap({ eventId: 'fd-1', playerId: null }),
      snap({ eventId: 'fd-2', playerId: null }),
    ];
    expect(collapsePerScorer(events)).toHaveLength(1);
  });

  it('no confunde "sin jugador" con un jugador real del mismo partido', () => {
    const events = [
      snap({ eventId: 'con-jugador', playerId: 'player-1' }),
      snap({ eventId: 'sin-jugador', playerId: null }),
    ];
    expect(collapsePerScorer(events)).toHaveLength(2);
  });

  it('con la lista vacía devuelve vacío', () => {
    expect(collapsePerScorer([])).toEqual([]);
  });
});

describe('freshEvents + collapsePerScorer (como los usa diffGoals)', () => {
  it('un doblete recién llegado produce una única notificación, la del gol más avanzado', () => {
    const prev = mapOf(snap({ eventId: 'viejo', minute: 3 }));
    const cur = mapOf(
      snap({ eventId: 'viejo', minute: 3 }),
      snap({ eventId: 'nuevo-1', minute: 15 }),
      snap({ eventId: 'nuevo-2', minute: 18 }),
    );

    const out = collapsePerScorer(freshEvents(prev, cur));
    expect(out).toHaveLength(1);
    expect(out[0]!.eventId).toBe('nuevo-2');
    expect(out[0]!.minute).toBe(18);
  });

  it('con goles en periodos distintos gana el del periodo más avanzado', () => {
    const cur = mapOf(
      snap({ eventId: 'gol-p2', period: 2, minute: 2 }),
      snap({ eventId: 'gol-p1', period: 1, minute: 24 }),
    );
    const out = collapsePerScorer(freshEvents(new Map(), cur));
    expect(out).toHaveLength(1);
    expect(out[0]!.eventId).toBe('gol-p2');
  });
});

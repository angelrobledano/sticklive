import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFicha, parseLiveHeader, parseTeamFouls, parseLineups, eventSourceRef,
  remainingToElapsedMinute, mapIncidenciaType, normalizeName,
} from './fep-ficha.parser.js';

/**
 * Golden files: HTML REAL de sidgad congelado en __fixtures__.
 *
 * Son tres capturas del MISMO partido (idp 34259) tomadas durante el directo,
 * más un acta de playoff. Si sidgad cambia la estructura del acta, estos tests
 * fallan en CI en vez de dejarnos sin directo un domingo por la tarde.
 *
 * Las cifras esperadas salen de ejecutar el parser sobre los fixtures, no de
 * suposiciones: son el comportamiento observado que queremos preservar.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const load = (name: string) => readFileSync(join(FIXTURES, `${name}.html`), 'utf-8');

describe('parseFicha — actas reales', () => {
  it('acta en directo, periodo 1: extrae los eventos publicados hasta ese momento', () => {
    const events = parseFicha(load('acta-live-p1'), '34259');

    // Guardia esencial: si el parseo devuelve 0, la fuente cambió de estructura.
    expect(events.length).toBeGreaterThan(0);
    expect(events).toHaveLength(6);

    const byType = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.eventType] = (acc[e.eventType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({ goal: 2, foul: 4 });
  });

  it('acta en directo, periodo 2: ha crecido respecto al periodo 1', () => {
    const p1 = parseFicha(load('acta-live-p1'), '34259');
    const p2 = parseFicha(load('acta-live-p2'), '34259');
    expect(p2.length).toBeGreaterThan(p1.length);
    expect(p2).toHaveLength(18);
  });

  it('acta finalizada: 38 eventos con la mezcla completa de tipos', () => {
    const events = parseFicha(load('acta-finalizada'), '34259');
    expect(events).toHaveLength(38);

    const byType = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.eventType] = (acc[e.eventType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({ goal: 6, foul: 23, direct_foul: 2, timeout: 6, blue_card: 1 });
  });

  it('acta de playoff: se parsea con la misma estructura', () => {
    const events = parseFicha(load('acta-playoff'), '34277');
    expect(events).toHaveLength(43);
    expect(events.filter((e) => e.eventType === 'goal')).toHaveLength(3);
  });

  it('los goles traen goleador, periodo y crono', () => {
    const goles = parseFicha(load('acta-finalizada'), '34259').filter((e) => e.eventType === 'goal');
    for (const g of goles) {
      expect(g.playerName, 'gol sin goleador').toBeTruthy();
      expect(g.period).toBeGreaterThanOrEqual(1);
      expect(g.clock).toMatch(/^\d{2}:\d{2}$/);
      expect(typeof g.isHome).toBe('boolean');
    }
  });

  it('convierte el crono restante en minuto transcurrido', () => {
    // La fuente cuenta ATRÁS desde 25:00 por periodo: 20:46 restante en P1 = minuto 5.
    const g = parseFicha(load('acta-live-p1'), '34259')
      .find((e) => e.eventType === 'goal' && e.clock === '20:46');
    expect(g?.minute).toBe(5);
  });
});

describe('source_ref estable entre capturas', () => {
  /**
   * La regresión que motivó la migración 035.
   *
   * El acta se ordena de más nuevo a más viejo, así que con refs posicionales
   * (`fep_event_{idp}_{rowIdx}`) cada incidencia nueva desplazaba a todas las
   * anteriores: el mismo gol era `_0`, luego `_12`, luego `_33`. Eso rompe el
   * upsert por source_ref y hace que el push re-notifique goles ya avisados.
   *
   * Identificamos cada evento por su contenido observable y exigimos que su
   * `sourceRef` no cambie entre las tres capturas del mismo partido.
   */
  const identidad = (e: { period: number | undefined; clock: string | undefined; eventType: string; playerName: string | undefined }) =>
    `${e.period}|${e.clock}|${e.eventType}|${e.playerName ?? '-'}`;

  it('el mismo evento conserva su ref en las tres capturas del partido', () => {
    const capturas = ['acta-live-p1', 'acta-live-p2', 'acta-finalizada']
      .map((n) => parseFicha(load(n), '34259'));

    const refsPorEvento = new Map<string, Set<string>>();
    for (const eventos of capturas) {
      for (const e of eventos) {
        const k = identidad(e);
        if (!refsPorEvento.has(k)) refsPorEvento.set(k, new Set());
        refsPorEvento.get(k)!.add(e.sourceRef);
      }
    }

    const comunes = [...refsPorEvento.entries()].filter(([, refs]) => refs.size > 0);
    const inestables = comunes.filter(([, refs]) => refs.size > 1);

    expect(inestables.map(([k]) => k)).toEqual([]);
    // Y que la comparación no sea vacua: tiene que haber eventos compartidos.
    expect(comunes.length).toBeGreaterThan(15);
  });

  it('las refs son únicas dentro de cada acta', () => {
    for (const [name, idp] of [['acta-live-p1', '34259'], ['acta-live-p2', '34259'],
                               ['acta-finalizada', '34259'], ['acta-playoff', '34277']] as const) {
      const events = parseFicha(load(name), idp);
      const refs = new Set(events.map((e) => e.sourceRef));
      expect(refs.size, `refs duplicadas en ${name}`).toBe(events.length);
    }
  });

  it('la ref no contiene la posición de la fila', () => {
    const events = parseFicha(load('acta-live-p2'), '34259');
    // Formato esperado: fep_event_{idp}_p{periodo}_{crono}_{tipo}_{lado}
    for (const e of events) {
      expect(e.sourceRef).toMatch(/^fep_event_34259_p\d+_\d{4}_[a-z_]+_[HAx]$/);
    }
  });
});

describe('eventSourceRef', () => {
  const base = { idp: '999', eventType: 'goal' as const, fallbackIdx: 7 };

  it('deriva la ref del contenido', () => {
    expect(eventSourceRef({ ...base, period: 1, clock: '20:46', isHome: true }))
      .toBe('fep_event_999_p1_2046_goal_H');
  });

  it('distingue el lado', () => {
    const local = eventSourceRef({ ...base, period: 2, clock: '10:00', isHome: true });
    const visitante = eventSourceRef({ ...base, period: 2, clock: '10:00', isHome: false });
    expect(local).not.toBe(visitante);
  });

  it('marca el lado desconocido sin colisionar con local ni visitante', () => {
    const refs = [true, false, null].map((isHome) =>
      eventSourceRef({ ...base, period: 1, clock: '05:00', isHome }));
    expect(new Set(refs).size).toBe(3);
  });

  it('cae a la posición sólo si falta periodo o crono', () => {
    expect(eventSourceRef({ ...base, period: undefined, clock: '20:46', isHome: true }))
      .toBe('fep_event_999_row7');
    expect(eventSourceRef({ ...base, period: 1, clock: undefined, isHome: true }))
      .toBe('fep_event_999_row7');
  });
});

describe('parseLiveHeader', () => {
  it('lee periodo y crono de un acta en directo', () => {
    expect(parseLiveHeader(load('acta-live-p1')))
      .toEqual({ period: 1, clockSeconds: 1246, isHalftime: false });
  });

  it('detecta el cambio de periodo', () => {
    expect(parseLiveHeader(load('acta-live-p2'))?.period).toBe(2);
  });

  it('en un acta ya cerrada no hay periodo ni crono en marcha', () => {
    expect(parseLiveHeader(load('acta-finalizada'))?.period).toBeNull();
  });
});

describe('parseTeamFouls', () => {
  it('lee el contador de faltas de cada equipo', () => {
    expect(parseTeamFouls(load('acta-live-p1'))).toEqual({ home: 2, away: 2 });
    expect(parseTeamFouls(load('acta-finalizada'))).toEqual({ home: 10, away: 13 });
  });

  it('las faltas crecen a lo largo del partido', () => {
    const p1 = parseTeamFouls(load('acta-live-p1'))!;
    const fin = parseTeamFouls(load('acta-finalizada'))!;
    expect(fin.home).toBeGreaterThan(p1.home);
    expect(fin.away).toBeGreaterThan(p1.away);
  });
});

describe('parseLineups', () => {
  it('extrae las dos alineaciones completas', () => {
    const lineups = parseLineups(load('acta-finalizada'), '34259');
    expect(lineups).toHaveLength(30);
    expect(lineups.filter((l) => l.isHome)).toHaveLength(15);
    expect(lineups.filter((l) => !l.isHome)).toHaveLength(15);
  });

  it('cada jugador trae nombre', () => {
    for (const l of parseLineups(load('acta-finalizada'), '34259')) {
      expect(l.playerName).toBeTruthy();
    }
  });
});

describe('helpers', () => {
  it('remainingToElapsedMinute convierte la cuenta atrás', () => {
    // OJO: el minuto es RELATIVO AL PERIODO (1..25), no absoluto del partido.
    // El consumidor muestra periodo y minuto juntos ("P2 05'").
    expect(remainingToElapsedMinute('20:46', 1)).toBe(5);
    expect(remainingToElapsedMinute('12:04', 1)).toBe(13);
    expect(remainingToElapsedMinute('01:06', 1)).toBe(24);
    expect(remainingToElapsedMinute('00:00', 1)).toBe(25);
    // Convención deportiva: el arranque es el minuto 1', no el 0'.
    expect(remainingToElapsedMinute('25:00', 1)).toBe(1);
    // El periodo 2 vuelve a contar desde 1: NO acumula los 25 del primero.
    expect(remainingToElapsedMinute('20:46', 2)).toBe(5);
  });

  it('mapIncidenciaType traduce las etiquetas de la fuente', () => {
    expect(mapIncidenciaType('GOL')).toBe('goal');
    expect(mapIncidenciaType('TARJETA AZUL')).toBe('blue_card');
    expect(mapIncidenciaType('TARJETA ROJA')).toBe('red_card');
    expect(mapIncidenciaType('TIEMPO MUERTO')).toBe('timeout');
    // FALTA DIRECTA debe ganar a FALTA genérica.
    expect(mapIncidenciaType('FALTA DIRECTA')).toBe('direct_foul');
    expect(mapIncidenciaType('FALTA')).toBe('foul');
    // Sin equivalente en el esquema.
    expect(mapIncidenciaType('AMONESTACIÓN VERBAL')).toBeNull();
  });

  it('normalizeName ignora acentos y símbolos al comparar equipos', () => {
    expect(normalizeName('C.P. Vilanova')).toBe('CP VILANOVA');
    expect(normalizeName('  Igualada   HC  ')).toBe('IGUALADA HC');
  });
});

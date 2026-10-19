import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFicha, parseLiveHeader, parseTeamFouls, parseLineups, eventSourceRef,
  disambiguateEventRefs,
  remainingToElapsedMinute, mapIncidenciaType, normalizeName, splitPlayerName,
  type ScrapedMatchEvent,
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

describe('penaltis y faltas directas: lanzador y resultado del acta (C1)', () => {
  /**
   * La fila de un penalti o una falta directa trae dos enlaces de jugador: el
   * primero vacío (id_player="0") y, tras "Al Lanzamiento ...", el lanzador con
   * su id en el atributo `id`. Debajo, el resultado explícito: "GOL" o "NO HAY
   * GOL". Auditado contra las 268 acciones de OK Liga Plata Sur 2025/26: el
   * parser perdía al lanzador en 186 de 189 fallos (solo lo recuperaba del gol)
   * y daba por marcadas 3 faltas directas falladas que coincidían en el mismo
   * segundo con otro gol del mismo equipo.
   */
  const setPieces = (html: string, idp = '34259') =>
    parseFicha(html, idp).filter((e) => e.eventType === 'direct_foul' || e.eventType === 'penalty');

  it('el lanzador de una falta directa fallada se lee del acta', () => {
    const [fd1, fd2] = setPieces(load('acta-finalizada'));
    expect(fd1).toMatchObject({ detail: 'fallada', playerName: 'XAUS MOLINARI ARNAU', playerSourceRef: 'fep_player_4775', playerTeamRef: '3373' });
    expect(fd2?.detail).toBe('fallada');
    expect(fd2?.playerName).toMatch(/^LLANES GALITO/);
    expect(fd2?.playerSourceRef).toMatch(/^fep_player_\d+$/);
  });

  it('el lanzador de un penalti fallado se lee del acta (World Skate)', () => {
    const [pen] = parseFicha(load('acta-wse-finalizada'), '3095', { eventPrefix: 'wse_event_' })
      .filter((e) => e.eventType === 'penalty');
    expect(pen).toMatchObject({ detail: 'fallado', playerName: 'PACZIA LEON', playerSourceRef: 'fep_player_7747' });
  });

  it('"NO HAY GOL" manda aunque haya otro gol del mismo equipo en el mismo segundo', () => {
    // Un gol del Liceo (HCL) movido al instante exacto de su falta directa (P2 06:56).
    const html = load('acta-finalizada');
    const rows = html.split('<tr');
    const goalIdx = rows.findIndex((r) => r.includes('game_view_indcidencias_period') && r.includes('21:04') && r.includes('HCL'));
    expect(goalIdx).toBeGreaterThan(0);
    const moved = rows[goalIdx]!.replace('21:04', '06:56').replace('>P1<', '>P2<');
    const withGoal = [...rows.slice(0, goalIdx), moved, ...rows.slice(goalIdx + 1)].join('<tr');
    const [fd] = setPieces(withGoal);
    expect(fd?.clock).toBe('06:56');
    expect(fd?.detail).toBe('fallada');
    expect(fd?.playerName).toBe('XAUS MOLINARI ARNAU');
  });

  it('"GOL" explícito da la falta directa por marcada', () => {
    const html = load('acta-finalizada').replace(
      /(FALTA DIRECTA PARA[\s\S]*?XAUS MOLINARI[\s\S]*?lang_es'>)NO HAY GOL/,
      '$1GOL',
    );
    const [fd1, fd2] = setPieces(html);
    expect(fd1?.detail).toBe('marcada');
    expect(fd2?.detail).toBe('fallada');
  });
});

describe('nombre y apellidos del jugador (C1)', () => {
  /**
   * El acta marca el nombre de pila con su propio span: "PASCUAL <span>MATÍAS
   * JOSÉ</span>". Partir por la última palabra daba "JOSÉ" / "PASCUAL MATÍAS".
   * En OK Liga Plata Sur 2025/26, 8 de 137 jugadores con eventos tenían el
   * nombre compuesto mal repartido ("GABRIEL" / "FERNANDEZ DELGADO JUAN").
   */
  it('con el nombre de pila del acta, reparte exacto', () => {
    expect(splitPlayerName('PASCUAL MATÍAS JOSÉ', 'MATÍAS JOSÉ')).toEqual({ firstName: 'MATÍAS JOSÉ', lastName: 'PASCUAL' });
    expect(splitPlayerName('FERNANDEZ DELGADO JUAN GABRIEL', 'JUAN GABRIEL'))
      .toEqual({ firstName: 'JUAN GABRIEL', lastName: 'FERNANDEZ DELGADO' });
  });

  it('sin él, la última palabra es el nombre (comportamiento anterior)', () => {
    expect(splitPlayerName('FONT SÁNCHEZ FERRAN')).toEqual({ firstName: 'FERRAN', lastName: 'FONT SÁNCHEZ' });
    expect(splitPlayerName('PELÉ')).toEqual({ firstName: 'PELÉ', lastName: 'PELÉ' });
  });

  it('un nombre de pila que no cierra el nombre completo se ignora', () => {
    expect(splitPlayerName('FONT SÁNCHEZ FERRAN', 'JORDI')).toEqual({ firstName: 'FERRAN', lastName: 'FONT SÁNCHEZ' });
    expect(splitPlayerName('FERRAN', 'FERRAN')).toEqual({ firstName: 'FERRAN', lastName: 'FERRAN' });
  });

  it('los goles traen el nombre de pila del acta', () => {
    const gol = parseFicha(load('acta-finalizada'), '34259')
      .find((e) => e.eventType === 'goal' && e.playerName?.startsWith('PASCUAL'));
    expect(gol).toMatchObject({ playerName: 'PASCUAL MATÍAS JOSÉ', playerFirstName: 'MATÍAS JOSÉ' });
  });

  it('el lanzador de una falta directa también', () => {
    const fd = parseFicha(load('acta-finalizada'), '34259').find((e) => e.eventType === 'direct_foul');
    expect(fd?.playerFirstName).toBe('ARNAU');
  });

  it('las alineaciones traen el nombre de pila del acta', () => {
    const l = parseLineups(load('acta-finalizada'), '34259').find((x) => x.playerName.startsWith('PASCUAL'));
    expect(l).toMatchObject({ playerName: 'PASCUAL MATÍAS JOSÉ', playerFirstName: 'MATÍAS JOSÉ' });
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
  const identidad = (e: ScrapedMatchEvent) =>
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
    // Formato esperado: fep_event_{idp}_p{periodo|x}_{crono}_{tipo}_{lado}
    for (const e of events) {
      expect(e.sourceRef).toMatch(/^fep_event_34259_p(\d+|x)_\d{4}_[a-z_]+_[HAx]$/);
    }
  });

  it('ningún evento de un acta real cae al fallback posicional', () => {
    // `eventSourceRef` sólo cae a la posición si no hay crono NI ningún otro
    // contenido (periodo/minuto/lado). En las actas reales eso no pasa nunca
    // (105 eventos, 0 fallbacks), pero si la fuente dejara de publicar el crono
    // podríamos degradar a refs inestables EN SILENCIO: volverían las
    // notificaciones duplicadas sin que nada fallara. Este test convierte esa
    // degradación en un fallo visible.
    for (const [name, idp] of [['acta-live-p1', '34259'], ['acta-live-p2', '34259'],
                               ['acta-finalizada', '34259'], ['acta-playoff', '34277']] as const) {
      const events = parseFicha(load(name), idp);
      const posicionales = events.filter((e) => /_row\d+$/.test(e.sourceRef));
      expect(posicionales, `${name}: eventos sin crono`).toEqual([]);

      // Y la causa raíz, por si el formato de la ref cambiara algún día.
      expect(events.every((e) => !!e.clock), `${name}: falta el crono`).toBe(true);
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

  it('sin crono deriva del contenido (periodo/momento) en vez de la posición', () => {
    // La posición en el acta es inestable (el acta crece por arriba); si hay
    // algo de contenido —periodo o lado— la ref se deriva de ahí.
    expect(eventSourceRef({ ...base, period: 1, clock: undefined, isHome: true }))
      .toBe('fep_event_999_nc_p1_mx_goal_H');
  });

  it('sin crono usa el minuto cuando está disponible', () => {
    expect(eventSourceRef({ ...base, period: 2, clock: undefined, minute: 5, isHome: true }))
      .toBe('fep_event_999_nc_p2_m5_goal_H');
  });

  it('sin crono ni contenido cae a la posición como último recurso', () => {
    expect(eventSourceRef({ ...base, period: undefined, clock: undefined, isHome: null }))
      .toBe('fep_event_999_row7');
  });

  it('sin periodo pero con crono sigue derivando del contenido', () => {
    // Caso real en producción: un evento con crono 00:15 y sin periodo. Exigir
    // ambos lo mandaba a una ref posicional, inestable entre scrapes.
    expect(eventSourceRef({ ...base, period: undefined, clock: '00:15', isHome: false }))
      .toBe('fep_event_999_px_0015_goal_A');
  });

  it('un periodo desconocido no colisiona con uno conocido', () => {
    const conocido = eventSourceRef({ ...base, period: 1, clock: '00:15', isHome: true });
    const desconocido = eventSourceRef({ ...base, period: undefined, clock: '00:15', isHome: true });
    expect(conocido).not.toBe(desconocido);
  });
});

/**
 * #375 P3-2: dos incidencias distintas pueden compartir (periodo, crono, tipo,
 * lado) —clave de la ref de contenido— y entonces el Map de dedup del upsert
 * conservaba una y perdía la otra en silencio. El parser añade un sufijo de
 * contenido (jugador, dorsal, detalle) SÓLO a los grupos que colisionan, para
 * que la ref siga siendo única y estable entre capturas.
 */
describe('desambiguación de colisiones de identidad (#375 P3-2)', () => {
  const filaFalta = (nombre: string, dorsal: number) => `
    <tr>
      <td><div class="game_view_indcidencias_period">P1</div><div class="game_view_incidencias_time">10:00</div></td>
      <td class="stats_table"><div class="texto_gris_11">IHC</div></td>
      <td>
        <div class="evento_negativo"><span class="lang_es">FALTA</span> IGUALADA RIGAT HC</div>
        <a class="nombre_ficha_jugador_plus" team_id="3408">${nombre}</a>
        <div class="game_view_incidencias_dorsal">${dorsal}</div>
      </td>
    </tr>`;

  const dosFaltas = (primera: string, segunda: string) => `
    <div class="nombre1">IGUALADA RIGAT HC</div>
    <table>${primera}${segunda}</table>`;

  it('dos eventos con la misma ref base reciben refs distintas', () => {
    const events = parseFicha(
      dosFaltas(filaFalta('JUGADOR UNO', 7), filaFalta('JUGADOR DOS', 9)),
      'TEST',
    ).filter((e) => e.eventType === 'foul');

    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.sourceRef)).size).toBe(2);
    // La ref sigue siendo reconocible como la de contenido.
    for (const e of events) {
      expect(e.sourceRef).toMatch(/^fep_event_TEST_p1_1000_foul_H_/);
    }
  });

  it('la ref de cada jugador no depende del orden del acta', () => {
    const refPorJugador = (html: string) =>
      new Map(
        parseFicha(html, 'TEST')
          .filter((e) => e.eventType === 'foul')
          .map((e) => [e.playerName, e.sourceRef]),
      );

    const unoDos = refPorJugador(dosFaltas(filaFalta('JUGADOR UNO', 7), filaFalta('JUGADOR DOS', 9)));
    const dosUno = refPorJugador(dosFaltas(filaFalta('JUGADOR DOS', 9), filaFalta('JUGADOR UNO', 7)));
    expect(unoDos).toEqual(dosUno);
  });

  it('no toca las refs de eventos sin colisión (compatibilidad con la 035)', () => {
    for (const [name, idp] of [['acta-live-p1', '34259'], ['acta-live-p2', '34259'],
                               ['acta-finalizada', '34259'], ['acta-playoff', '34277']] as const) {
      const events = parseFicha(load(name), idp);
      const antes = events.map((e) => e.sourceRef);
      disambiguateEventRefs(events);
      expect(events.map((e) => e.sourceRef), name).toEqual(antes);
    }
  });

  it('con contenido idéntico desempata con un ordinal determinista', () => {
    const ev = (): ScrapedMatchEvent => ({
      eventType: 'foul', minute: 5, period: 1, isHome: true,
      playerName: null, jerseyNumber: null, detail: null,
      sourceRef: 'fep_event_X_p1_1000_foul_H',
    });
    const a = [ev(), ev()];
    disambiguateEventRefs(a);
    expect(new Set(a.map((e) => e.sourceRef)).size).toBe(2);
  });
});

describe('parseLiveHeader', () => {
  it('lee periodo y crono de un acta en directo', () => {
    expect(parseLiveHeader(load('acta-live-p1')))
      .toEqual({ period: 1, clockSeconds: 1246, isHalftime: false, ended: false });
  });

  it('señal EXPLÍCITA de fin: #game_period.periodo_fin ("FINALIZADO") en actas reales FEP y WSE', () => {
    expect(parseLiveHeader(load('acta-finalizada'))?.ended).toBe(true);
    expect(parseLiveHeader(load('acta-playoff'))?.ended).toBe(true);
    expect(parseLiveHeader(load('acta-wse-finalizada'))?.ended).toBe(true);
    expect(parseLiveHeader(load('acta-live-p2'))?.ended).toBe(false);
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

describe('eventSourceRef por fuente', () => {
  const base = { idp: '3095', eventType: 'goal' as const, fallbackIdx: 2, period: 2, clock: '01:59', isHome: true };

  it('sin prefijo usa el histórico de la FEP', () => {
    // Los eventos de la FEP ya cargados llevan `fep_event_`; cambiarlo
    // reescribiría sus refs y con ellos los ids que estabilizó la 035.
    expect(eventSourceRef(base)).toBe('fep_event_3095_p2_0159_goal_H');
  });

  it('cada fuente lleva el suyo', () => {
    expect(eventSourceRef({ ...base, prefix: 'wse_event_' }))
      .toBe('wse_event_3095_p2_0159_goal_H');
  });

  it('el fallback sin crono también respeta el prefijo', () => {
    expect(eventSourceRef({ ...base, clock: undefined, prefix: 'wse_event_' }))
      .toBe('wse_event_3095_nc_p2_mx_goal_H');
  });

  it('el fallback posicional (sin contenido) también respeta el prefijo', () => {
    expect(eventSourceRef({ ...base, period: undefined, clock: undefined, isHome: null, prefix: 'wse_event_' }))
      .toBe('wse_event_3095_row2');
  });

  it('dos fuentes con el mismo idp no colisionan', () => {
    const fep = eventSourceRef(base);
    const wse = eventSourceRef({ ...base, prefix: 'wse_event_' });
    expect(fep).not.toBe(wse);
  });
});

describe('parseLineups — acta de World Skate (selecciones)', () => {
  /**
   * El acta del Europeo Sub-17 tiene la MISMA estructura que la de la FEP, pero
   * los nombres vienen sin prefijo de licencia federativa: "FAILLA ALESSANDRO"
   * en vez de "OKM - PASCUAL MATÍAS". El parser exigía ese " - " para dar por
   * buena la celda del nombre, así que descartaba a todos los jugadores y sólo
   * guardaba el cuerpo técnico: 8 filas en vez de 28.
   */
  const wse = () => parseLineups(load('acta-wse-finalizada'), '3095');

  it('extrae las dos plantillas completas, no sólo el cuerpo técnico', () => {
    const filas = wse();
    const jugadores = filas.filter((l) => !l.role);
    const staff = filas.filter((l) => l.role);

    expect(jugadores).toHaveLength(20);
    expect(staff).toHaveLength(8);
    expect(filas).toHaveLength(28);
  });

  it('diez jugadores por selección', () => {
    const jugadores = wse().filter((l) => !l.role);
    expect(jugadores.filter((l) => l.isHome)).toHaveLength(10);
    expect(jugadores.filter((l) => !l.isHome)).toHaveLength(10);
  });

  it('los nombres llegan limpios y con dorsal', () => {
    for (const j of wse().filter((l) => !l.role)) {
      expect(j.playerName.length).toBeGreaterThan(3);
      expect(j.jerseyNumber).toBeGreaterThan(0);
      // Sin prefijo de licencia: en selecciones no existe.
      expect(j.playerName).not.toMatch(/^[A-Z]{2,4}\s*-\s/);
    }
  });

  it('marca porteros, capitanes y cinco inicial', () => {
    const jugadores = wse().filter((l) => !l.role);
    expect(jugadores.filter((l) => l.isGoalkeeper).length).toBeGreaterThanOrEqual(2);
    expect(jugadores.filter((l) => l.isCaptain).length).toBeGreaterThanOrEqual(2);
    expect(jugadores.filter((l) => l.isStarter).length).toBeGreaterThanOrEqual(10);
  });

  it('los goles de los jugadores cuadran con el 4-0 del marcador', () => {
    // Comprobación cruzada: si el parseo de la columna G se desalineara, esto
    // deja de cuadrar aunque el número de filas siga siendo correcto.
    const jugadores = wse().filter((l) => !l.role);
    const golesLocal = jugadores.filter((l) => l.isHome).reduce((s, l) => s + (l.goals ?? 0), 0);
    const golesVisitante = jugadores.filter((l) => !l.isHome).reduce((s, l) => s + (l.goals ?? 0), 0);
    expect(golesLocal).toBe(4);
    expect(golesVisitante).toBe(0);
  });

  it('#219: la alineación captura la ref del acta (id_player) para el vínculo exacto', () => {
    const jugadores = wse().filter((l) => !l.role);
    // El fixture trae id_player en las celdas de nombre de las tablas de
    // alineación (mismo ancla nombre_ficha_jugador_plus que las incidencias).
    const conRef = jugadores.filter((l) => l.playerSourceRef);
    expect(conRef.length).toBeGreaterThan(0);
    for (const l of conRef) {
      expect(l.playerSourceRef).toMatch(/^fep_player_\d+$/);
    }
    // Los cuerpos técnicos no llevan vínculo de jugador.
    for (const st of wse().filter((l) => l.role)) {
      expect(st.playerSourceRef).toBeUndefined();
    }
  });

  it('el acta de World Skate también da eventos', () => {
    const eventos = parseFicha(load('acta-wse-finalizada'), '3095', { eventPrefix: 'wse_event_' });
    expect(eventos).toHaveLength(25);
    expect(eventos.filter((e) => e.eventType === 'goal')).toHaveLength(4);
    expect(eventos.every((e) => e.sourceRef.startsWith('wse_event_'))).toBe(true);
  });
});

describe('parseLineups — la FEP no cambia', () => {
  it('sigue dando las plantillas completas con prefijo de licencia limpiado', () => {
    for (const [name, total] of [['acta-finalizada', 30], ['acta-playoff', 31],
                                 ['acta-live-p1', 30], ['acta-live-p2', 30]] as const) {
      const filas = parseLineups(load(name), '34259');
      expect(filas, name).toHaveLength(total);
      expect(filas.filter((l) => !l.role), `${name}: jugadores`).toHaveLength(20);
      for (const j of filas.filter((l) => !l.role)) {
        expect(j.playerName, `${name}: prefijo sin limpiar`).not.toMatch(/^[A-Z]{2,4}\s*-\s/);
      }
    }
  });
});

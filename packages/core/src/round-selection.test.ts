import { describe, expect, it } from 'vitest';
import type { SeasonMatch, SeasonRound } from './api';
import { defaultRoundSelection, isKnockoutRound, isKnockoutStage, matchesOfSelection, parseRoundSelection, roundLabel, roundSelection, roundSelectionKey, selectableRounds, stageLabel, type RoundItem } from './round-selection';

describe('round-selection (origen web)', () => {
  /**
   * Jornadas con rondas eliminatorias (spec 2026-10-16): las rondas con `stage`
   * de la fuente (cuartos, semis, final, 3.º y 4.º, colocación) entran en el
   * selector detrás de las jornadas y se identifican por id (`?round=`), no por
   * número: el número legado (1=cuartos, 2=semis…) chocaba con las jornadas.
   */

  /** ISO a mediodía UTC: el día de Madrid no depende del horario de verano. */
  const iso = (day: string) => `${day}T12:00:00.000Z`;

  function round(id: string, number: number, over: Partial<SeasonRound> = {}): SeasonRound {
    return { id, number, name: null, roundType: 'regular', ...over };
  }
  const ko = (id: string, number: number, stage: SeasonRound['stage'], name: string | null = null) =>
    round(id, number, { roundType: 'playoff', stage, name });

  let n = 0;
  function match(over: Partial<SeasonMatch> = {}): SeasonMatch {
    return {
      id: `m${++n}`,
      status: 'scheduled',
      scheduledAt: null,
      startedAt: null,
      finishedAt: null,
      score: { home: null, away: null },
      venueName: null,
      roundId: null,
      roundNumber: null,
      roundName: null,
      roundType: 'regular',
      homeTeam: { id: 'h', name: 'Local', shortName: 'LOC', logoUrl: null },
      awayTeam: { id: 'a', name: 'Visitante', shortName: 'VIS', logoUrl: null },
      ...over,
    };
  }

  // Mundial WSG Asunción 2026, tal y como lo devuelve la API el 16/10.
  const J1 = round('j1', 1), J2 = round('j2', 2), J3 = round('j3', 3);
  const P58 = ko('p58', 74, 'placement', 'Puestos 5º-8º');
  const P56 = ko('p56', 75, 'placement', 'Puestos 5º-6º');
  const QF = ko('qf', 90, 'quarters', 'Cuartos de final');
  const SF = ko('sf', 95, 'semis', 'Semifinal');
  const TP = ko('tp', 98, 'third_place', '3º y 4º puesto');
  const FI = ko('fi', 99, 'final', 'Final');
  const ROUNDS = [J1, J2, J3, P58, P56, QF, SF, TP, FI];
  const MATCHES = [
    match({ roundId: 'j1', roundNumber: 1, scheduledAt: iso('2026-10-12'), status: 'finished' }),
    match({ roundId: 'j2', roundNumber: 2, scheduledAt: iso('2026-10-13'), status: 'finished' }),
    match({ roundId: 'j3', roundNumber: 3, scheduledAt: iso('2026-10-14'), status: 'finished' }),
    // Legado: el roundNumber de una eliminatoria es 1/2/3 (choca con las jornadas).
    match({ roundId: 'qf', roundNumber: 1, roundType: 'playoff', stage: 'quarters', scheduledAt: iso('2026-10-15'), status: 'finished' }),
    match({ roundId: 'sf', roundNumber: 2, roundType: 'playoff', stage: 'semis', scheduledAt: iso('2026-10-16') }),
    match({ roundId: 'p58', roundNumber: 0, roundType: 'playoff', stage: 'placement', scheduledAt: iso('2026-10-16') }),
  ];

  describe('selectableRounds', () => {
    it('jornadas por número y después las eliminatorias por fecha y, sin fecha, por fase', () => {
      expect(selectableRounds(ROUNDS, MATCHES).map((r) => r.id))
        .toEqual(['j1', 'j2', 'j3', 'qf', 'sf', 'p58', 'tp', 'fi', 'p56']);
    });

    it('deja fuera las rondas eliminatorias heredadas sin stage (como hasta ahora)', () => {
      const legacy = round('old', 1, { roundType: 'playoff', stage: null, name: 'Cuartos' });
      expect(selectableRounds([J1, legacy], [match({ roundId: 'old', roundType: 'playoff' })]).map((r) => r.id))
        .toEqual(['j1']);
    });

    it('una copa o amistoso con partidos sigue entrando tras las jornadas', () => {
      const cup = round('cup', 1, { roundType: 'cup' });
      expect(selectableRounds([cup, J1], [match({ roundId: 'cup' })]).map((r) => r.id)).toEqual(['j1', 'cup']);
    });
  });

  describe('roundSelection / clave / URL', () => {
    it('jornada por número, eliminatoria por id', () => {
      expect(roundSelection(J2)).toEqual({ kind: 'journey', n: 2 });
      expect(roundSelection(SF)).toEqual({ kind: 'round', id: 'sf' });
      expect(roundSelectionKey({ kind: 'journey', n: 2 })).toBe('j:2');
      expect(roundSelectionKey({ kind: 'round', id: 'sf' })).toBe('r:sf');
    });

    it('?round= de una ronda seleccionable manda sobre ?journey=', () => {
      const sel = selectableRounds(ROUNDS, MATCHES);
      expect(parseRoundSelection('3', 'sf', sel)).toEqual({ kind: 'round', id: 'sf' });
      expect(parseRoundSelection('3', null, sel)).toEqual({ kind: 'journey', n: 3 });
    });

    it('valores que no existen se ignoran (enlace viejo o manipulado)', () => {
      const sel = selectableRounds(ROUNDS, MATCHES);
      expect(parseRoundSelection(null, 'nope', sel)).toBeNull();
      expect(parseRoundSelection('abc', null, sel)).toBeNull();
      expect(parseRoundSelection(null, null, sel)).toBeNull();
    });
  });

  describe('matchesOfSelection', () => {
    it('jornada 1 NO incluye los cuartos aunque su roundNumber legado sea 1', () => {
      const ms = matchesOfSelection(MATCHES, { kind: 'journey', n: 1 });
      expect(ms.map((m) => m.roundId)).toEqual(['j1']);
    });

    it('una eliminatoria se filtra por el id de su ronda', () => {
      expect(matchesOfSelection(MATCHES, { kind: 'round', id: 'sf' }).map((m) => m.roundId)).toEqual(['sf']);
      expect(matchesOfSelection(MATCHES, { kind: 'round', id: 'fi' })).toEqual([]);
    });
  });

  describe('defaultRoundSelection', () => {
    it('durante la fase final abre en la eliminatoria más cercana a hoy', () => {
      const sel = selectableRounds(ROUNDS, MATCHES);
      expect(defaultRoundSelection(sel, MATCHES, '2026-10-16')).toEqual({ kind: 'round', id: 'sf' });
    });

    it('mismo día que unos cuartos ya jugados (madrugada): manda la ronda pendiente', () => {
      const qfLate = match({ roundId: 'qf', roundNumber: 1, roundType: 'playoff', stage: 'quarters', scheduledAt: iso('2026-10-16'), status: 'finished' });
      const sel = selectableRounds(ROUNDS, [...MATCHES, qfLate]);
      expect(defaultRoundSelection(sel, [qfLate, ...MATCHES], '2026-10-16')).toEqual({ kind: 'round', id: 'sf' });
    });

    it('en la fase de grupos abre en la jornada más cercana', () => {
      const sel = selectableRounds(ROUNDS, MATCHES);
      expect(defaultRoundSelection(sel, MATCHES, '2026-10-13')).toEqual({ kind: 'journey', n: 2 });
    });

    it('sin fechas: la primera ronda con partidos; sin nada, la primera ronda o null', () => {
      const noDates = [match({ roundId: 'j2', roundNumber: 2 })];
      expect(defaultRoundSelection([J1, J2], noDates, '2026-10-16')).toEqual({ kind: 'journey', n: 2 });
      expect(defaultRoundSelection([J1], [], '2026-10-16')).toEqual({ kind: 'journey', n: 1 });
      expect(defaultRoundSelection([], [], '2026-10-16')).toBeNull();
    });

    it('ignora partidos de rondas que no están en el selector (heredadas)', () => {
      const legacy = match({ roundId: 'old', roundType: 'playoff', scheduledAt: iso('2026-10-16') });
      const jornada = match({ roundId: 'j3', roundNumber: 3, scheduledAt: iso('2026-10-10') });
      expect(defaultRoundSelection([J3], [legacy, jornada], '2026-10-16')).toEqual({ kind: 'journey', n: 3 });
    });
  });
});

describe('round-selection (origen app)', () => {
  const iso = (day: string) => `${day}T12:00:00.000Z`;

  function round(id: string, number: number, over: Partial<RoundItem> = {}): RoundItem {
    return { id, number, name: null, roundType: 'regular', ...over };
  }

  const ko = (id: string, number: number, stage: RoundItem['stage'], name: string | null = null) =>
    round(id, number, { roundType: 'playoff', stage, name });

  let n = 0;
  function match(over: Partial<SeasonMatch> = {}): SeasonMatch {
    return {
      id: `m${++n}`,
      status: 'scheduled',
      competitionTimezone: 'Europe/Madrid',
      scheduledAt: null,
      startedAt: null,
      finishedAt: null,
      score: { home: null, away: null },
      winnerTeamId: null,
      winType: null,
      penalties: null,
      venueName: null,
      roundId: null,
      groupName: null,
      phaseId: null,
      stage: null,
      seriesGame: null,
      roundNumber: null,
      roundName: null,
      roundType: 'regular',
      homeTeam: { id: 'h', name: 'Local', shortName: 'LOC', logoUrl: null },
      awayTeam: { id: 'a', name: 'Visitante', shortName: 'VIS', logoUrl: null },
      ...over,
    };
  }

  const J1 = round('j1', 1);
  const J2 = round('j2', 2);
  const J3 = round('j3', 3);
  const P58 = ko('p58', 74, 'placement', 'Puestos 5º-8º');
  const P56 = ko('p56', 75, 'placement', 'Puestos 5º-6º');
  const QF = ko('qf', 90, 'quarters', 'Cuartos de final');
  const SF = ko('sf', 95, 'semis', 'Semifinal');
  const TP = ko('tp', 98, 'third_place', '3º y 4º puesto');
  const FI = ko('fi', 99, 'final', 'Final');
  const ROUNDS = [J1, J2, J3, P58, P56, QF, SF, TP, FI];

  const MATCHES = [
    match({ roundId: 'j1', roundNumber: 1, scheduledAt: iso('2026-10-12'), status: 'finished' }),
    match({ roundId: 'j2', roundNumber: 2, scheduledAt: iso('2026-10-13'), status: 'finished' }),
    match({ roundId: 'j3', roundNumber: 3, scheduledAt: iso('2026-10-14'), status: 'finished' }),
    match({
      roundId: 'qf',
      roundNumber: 1,
      roundType: 'playoff',
      stage: 'quarters',
      scheduledAt: iso('2026-10-15'),
      status: 'finished',
    }),
    match({ roundId: 'sf', roundNumber: 2, roundType: 'playoff', stage: 'semis', scheduledAt: iso('2026-10-16') }),
    match({ roundId: 'p58', roundNumber: 0, roundType: 'playoff', stage: 'placement', scheduledAt: iso('2026-10-16') }),
  ];

  describe('selectableRounds', () => {
    it('ordena jornadas por número y luego eliminatorias por fecha de primer partido', () => {
      expect(selectableRounds(ROUNDS, MATCHES).map((r) => r.id)).toEqual([
        'j1',
        'j2',
        'j3',
        'qf',
        'sf',
        'p58',
        'tp',
        'fi',
        'p56',
      ]);
    });

    it('excluye rondas playoff heredadas sin stage', () => {
      const legacy = round('old', 1, { roundType: 'playoff', stage: null, name: 'Cuartos' });
      expect(selectableRounds([J1, legacy], [match({ roundId: 'old', roundType: 'playoff' })]).map((r) => r.id)).toEqual([
        'j1',
      ]);
    });

    it('incluye rondas de copa o torneo con partidos tras las jornadas regulares', () => {
      const cup = round('cup', 1, { roundType: 'cup' });
      expect(selectableRounds([cup, J1], [match({ roundId: 'cup' })]).map((r) => r.id)).toEqual(['j1', 'cup']);
    });
  });

  describe('roundSelection / claves', () => {
    it('jornada genera { kind: journey, n } y eliminatoria genera { kind: round, id }', () => {
      expect(roundSelection(J2)).toEqual({ kind: 'journey', n: 2 });
      expect(roundSelection(SF)).toEqual({ kind: 'round', id: 'sf' });
      expect(roundSelectionKey({ kind: 'journey', n: 2 })).toBe('j:2');
      expect(roundSelectionKey({ kind: 'round', id: 'sf' })).toBe('r:sf');
    });

    it('parseRoundSelection prioriza round sobre journey', () => {
      const sel = selectableRounds(ROUNDS, MATCHES);
      expect(parseRoundSelection('3', 'sf', sel)).toEqual({ kind: 'round', id: 'sf' });
      expect(parseRoundSelection('3', null, sel)).toEqual({ kind: 'journey', n: 3 });
      expect(parseRoundSelection(null, 'invalid', sel)).toBeNull();
    });
  });

  describe('matchesOfSelection', () => {
    it('jornada 1 no incluye eliminatorias con roundNumber 1', () => {
      const ms = matchesOfSelection(MATCHES, { kind: 'journey', n: 1 });
      expect(ms.map((m) => m.roundId)).toEqual(['j1']);
    });

    it('eliminatoria filtra por id de ronda', () => {
      expect(matchesOfSelection(MATCHES, { kind: 'round', id: 'sf' }).map((m) => m.roundId)).toEqual(['sf']);
      expect(matchesOfSelection(MATCHES, { kind: 'round', id: 'fi' })).toEqual([]);
    });
  });

  describe('defaultRoundSelection', () => {
    it('en fase final selecciona la eliminatoria más cercana', () => {
      const sel = selectableRounds(ROUNDS, MATCHES);
      expect(defaultRoundSelection(sel, MATCHES, '2026-10-16')).toEqual({ kind: 'round', id: 'sf' });
    });

    it('en fase regular selecciona la jornada más cercana a la fecha de hoy', () => {
      const sel = selectableRounds(ROUNDS, MATCHES);
      expect(defaultRoundSelection(sel, MATCHES, '2026-10-13')).toEqual({ kind: 'journey', n: 2 });
    });

    it('sin fechas selecciona la primera ronda con partidos', () => {
      const noDates = [match({ roundId: 'j2', roundNumber: 2 })];
      expect(defaultRoundSelection([J1, J2], noDates, '2026-10-16')).toEqual({ kind: 'journey', n: 2 });
      expect(defaultRoundSelection([J1], [], '2026-10-16')).toEqual({ kind: 'journey', n: 1 });
      expect(defaultRoundSelection([], [], '2026-10-16')).toBeNull();
    });
  });

  describe('roundLabel & stageLabel', () => {
    const fakeT = (k: string) => {
      const dict: Record<string, string> = {
        'fixtures.matchday': 'Jornada {n}',
        'playoffs.stage_quarters': 'Cuartos de final',
        'playoffs.stage_semis': 'Semifinales',
        'playoffs.stage_final': 'Final',
        'playoffs.third_place': '3.er y 4.º puesto',
        'playoffs.other_places': 'Puestos',
      };
      return dict[k] ?? k;
    };

    it('formatea etiquetas de jornadas y eliminatorias', () => {
      expect(roundLabel(J1, fakeT)).toBe('Jornada 1');
      expect(roundLabel(QF, fakeT)).toBe('Cuartos de final');
      expect(roundLabel(SF, fakeT)).toBe('Semifinales');
      expect(roundLabel(FI, fakeT)).toBe('Final');
    });

    it('valida etapas de eliminatorias conocidas', () => {
      expect(isKnockoutStage('quarters')).toBe(true);
      expect(isKnockoutStage('semis')).toBe(true);
      expect(isKnockoutStage('regular')).toBe(false);
      expect(isKnockoutStage(null)).toBe(false);
      expect(isKnockoutRound(QF)).toBe(true);
      expect(isKnockoutRound(J1)).toBe(false);
      expect(stageLabel('quarters', fakeT)).toBe('Cuartos de final');
    });
  });
});

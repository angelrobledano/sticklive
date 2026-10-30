import { describe, it, expect } from 'vitest';
import {
  parseRoundLabel,
  parsePhaseTitle,
  resolvePhaseKind,
  planSourceStructure,
  compatRoundNumber,
  type StructureRow,
} from './index.js';

describe('parseRoundLabel — cabeceras de ronda de la fuente (sidgad)', () => {
  it('jornadas de liga en varios idiomas', () => {
    expect(parseRoundLabel('JORNADA 5')).toEqual({ type: 'matchday', number: 5 });
    expect(parseRoundLabel('Jornada 12')).toEqual({ type: 'matchday', number: 12 });
    expect(parseRoundLabel('GIORNATA 3')).toEqual({ type: 'matchday', number: 3 });
    expect(parseRoundLabel('MATCHDAY 4')).toEqual({ type: 'matchday', number: 4 });
    expect(parseRoundLabel('1ª JORNADA')).toEqual({ type: 'matchday', number: 1 });
  });

  it('fases eliminatorias con número de partido de la serie ("2 CUARTOS")', () => {
    expect(parseRoundLabel('2 CUARTOS')).toEqual({ type: 'stage', stage: 'quarters', game: 2 });
    expect(parseRoundLabel('1 SEMIFINALES')).toEqual({ type: 'stage', stage: 'semis', game: 1 });
    expect(parseRoundLabel('4 FINAL')).toEqual({ type: 'stage', stage: 'final', game: 4 });
  });

  it('fases eliminatorias sin número (partido único)', () => {
    expect(parseRoundLabel('CUARTOS DE FINAL')).toEqual({ type: 'stage', stage: 'quarters', game: null });
    expect(parseRoundLabel('QUARTERFINALS')).toEqual({ type: 'stage', stage: 'quarters', game: null });
    expect(parseRoundLabel('QUARTERSFINALS')).toEqual({ type: 'stage', stage: 'quarters', game: null });
    expect(parseRoundLabel('QUARTS DE FINAL')).toEqual({ type: 'stage', stage: 'quarters', game: null });
    expect(parseRoundLabel('SEMIFINALES')).toEqual({ type: 'stage', stage: 'semis', game: null });
    expect(parseRoundLabel('SEMIS FINALS')).toEqual({ type: 'stage', stage: 'semis', game: null });
    expect(parseRoundLabel('MEIAS-FINAIS')).toEqual({ type: 'stage', stage: 'semis', game: null });
    expect(parseRoundLabel('FINAL')).toEqual({ type: 'stage', stage: 'final', game: null });
    expect(parseRoundLabel('GOLD MEDAL')).toEqual({ type: 'stage', stage: 'final', game: null });
    expect(parseRoundLabel('FINALE')).toEqual({ type: 'stage', stage: 'final', game: null });
  });

  it('octavos NO es la final aunque contenga "final"', () => {
    expect(parseRoundLabel('OCTAVOS DE FINAL')).toEqual({ type: 'stage', stage: 'round_of_16', game: null });
    expect(parseRoundLabel('ROUND OF 16')).toEqual({ type: 'stage', stage: 'round_of_16', game: null });
  });

  it('tercer y cuarto puesto y colocación', () => {
    expect(parseRoundLabel('BRONZE MEDAL')).toEqual({ type: 'stage', stage: 'third_place', game: null });
    expect(parseRoundLabel('BRONCE MEDAL')).toEqual({ type: 'stage', stage: 'third_place', game: null });
    expect(parseRoundLabel('SMALL FINAL')).toEqual({ type: 'stage', stage: 'third_place', game: null });
    expect(parseRoundLabel('3º Y 4º PUESTO')).toEqual({ type: 'stage', stage: 'third_place', game: null });
    expect(parseRoundLabel('5TH - 8TH POSITION')).toEqual({ type: 'stage', stage: 'placement', game: null });
    expect(parseRoundLabel('5 TO 6')).toEqual({ type: 'stage', stage: 'placement', game: null });
    expect(parseRoundLabel('Puestos 5º-8º')).toEqual({ type: 'stage', stage: 'placement', game: null });
  });

  it('partidos de una serie sin fase ("PARTIDO 2", ida/vuelta)', () => {
    expect(parseRoundLabel('PARTIDO 2')).toEqual({ type: 'game', game: 2 });
    expect(parseRoundLabel('IDA')).toEqual({ type: 'game', game: 1 });
    expect(parseRoundLabel('VUELTA')).toEqual({ type: 'game', game: 2 });
  });

  it('un número suelto es ambiguo (jornada o partido): lo decide la fase', () => {
    expect(parseRoundLabel('1')).toEqual({ type: 'ordinal', number: 1 });
  });

  it('cabeceras de fecha o vacías no aportan estructura', () => {
    expect(parseRoundLabel('8TH OCTUBER')).toEqual({ type: 'unlabelled' });
    expect(parseRoundLabel('12TH OCTOBER')).toEqual({ type: 'unlabelled' });
    expect(parseRoundLabel('')).toEqual({ type: 'unlabelled' });
    expect(parseRoundLabel(null)).toEqual({ type: 'unlabelled' });
    expect(parseRoundLabel('FINAL FOUR')).toEqual({ type: 'unlabelled' });
  });
});

describe('parsePhaseTitle — títulos de fase de la fuente', () => {
  it('playoff por el título y de colocación', () => {
    expect(parsePhaseTitle('PLAY OFF OK LIGA')).toEqual({ kindHint: 'knockout', isPlacement: false, groupName: null });
    expect(parsePhaseTitle('PLAY OFF 9 Y 10')).toEqual({ kindHint: 'knockout', isPlacement: true, groupName: null });
    expect(parsePhaseTitle('5TH - 8TH PLACE')).toEqual({ kindHint: 'knockout', isPlacement: true, groupName: null });
  });

  it('grupos y fase final', () => {
    expect(parsePhaseTitle('GROUP PHASE')).toEqual({ kindHint: 'groups', isPlacement: false, groupName: null });
    expect(parsePhaseTitle('GRUPO A')).toEqual({ kindHint: 'groups', isPlacement: false, groupName: 'A' });
    expect(parsePhaseTitle('FINAL PHASE')).toEqual({ kindHint: 'knockout', isPlacement: false, groupName: null });
    // FECAPA (catalán): "GRUPS" no es "GRUPOS"; sin esto la fase caía a liga.
    expect(parsePhaseTitle('FASE DE GRUPS FRIT RAVICH LLIGA CATALANA'))
      .toEqual({ kindHint: 'groups', isPlacement: false, groupName: null });
    expect(parsePhaseTitle('FASES FINALS FRIT RAVICH LLIGA CATALANA'))
      .toEqual({ kindHint: 'knockout', isPlacement: false, groupName: null });
    expect(parsePhaseTitle('KNOCKOUT STAGE')).toEqual({ kindHint: 'knockout', isPlacement: false, groupName: null });
    expect(parsePhaseTitle('FINAL FOUR')).toEqual({ kindHint: 'knockout', isPlacement: false, groupName: null });
    expect(parsePhaseTitle('LIGA REGULAR')).toEqual({ kindHint: 'league', isPlacement: false, groupName: null });
  });

  it('consolación a liguilla: colocación sin pista de tipo (la deciden las rondas)', () => {
    expect(parsePhaseTitle('5 TO 7')).toEqual({ kindHint: null, isPlacement: true, groupName: null });
  });

  it('sin título no hay pistas', () => {
    expect(parsePhaseTitle(null)).toEqual({ kindHint: null, isPlacement: false, groupName: null });
  });
});

describe('resolvePhaseKind — prioridad: rondas de la fuente > título > metadato > regla > fallback', () => {
  const noTitle = parsePhaseTitle(null);
  it('jornadas → liga; con grupos → grupos', () => {
    const labels = [parseRoundLabel('JORNADA 1'), parseRoundLabel('JORNADA 2')];
    expect(resolvePhaseKind({ labels, title: noTitle, hasGroups: false, distinctTeams: 14 }))
      .toEqual({ kind: 'league', resolvedBy: 'source_rounds' });
    expect(resolvePhaseKind({ labels, title: noTitle, hasGroups: true, distinctTeams: 14 }))
      .toEqual({ kind: 'groups', resolvedBy: 'source_rounds' });
  });

  it('cualquier fase eliminatoria en las rondas → eliminatoria (aunque el metadato diga liga)', () => {
    const labels = [parseRoundLabel('SEMIFINALES'), parseRoundLabel('FINAL')];
    expect(resolvePhaseKind({ labels, title: noTitle, hasGroups: false, distinctTeams: 4, declaredKind: 'league' }))
      .toEqual({ kind: 'knockout', resolvedBy: 'source_rounds' });
  });

  it('cabeceras de fecha: decide el título', () => {
    const labels = [parseRoundLabel('5TH OCTOBER')];
    expect(resolvePhaseKind({ labels, title: parsePhaseTitle('GROUP PHASE'), hasGroups: true, distinctTeams: 8 }))
      .toEqual({ kind: 'groups', resolvedBy: 'source_title' });
  });

  it('sin rondas ni título: decide el metadato declarado', () => {
    const labels = [parseRoundLabel('1'), parseRoundLabel('2')];
    expect(resolvePhaseKind({ labels, title: noTitle, hasGroups: false, distinctTeams: 2, declaredKind: 'knockout' }))
      .toEqual({ kind: 'knockout', resolvedBy: 'declared' });
  });

  it('sin nada declarado: dos únicos equipos = una eliminatoria (regla determinista)', () => {
    const labels = [parseRoundLabel('1'), parseRoundLabel('2')];
    expect(resolvePhaseKind({ labels, title: noTitle, hasGroups: false, distinctTeams: 2 }))
      .toEqual({ kind: 'knockout', resolvedBy: 'structural_rule' });
  });

  it('sin ninguna evidencia: fallback a liga, marcado como tal', () => {
    expect(resolvePhaseKind({ labels: [parseRoundLabel('')], title: noTitle, hasGroups: false, distinctTeams: 10 }))
      .toEqual({ kind: 'league', resolvedBy: 'fallback' });
  });
});

// ── Casos de validación del modelo (A–F): todos salen del MISMO planificador ──

let doc = 0;
function row(phaseRef: string, phaseTitle: string | null, roundLabel: string, date: string, home: string, away: string, groupName: string | null = null): StructureRow {
  return { phaseRef, phaseTitle, roundLabel, date, homeRef: home, awayRef: away, groupName, docIndex: doc++ };
}

function liga(teams = ['A', 'B', 'C', 'D'], jornadas = 3, phaseRef = 'fep_fase_3150'): StructureRow[] {
  const out: StructureRow[] = [];
  for (let j = 1; j <= jornadas; j++) {
    out.push(row(phaseRef, null, `JORNADA ${j}`, `2025100${j}`, teams[0]!, teams[j % teams.length]!));
    out.push(row(phaseRef, null, `JORNADA ${j}`, `2025100${j}`, teams[2]!, teams[(j + 2) % teams.length]!));
  }
  return out;
}

describe('planSourceStructure — casos A–F', () => {
  it('Caso A: liga regular (jornadas 1..N)', () => {
    const plan = planSourceStructure(liga());
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({ kind: 'league', ordinal: 1, isPlacement: false, resolvedBy: 'source_rounds' });
    expect(plan.phases[0]!.rounds.map((r) => [r.roundType, r.number, r.stage])).toEqual([
      ['regular', 1, null], ['regular', 2, null], ['regular', 3, null],
    ]);
    expect(plan.assignments.every((a) => a.seriesGame === null)).toBe(true);
  });

  it('Caso B: liga + playoff (cuartos al mejor de 3 → semis → final) + playoff de colocación 9.º-10.º', () => {
    const rows = [
      ...liga(['IHC', 'BAR', 'HCL', 'CAL'], 2),
      row('fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260516', 'BAR', 'NOI'),
      row('fep_fase_3483', 'PLAY OFF OK LIGA', '2 CUARTOS', '20260523', 'NOI', 'BAR'),
      row('fep_fase_3483', 'PLAY OFF OK LIGA', '3 CUARTOS', '20260526', 'BAR', 'NOI'),
      row('fep_fase_3483', 'PLAY OFF OK LIGA', '1 SEMIFINALES', '20260529', 'HCL', 'CAL'),
      row('fep_fase_3483', 'PLAY OFF OK LIGA', '5 SEMIFINALES', '20260609', 'BAR', 'IHC'),
      row('fep_fase_3483', 'PLAY OFF OK LIGA', '1 FINAL', '20260612', 'HCL', 'IHC'),
      row('fep_fase_3483', 'PLAY OFF OK LIGA', '5 FINAL', '20260623', 'HCL', 'IHC'),
      row('fep_fase_3482', 'PLAY OFF 9 Y 10', 'PARTIDO 1', '20260516', 'ALC', 'RIV'),
      row('fep_fase_3482', 'PLAY OFF 9 Y 10', 'PARTIDO 2', '20260523', 'RIV', 'ALC'),
    ];
    const plan = planSourceStructure(rows);
    expect(plan.phases.map((p) => [p.ref, p.ordinal, p.kind, p.isPlacement])).toEqual([
      ['fep_fase_3150', 1, 'league', false],
      ['fep_fase_3483', 2, 'knockout', false],
      ['fep_fase_3482', 3, 'knockout', true],
    ]);
    const po = plan.phases[1]!;
    expect(po.rounds.map((r) => r.stage)).toEqual(['quarters', 'semis', 'final']);
    expect(po.rounds.every((r) => r.roundType === 'playoff')).toBe(true);
    // El nº de partido de la serie viaja en la asignación, no en la ronda.
    const games = plan.assignments.filter((a) => a.phaseRef === 'fep_fase_3483').map((a) => a.seriesGame);
    expect(games).toEqual([1, 2, 3, 1, 5, 1, 5]);
    const placement = plan.phases[2]!;
    expect(placement.rounds).toHaveLength(1);
    expect(placement.rounds[0]).toMatchObject({ stage: 'placement', name: 'PLAY OFF 9 Y 10' });
  });

  it('Caso C: liguilla por grupos (cabeceras de fecha, grupos A/B)', () => {
    const rows = [
      row('wse_fase_329', 'GROUP PHASE', '5TH OCTOBER', '20261005', 'ESP', 'ARG', 'A'),
      row('wse_fase_329', 'GROUP PHASE', '5TH OCTOBER', '20261005', 'POR', 'COL', 'B'),
      row('wse_fase_329', 'GROUP PHASE', '6TH OCTOBER', '20261006', 'ESP', 'FRA', 'A'),
      row('wse_fase_329', 'GROUP PHASE', '6TH OCTOBER', '20261006', 'POR', 'ITA', 'B'),
    ];
    const plan = planSourceStructure(rows);
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({ kind: 'groups', resolvedBy: 'source_title' });
    // Sin número en la cabecera: la jornada es el orden cronológico.
    expect(plan.phases[0]!.rounds.map((r) => [r.roundType, r.number])).toEqual([['regular', 1], ['regular', 2]]);
  });

  it('Caso D: grupos + Final Four (semis, final y 3.er puesto); orden por fecha, no por documento', () => {
    const rows = [
      // La fuente puede listar la fase final ANTES que la de grupos (WSG sub-19).
      row('wse_fase_344', 'FINAL PHASE', 'SEMIFINALS', '20261010', 'ESP', 'ITA'),
      row('wse_fase_344', 'FINAL PHASE', 'SEMIFINALS', '20261010', 'POR', 'ARG'),
      row('wse_fase_344', 'FINAL PHASE', 'BRONZE MEDAL', '20261011', 'ITA', 'ARG'),
      row('wse_fase_344', 'FINAL PHASE', 'GOLD MEDAL', '20261011', 'ESP', 'POR'),
      row('wse_fase_329', 'GROUP PHASE', '5TH OCTOBER', '20261005', 'ESP', 'ARG', 'A'),
      row('wse_fase_329', 'GROUP PHASE', '5TH OCTOBER', '20261005', 'POR', 'ITA', 'B'),
    ];
    const plan = planSourceStructure(rows);
    expect(plan.phases.map((p) => [p.ref, p.ordinal, p.kind])).toEqual([
      ['wse_fase_329', 1, 'groups'],
      ['wse_fase_344', 2, 'knockout'],
    ]);
    expect(plan.phases[1]!.rounds.map((r) => r.stage)).toEqual(['semis', 'final', 'third_place']);
  });

  it('Caso E: solo Final Four (Supercopa: SEMIFINALES → FINAL, partido único)', () => {
    const rows = [
      row('fep_fase_3592', null, 'SEMIFINALES', '20260924', 'IHC', 'BAR'),
      row('fep_fase_3592', null, 'SEMIFINALES', '20260924', 'HCL', 'REU'),
      row('fep_fase_3592', null, 'FINAL', '20260925', 'BAR', 'HCL'),
    ];
    const plan = planSourceStructure(rows);
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({ kind: 'knockout', resolvedBy: 'source_rounds' });
    expect(plan.phases[0]!.rounds.map((r) => r.stage)).toEqual(['semis', 'final']);
    expect(plan.assignments.every((a) => a.seriesGame === null)).toBe(true);
  });

  it('Caso F: eliminatoria (cuartos → semis → final), incluso con la final aún sin jugar', () => {
    const rows = [
      row('fep_fase_3258', null, 'CUARTOS DE FINAL', '20260319', 'CAL', 'REU'),
      row('fep_fase_3258', null, 'CUARTOS DE FINAL', '20260319', 'BAR', 'NOI'),
      row('fep_fase_3258', null, 'CUARTOS DE FINAL', '20260320', 'IHC', 'VOL'),
      row('fep_fase_3258', null, 'CUARTOS DE FINAL', '20260320', 'HCL', 'ALC'),
      row('fep_fase_3258', null, 'SEMIFINALES', '20260321', 'CAL', 'BAR'),
      row('fep_fase_3258', null, 'SEMIFINALES', '20260321', 'IHC', 'HCL'),
    ];
    const plan = planSourceStructure(rows);
    // Sin la final publicada, las semis siguen siendo semis (no hay inferencia cronológica).
    expect(plan.phases[0]!.rounds.map((r) => r.stage)).toEqual(['quarters', 'semis']);
  });

  it('eliminatoria a doble partido sin etiquetas ("1", "2"): metadato declarado o regla de 2 equipos', () => {
    const rows = [
      row('fep_fase_3515', null, '1', '20260530', 'MAN', 'CPV'),
      row('fep_fase_3515', null, '2', '20260628', 'CPV', 'MAN'),
    ];
    const declared = planSourceStructure(rows, { declaredKind: 'knockout' });
    expect(declared.phases[0]).toMatchObject({ kind: 'knockout', resolvedBy: 'declared' });
    expect(declared.assignments.map((a) => a.seriesGame)).toEqual([1, 2]);
    expect(declared.phases[0]!.rounds).toHaveLength(1);
    expect(declared.phases[0]!.rounds[0]!.stage).toBeNull();

    const ruled = planSourceStructure(rows);
    expect(ruled.phases[0]).toMatchObject({ kind: 'knockout', resolvedBy: 'structural_rule' });
  });

  it('eliminatoria a doble partido rotulada como JORNADAS (caso real idc 3515/3516): sigue siendo eliminatoria', () => {
    // La fuente rotula la ida y la vuelta "Jornada 1" / "Jornada 2". Una
    // "liga" de solo dos equipos no existe: es una eliminatoria a doble
    // partido, y el nº de jornada es el nº de partido de la serie.
    const rows = [
      row('fep_fase_3515', null, 'Jornada 1', '20260530', 'MAN', 'CPV'),
      row('fep_fase_3515', null, 'Jornada 2', '20260628', 'CPV', 'MAN'),
    ];
    const plan = planSourceStructure(rows);
    expect(plan.phases[0]).toMatchObject({ kind: 'knockout', resolvedBy: 'structural_rule' });
    expect(plan.assignments.map((a) => a.seriesGame)).toEqual([1, 2]);
    expect(plan.phases[0]!.rounds).toHaveLength(1);
    expect(resolvePhaseKind({
      labels: [parseRoundLabel('Jornada 1'), parseRoundLabel('Jornada 2')],
      title: parsePhaseTitle(null), hasGroups: false, distinctTeams: 2,
    })).toEqual({ kind: 'knockout', resolvedBy: 'structural_rule' });
    // Con más equipos, las jornadas siguen siendo liga.
    expect(resolvePhaseKind({
      labels: [parseRoundLabel('Jornada 1')], title: parsePhaseTitle(null), hasGroups: false, distinctTeams: 4,
    })).toEqual({ kind: 'league', resolvedBy: 'source_rounds' });
  });

  it('filas sin equipos (cruces aún sin publicar) también aportan estructura', () => {
    const rows: StructureRow[] = [
      row('fep_fase_3593', null, 'SEMIFINALES', '20261023', 'VIL', 'PAL'),
      { phaseRef: 'fep_fase_3593', phaseTitle: null, roundLabel: 'FINAL', date: '20261025', homeRef: null, awayRef: null, groupName: null, docIndex: doc++ },
    ];
    const plan = planSourceStructure(rows);
    expect(plan.phases[0]!.rounds.map((r) => r.stage)).toEqual(['semis', 'final']);
  });
});

describe('planSourceStructure — grupos publicados como bloques separados', () => {
  it('"GRUPO A" y "GRUPO B" son la MISMA fase de grupos (el grupo va en cada partido)', () => {
    const rows = [
      row('wse_fase_251', 'GRUPO A', 'JORNADA 1', '20250701', 'ESP', 'ITA'),
      row('wse_fase_252', 'GRUPO B', 'JORNADA 1', '20250701', 'POR', 'FRA'),
      row('wse_fase_253', 'KNOCKOUT STAGE', 'SEMIS FINALS', '20250705', 'ESP', 'POR'),
    ];
    const plan = planSourceStructure(rows);
    expect(plan.phases.map((p) => [p.ordinal, p.kind])).toEqual([[1, 'groups'], [2, 'knockout']]);
    expect(plan.phases[0]!.rounds).toHaveLength(1);
    expect(plan.assignments.map((a) => a.groupName)).toEqual(['A', 'B', null]);
  });
});

describe('compatRoundNumber — campo legado roundNumber de la API', () => {
  it('mapea fases explícitas a la numeración que ya consumen web/app (1=QF, 2=SF, 3=F, 0=colocación)', () => {
    expect(compatRoundNumber('quarters', false)).toBe(1);
    expect(compatRoundNumber('semis', false)).toBe(2);
    expect(compatRoundNumber('final', false)).toBe(3);
    expect(compatRoundNumber('placement', true)).toBe(0);
    expect(compatRoundNumber(null, true)).toBe(0);
    expect(compatRoundNumber(null, false)).toBeNull();
  });
});

describe('grupos en italiano (FISR: «GIRONE A»)', () => {
  it('el título «COPPA ITALIA A2 - GIRONE A» es un grupo, no una eliminatoria', () => {
    expect(parsePhaseTitle('COPPA ITALIA A2 - GIRONE A')).toEqual({ kindHint: 'groups', isPlacement: false, groupName: 'A' });
    expect(parsePhaseTitle('SKATE ITALIA TROPHY - GIRONI')).toMatchObject({ kindHint: 'groups' });
  });

  it('cuatro gironi sin jornadas numeradas y declarada como copa: UNA fase de grupos, no cuatro eliminatorias', () => {
    const rows: StructureRow[] = [];
    for (const g of ['A', 'B']) {
      const t = (x: string) => `${g}${x}`;
      rows.push(
        row(`fisr_${g}`, `COPPA ITALIA A2 - GIRONE ${g}`, '', '20261003', t('1'), t('2')),
        row(`fisr_${g}`, `COPPA ITALIA A2 - GIRONE ${g}`, '', '20261003', t('3'), t('4')),
        row(`fisr_${g}`, `COPPA ITALIA A2 - GIRONE ${g}`, '', '20261010', t('1'), t('3')),
      );
    }
    const plan = planSourceStructure(rows, { declaredKind: 'knockout' });
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({ kind: 'groups', resolvedBy: 'source_title' });
    expect(new Set(plan.assignments.map((a) => a.groupName))).toEqual(new Set(['A', 'B']));
  });
});

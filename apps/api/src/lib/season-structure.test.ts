import { describe, it, expect } from 'vitest';
import { buildSeasonStructure, type StructureMatchRow, type StructurePhaseRow, type StructureRoundRow } from './season-structure.js';

/**
 * La API expone la estructura EXPLÍCITA (fases → rondas → partidos) y calcula
 * desde ella los campos legados (`roundNumber`, `roundType`, `competitionFormat`)
 * que ya consumen web y app. Casos A–F: todos salen del mismo modelo.
 */

let n = 0;
function phase(over: Partial<StructurePhaseRow> & Pick<StructurePhaseRow, 'kind'>): StructurePhaseRow {
  return { id: `p${++n}`, ordinal: n, is_placement: false, name: null, resolved_by: 'source_rounds', ...over };
}
function round(phaseId: string | null, over: Partial<StructureRoundRow> = {}): StructureRoundRow {
  return { id: `r${++n}`, number: 1, name: null, round_type: 'regular', phase_id: phaseId, stage: null, ...over };
}
function match(r: StructureRoundRow | null, home: string, away: string, date: string, over: Partial<StructureMatchRow> = {}): StructureMatchRow {
  return {
    id: `m${++n}`, round_id: r?.id ?? null, phase_id: r?.phase_id ?? null, series_game: null,
    home_team_id: home, away_team_id: away, scheduled_at: new Date(date), ...over,
  };
}

describe('buildSeasonStructure — casos A–F', () => {
  it('A: liga regular → una fase league con clasificación; roundType regular', () => {
    const p = phase({ kind: 'league' });
    const j1 = round(p.id, { number: 1 });
    const out = buildSeasonStructure({ phases: [p], rounds: [j1], matches: [match(j1, 'a', 'b', '2025-10-01')], hasStandings: true, declaredFormat: null });
    expect(out.phases).toEqual([expect.objectContaining({ id: p.id, kind: 'league', hasStandings: true, stages: [], fromSource: true })]);
    expect(out.competitionFormat).toBe('league');
    expect([...out.byMatch.values()][0]).toMatchObject({ phaseId: p.id, roundType: 'regular', stage: null });
  });

  it('B: liga + playoff: fase eliminatoria explícita (sin cronología) y roundNumber legado 1/2/3', () => {
    const liga = phase({ kind: 'league' });
    const po = phase({ kind: 'knockout', name: 'PLAY OFF OK LIGA' });
    const j1 = round(liga.id);
    const qf = round(po.id, { number: 20, round_type: 'playoff', stage: 'quarters' });
    const sf = round(po.id, { number: 30, round_type: 'playoff', stage: 'semis' });
    const f = round(po.id, { number: 40, round_type: 'playoff', stage: 'final' });
    const ms = [
      match(j1, 'a', 'b', '2025-10-01'),
      match(qf, 'a', 'h', '2026-05-16', { series_game: 1 }),
      match(sf, 'a', 'd', '2026-05-29', { series_game: 1 }),
      match(f, 'a', 'c', '2026-06-12', { series_game: 1 }),
    ];
    const out = buildSeasonStructure({ phases: [liga, po], rounds: [j1, qf, sf, f], matches: ms, hasStandings: true, declaredFormat: null });
    expect(out.phases.map((x) => [x.kind, x.stages])).toEqual([['league', []], ['knockout', ['quarters', 'semis', 'final']]]);
    expect(out.competitionFormat).toBe('league');
    expect(ms.slice(1).map((m) => out.byMatch.get(m.id))).toEqual([
      { phaseId: po.id, stage: 'quarters', seriesGame: 1, roundNumber: 1, roundType: 'playoff', stageInferred: false },
      { phaseId: po.id, stage: 'semis', seriesGame: 1, roundNumber: 2, roundType: 'playoff', stageInferred: false },
      { phaseId: po.id, stage: 'final', seriesGame: 1, roundNumber: 3, roundType: 'playoff', stageInferred: false },
    ]);
  });

  it('B (en curso): durante las semis la 2.ª semifinal NO se etiqueta como final', () => {
    // Antes, la API deducía "la última serie = la final" y fallaba aquí.
    const po = phase({ kind: 'knockout' });
    const qf = round(po.id, { number: 20, round_type: 'playoff', stage: 'quarters' });
    const sf = round(po.id, { number: 30, round_type: 'playoff', stage: 'semis' });
    const ms = [
      match(qf, 'a', 'h', '2026-05-16'), match(qf, 'b', 'g', '2026-05-16'),
      match(qf, 'c', 'f', '2026-05-17'), match(qf, 'd', 'e', '2026-05-17'),
      match(sf, 'a', 'd', '2026-05-29'), match(sf, 'b', 'c', '2026-05-30'),
    ];
    const out = buildSeasonStructure({ phases: [po], rounds: [qf, sf], matches: ms, hasStandings: false, declaredFormat: null });
    expect(ms.map((m) => out.byMatch.get(m.id)!.stage)).toEqual(['quarters', 'quarters', 'quarters', 'quarters', 'semis', 'semis']);
  });

  it('C: grupos → fase groups con clasificación', () => {
    const g = phase({ kind: 'groups', name: 'GROUP PHASE' });
    const j1 = round(g.id);
    const out = buildSeasonStructure({ phases: [g], rounds: [j1], matches: [match(j1, 'a', 'b', '2026-10-05', { })], hasStandings: true, declaredFormat: 'bracket' });
    expect(out.phases[0]).toMatchObject({ kind: 'groups', hasStandings: true });
    // El formato declarado ("bracket") ya no manda sobre la estructura real.
    expect(out.competitionFormat).toBe('league');
  });

  it('D: grupos + final four → clasificación Y cuadro (antes final_four ocultaba la fase de grupos)', () => {
    const g = phase({ kind: 'groups' });
    const ff = phase({ kind: 'knockout' });
    const j1 = round(g.id);
    const sf = round(ff.id, { number: 30, round_type: 'playoff', stage: 'semis' });
    const f = round(ff.id, { number: 40, round_type: 'playoff', stage: 'final' });
    const out = buildSeasonStructure({
      phases: [g, ff], rounds: [j1, sf, f],
      matches: [match(j1, 'a', 'b', '2026-10-05'), match(sf, 'a', 'c', '2026-10-10'), match(f, 'a', 'd', '2026-10-11')],
      hasStandings: true, declaredFormat: 'final_four',
    });
    expect(out.phases.map((x) => [x.kind, x.hasStandings, x.stages])).toEqual([
      ['groups', true, []],
      ['knockout', false, ['semis', 'final']],
    ]);
    expect(out.competitionFormat).toBe('league');
  });

  it('E: solo final four → formato legado final_four', () => {
    const ff = phase({ kind: 'knockout' });
    const sf = round(ff.id, { number: 30, round_type: 'playoff', stage: 'semis' });
    const f = round(ff.id, { number: 40, round_type: 'playoff', stage: 'final' });
    const out = buildSeasonStructure({ phases: [ff], rounds: [sf, f], matches: [match(sf, 'a', 'b', '2026-09-24'), match(sf, 'c', 'd', '2026-09-24')], hasStandings: false, declaredFormat: null });
    expect(out.competitionFormat).toBe('final_four');
    // La final aún sin partidos sigue siendo parte de la estructura.
    expect(out.phases[0]!.stages).toEqual(['semis', 'final']);
  });

  it('F: eliminatoria cuartos → semis → final → formato legado bracket', () => {
    const ko = phase({ kind: 'knockout' });
    const qf = round(ko.id, { number: 20, round_type: 'playoff', stage: 'quarters' });
    const out = buildSeasonStructure({ phases: [ko], rounds: [qf], matches: [match(qf, 'a', 'b', '2026-03-19')], hasStandings: false, declaredFormat: null });
    expect(out.competitionFormat).toBe('bracket');
  });

  it('colocación (9.º-10.º): roundNumber legado 0 y no cuenta para el formato', () => {
    const liga = phase({ kind: 'league' });
    const pl = phase({ kind: 'knockout', is_placement: true, name: 'PLAY OFF 9 Y 10' });
    const j1 = round(liga.id);
    const r = round(pl.id, { number: 60, round_type: 'playoff', stage: 'placement' });
    const m = match(r, 'i', 'j', '2026-05-16', { series_game: 2 });
    const out = buildSeasonStructure({ phases: [liga, pl], rounds: [j1, r], matches: [match(j1, 'a', 'b', '2025-10-01'), m], hasStandings: true, declaredFormat: null });
    expect(out.byMatch.get(m.id)).toMatchObject({ roundNumber: 0, seriesGame: 2, stage: 'placement' });
    expect(out.competitionFormat).toBe('league');
  });
});

describe('buildSeasonStructure — datos históricos', () => {
  it('playoff LEGADO (ronda 100 sin fase eliminatoria): deducción cronológica aislada y marcada', () => {
    const liga = phase({ kind: 'league', resolved_by: 'legacy' });
    const po = phase({ kind: 'knockout', resolved_by: 'legacy' });
    const r100 = round(po.id, { number: 100, round_type: 'playoff', name: 'Playoff por el título' });
    const ms = [
      match(r100, 'a', 'h', '2025-05-16'), match(r100, 'b', 'g', '2025-05-16'),
      match(r100, 'c', 'f', '2025-05-17'), match(r100, 'd', 'e', '2025-05-17'),
      match(r100, 'a', 'd', '2025-05-29'), match(r100, 'b', 'c', '2025-05-30'),
      match(r100, 'a', 'b', '2025-06-12'),
    ];
    const out = buildSeasonStructure({ phases: [liga, po], rounds: [r100], matches: ms, hasStandings: true, declaredFormat: null });
    expect(ms.map((m) => out.byMatch.get(m.id)!.stage)).toEqual(['quarters', 'quarters', 'quarters', 'quarters', 'semis', 'semis', 'final']);
    expect(out.byMatch.get(ms[6]!.id)).toMatchObject({ roundNumber: 3, stageInferred: true });
  });

  it('playoff LEGADO con serie 9.º-10.º: se conserva como colocación (roundNumber 0), como antes', () => {
    const po = phase({ kind: 'knockout', resolved_by: 'legacy' });
    const r100 = round(po.id, { number: 100, round_type: 'playoff' });
    const ms = [
      match(r100, 'a', 'h', '2025-05-16'), match(r100, 'b', 'g', '2025-05-16'),
      match(r100, 'c', 'f', '2025-05-17'), match(r100, 'd', 'e', '2025-05-17'),
      match(r100, 'i', 'j', '2025-05-17'),
      match(r100, 'a', 'd', '2025-05-29'), match(r100, 'b', 'c', '2025-05-30'),
      match(r100, 'a', 'b', '2025-06-12'),
    ];
    const out = buildSeasonStructure({ phases: [po], rounds: [r100], matches: ms, hasStandings: false, declaredFormat: null });
    expect(out.byMatch.get(ms[4]!.id)).toMatchObject({ stage: 'placement', roundNumber: 0, stageInferred: true });
    expect(out.phases[0]).toMatchObject({ stages: ['quarters', 'semis', 'final', 'placement'], stagesInferred: true, fromSource: false });
  });

  it('LEGADO con alguna ronda ya identificada o final four declarada: no se deduce nada', () => {
    const po = phase({ kind: 'knockout', resolved_by: 'legacy' });
    const sf = round(po.id, { number: 2, round_type: 'playoff', name: 'SEMIFINALES', stage: 'semis' });
    const other = round(po.id, { number: 7, round_type: 'playoff', name: 'PLAYOFF' });
    const ms = [match(sf, 'a', 'b', '2025-05-16'), match(other, 'a', 'c', '2025-05-20')];
    const out = buildSeasonStructure({ phases: [po], rounds: [sf, other], matches: ms, hasStandings: false, declaredFormat: 'bracket' });
    expect(ms.map((m) => out.byMatch.get(m.id))).toEqual([
      { phaseId: po.id, stage: 'semis', seriesGame: null, roundNumber: 2, roundType: 'playoff', stageInferred: false },
      // Sin fase eliminatoria y heredada: conserva su número de ronda de siempre.
      { phaseId: po.id, stage: null, seriesGame: null, roundNumber: 7, roundType: 'playoff', stageInferred: false },
    ]);

    const ff = phase({ kind: 'knockout', resolved_by: 'legacy' });
    const fin = round(ff.id, { number: 4, round_type: 'playoff', name: 'FINAL' });
    const ffMs = [match(fin, 'a', 'b', '2025-09-24'), match(fin, 'c', 'd', '2025-09-24'), match(fin, 'a', 'c', '2025-09-25')];
    const out2 = buildSeasonStructure({ phases: [ff], rounds: [fin], matches: ffMs, hasStandings: false, declaredFormat: 'final_four' });
    expect(ffMs.every((m) => out2.byMatch.get(m.id)!.stage === null)).toBe(true);
    // Todo heredado: el formato declarado de siempre se mantiene.
    expect(out2.competitionFormat).toBe('final_four');
  });

  it('en una fase de la FUENTE sin fase eliminatoria (ida/vuelta "1","2") NO se inventa nada', () => {
    const ko = phase({ kind: 'knockout', resolved_by: 'declared' });
    const r = round(ko.id, { number: 90, round_type: 'playoff' });
    const ms = [match(r, 'a', 'b', '2026-05-30', { series_game: 1 }), match(r, 'b', 'a', '2026-06-28', { series_game: 2 })];
    const out = buildSeasonStructure({ phases: [ko], rounds: [r], matches: ms, hasStandings: false, declaredFormat: 'bracket' });
    expect(ms.map((m) => out.byMatch.get(m.id))).toEqual([
      { phaseId: ko.id, stage: null, seriesGame: 1, roundNumber: null, roundType: 'playoff', stageInferred: false },
      { phaseId: ko.id, stage: null, seriesGame: 2, roundNumber: null, roundType: 'playoff', stageInferred: false },
    ]);
  });

  it('temporada sin fases (payload antiguo / sin backfill): campos legados como antes', () => {
    const r = round(null, { number: 3, round_type: 'regular' });
    const m = match(r, 'a', 'b', '2019-01-01');
    const out = buildSeasonStructure({ phases: [], rounds: [r], matches: [m], hasStandings: true, declaredFormat: null });
    expect(out.phases).toEqual([]);
    expect(out.competitionFormat).toBe('league');
    expect(out.byMatch.get(m.id)).toMatchObject({ phaseId: null, roundType: 'regular', roundNumber: 3 });
  });

  it('fases y rondas vacías heredadas no se exponen (sin partidos ni fase eliminatoria)', () => {
    const po = phase({ kind: 'knockout', resolved_by: 'legacy' });
    const huérfana = round(po.id, { number: 100, round_type: 'playoff' });
    const out = buildSeasonStructure({ phases: [po], rounds: [huérfana], matches: [], hasStandings: false, declaredFormat: null });
    expect(out.phases).toEqual([]);
    expect(out.visibleRoundIds.has(huérfana.id)).toBe(false);
  });
});

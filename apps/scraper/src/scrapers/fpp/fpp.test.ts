import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFppCalendar, parseFppStandings, isPlaceholderTeam, cleanName } from './fpp.parser.js';
import { buildFppCompetition, type FppSectionData } from './fpp-structure.js';
import { FPP_COMPETITIONS, fppTeamRef, type FppCompetition } from './fpp-catalog.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fx = (f: string) => readFileSync(join(dir, f), 'utf8');
const comp = (key: string) => FPP_COMPETITIONS.find((c) => c.key === key)!;
const ctx = { seasonId: 'season-1', sourceId: 'source-1', now: new Date('2026-10-22T20:00:00Z') };

describe('parseFppCalendar', () => {
  it('lee la 1ª jornada de la liga 2026/27 (sin jugar)', () => {
    const rows = parseFppCalendar(fx('competicao-493-liga-2026.html'));
    expect(rows.length).toBe(182); // 14 equipos × 26 jornadas / 2
    expect(rows[0]).toMatchObject({
      numero: '3', roundLabel: '1ª Jornada', date: '2026-11-08', time: '16:00',
      homeName: 'J. Pacense / Des Compagnons', awayName: 'AJ Viana',
      homeScore: null, awayScore: null, jogoId: null,
    });
    expect(rows[0]!.homeEquipaId).toMatch(/^\d+$/);
  });

  it('lee resultado, ficha e inscripción de un partido jugado', () => {
    const rows = parseFppCalendar(fx('competicao-294-liga-2024-jogada.html'));
    expect(rows[0]).toMatchObject({
      numero: '3', date: '2024-10-20', time: '18:00',
      homeName: 'UD Oliveirense / Simoldes', awayName: "Riba d' Ave HC / CSJ Group",
      homeScore: 2, awayScore: 0, jogoId: '10522', homeEquipaId: '248', awayEquipaId: '423',
    });
    expect(rows.every((r) => r.homeScore !== null)).toBe(true);
  });

  it('marca como pendientes los cruces sin decidir de las copas', () => {
    const rows = parseFppCalendar(fx('competicao-509-elite-cup.html'));
    const labels = new Set(rows.map((r) => r.roundLabel));
    expect(labels).toEqual(new Set(['1/4 Final', '1/2 Final', 'Final']));
    expect(rows.filter((r) => isPlaceholderTeam(r.homeName)).length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.roundLabel === '1/4 Final').every((r) => !isPlaceholderTeam(r.homeName))).toBe(true);
  });
});

describe('parseFppStandings', () => {
  it('lee la tabla con P J V E D GM GS y el id de club del escudo', () => {
    const rows = parseFppStandings(fx('classificacao-294.html'));
    expect(rows.length).toBe(14);
    expect(rows[0]).toMatchObject({
      position: 1, name: 'SL Benfica', equipaId: '236', clubId: '119',
      points: 66, played: 26, won: 21, drawn: 3, lost: 2, goalsFor: 148, goalsAgainst: 55,
    });
  });
});

describe('isPlaceholderTeam / cleanName', () => {
  it.each(['Vencedor Jogo 1557', 'Vencedor jogo 1562', 'A definir', ''])('"%s" no es un equipo', (n) => {
    expect(isPlaceholderTeam(n)).toBe(true);
  });
  it('un club real sí lo es y se limpia el espacio final', () => {
    expect(isPlaceholderTeam('FC Porto ')).toBe(false);
    expect(cleanName('  FC   Porto ')).toBe('FC Porto');
  });
});

describe('buildFppCompetition', () => {
  const section = (c: FppCompetition, i = 0) => c.sections[i]!;

  it('liga: jornadas regulares, hora de Lisboa a UTC, sin estado antes de jugar', () => {
    const c = comp('campeonato-placard');
    const data: FppSectionData[] = [{
      section: section(c), calendar: parseFppCalendar(fx('competicao-493-liga-2026.html')), standings: [],
    }];
    const out = buildFppCompetition(c, data, ctx);
    expect(out.matches.length).toBe(182);
    const m = out.matches[0]!;
    // 8/11 es horario de invierno: Lisboa = UTC+0 → 16:00 local = 16:00Z.
    expect(m.scheduledAt).toBe('2026-11-08T16:00:00.000Z');
    expect(m).toMatchObject({
      roundType: 'regular', roundNumber: 1, phaseKind: 'league', status: undefined,
      sourceRef: 'fpp_match_493_3', homeTeamRef: 'fpp_m_senior_j-pacense-des-compagnons',
    });
    expect(new Set(out.rounds.map((r) => r.number)).size).toBe(26);
  });

  it('hora de verano: Lisboa = UTC+1', () => {
    const c = comp('campeonato-placard');
    const out = buildFppCompetition(c, [{
      section: section(c), standings: [],
      calendar: [{ numero: '1', roundLabel: '1ª Jornada', date: '2026-09-20', time: '18:00',
        homeName: 'A', awayName: 'B', homeEquipaId: null, awayEquipaId: null,
        homeScore: null, awayScore: null, jogoId: null, docIndex: 0 }],
    }], ctx);
    expect(out.matches[0]!.scheduledAt).toBe('2026-09-20T17:00:00.000Z');
  });

  it('resultado: terminado solo cuando ha pasado el margen desde el inicio', () => {
    const c = comp('campeonato-placard');
    const row = { numero: '1', roundLabel: '1ª Jornada', date: '2026-10-22', time: '19:00',
      homeName: 'A', awayName: 'B', homeEquipaId: null, awayEquipaId: null,
      homeScore: 3, awayScore: 2, jogoId: null, docIndex: 0 };
    const mk = (now: string) => buildFppCompetition(c, [{ section: section(c), standings: [], calendar: [row] }],
      { ...ctx, now: new Date(now) }).matches[0]!;
    // En juego (marcador provisional en el calendario) → sin señal ni marcador.
    expect(mk('2026-10-22T19:30:00Z')).toMatchObject({ status: undefined, homeScore: undefined });
    expect(mk('2026-10-22T22:00:00Z')).toMatchObject({ status: 'finished', homeScore: 3, awayScore: 2 });
  });

  it('grupos: dos secciones de una fase comparten fase y se separan por grupo', () => {
    const c = comp('2-divisao');
    const cal = parseFppCalendar(fx('competicao-493-liga-2026.html')).slice(0, 7);
    const out = buildFppCompetition(c, [
      { section: section(c, 0), calendar: cal, standings: [] },
      { section: section(c, 1), calendar: cal.map((r) => ({ ...r, numero: `9${r.numero}` })), standings: [] },
    ], ctx);
    expect(new Set(out.matches.map((m) => m.phaseRef))).toEqual(new Set(['fpp_phase_2-divisao_regular']));
    expect(out.matches[0]!.phaseKind).toBe('groups');
    expect(new Set(out.matches.map((m) => m.groupName))).toEqual(new Set(['Norte', 'Sul']));
  });

  it('copa: eliminatoria con etapas y cruces sin decidir fuera de los partidos', () => {
    const c = comp('elite-cup');
    const out = buildFppCompetition(c, [{
      section: section(c), calendar: parseFppCalendar(fx('competicao-509-elite-cup.html')), standings: [],
    }], ctx);
    expect(out.pendingTeams).toBeGreaterThan(0);
    expect(out.matches.every((m) => m.stage === 'quarters')).toBe(true);
    expect(out.matches.every((m) => m.roundType === 'playoff' && m.phaseKind === 'knockout')).toBe(true);
    expect(new Set(out.rounds.map((r) => r.stage))).toEqual(new Set(['quarters', 'semis', 'final']));
  });

  it('pré-eliminatória: rondas sin etiqueta se tratan como eliminatoria por el título', () => {
    const c = comp('taca-portugal');
    const out = buildFppCompetition(c, [{
      section: section(c), calendar: parseFppCalendar(fx('competicao-508-pre-eliminatoria.html')), standings: [],
    }], ctx);
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches.every((m) => m.phaseKind === 'knockout')).toBe(true);
  });

  it('clasificación: ref de la sección y grupo de la zona', () => {
    const c = comp('2-divisao');
    const out = buildFppCompetition(c, [
      { section: section(c, 0), calendar: [], standings: parseFppStandings(fx('classificacao-294.html')) },
    ], ctx);
    expect(out.standings[0]).toMatchObject({
      teamRef: 'fpp_m_senior_sl-benfica', groupName: 'Norte', position: 1, points: 66,
      phaseTitle: 'Fase Regular', logoUrl: 'https://plataforma.fpp.pt/Files/CLUBE_119.png',
    });
  });
});

describe('fppTeamRef', () => {
  it('distingue las secciones del mismo club', () => {
    expect(fppTeamRef('male', 'senior', 'SL Benfica')).toBe('fpp_m_senior_sl-benfica');
    expect(fppTeamRef('female', 'senior', 'SL Benfica')).toBe('fpp_f_senior_sl-benfica');
    expect(fppTeamRef('male', 'sub23', "Riba d' Ave HC / CSJ Group")).toBe('fpp_m_sub23_riba-d-ave-hc-csj-group');
  });
});

describe('catálogo', () => {
  it('cubre los 18 ids de la FPP de 2026/27, sin repetir', () => {
    const ids = FPP_COMPETITIONS.flatMap((c) => c.sections.map((s) => s.fppId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(
      ['493','494','495','496','497','498','499','500','501','502','503','504','505','506','507','508','509','510'],
    );
  });
});

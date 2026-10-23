import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planFvpCatalog, ageOf, genderOf, seasonFromCode, fvpTeamRef, cupAliasesByClub, type FvpApiCompetition } from './fvp-catalog.js';
import { parseFvpTree, parseFvpStandings, statusOf, golesOf } from './fvp.parser.js';
import { buildFvpCompetition } from './fvp-structure.js';
import { parseFvpActa, affiliationIdOf } from './fvp-ficha.parser.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fx = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const catalog = () => planFvpCatalog(fx('competitions.json') as FvpApiCompetition[], 'T2627');
const comp = (key: string) => catalog().competitions.find((c) => c.key === key)!;
const ctx = { seasonId: 'season-1', sourceId: 'source-1', now: new Date('2026-10-23T20:00:00Z') };

describe('catálogo FVP', () => {
  it('se queda con las 15 de hockey patines 2026/27', () => {
    const { competitions, skipped } = catalog();
    expect(competitions).toHaveLength(15);
    expect(skipped).toEqual([]);
    expect(competitions.every((c) => c.season.name === '2026/27')).toBe(true);
  });

  it('traduce categoría y género', () => {
    expect(comp('liga-norte')).toMatchObject({ gender: 'male', age: 'senior', isCup: false, slug: 'liga-norte' });
    expect(comp('liga-norte-femenina')).toMatchObject({ gender: 'female', age: 'senior' });
    expect(comp('liga-norte-sub-23')).toMatchObject({ gender: 'mixed', age: 'sub23' });
    expect(comp('liga-escolar-benjamin-a')).toMatchObject({ age: 'benjamin', slug: 'liga-escolar-benjamin-a-euskadi' });
    expect(ageOf('Juvenil Federado')).toBe('juvenil');
    expect(ageOf('Alevín Escolar')).toBe('alevin');
    expect(ageOf('Veteranos')).toBe('veteranos');
    expect(ageOf('Patinaje artístico')).toBeNull();
    expect(genderOf('MIXTO')).toBe('mixed');
    expect(seasonFromCode('T2627')).toMatchObject({ name: '2026/27', start: '2026-09-01' });
    expect(seasonFromCode('T2629')).toBeNull();
  });

  it('la copa comparte los equipos de su liga; dos ligas de la misma categoría no', () => {
    expect(comp('copa-liga-norte')).toMatchObject({ isCup: true, teamScope: 'liga-norte' });
    expect(comp('liga-escolar-infantil-a').teamScope).toBe('liga-escolar-infantil-a');
    expect(comp('liga-escolar-infantil-r').teamScope).toBe('liga-escolar-infantil-r');
    expect(fvpTeamRef('liga-norte', 'C.P. BURGOS')).toBe('fvp_liga-norte_cp-burgos');
    expect(fvpTeamRef('liga-norte', 'SANTUTXU H.T.')).toBe(fvpTeamRef('liga-norte', 'SANTUTXU HT'));
  });

  it('la copa enlaza por club un nombre distinto al de la liga, salvo que el club tenga varios equipos', () => {
    const league = [
      { name: 'TENIS SANTANDER', clubId: 'c1' }, { name: 'SANTUTXU HT', clubId: 'c2' },
      { name: 'LOYOLA A', clubId: 'c3' }, { name: 'LOYOLA B', clubId: 'c3' },
    ];
    const cup = [
      { name: 'R.S. TENIS', clubId: 'c1' }, { name: 'SANTUTXU H.T.', clubId: 'c2' }, { name: 'LOYOLA', clubId: 'c3' },
    ];
    expect(cupAliasesByClub(league, cup, 'liga-norte')).toEqual({ 'R.S. TENIS': 'TENIS SANTANDER' });
  });

  it('una categoría desconocida se avisa, no se pierde en silencio', () => {
    const rows = [{ id: 'x', nombre: 'LIGA RARA', deporteCodigo: 'HP', temporada: 'T2627', estado: 'PUBLISHED', categoriaDisplay: 'Mini', generoDisplay: 'MIXTO' }];
    expect(planFvpCatalog(rows, 'T2627').skipped).toEqual([{ nombre: 'LIGA RARA', motivo: 'categoría desconocida "Mini"' }]);
  });
});

describe('parseFvpTree', () => {
  it('lee un partido jugado con hora, pista, árbitro y goles', () => {
    const rows = parseFvpTree(fx('tree-liga-norte.json'));
    expect(rows).toHaveLength(18); // 3 jornadas × 6
    expect(rows[0]).toMatchObject({
      faseNombre: 'FASE REGULAR', faseFormato: 'LEAGUE', jornadaNombre: 'JORNADA 1', jornadaOrden: 1,
      date: '2026-10-03', time: '17:30', estado: 'FINISHED',
      homeName: 'SANTUTXU HT', awayName: 'C.P. BURGOS', homeAbbr: 'STX', homeGoals: 3, awayGoals: 2,
      venue: 'POLIDEPORTIVO DE TXURDINAGA', referees: 'GORKA DE MIGUEL MARURI',
    });
  });

  it('la copa trae dos fases de eliminatoria', () => {
    const rows = parseFvpTree(fx('tree-copa-liga-norte.json'));
    expect(new Set(rows.map((r) => r.faseNombre))).toEqual(new Set(['FASE PREVIA', 'COPA LIGA NORTE']));
    expect(rows.every((r) => r.faseFormato === 'KNOCKOUT')).toBe(true);
  });

  it('una respuesta con otra forma falla en voz alta', () => {
    expect(() => parseFvpTree({})).toThrow(/no es una lista/);
    expect(() => parseFvpTree([{ id: 'f' }])).toThrow(/falta "jornadas"/);
  });

  it('golesOf y statusOf', () => {
    expect(golesOf('{"goles": 9, "penaltis": 0}')).toBe(9);
    expect(golesOf('{}')).toBeNull();
    expect(golesOf('roto')).toBeNull();
    expect(statusOf('FINISHED')).toBe('finished');
    expect(statusOf('PROGRAMADO')).toBe('scheduled');
    expect(statusOf('ALGO_NUEVO')).toBeUndefined();
  });
});

describe('parseFvpStandings', () => {
  it('lee la tabla de la Liga Norte', () => {
    const rows = parseFvpStandings(fx('clasificacion-liga-norte.json'));
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ position: 1, name: 'OBERENA AUTOESCUELA INDURAIN', abbr: 'OBE', played: 3, won: 3, points: 9, goalsFor: 21, goalsAgainst: 1 });
  });
});

describe('buildFvpCompetition', () => {
  it('liga: partidos con ref estable, hora de Madrid en UTC y clasificación', () => {
    const c = comp('liga-norte');
    const b = buildFvpCompetition(c, parseFvpTree(fx('tree-liga-norte.json')),
      [{ faseId: 'f991edaf-9299-4cf1-bd15-0645d01b08d1', faseNombre: 'FASE REGULAR', rows: parseFvpStandings(fx('clasificacion-liga-norte.json')) }], ctx);
    expect(b.matches).toHaveLength(18);
    const m = b.matches[0]!;
    expect(m).toMatchObject({
      sourceRef: 'fvp_match_6636af38-a791-4002-ab03-402a765a7d7f',
      homeTeamRef: 'fvp_liga-norte_santutxu-ht', awayTeamRef: 'fvp_liga-norte_cp-burgos',
      status: 'finished', homeScore: 3, awayScore: 2,
      scheduledAt: '2026-10-03T15:30:00.000Z', // 17:30 en Madrid (CEST)
      roundNumber: 1, roundType: 'regular', venueName: 'POLIDEPORTIVO DE TXURDINAGA',
    });
    expect(b.rounds.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(b.standings).toHaveLength(12);
    expect(b.standings[0]).toMatchObject({ teamRef: 'fvp_liga-norte_oberena-autoescuela-indurain', points: 9, phaseTitle: 'FASE REGULAR' });
    expect(b.unknownStates).toEqual([]);
  });

  it('un partido sin jugar no lleva marcador ni se da por terminado', () => {
    const b = buildFvpCompetition(comp('copa-liga-norte'), parseFvpTree(fx('tree-copa-liga-norte.json')), [], ctx);
    const pending = b.matches.filter((m) => m.status !== 'finished');
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((m) => m.homeScore === undefined && m.awayScore === undefined)).toBe(true);
  });

  it('copa: rondas de eliminatoria y equipos de la liga', () => {
    const b = buildFvpCompetition(comp('copa-liga-norte'), parseFvpTree(fx('tree-copa-liga-norte.json')), [], ctx);
    expect(b.matches).toHaveLength(7); // 3 previas + 4 cuartos; semis y final sin equipos aún
    expect(b.pendingTeams).toBe(3);
    expect(b.matches.filter((m) => m.roundRef === 'CUARTOS DE FINAL').every((m) => m.roundType === 'playoff' && m.stage === 'quarters')).toBe(true);
    expect(b.matches.every((m) => m.homeTeamRef.startsWith('fvp_liga-norte_'))).toBe(true);
  });

  it('un estado desconocido no toca el partido y se reporta', () => {
    const rows = parseFvpTree(fx('tree-liga-norte.json'));
    rows[0]!.estado = 'ALGO_NUEVO';
    const b = buildFvpCompetition(comp('liga-norte'), rows, [], ctx);
    expect(b.matches[0]!.status).toBeUndefined();
    expect(b.unknownStates).toEqual(['ALGO_NUEVO']);
  });
});

describe('parseFvpActa', () => {
  const acta = () => parseFvpActa(fx('partido-santutxu-burgos.json'), '6636af38');

  it('alineación con jugadores (ref de su ficha federativa) y cuerpo técnico', () => {
    const a = acta();
    const players = a.lineup.filter((l) => !l.role);
    expect(players).toHaveLength(20);
    expect(a.lineup.filter((l) => l.role)).toHaveLength(3);
    expect(players.every((l) => l.playerRef?.startsWith('fvp_player_'))).toBe(true);
    expect(players.find((l) => l.name === 'DIEGO CARNEROS')).toMatchObject({ isHome: true, jerseyNumber: 10, isGoalkeeper: true, isStarter: true });
    expect(affiliationIdOf('https://x/affiliations/6b7995ff-0da7-4123-ac76-8f1a2396bd62.webp')).toBe('6b7995ff-0da7-4123-ac76-8f1a2396bd62');
  });

  it('goles con marcador acumulado y jugador, en orden cronológico', () => {
    const goals = acta().events.filter((e) => e.eventType === 'goal');
    expect(goals.map((g) => [g.period, g.clock, g.isHome, g.detail, g.playerName])).toEqual([
      [1, '13:03', true, '1-0', 'HEGOI OLEAGA'],
      [1, '12:29', true, '2-0', 'ENDIKA ARANDIA'],
      [1, '02:47', true, '3-0', 'ENDIKA ARANDIA'],
      [2, '22:44', false, '3-1', 'PABLO GONZÁLEZ'],
      [2, '10:39', false, '3-2', 'JUAN VICENTE'],
    ]);
    expect(goals.every((g) => g.playerSourceRef?.startsWith('fvp_player_'))).toBe(true);
  });

  it('la falta directa es del equipo que lanza; tarjetas, tiempos muertos y faltas de equipo', () => {
    const a = acta();
    const fd = a.events.filter((e) => e.eventType === 'direct_foul');
    expect(fd).toEqual([expect.objectContaining({ isHome: false, detail: 'marcada', period: 2, clock: '22:44' })]);
    expect(a.events.filter((e) => e.eventType === 'blue_card')).toHaveLength(1);
    expect(a.events.filter((e) => e.eventType === 'timeout')).toHaveLength(6);
    expect(a.homeFouls + a.awayFouls).toBe(22);
    expect(a.unknownTypes).toEqual([]);
    expect(new Set(a.events.map((e) => e.sourceRef)).size).toBe(a.events.length);
  });

  it('con marcador oculto (benjamines) no se publica ningún gol', () => {
    const raw = fx('partido-santutxu-burgos.json') as Record<string, unknown>;
    raw['marcadorACero'] = true;
    const a = parseFvpActa(raw, 'x');
    expect(a.hiddenScore).toBe(true);
    expect(a.events.filter((e) => ['goal', 'penalty', 'direct_foul'].includes(e.eventType))).toEqual([]);
    expect(a.events.filter((e) => e.eventType === 'blue_card')).toHaveLength(1);
  });

  it('marcador y árbitro del acta', () => {
    expect(acta()).toMatchObject({ estado: 'FINISHED', homeScore: 3, awayScore: 2, referees: 'GORKA DE MIGUEL MARURI' });
  });
});

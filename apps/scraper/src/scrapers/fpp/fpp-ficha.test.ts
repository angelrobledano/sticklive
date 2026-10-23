import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFppJogo, parseFppTimeline, fedIdOf, splitPtName } from './fpp-ficha.parser.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fx = (f: string) => readFileSync(join(dir, f), 'utf8');

function load(id: string) {
  const jogo = parseFppJogo(fx(`jogo-${id}.html`));
  const players = new Set(jogo.lineup.filter((l) => !l.role && l.fedId).map((l) => l.fedId!));
  const events = parseFppTimeline(fx(`jogo-${id}.timeline.html`), id, players);
  return { jogo, events };
}

describe('parseFppJogo', () => {
  it('marcador, faltas, árbitros, alineación y técnicos', () => {
    const j = parseFppJogo(fx('jogo-10522.html'));
    expect(j).toMatchObject({
      homeName: 'UD Oliveirense / Simoldes', awayName: "Riba d' Ave HC / CSJ Group",
      homeScore: 2, awayScore: 0, homeFouls: 8, awayFouls: 8,
      referees: 'Silvia Coelho, Jorge Machado, José Mendes, Marco Gomes',
    });
    const home = j.lineup.filter((l) => l.isHome && !l.role);
    expect(home.length).toBe(9);
    expect(home[0]).toMatchObject({ jerseyNumber: 1, name: 'Xano Edo', fedId: '85963', isStarter: true });
    expect(home.find((l) => l.name === 'B. BENEDETTO')).toMatchObject({ jerseyNumber: 3, isStarter: false });
    expect(home.filter((l) => l.isStarter).length).toBe(5);
    expect(j.lineup.filter((l) => !l.isHome && !l.role).length).toBe(10);
    expect(j.lineup.find((l) => l.name === 'Nuno Resende')).toMatchObject({ role: 'E1', isHome: true });
    expect(j.lineup.find((l) => l.name === 'Raúl Alves')).toMatchObject({ role: 'E2' });
    expect(j.lineup.find((l) => l.name === 'Avelino Bastos')).toMatchObject({ role: 'D' });
    expect(j.timelineQuery).toMatch(/^epoca=52&jogoNumero=3&clubeVisitado=277&.*token=[0-9a-f]{64}$/);
  });

  it('la ficha de copa (/jogoTaca) tiene la misma estructura', () => {
    const j = parseFppJogo(fx('jogoTaca-100883.html'));
    expect(j).toMatchObject({ homeScore: 3, awayScore: 4 });
    expect(j.timelineQuery).toContain('competicao=508');
    expect(j.lineup.filter((l) => !l.role).length).toBeGreaterThan(10);
  });
});

describe('parseFppTimeline', () => {
  it('goles con marcador acumulado, lado por alineación y jugador por id federativo', () => {
    const { events } = load('10522');
    const goals = events.filter((e) => e.eventType === 'goal');
    expect(goals.map((g) => [g.period, g.clock, g.detail, g.playerName, g.isHome])).toEqual([
      [2, '23:13', '1-0', 'B. BENEDETTO', true],
      [2, '16:32', '2-0', 'F. Navarro', true],
    ]);
    expect(goals[0]!.playerSourceRef).toBe('fpp_player_85962');
    // Crono restante 16:32 de la 2ª parte → minuto 9 de la parte.
    expect(goals[1]!.minute).toBe(9);
  });

  it('tarjetas, penaltis/libres fallados, faltas y tiempos muertos', () => {
    const { events } = load('10522');
    const count = (t: string) => events.filter((e) => e.eventType === t).length;
    expect(count('blue_card')).toBe(3);
    expect(events.find((e) => e.eventType === 'penalty')).toMatchObject({ detail: 'fallado', playerName: 'Marc Sayo', isHome: true });
    expect(events.filter((e) => e.eventType === 'direct_foul').map((e) => e.detail)).toEqual(['fallada', 'fallada']);
    expect(count('timeout')).toBe(6);
    expect(events.filter((e) => e.eventType === 'foul').every((e) => e.playerName === null)).toBe(true);
    // Visitante: alineado a la derecha.
    expect(events.find((e) => e.eventType === 'blue_card' && e.playerName === 'Anderson Silva')!.isHome).toBe(false);
    // Las advertencias verbales/amarillas no tienen equivalente.
    expect(events.some((e) => e.playerName === 'Raul Lopes')).toBe(false);
  });

  it('un "Golo Penalti" es gol + penalti marcado', () => {
    const { events } = load('15035');
    const pen = events.find((e) => e.eventType === 'penalty' && e.detail === 'marcado')!;
    expect(pen.playerName).toBe('José Miranda');
    expect(events.find((e) => e.eventType === 'goal' && e.clock === pen.clock)!.playerName).toBe('José Miranda');
    expect(events.filter((e) => e.eventType === 'goal').map((g) => g.detail)).toEqual(['1-0', '2-0', '3-0', '4-0', '5-0']);
  });

  it('prórroga: las partes tras "Prolongamento" son los periodos 3 y 4', () => {
    const { jogo, events } = load('17966');
    const goals = events.filter((e) => e.eventType === 'goal');
    expect(goals.length).toBe(jogo.homeScore! + jogo.awayScore!);
    expect(goals.at(-1)).toMatchObject({ period: 4, clock: '01:47', detail: '2-3', playerName: 'Xavier Lopes' });
    expect(new Set(events.map((e) => e.period))).toEqual(new Set([1, 2, 3, 4]));
  });

  it('quita los eventos duplicados de la fuente (mismo gol dos veces)', () => {
    const { jogo, events } = load('17386');
    expect(events.filter((e) => e.eventType === 'goal').length).toBe(jogo.homeScore! + jogo.awayScore!);
  });

  it('refs únicas y estables entre capturas', () => {
    const a = load('10522').events.map((e) => e.sourceRef);
    const b = load('10522').events.map((e) => e.sourceRef);
    expect(new Set(a).size).toBe(a.length);
    expect(a).toEqual(b);
    expect(a[0]).toMatch(/^fpp_event_10522_p\d_/);
  });
});

describe('helpers', () => {
  it('fedIdOf', () => {
    expect(fedIdOf('https://plataforma.fpp.pt/Files/FED/FED_85001_90000/FED_85963.jpg')).toBe('85963');
    expect(fedIdOf('https://plataforma.fpp.pt/Files/FED/FED_75001_80000/FED_77553.jpeg')).toBe('77553');
    expect(fedIdOf('')).toBeNull();
  });
  it('splitPtName: "Nombre Apellidos"', () => {
    expect(splitPtName('Xano Edo')).toEqual({ firstName: 'Xano', lastName: 'Edo' });
    expect(splitPtName('F. Navarro')).toEqual({ firstName: 'F.', lastName: 'Navarro' });
    expect(splitPtName('Platero')).toEqual({ firstName: '', lastName: 'Platero' });
  });
});

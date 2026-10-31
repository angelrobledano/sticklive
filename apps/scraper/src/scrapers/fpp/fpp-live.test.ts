import { describe, it, expect } from 'vitest';
import { parseFppDireto, classifyState, pairKey } from './fpp-live.parser.js';
import { matchItems, parseScore, implausibleJump, goneLive } from './fpp-live.parser.js';

/**
 * ⚠️ FIXTURE SINTÉTICO: reconstruido a partir del CSS de /Direto (23/10/2026,
 * sin partidos en juego). Sustituir por una captura real del primer directo
 * (sábado 24/10, 2ª y 3ª Divisão) y ajustar `classifyState` si hace falta.
 */
const DIRETO = `
<ul class="lista-jogos">
  <li><h5 class="titulo-competicao">CN 2ª Divisão Norte</h5></li>
  <li class="jogo-item">
    <div class="team-section team-visitada"><img class="team-logo" src="x.png"><p class="team-name">HC Maia </p></div>
    <div class="resultado-info"><p class="resultado">2 - 1</p><p class="data-hora">2026-10-24 15:00</p>
      <p class="estado-jogo"><i class="fa fa-circle"></i> 2ª Parte</p></div>
    <div class="team-section team-visitante"><img class="team-logo" src="y.png"><p class="team-name">CD Cucujães</p></div>
    <div class="link-icons"><a href="/jogo/20001"><i class="fa fa-search"></i></a></div>
  </li>
  <li class="jogo-item">
    <div class="team-section team-visitada"><p class="team-name">AD Valongo</p></div>
    <div class="resultado-info"><p class="resultado">3 - 3</p><p class="estado-jogo">Intervalo</p></div>
    <div class="team-section team-visitante"><p class="team-name">CA Feira</p></div>
  </li>
  <li class="jogo-item">
    <div class="team-section team-visitada"><p class="team-name">GD Sesimbra</p></div>
    <div class="resultado-info"><p class="resultado">4 - 0</p><p class="estado-jogo">Terminado</p></div>
    <div class="team-section team-visitante"><p class="team-name">CI Sagres</p></div>
    <div class="link-icons"><a href="/jogoTaca/100999">ficha</a></div>
  </li>
  <li class="jogo-item">
    <div class="team-section team-visitada"><p class="team-name">HC Fão</p></div>
    <div class="resultado-info"><p class="resultado">-</p><p class="data-hora">18:00</p><p class="estado-jogo">18:00</p></div>
    <div class="team-section team-visitante"><p class="team-name">CENAP</p></div>
  </li>
</ul>`;

describe('parseFppDireto', () => {
  it('lee competición, equipos, marcador, estado y ficha', () => {
    const items = parseFppDireto(DIRETO);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      competition: 'CN 2ª Divisão Norte', homeName: 'HC Maia', awayName: 'CD Cucujães',
      homeScore: 2, awayScore: 1, state: 'live', blinking: true, jogoPath: '/jogo/20001',
    });
    expect(items[1]).toMatchObject({ state: 'halftime', homeScore: 3, awayScore: 3, jogoPath: null });
    expect(items[2]).toMatchObject({ state: 'finished', jogoPath: '/jogoTaca/100999' });
    expect(items[3]).toMatchObject({ state: 'scheduled', homeScore: null });
  });

  it('una página sin partidos devuelve lista vacía', () => {
    expect(parseFppDireto('<ul class="lista-jogos"></ul>')).toEqual([]);
  });
});

describe('classifyState', () => {
  it.each([
    ['1ª Parte', false, 'live'],
    ['2ª Parte', true, 'live'],
    ['Prolongamento', false, 'live'],
    ['A decorrer', false, 'live'],
    ['Intervalo', false, 'halftime'],
    ['Final', false, 'finished'],
    ['Terminado', false, 'finished'],
    ['Jogo Terminado', false, 'finished'],
    ['18:00', false, 'scheduled'],
    ['', false, 'scheduled'],
    ['Adiado', false, 'scheduled'],
  ] as const)('"%s" (punto=%s) → %s', (text, blink, state) => {
    expect(classifyState(text, blink)).toBe(state);
  });

  it('un texto desconocido NO se interpreta (salvo punto rojo)', () => {
    expect(classifyState('Algo novo', false)).toBe('unknown');
    expect(classifyState('Algo novo', true)).toBe('live');
  });

  it('"1/2 Final" es una ronda, no "terminado"', () => {
    expect(classifyState('1/2 Final', false)).not.toBe('finished');
  });
});

describe('matchItems', () => {
  const cand = (id: string, home: string, away: string, url: string | null = null) => ({
    id, season_id: 's', sport_id: 'sp', source_ref: `fpp_match_${id}`, source_url: url, status: 'scheduled',
    home_team_id: 'h', away_team_id: 'a', home_name: home, away_name: away,
  });

  it('casa por ficha enlazada y, si no, por nombres sin acentos ni espacios', () => {
    const items = parseFppDireto(DIRETO);
    const pairs = matchItems(items, [
      cand('1', 'Otro', 'Nombre', 'https://hp.fpp.pt/jogo/20001'),
      cand('2', 'AD VALONGO', 'C.A. Feira'),
      cand('3', 'Nadie', 'Juega'),
    ]);
    expect(pairs.map((p) => [p.cand.id, p.item.homeName])).toEqual([['1', 'HC Maia'], ['2', 'AD Valongo']]);
  });

  it('pairKey ignora acentos, mayúsculas y signos', () => {
    expect(pairKey('HC Fão', 'C.E.N.A.P.')).toBe(pairKey('hc fao', 'CENAP'));
  });
});

describe('directo FPP: Elite Cup 30/10 (7-22 y horas en directo)', () => {
  it('feed real: la ficha se enlaza en relativo («jogo/18553») y se normaliza', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const html = readFileSync(fileURLToPath(new URL('./__fixtures__/direto-2026-10-31.html', import.meta.url)), 'utf8');
    const items = parseFppDireto(html);
    expect(items.length).toBeGreaterThan(20);
    expect(items.filter((i) => i.jogoPath).length).toBeGreaterThan(20);
    expect(items.every((i) => !i.jogoPath || /^\/jogo(Taca)?\/\d+$/.test(i.jogoPath))).toBe(true);
  });

  it('el marcador no se lee de una hora pegada', () => {
    expect(parseScore(' 7 - 3 ')).toEqual([7, 3]);
    expect(parseScore('7 - 22:10')).toBeNull();
    expect(parseScore(' - 18:30')).toBeNull();
    expect(parseScore("2 - 1 22'")).toEqual([2, 1]);
  });

  it('salto imposible entre ciclos', () => {
    expect(implausibleJump({ home: 7, away: 3 }, { home: 7, away: 22 })).toBe(true);
    expect(implausibleJump({ home: 7, away: 3 }, { home: 8, away: 3 })).toBe(false);
    expect(implausibleJump({ home: null, away: null }, { home: 7, away: 3 })).toBe(false);
  });

  it('en juego que ya no sale en el feed y empezó hace más de 2,5 h → terminado', () => {
    const now = new Date('2026-10-31T00:30:00Z');
    const c = (id: string, startedH: number, status = 'live') => ({
      id, season_id: 's', sport_id: 'x', source_ref: id, source_url: null, status,
      home_team_id: 'h', away_team_id: 'a', home_name: 'A', away_name: 'B',
      started_at: new Date(now.getTime() - startedH * 3_600_000),
    });
    const item = parseFppDireto('<ul class="lista-jogos"><li class="jogo-item"><p class="team-name">X</p><p class="team-name">Y</p></li></ul>');
    const gone = goneLive(item, [c('viejo', 3.5), c('reciente', 1), c('casado', 4), c('prog', 4, 'scheduled')], new Set(['casado']), now);
    expect(gone.map((g) => g.id)).toEqual(['viejo']);
    expect(goneLive([], [c('viejo', 3.5)], new Set(), now)).toEqual([]);
  });
});

describe('directo FPP real con partidos en juego (31/10, 16:05)', () => {
  it('marcador del span, no pegado al periodo; en juego y terminado bien leídos', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const html = readFileSync(fileURLToPath(new URL('./__fixtures__/direto-2026-10-31-live.html', import.meta.url)), 'utf8');
    const items = parseFppDireto(html);
    const benfica = items.filter((i) => i.homeName.startsWith('SL Benfica') && i.awayName === 'Escola Livre A');
    expect(benfica.length).toBeGreaterThan(0);
    for (const b of benfica) expect(b).toMatchObject({ homeScore: 2, awayScore: 0, state: 'live' });
    const gulpi = items.filter((i) => i.homeName === 'ACD Gulpilhares' && /Sanjoanense/.test(i.awayName));
    for (const g of gulpi) expect(g).toMatchObject({ homeScore: 0, awayScore: 5, state: 'finished' });
  });
});

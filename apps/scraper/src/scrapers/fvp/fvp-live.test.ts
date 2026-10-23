import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFvpMarcadores, stateOfPeriod, clockOfActa } from './fvp-live.parser.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fx = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('parseFvpMarcadores (feed real del 23/10/2026, 21:00)', () => {
  const items = parseFvpMarcadores(fx('marcadores-en-juego.json'));

  it('lee todos los partidos del feed', () => {
    expect(items).toHaveLength(42);
    expect(items.every((i) => i.state !== 'unknown')).toBe(true);
  });

  it('terminado: periodo 30 con el acta cerrada', () => {
    const urd = items.find((i) => i.competitionName === 'LIGA NORTE' && i.state === 'finished');
    expect(urd).toMatchObject({ homeScore: 3, awayScore: 5, actaClosed: true, period: null });
  });

  it('en juego: parte y marcador', () => {
    const live = items.filter((i) => i.state === 'live');
    expect(live.map((i) => [i.competitionName, i.period, i.homeScore, i.awayScore])).toEqual([
      ['LIGA NORTE FEMENINA', 2, 3, 2],
      ['LIGA VASCA JUNIOR', 1, 1, 0],
      ['LIGA ESCOLAR INFANTIL R', 1, 0, 0],
    ]);
  });

  it('sin empezar no trae estado de juego', () => {
    expect(items.filter((i) => i.state === 'scheduled').length).toBe(38);
  });

  it('marcador oculto: no se publica el marcador', () => {
    const raw = fx('marcadores-en-juego.json') as Array<{ matches: Array<Record<string, unknown>> }>;
    raw[0]!.matches[0]!['marcadorACero'] = true;
    const it0 = parseFvpMarcadores(raw)[0]!;
    expect(it0).toMatchObject({ hiddenScore: true, homeScore: null, awayScore: null });
  });

  it('forma rara → error explícito', () => {
    expect(() => parseFvpMarcadores({})).toThrow(/no es una lista/);
    expect(() => parseFvpMarcadores([{ competicionNombre: 'X' }])).toThrow(/sin "matches"/);
  });
});

describe('stateOfPeriod / clockOfActa', () => {
  it('solo con señal conocida', () => {
    expect(stateOfPeriod(0)).toBe('scheduled');
    expect(stateOfPeriod(1)).toBe('live');
    expect(stateOfPeriod(4)).toBe('live');
    expect(stateOfPeriod(30)).toBe('finished');
    expect(stateOfPeriod(9)).toBe('halftime');
    expect(stateOfPeriod(15)).toBe('unknown');
    expect(stateOfPeriod(null)).toBe('unknown');
  });
  it('crono restante del acta', () => {
    expect(clockOfActa({ periodo: 2, cronoMin: 12, cronoSec: 5, cronoEnMarcha: true })).toEqual({ period: 2, seconds: 725, running: true });
    expect(clockOfActa({ periodo: 30, cronoMin: 0, cronoSec: 0, cronoEnMarcha: false })).toEqual({ period: null, seconds: 0, running: false });
  });
});

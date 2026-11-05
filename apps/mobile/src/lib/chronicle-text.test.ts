import { describe, expect, it } from 'vitest';
import type { ChronicleFact } from '@sports/core/match-chronicle';
import { dictionaries, resolveKey } from '@/src/i18n/locales';
import { chronicleSegments } from './chronicle-text';

const t = (key: string) => resolveKey(dictionaries.es, key);
const teams = { h: 'Liceo', a: 'Barça' };
const text = (f: ChronicleFact) => chronicleSegments(f, t, teams).map((s) => s.text).join('');

describe('chronicleSegments', () => {
  it('pone el equipo como enlace y el resto como texto (remontada)', () => {
    const segs = chronicleSegments({ kind: 'comeback', teamId: 'h' }, t, teams);
    expect(segs[0]).toEqual({ text: 'Liceo', teamId: 'h' });
    expect(text({ kind: 'comeback', teamId: 'h' })).toBe('Liceo: perdía al descanso y ganó al final.');
  });

  it('primer gol: jugador enlazado en formato título y equipo sin enlace', () => {
    const f: ChronicleFact = { kind: 'opening_goal', teamId: 'a', playerId: 'p1', playerName: 'ANA FERRER', minute: 7 };
    const segs = chronicleSegments(f, t, teams);
    expect(segs).toContainEqual({ text: 'Ana Ferrer', playerId: 'p1' });
    expect(segs.some((s) => s.teamId)).toBe(false);
    expect(text(f)).toBe("Primer gol en el 7': Ana Ferrer (Barça).");
  });

  it('goles por parte enlaza a los dos equipos', () => {
    const f: ChronicleFact = {
      kind: 'period_goals', teamIds: ['h', 'a'],
      values: { homeFirst: 1, homeSecond: 2, awayFirst: 0, awaySecond: 1 },
    };
    const segs = chronicleSegments(f, t, teams);
    expect(segs.filter((s) => s.teamId).map((s) => s.teamId)).toEqual(['h', 'a']);
    expect(text(f)).toContain('Liceo marcó 1 en la primera parte y 2 en la segunda parte');
  });

  it('racha de goles calcula los minutos de diferencia', () => {
    expect(text({ kind: 'goal_flurry', teamId: 'h', values: { n: 3, from: 10, to: 14 } }))
      .toBe("Liceo marcó 3 goles en 4 minutos (10' y 14').");
  });

  it('tanda de penaltis con sus cifras', () => {
    expect(text({ kind: 'shootout', teamId: 'a', values: { home: 1, away: 2, rounds: 5, scored: 3, attempts: 10 } }))
      .toContain('Barça ganó la tanda de penaltis 1-2 tras 5 rondas');
  });

  it('jugador sin id sale como texto, sin enlace', () => {
    const segs = chronicleSegments({ kind: 'hat_trick', playerName: 'luis', goals: 3 }, t, teams);
    expect(segs.some((s) => s.playerId)).toBe(false);
    expect(segs.map((s) => s.text).join('')).toBe('Hat-trick de Luis.');
  });
});

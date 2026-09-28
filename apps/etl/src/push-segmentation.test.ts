import { describe, it, expect } from 'vitest';
import {
  wants, effectivePreset, PRESET_EVENTS, morningPendingSubs,
  type SubPrefs, type MorningSub, type MorningNightMatch,
} from './push-segmentation.js';

function sub(over: Partial<SubPrefs> = {}): SubPrefs {
  return { fav_teams: [], fav_leagues: [], fav_players: [], presets: {}, ...over };
}

describe('wants — segmentación por entidad seguida', () => {
  it('sigue por equipo local o visitante → recibe', () => {
    const s = sub({ fav_teams: ['T1'] });
    expect(wants(s, 'goal', ['T1', 'T2'], 'C1', null)).toBe(true);
    expect(wants(s, 'goal', ['T2', 'T1'], 'C1', null)).toBe(true);
  });
  it('sigue por competición → recibe', () => {
    expect(wants(sub({ fav_leagues: ['C1'] }), 'goal', ['T9'], 'C1', null)).toBe(true);
  });
  it('sigue por jugador → recibe su gol', () => {
    expect(wants(sub({ fav_players: ['P1'] }), 'goal', ['T9'], 'C9', 'P1')).toBe(true);
  });
  it('sin favoritos que casen → NO recibe (no spam)', () => {
    expect(wants(sub({ fav_teams: ['T1'] }), 'goal', ['T2', 'T3'], 'C2', 'P2')).toBe(false);
    expect(wants(sub(), 'goal', ['T1'], 'C1', 'P1')).toBe(false);
  });
});

describe('effectivePreset y catálogo PRESET_EVENTS', () => {
  it('entidad seguida sin preset explícito → complete', () => {
    expect(effectivePreset(sub({ fav_teams: ['T1'] }), 'team:T1')).toBe('complete');
  });
  it('preset inválido cae a complete; válido se respeta', () => {
    expect(effectivePreset(sub({ presets: { 'team:T1': 'basura' } }), 'team:T1')).toBe('complete');
    expect(effectivePreset(sub({ presets: { 'team:T1': 'results' } }), 'team:T1')).toBe('results');
  });
  it("'silent' no recibe ningún evento", () => {
    const s = sub({ fav_teams: ['T1'], presets: { 'team:T1': 'silent' } });
    expect(wants(s, 'goal', ['T1'], 'C1', null)).toBe(false);
    expect(wants(s, 'final', ['T1'], 'C1', null)).toBe(false);
  });
  it("'results' excluye 'goal' pero incluye 'final'; 'key_events' incluye 'start' y 'goal'", () => {
    expect(PRESET_EVENTS.results).not.toContain('goal');
    expect(PRESET_EVENTS.results).toContain('final');
    // #265: el preset por defecto al seguir debe avisar del inicio del partido.
    expect(PRESET_EVENTS.key_events).toContain('start');
    expect(PRESET_EVENTS.key_events).toContain('goal');
  });

  it("seguir con preset 'key_events' (por defecto) recibe el inicio del partido", () => {
    const s = sub({ fav_teams: ['T1'], presets: { 'team:T1': 'key_events' } });
    expect(wants(s, 'start', ['T1', 'T2'], 'C1', null)).toBe(true);
  });
  it("respeta el preset por entidad: 'results' no da gol aunque siga el equipo", () => {
    const s = sub({ fav_teams: ['T1'], presets: { 'team:T1': 'results' } });
    expect(wants(s, 'goal', ['T1'], 'C1', null)).toBe(false);
    expect(wants(s, 'final', ['T1'], 'C1', null)).toBe(true);
  });
});

// ── Resumen matinal: selección con ledger persistente (#383) ────────────────
function msub(over: Partial<MorningSub> = {}): MorningSub {
  return { id: 's1', fav_teams: [], fav_leagues: [], fav_players: [], presets: {}, config: {}, ...over };
}
const nightFinals: MorningNightMatch[] = [
  { matchId: 'm1', homeTeamId: 'T1', awayTeamId: 'T2', competitionId: 'C1' },
];

describe('morningPendingSubs — a quién toca el resumen matinal (#383)', () => {
  it('sin ledger y siguiendo un equipo del partido → recibe (con sus partidos)', () => {
    const out = morningPendingSubs([msub({ fav_teams: ['T1'] })], nightFinals, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]!.matches.map((m) => m.matchId)).toEqual(['m1']);
  });

  it('si ya está en el ledger del día → NO se repite', () => {
    const out = morningPendingSubs([msub({ fav_teams: ['T1'] })], nightFinals, new Set(['s1']));
    expect(out).toHaveLength(0);
  });

  it('master=false → excluido', () => {
    const out = morningPendingSubs([msub({ fav_teams: ['T1'], config: { master: false } })], nightFinals, new Set());
    expect(out).toHaveLength(0);
  });

  it('quietNight=false → excluido (ya recibió el final en directo)', () => {
    const out = morningPendingSubs([msub({ fav_teams: ['T1'], config: { quietNight: false } })], nightFinals, new Set());
    expect(out).toHaveLength(0);
  });

  it('sin partidos que siga → excluido', () => {
    const out = morningPendingSubs([msub({ fav_teams: ['OTRO'] })], nightFinals, new Set());
    expect(out).toHaveLength(0);
  });

  it('mezcla: solo devuelve las elegibles', () => {
    const out = morningPendingSubs(
      [
        msub({ id: 's1', fav_teams: ['T1'] }),          // sí
        msub({ id: 's2', fav_teams: ['OTRO'] }),        // no sigue el partido
        msub({ id: 's3', fav_teams: ['T1'], config: { master: false } }), // apagado
        msub({ id: 's4', fav_teams: ['T1'] }),          // ya servido
      ],
      nightFinals,
      new Set(['s4']),
    );
    expect(out.map((p) => p.sub.id)).toEqual(['s1']);
  });

  it('sigue por competición → también entra', () => {
    const out = morningPendingSubs([msub({ fav_leagues: ['C1'] })], nightFinals, new Set());
    expect(out).toHaveLength(1);
  });
});

import { describe, it, expect } from 'vitest';
import { wants, effectivePreset, PRESET_EVENTS, type SubPrefs } from './push-segmentation.js';

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

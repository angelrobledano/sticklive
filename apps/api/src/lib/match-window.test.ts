import { describe, it, expect } from 'vitest';
import { resolveCurrentWindow } from './match-window.js';

describe('resolveCurrentWindow', () => {
  it('SIN parámetros usa la ventana por defecto hoy-8d..hoy+15d (regresión del bug que vació la home)', () => {
    expect(resolveCurrentWindow({})).toEqual({ kind: 'relative', backDays: 8, fwdDays: 15 });
  });

  it('?days=N usa ventana simétrica de N', () => {
    expect(resolveCurrentWindow({ days: '30' })).toEqual({ kind: 'relative', backDays: 30, fwdDays: 30 });
  });

  it('?days inválido (no numérico, 0, negativo) cae a la ventana por defecto, NO a ±1', () => {
    expect(resolveCurrentWindow({ days: 'x' })).toEqual({ kind: 'relative', backDays: 8, fwdDays: 15 });
    expect(resolveCurrentWindow({ days: '0' })).toEqual({ kind: 'relative', backDays: 8, fwdDays: 15 });
    expect(resolveCurrentWindow({ days: '-5' })).toEqual({ kind: 'relative', backDays: 8, fwdDays: 15 });
  });

  it('?days se topa a 120', () => {
    expect(resolveCurrentWindow({ days: '999' })).toEqual({ kind: 'relative', backDays: 120, fwdDays: 120 });
  });

  it('?from&?to válidos → rango explícito', () => {
    expect(resolveCurrentWindow({ from: '2026-06-01', to: '2026-06-30' }))
      .toEqual({ kind: 'range', from: '2026-06-01', to: '2026-06-30' });
  });

  it('solo from (sin to) ignora el rango y usa el por defecto', () => {
    expect(resolveCurrentWindow({ from: '2026-06-01' })).toEqual({ kind: 'relative', backDays: 8, fwdDays: 15 });
  });
});

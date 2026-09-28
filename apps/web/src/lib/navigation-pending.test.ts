import { describe, it, expect } from 'vitest';
import {
  IDLE,
  PENDING_DELAY_MS,
  reducePending,
  shouldStartPending,
  shouldRenderPending,
  type ClickInfo,
} from './navigation-pending';

/**
 * #345: feedback de navegación SIN Suspense de ruta (no se puede añadir
 * `loading.tsx` a matches/teams/players: rompería el 404 real de #168).
 * `shouldStartPending` decide si un click inicia el indicador; `reducePending`
 * y `shouldRenderPending` fijan cuándo se pinta y cuándo se apaga.
 */

const ORIGIN = 'https://sticklive.eu';
const CURRENT = 'https://sticklive.eu/es';

function click(over: Partial<ClickInfo> = {}): ClickInfo {
  return { href: '/es/teams/abc', origin: ORIGIN, currentHref: CURRENT, button: 0, ...over };
}

describe('shouldStartPending (#345)', () => {
  it('inicia con click izquierdo a otra ruta interna', () => {
    expect(shouldStartPending(click())).toBe(true);
  });

  it('ignora clicks con modificadores (abrir en pestaña nueva)', () => {
    expect(shouldStartPending(click({ modifier: true }))).toBe(false);
  });

  it('ignora botones que no son el principal', () => {
    expect(shouldStartPending(click({ button: 1 }))).toBe(false);
    expect(shouldStartPending(click({ button: 2 }))).toBe(false);
  });

  it('ignora target distinto de _self, pero permite _self', () => {
    expect(shouldStartPending(click({ target: '_blank' }))).toBe(false);
    expect(shouldStartPending(click({ target: '_self' }))).toBe(true);
  });

  it('ignora descargas', () => {
    expect(shouldStartPending(click({ download: true }))).toBe(false);
  });

  it('ignora enlaces externos y protocolos no http(s)', () => {
    expect(shouldStartPending(click({ href: 'https://google.com/x' }))).toBe(false);
    expect(shouldStartPending(click({ href: 'mailto:a@b.com' }))).toBe(false);
    expect(shouldStartPending(click({ href: 'javascript:void(0)' }))).toBe(false);
  });

  it('ignora la misma página y los saltos de ancla', () => {
    expect(shouldStartPending(click({ href: '/es' }))).toBe(false);
    expect(shouldStartPending(click({ href: '#main' }))).toBe(false);
  });

  it('considera navegación un cambio de query en la misma ruta', () => {
    expect(shouldStartPending(click({ href: '/es?page=2' }))).toBe(true);
  });
});

describe('reducePending / shouldRenderPending (#345)', () => {
  it('start activa el estado con url y timestamp', () => {
    expect(reducePending(IDLE, { type: 'start', url: '/es/teams/a', at: 1000 })).toEqual({
      pending: true,
      url: '/es/teams/a',
      startedAt: 1000,
    });
  });

  it('settle (ruta llegada) y timeout apagan el indicador', () => {
    const started = reducePending(IDLE, { type: 'start', url: '/x', at: 0 });
    expect(reducePending(started, { type: 'settle' })).toEqual(IDLE);
    expect(reducePending(started, { type: 'timeout' })).toEqual(IDLE);
  });

  it('no pinta antes del retraso (evita el flash) y sí después', () => {
    const started = reducePending(IDLE, { type: 'start', url: '/x', at: 1000 });
    expect(shouldRenderPending(started, 1000)).toBe(false);
    expect(shouldRenderPending(started, 1000 + PENDING_DELAY_MS - 1)).toBe(false);
    expect(shouldRenderPending(started, 1000 + PENDING_DELAY_MS)).toBe(true);
    expect(shouldRenderPending(IDLE, 99_999)).toBe(false);
  });
});

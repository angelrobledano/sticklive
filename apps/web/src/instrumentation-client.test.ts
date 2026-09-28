import { describe, it, expect, vi } from 'vitest';

// Aislamos Sentry: solo probamos la lógica pura del módulo de instrumentación.
vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  replayIntegration: vi.fn(() => ({ name: 'Replay' })),
}));

import {
  sentryReplayPolicy,
  isStreamContainerId,
  stripLeftoverStreamContainers,
} from './instrumentation-client';

describe('sentryReplayPolicy (#340)', () => {
  it('sin consentimiento no graba sesión ni replay en error', () => {
    expect(sentryReplayPolicy('pending')).toEqual({
      enabled: false,
      sessionSampleRate: 0,
      onErrorSampleRate: 0,
    });
    expect(sentryReplayPolicy('denied')).toEqual({
      enabled: false,
      sessionSampleRate: 0,
      onErrorSampleRate: 0,
    });
  });

  it('con consentimiento desactiva la grabación continua y solo graba en error', () => {
    expect(sentryReplayPolicy('granted')).toEqual({
      enabled: true,
      sessionSampleRate: 0,
      onErrorSampleRate: 1,
    });
  });
});

describe('isStreamContainerId (#354)', () => {
  it('reconoce solo los contenedores S:n que inserta React al streamear', () => {
    expect(isStreamContainerId('S:0')).toBe(true);
    expect(isStreamContainerId('S:12')).toBe(true);
    expect(isStreamContainerId('B:0')).toBe(false);
    expect(isStreamContainerId('S:abc')).toBe(false);
    expect(isStreamContainerId(null)).toBe(false);
    expect(isStreamContainerId(undefined)).toBe(false);
  });
});

describe('stripLeftoverStreamContainers (#354)', () => {
  it('elimina solo los contenedores S:n y devuelve cuántos limpió', () => {
    const removed: string[] = [];
    const nodes = [
      { id: 'S:0', remove: () => removed.push('S:0') },
      { id: 'otro', remove: () => removed.push('otro') },
      { id: 'S:1', remove: () => removed.push('S:1') },
    ];
    const root = { querySelectorAll: () => nodes };

    expect(stripLeftoverStreamContainers(root)).toBe(2);
    expect(removed).toEqual(['S:0', 'S:1']);
  });
});

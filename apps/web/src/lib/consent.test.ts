import { describe, it, expect } from 'vitest';
import {
  CONSENT_KEY,
  parseConsent,
  serializeConsent,
  isAnalyticsAllowed,
  readConsent,
  writeConsent,
  type ConsentStorage,
} from './consent';

/** Almacenamiento en memoria para testear la persistencia sin navegador. */
function memoryStorage(initial: Record<string, string> = {}): ConsentStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key]! : null),
    setItem: (key, value) => { data[key] = value; },
  };
}

describe('parseConsent', () => {
  it('acepta solo los estados válidos', () => {
    expect(parseConsent('granted')).toBe('granted');
    expect(parseConsent('denied')).toBe('denied');
  });

  it('trata ausente, vacío o corrupto como pendiente', () => {
    expect(parseConsent(null)).toBe('pending');
    expect(parseConsent(undefined)).toBe('pending');
    expect(parseConsent('')).toBe('pending');
    expect(parseConsent('yes')).toBe('pending');
    expect(parseConsent('GRANTED')).toBe('pending');
  });
});

describe('serializeConsent', () => {
  it('hace round-trip con parseConsent', () => {
    for (const state of ['granted', 'denied', 'pending'] as const) {
      expect(parseConsent(serializeConsent(state))).toBe(state);
    }
  });
});

describe('isAnalyticsAllowed', () => {
  it('solo permite analítica con consentimiento explícito', () => {
    expect(isAnalyticsAllowed('granted')).toBe(true);
    expect(isAnalyticsAllowed('denied')).toBe(false);
    expect(isAnalyticsAllowed('pending')).toBe(false);
  });
});

describe('readConsent', () => {
  it('devuelve pendiente cuando no hay elección guardada', () => {
    expect(readConsent(memoryStorage())).toBe('pending');
  });

  it('lee la elección guardada', () => {
    expect(readConsent(memoryStorage({ [CONSENT_KEY]: 'granted' }))).toBe('granted');
    expect(readConsent(memoryStorage({ [CONSENT_KEY]: 'denied' }))).toBe('denied');
  });

  it('devuelve pendiente si el valor está corrupto', () => {
    expect(readConsent(memoryStorage({ [CONSENT_KEY]: 'whatever' }))).toBe('pending');
  });

  it('es tolerante a un almacenamiento ausente o que lanza', () => {
    expect(readConsent(null)).toBe('pending');
    const throwing: ConsentStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => undefined,
    };
    expect(readConsent(throwing)).toBe('pending');
  });
});

describe('writeConsent', () => {
  it('persiste la elección', () => {
    const storage = memoryStorage();
    writeConsent('granted', storage);
    expect(storage.data[CONSENT_KEY]).toBe('granted');
    expect(readConsent(storage)).toBe('granted');
  });

  it('no lanza si el almacenamiento está bloqueado', () => {
    const throwing: ConsentStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    };
    expect(() => writeConsent('granted', throwing)).not.toThrow();
  });

  it('no lanza sin almacenamiento (SSR)', () => {
    expect(() => writeConsent('denied', null)).not.toThrow();
  });
});

describe('browserStorage por defecto', () => {
  it('sin window (Node) el consentimiento por defecto es pendiente', () => {
    // Vitest corre en entorno node: no hay window.
    expect(readConsent()).toBe('pending');
  });

  it('no escribe sin window', () => {
    expect(() => writeConsent('granted')).not.toThrow();
  });
});

describe('integración de estados', () => {
  it('denegar no habilita analítica y persiste la decisión', () => {
    const storage = memoryStorage();
    writeConsent('denied', storage);
    expect(isAnalyticsAllowed(readConsent(storage))).toBe(false);
  });

  it('aceptar habilita analítica', () => {
    const storage = memoryStorage();
    writeConsent('granted', storage);
    expect(isAnalyticsAllowed(readConsent(storage))).toBe(true);
  });
});

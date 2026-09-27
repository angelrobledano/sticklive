import { describe, it, expect } from 'vitest';
import { buildBeaconBody } from './notification-beacon';

describe('buildBeaconBody', () => {
  it('conserva los campos válidos del beacon', () => {
    expect(
      buildBeaconBody({ endpoint: 'https://push.example/abc', type: 'goal', url: '/es/matches/1' }),
    ).toEqual({ endpoint: 'https://push.example/abc', type: 'goal', url: '/es/matches/1' });
  });

  it('descarta campos no esperados y aplica valores por defecto', () => {
    expect(buildBeaconBody({ endpoint: 123, type: { evil: true }, url: null, extra: 'x' })).toEqual({
      endpoint: null,
      type: 'unknown',
      url: '/',
    });
  });

  it('tolera entradas que no son objeto', () => {
    expect(buildBeaconBody(null)).toEqual({ endpoint: null, type: 'unknown', url: '/' });
    expect(buildBeaconBody('hola')).toEqual({ endpoint: null, type: 'unknown', url: '/' });
  });
});

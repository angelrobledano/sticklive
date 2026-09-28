import { describe, it, expect } from 'vitest';
import { corsOrigins } from './cors-origins.js';

describe('corsOrigins (#307) — localhost solo fuera de producción', () => {
  it('en producción solo permite el origen web declarado', () => {
    expect(corsOrigins({ nodeEnv: 'production', webBaseUrl: 'https://sticklive.eu' }))
      .toEqual(['https://sticklive.eu']);
  });

  it('en producción NUNCA incluye localhost:3001', () => {
    const origins = corsOrigins({ nodeEnv: 'production', webBaseUrl: 'https://sticklive.eu' });
    expect(origins).not.toContain('http://localhost:3001');
  });

  it('fuera de producción añade localhost:3001 para el dev local', () => {
    expect(corsOrigins({ nodeEnv: 'development', webBaseUrl: 'https://sticklive.eu' }))
      .toContain('http://localhost:3001');
  });

  it('no duplica localhost:3001 si ya es el origen web', () => {
    const origins = corsOrigins({ nodeEnv: 'development', webBaseUrl: 'http://localhost:3001' });
    expect(origins.filter((o) => o === 'http://localhost:3001')).toHaveLength(1);
  });

  it('sin webBaseUrl usa localhost por defecto', () => {
    expect(corsOrigins({ nodeEnv: 'development' })).toEqual(['http://localhost:3001']);
    expect(corsOrigins({ nodeEnv: 'production' })).toEqual(['http://localhost:3001']);
  });
});

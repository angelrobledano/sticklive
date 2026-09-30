import { describe, it, expect } from 'vitest';
import { scrapeRunStatus } from './scrape-log-status.js';

describe('scrapeRunStatus', () => {
  it('un scrape fallido es error aunque trajera algunas filas', () => {
    expect(scrapeRunStatus(false, 0, false)).toBe('error');
    expect(scrapeRunStatus(false, 5, false)).toBe('error');
  });

  it('éxito con filas es success', () => {
    expect(scrapeRunStatus(true, 3, false)).toBe('success');
  });

  it('éxito con 0 filas es success con records_found=0 (activa la alerta zero)', () => {
    // Es el caso que antes no dejaba NI fila: el "éxito silencioso".
    expect(scrapeRunStatus(true, 0, false)).toBe('success');
  });

  it('éxito con 0 filas esperadas (copas) es skipped y no alerta', () => {
    expect(scrapeRunStatus(true, 0, true)).toBe('skipped');
  });
});

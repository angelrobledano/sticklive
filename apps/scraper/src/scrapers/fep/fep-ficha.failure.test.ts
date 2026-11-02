import { describe, expect, it, vi } from 'vitest';
import { SidgadEgressError } from '../../egress/index.js';

const FEP_SOURCE_ID = '00000000-0000-4000-8000-000000000001';

function egressError(kind: 'forbidden' | 'client' | 'server', status: number): SidgadEgressError {
  return new SidgadEgressError({
    kind,
    message: `HTTP ${status}`,
    route: 'direct',
    portal: 'rfep',
    url: 'https://www.server2.sidgad.es/rfep/x.php',
    status,
    retryable: kind === 'server',
    failover: false,
  });
}

async function loadScraper() {
  // @sports/db valida DATABASE_URL al importar; no se conecta hasta query().
  process.env['DATABASE_URL'] = 'postgresql://test:test@127.0.0.1:5433/test';
  process.env['FEP_SOURCE_ID'] = FEP_SOURCE_ID;
  return import('./fep-ficha.scraper.js');
}

describe('FepFichaScraper — fallos de salida', () => {
  it('propaga un 403 como fallo del scraper, no como éxito con 0 eventos', async () => {
    const { FepFichaScraper } = await loadScraper();
    const post = vi.fn().mockRejectedValue(egressError('forbidden', 403));
    const scraper = new FepFichaScraper({ idp: '1', idc: '3150', client: { post } });

    const result = await scraper.run();

    expect(result.success).toBe(false);
    expect(result.data).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/HTTP 403/);
    // Patrones base para un idc que no es playoff.
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('un 404 en todos los patrones sigue siendo éxito vacío (acta no publicada)', async () => {
    const { FepFichaScraper } = await loadScraper();
    const post = vi.fn().mockRejectedValue(egressError('client', 404));
    const scraper = new FepFichaScraper({ idp: '1', idc: '3150', client: { post } });

    const result = await scraper.run();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('un 500 también se propaga (fallo de la fuente, no acta ausente)', async () => {
    const { FepFichaScraper } = await loadScraper();
    const post = vi.fn().mockRejectedValue(egressError('server', 503));
    const scraper = new FepFichaScraper({ idp: '1', idc: '3150', client: { post } });

    const result = await scraper.run();

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/HTTP 503/);
  });
});

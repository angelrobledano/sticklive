import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => { process.env['FEP_SOURCE_ID'] = '00000000-0000-0000-0000-000000000000'; });

import { isNotFound } from './fep-standings.scraper.js';

describe('clasificación inexistente (404)', () => {
  it('reconoce el 404 de sidgad por status o por mensaje', () => {
    expect(isNotFound(Object.assign(new Error('x'), { status: 404 }))).toBe(true);
    expect(isNotFound(new Error('SIDGAD devolvió 404 en https://www.server2.sidgad.es/fecapa/fecapa_clasif_idc_4817_1.php. No se reintenta.'))).toBe(true);
    expect(isNotFound(new Error('HTTP 404 en https://x/y.php'))).toBe(true);
  });
  it('no confunde otros errores', () => {
    expect(isNotFound(new Error('SIDGAD devolvió 403 en https://x'))).toBe(false);
    expect(isNotFound(Object.assign(new Error('x'), { status: 500 }))).toBe(false);
  });
});

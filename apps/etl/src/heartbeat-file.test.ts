import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { touchAlive } from './heartbeat-file.js';

describe('touchAlive', () => {
  it('crea/actualiza el fichero de latido con el instante', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alive-'));
    const f = join(dir, 'etl-alive');
    touchAlive(f, new Date(1_700_000_000_000));
    expect(existsSync(f)).toBe(true);
    expect(readFileSync(f, 'utf-8')).toBe('1700000000000');
  });

  it('no lanza si no se puede escribir (no debe romper el directo)', () => {
    expect(() => touchAlive('/no/existe/xyz/alive')).not.toThrow();
  });
});

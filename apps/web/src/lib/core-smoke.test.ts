import { expect, it } from 'vitest';
import { CORE_SMOKE } from '@sports/core/smoke';
it('la web resuelve @sports/core', () => expect(CORE_SMOKE).toBe('sports-core'));

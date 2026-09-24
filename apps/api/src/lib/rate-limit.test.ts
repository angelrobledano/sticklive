import { describe, it, expect, vi } from 'vitest';
import { rateLimit } from './rate-limit.js';

type Json = { body: unknown; status: number };
function makeCtx(path: string, ip: string) {
  const headers: Record<string, string> = {};
  const ctx = {
    req: { path, header: (k: string) => (k === 'x-forwarded-for' ? ip : undefined) },
    header: (k: string, v: string) => { headers[k] = v; },
    json: (body: unknown, status = 200): Json => ({ body, status }),
  };
  return { ctx, headers };
}
type FakeCtx = ReturnType<typeof makeCtx>['ctx'];
type Mw = (c: FakeCtx, next: () => Promise<void>) => Promise<Json | undefined>;

async function run(mw: Mw, c: FakeCtx): Promise<{ nextCalled: boolean; res: Json | undefined }> {
  let nextCalled = false;
  const res = await mw(c, async () => { nextCalled = true; });
  return { nextCalled, res };
}
const build = (max: number, windowMs: number): Mw =>
  rateLimit(max, windowMs) as unknown as Mw;

describe('rateLimit', () => {
  it('permite hasta max y bloquea con 429 + Retry-After al superarlo', async () => {
    const mw = build(2, 60_000);
    const { ctx, headers } = makeCtx('/auth/magic-link', '1.1.1.1');
    expect((await run(mw, ctx)).nextCalled).toBe(true);
    expect((await run(mw, ctx)).nextCalled).toBe(true);
    const third = await run(mw, ctx);
    expect(third.nextCalled).toBe(false);
    expect(third.res?.status).toBe(429);
    expect(headers['Retry-After']).toBeDefined();
  });

  it('resetea al expirar la ventana', async () => {
    vi.useFakeTimers();
    try {
      const mw = build(1, 1_000);
      const { ctx } = makeCtx('/x', '2.2.2.2');
      expect((await run(mw, ctx)).nextCalled).toBe(true);
      expect((await run(mw, ctx)).res?.status).toBe(429);
      vi.advanceTimersByTime(1_001);
      expect((await run(mw, ctx)).nextCalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aísla por IP y por ruta (buckets independientes)', async () => {
    const mw = build(1, 60_000);
    const a = makeCtx('/p', '3.3.3.3');
    const b = makeCtx('/p', '4.4.4.4');
    const c = makeCtx('/otra', '3.3.3.3');
    expect((await run(mw, a.ctx)).nextCalled).toBe(true);
    expect((await run(mw, a.ctx)).res?.status).toBe(429);
    expect((await run(mw, b.ctx)).nextCalled).toBe(true);
    expect((await run(mw, c.ctx)).nextCalled).toBe(true);
  });
});

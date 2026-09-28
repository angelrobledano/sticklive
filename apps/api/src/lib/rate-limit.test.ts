import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'hono';
import { rateLimit, clientIp } from './rate-limit.js';

// Contexto mínimo para probar clientIp sin levantar Hono.
// `conn` simula la IP de la conexión TCP (c.env.incoming.socket.remoteAddress).
function ipCtx(
  headers: Record<string, string | undefined> = {},
  conn?: string
): Context {
  return {
    req: {
      path: '/',
      header: (k: string) => headers[k.toLowerCase()],
    },
    env: conn ? { incoming: { socket: { remoteAddress: conn } } } : {},
  } as unknown as Context;
}

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

describe('clientIp', () => {
  it('devuelve la única entrada del XFF', () => {
    expect(clientIp(ipCtx({ 'x-forwarded-for': '1.2.3.4' }))).toBe('1.2.3.4');
  });

  it('toma la ÚLTIMA entrada del XFF, no la primera (#372)', () => {
    // Las entradas de la izquierda las puede falsificar el cliente; el proxy
    // de confianza fija/añade la real al final.
    expect(
      clientIp(ipCtx({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 203.0.113.7' }))
    ).toBe('203.0.113.7');
  });

  it('recorta espacios y descarta entradas vacías', () => {
    expect(clientIp(ipCtx({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8 ' }))).toBe('5.6.7.8');
    expect(clientIp(ipCtx({ 'x-forwarded-for': '1.2.3.4,' }))).toBe('1.2.3.4');
  });

  it('soporta IPv6 (incluida la forma mapeada ::ffff:)', () => {
    expect(clientIp(ipCtx({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientIp(ipCtx({ 'x-forwarded-for': '::ffff:1.2.3.4, 2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('sin XFF usa la IP de la conexión TCP', () => {
    expect(clientIp(ipCtx({}, '198.51.100.4'))).toBe('198.51.100.4');
  });

  it('sin XFF ni conexión cae a x-real-ip', () => {
    expect(clientIp(ipCtx({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('sin ninguna fuente devuelve unknown', () => {
    expect(clientIp(ipCtx())).toBe('unknown');
  });

  it('ignora un XFF en blanco y sigue con el fallback', () => {
    expect(clientIp(ipCtx({ 'x-forwarded-for': '   ', 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });
});

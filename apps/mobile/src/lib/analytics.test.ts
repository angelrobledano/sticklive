import { beforeEach, describe, expect, it, vi } from 'vitest';

// posthog-react-native se mockea entero: lo que se testea aquí es el WRAPPER
// (opciones del cliente, identidad por deviceId, passthrough tipado y no-op sin
// key), no el SDK. El módulo se importa DINÁMICAMENTE en cada test porque lee
// el env al cargar y beforeEach hace vi.resetModules().
const ph = vi.hoisted(() => ({
  instances: [] as {
    apiKey: string;
    options?: Record<string, unknown>;
    capture: ReturnType<typeof vi.fn>;
    identify: ReturnType<typeof vi.fn>;
  }[],
  distinctId: 'sdk-anon-uuid', // lo que "devuelve" getDistinctId del SDK mockeado
}));

vi.mock('posthog-react-native', () => ({
  PostHog: class {
    capture = vi.fn();
    identify = vi.fn();
    getDistinctId = vi.fn(() => ph.distinctId);
    apiKey!: string;
    options?: Record<string, unknown>;
    constructor(apiKey: string, options?: Record<string, unknown>) {
      this.apiKey = apiKey;
      this.options = options;
      ph.instances.push(this);
    }
  },
}));

vi.mock('@/src/lib/device', () => ({ getDeviceId: vi.fn(async () => 'device-123') }));

/** Drena las microtareas (la siembra de identidad es un .then async). */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  ph.instances.length = 0;
  ph.distinctId = 'sdk-anon-uuid';
  delete process.env['EXPO_PUBLIC_POSTHOG_KEY'];
  delete process.env['EXPO_PUBLIC_POSTHOG_HOST'];
});

describe('sin key (EXPO_PUBLIC_POSTHOG_KEY vacío)', () => {
  it('todo es no-op: sin cliente, sin error y sin envíos', async () => {
    const a = await import('./analytics');
    expect(a.getPostHogClient()).toBeNull();
    expect(() => a.capture('match_opened', { match_id: 'm1' })).not.toThrow();
    a.identifyUser('a@b.c');
    a.capture('live_tab_viewed');
    await flush();
    expect(ph.instances).toHaveLength(0);
  });
});

describe('con key', () => {
  beforeEach(() => {
    process.env['EXPO_PUBLIC_POSTHOG_KEY'] = 'phc_test';
  });

  it('crea UN único cliente con autocapture apagado y host EU por defecto', async () => {
    const a = await import('./analytics');
    const c1 = a.getPostHogClient();
    const c2 = a.getPostHogClient();
    expect(c1).not.toBeNull();
    expect(c1).toBe(c2); // singleton: el provider y los captures comparten cliente
    expect(ph.instances).toHaveLength(1);
    expect(ph.instances[0]!.apiKey).toBe('phc_test');
    expect(ph.instances[0]!.options).toMatchObject({
      host: 'https://eu.i.posthog.com',
      captureAppLifecycleEvents: false,
      errorTracking: { autocapture: false },
    });
  });

  it('respeta EXPO_PUBLIC_POSTHOG_HOST si está definido', async () => {
    process.env['EXPO_PUBLIC_POSTHOG_HOST'] = 'https://eu.i.posthog.com/proxy';
    const a = await import('./analytics');
    a.getPostHogClient();
    expect(ph.instances[0]!.options).toMatchObject({ host: 'https://eu.i.posthog.com/proxy' });
  });

  it('siembra la identidad anónima con el deviceId (persona = deviceId, paridad web)', async () => {
    const a = await import('./analytics');
    a.getPostHogClient();
    await flush();
    expect(ph.instances[0]!.identify).toHaveBeenCalledWith('device-123');
  });

  it('NO re-identifica si el SDK ya trae el deviceId persistido', async () => {
    ph.distinctId = 'device-123'; // arranque anónimo posterior al primero
    const a = await import('./analytics');
    a.getPostHogClient();
    await flush();
    expect(ph.instances[0]!.identify).not.toHaveBeenCalled();
  });

  it('capture pasa evento y props al cliente tal cual', async () => {
    const a = await import('./analytics');
    a.getPostHogClient();
    a.capture('match_opened', { match_id: 'm-1' });
    a.capture('live_tab_viewed');
    a.capture('push_failed', { reason: 'permiso_notificaciones_denegado' });
    expect(ph.instances[0]!.capture).toHaveBeenNthCalledWith(1, 'match_opened', { match_id: 'm-1' });
    expect(ph.instances[0]!.capture).toHaveBeenNthCalledWith(2, 'live_tab_viewed', undefined);
    expect(ph.instances[0]!.capture).toHaveBeenNthCalledWith(3, 'push_failed', {
      reason: 'permiso_notificaciones_denegado',
    });
  });

  it('un capture que lanza NO rompe al llamante (warn y seguir)', async () => {
    const a = await import('./analytics');
    a.getPostHogClient();
    const inst = ph.instances[0]!;
    inst.capture.mockImplementation(() => {
      throw new Error('storage roto');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => a.capture('favorite_added', { kind: 'team' })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('favorite_added'), expect.any(Error));
    warn.mockRestore();
  });

  it('identifyUser identifica con el email (login) y no lanza si el SDK falla', async () => {
    const a = await import('./analytics');
    a.getPostHogClient();
    const inst = ph.instances[0]!;
    a.identifyUser('user@example.com');
    expect(inst.identify).toHaveBeenCalledWith('user@example.com');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    inst.identify.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => a.identifyUser('user@example.com')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('si el deviceId falla, la identidad queda en warn y el cliente funciona', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const device = await import('@/src/lib/device');
    vi.mocked(device.getDeviceId).mockRejectedValueOnce(new Error('SecureStore ilegible'));
    const a = await import('./analytics');
    a.getPostHogClient();
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deviceId'), expect.any(Error));
    expect(ph.instances[0]!.identify).not.toHaveBeenCalled();
    expect(() => a.capture('live_tab_viewed')).not.toThrow();
    warn.mockRestore();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * F1-7 (`docs/AUDITORIA_SEO_2026-10-16.md`): una ficha cuyo id ya no existe
 * consulta `entity_redirects` antes de responder 404. Si la sustituye otra
 * entidad (fusión, placeholder adoptado por el partido real) → 308 a esa ficha.
 */
const permanentRedirect = vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); });
const notFound = vi.fn(() => { throw new Error('NOT_FOUND'); });
vi.mock('next/navigation', () => ({ permanentRedirect, notFound }));

const { redirectOrNotFound, TemporarilyHiddenError } = await import('./entity-redirect');

function stubApi(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('redirectOrNotFound', () => {
  it('sustituto vivo: 308 a su ficha en el mismo idioma', async () => {
    stubApi(200, { status: 'moved', newId: 'n1' });
    await expect(redirectOrNotFound('match', 'o1', 'pt')).rejects.toThrow('REDIRECT /pt/matches/n1');
  });

  it('cada tipo va a su ruta', async () => {
    stubApi(200, { status: 'moved', newId: 'n1' });
    await expect(redirectOrNotFound('competition', 'o1', 'es')).rejects.toThrow('REDIRECT /es/competitions/n1');
    await expect(redirectOrNotFound('team', 'o1', 'es')).rejects.toThrow('REDIRECT /es/teams/n1');
    await expect(redirectOrNotFound('player', 'o1', 'es')).rejects.toThrow('REDIRECT /es/players/n1');
  });

  it('baja sin sustituto o id desconocido: 404', async () => {
    stubApi(200, { status: 'gone' });
    await expect(redirectOrNotFound('team', 'o1', 'es')).rejects.toThrow('NOT_FOUND');
    stubApi(404, { error: 'not found' });
    await expect(redirectOrNotFound('team', 'o1', 'es')).rejects.toThrow('NOT_FOUND');
  });

  it('oculta por calidad hace menos de 72 h: error (5xx), Google reintenta y conserva la URL', async () => {
    const hace2h = new Date(Date.now() - 2 * 3600_000).toISOString();
    stubApi(200, { status: 'hidden', since: hace2h });
    await expect(redirectOrNotFound('match', 'o1', 'es')).rejects.toBeInstanceOf(TemporarilyHiddenError);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('oculta hace más de 72 h, o sin fecha (antes de la 075): 404', async () => {
    const hace4d = new Date(Date.now() - 4 * 24 * 3600_000).toISOString();
    stubApi(200, { status: 'hidden', since: hace4d });
    await expect(redirectOrNotFound('match', 'o1', 'es')).rejects.toThrow('NOT_FOUND');
    stubApi(200, { status: 'hidden', since: null });
    await expect(redirectOrNotFound('competition', 'o1', 'es')).rejects.toThrow('NOT_FOUND');
  });

  it('si la consulta de redirección falla, 404 (nunca un 5xx por esto)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(redirectOrNotFound('team', 'o1', 'es')).rejects.toThrow('NOT_FOUND');
    expect(permanentRedirect).not.toHaveBeenCalled();
  });
});

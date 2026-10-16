import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTeamDetail } from './client';

/**
 * SEO-03 / F1-9 (`docs/AUDITORIA_SEO_2026-10-16.md`): `/es/teams/{id}?season=zzz`
 * devolvía 500. La API responde 400 («season must be a UUID») y la página lo
 * trataba como caída. Un `?season=` que no es un UUID se ignora: la ficha se
 * sirve con la temporada por defecto.
 */
describe('getTeamDetail: parámetro season', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubFetch() {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  const calledUrl = (m: ReturnType<typeof stubFetch>) => String((m.mock.calls[0] as unknown[])[0]);

  it('un season que no es UUID no llega a la API', async () => {
    const fetchMock = stubFetch();
    await getTeamDetail('t1', 'zzz');
    expect(calledUrl(fetchMock)).toMatch(/\/teams\/t1$/);
  });

  it('un season UUID se pasa tal cual', async () => {
    const fetchMock = stubFetch();
    const id = '94b3708e-74e3-4d0e-a380-d0ddd8ed6b54';
    await getTeamDetail('t1', id);
    expect(calledUrl(fetchMock)).toContain(`/teams/t1?season=${id}`);
  });

  it('sin season, sin query', async () => {
    const fetchMock = stubFetch();
    await getTeamDetail('t1');
    expect(calledUrl(fetchMock)).toMatch(/\/teams\/t1$/);
  });
});

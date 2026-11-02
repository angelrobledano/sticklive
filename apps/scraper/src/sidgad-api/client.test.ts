import { describe, it, expect } from 'vitest';
import { SidgadApi, SidgadApiBlocked, parsePistas, parseProfile, sameSurname } from './client.js';

const cfg = { token: 'secreto', client: 'rfep', base: 'https://api.example', gapMs: 2000 };

describe('API de sidgad', () => {
  it('solo permite pabellones y fichas de jugador', async () => {
    const api = new SidgadApi(cfg, (async () => new Response('[]')) as never);
    await expect(api.get('scorer')).rejects.toThrow(/no permitido/);
    await expect(api.get('report', { id: '1' })).rejects.toThrow(/no permitido/);
  });

  it('espacia las peticiones y no pone el token en los mensajes', async () => {
    let t = 0; const waits: number[] = [];
    const api = new SidgadApi(cfg, (async () => new Response('{"pistas":[]}')) as never, () => t, async (ms) => { waits.push(ms); t += ms; });
    await api.get('pistas'); await api.get('pistas');
    expect(waits).toEqual([2000]);
    expect(api.describe('profile', { id: '1' })).not.toContain('secreto');
  });

  it('403 o token inválido paran la tanda', async () => {
    const a = new SidgadApi(cfg, (async () => new Response('', { status: 403 })) as never);
    await expect(a.get('pistas')).rejects.toBeInstanceOf(SidgadApiBlocked);
    const b = new SidgadApi(cfg, (async () => new Response('{"status":"INVALID TOKEN"}')) as never);
    await expect(b.get('pistas')).rejects.toBeInstanceOf(SidgadApiBlocked);
  });

  it('pabellones: dirección y código postal, sin rellenos «xxx»', () => {
    const v = parsePistas({ pistas: [
      { id_pista: '57', denominacion: "PALAU D'ESPORTS DE REUS", direccion_pista: 'C/ Escornalbou,19', codigo_postal: '43203', aforo: '1500', pavimento: 'TERRAZO' },
      { id_pista: '1', denominacion: 'POLIDEPORTIVO LOS CERROS', direccion_pista: 'xxx', codigo_postal: null, aforo: '0' },
    ] });
    expect(v[0]).toEqual({ id: '57', name: "PALAU D'ESPORTS DE REUS", street: 'C/ Escornalbou,19', postalCode: '43203', capacity: 1500, surface: 'TERRAZO' });
    expect(v[1]).toMatchObject({ street: null, postalCode: null, capacity: null });
  });

  it('ficha de jugador', () => {
    expect(parseProfile({ player: { name: 'MARTÍ', surname: 'SERRA MOLIST', date_born: '05/11/1996', image: 'https://sidgad.cloud/rfep/images/fichas/4095_2.jpg', nationality: 'ESPAÑOLA' } }))
      .toEqual({ firstName: 'MARTÍ', lastName: 'SERRA MOLIST', birthDate: '1996-11-05', nationality: 'ESPAÑOLA', photoUrl: 'https://sidgad.cloud/rfep/images/fichas/4095_2.jpg' });
    expect(parseProfile({ status: 'NO FILE' })).toBeNull();
  });

  it('el apellido tiene que coincidir (ids cruzados)', () => {
    expect(sameSurname('Serra Molist', 'SERRA MOLIST')).toBe(true);
    expect(sameSurname('García', 'SERRA MOLIST')).toBe(false);
  });
});

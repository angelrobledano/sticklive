import { describe, expect, it } from 'vitest';
import { isSidgadMediaHidden, isSidgadUrl, stripSidgadImages } from './sidgad-media.js';

describe('sidgad-media', () => {
  it('reconoce los hosts de SIDGAD y nada más', () => {
    expect(isSidgadUrl('https://sidgad.cloud/shared/portales_files/agentes/clubes/1.png')).toBe(true);
    expect(isSidgadUrl('https://www.server2.sidgad.es/rfep/x.jpg')).toBe(true);
    expect(isSidgadUrl('https://www.hockeypatines.fep.es/x.png')).toBe(true);
    expect(isSidgadUrl('https://hp.fpp.pt/logo.png')).toBe(false);
    expect(isSidgadUrl('https://fvpatinaje.eus/escudo.png')).toBe(false);
    expect(isSidgadUrl('https://evilsidgad.cloud/x.png')).toBe(false);
    expect(isSidgadUrl(null)).toBe(false);
    expect(isSidgadUrl('no-es-url')).toBe(false);
  });

  it('el interruptor solo se activa con un valor afirmativo', () => {
    expect(isSidgadMediaHidden({})).toBe(false);
    expect(isSidgadMediaHidden({ SIDGAD_MEDIA_HIDDEN: '0' })).toBe(false);
    expect(isSidgadMediaHidden({ SIDGAD_MEDIA_HIDDEN: '1' })).toBe(true);
  });

  it('pone a null las imágenes de SIDGAD a cualquier profundidad y deja el resto', () => {
    const input = {
      homeTeam: { name: 'A', logoUrl: 'https://sidgad.cloud/a.png' },
      awayTeam: { name: 'B', logoUrl: 'https://hp.fpp.pt/b.png' },
      lineups: [{ name: 'P', photo_url: 'https://sidgad.cloud/p.jpg', note: 'https://sidgad.cloud/x' }],
    };
    const { value, changed } = stripSidgadImages(input);
    expect(changed).toBe(true);
    expect(value).toEqual({
      homeTeam: { name: 'A', logoUrl: null },
      awayTeam: { name: 'B', logoUrl: 'https://hp.fpp.pt/b.png' },
      lineups: [{ name: 'P', photo_url: null, note: 'https://sidgad.cloud/x' }],
    });
    expect(stripSidgadImages({ a: 1 }).changed).toBe(false);
  });
});

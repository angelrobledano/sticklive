import { describe, it, expect } from 'vitest';
import { clubKeyFromLogo } from './sidgad-club.js';

/**
 * A4: el id de CLUB de sidgad es el nombre del fichero de escudo. Es estable
 * entre temporadas, competiciones, categorías y patrocinadores (el `teamId` es
 * de inscripción y cambia cada temporada). Es la clave que usa OKMob para
 * agrupar clubes (`rfep:calafell ↔ fecapa:322`).
 */
describe('clubKeyFromLogo', () => {
  it('numérico (FECAPA) y con variante _n', () => {
    expect(clubKeyFromLogo('https://sidgad.cloud/fecapa/images/logos_clubes/664.png')).toBe('664');
    expect(clubKeyFromLogo('https://sidgad.cloud/fecapa/images//logos_clubes/252_1.png')).toBe('252');
  });
  it('slug (RFEP)', () => {
    expect(clubKeyFromLogo('https://sidgad.cloud/rfep/images/logos_clubes/calafell.png')).toBe('calafell');
  });
  it('fichero suelto del teams_array', () => {
    expect(clubKeyFromLogo('fcbarcelona.png')).toBe('fcbarcelona');
  });
  it('escudos genéricos o vacíos no son clave de club', () => {
    expect(clubKeyFromLogo('')).toBeNull();
    expect(clubKeyFromLogo(null)).toBeNull();
    expect(clubKeyFromLogo('https://sidgad.cloud/rfep/images/logos_clubes/no_logo.png')).toBeNull();
    expect(clubKeyFromLogo('https://sidgad.cloud/rfep/images/logos_clubes/0.png')).toBeNull();
    expect(clubKeyFromLogo('https://x/y/escudo_defecto.jpg')).toBeNull();
  });
  it('un escudo fuera de logos_clubes (selecciones, competiciones) no cuenta', () => {
    expect(clubKeyFromLogo('https://sidgad.cloud/worldskate/images/logos_competiciones/325_1.png')).toBeNull();
  });
});

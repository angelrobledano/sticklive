import { describe, it, expect } from 'vitest';
import {
  idNumFromSourceRef, resolvePlayerPhoto, resolvePlayerPhotoIfNeeded,
  photoAreaForTeamRefs, PHOTO_CDNS, PHOTO_GAP, photoTargetFromRef,
} from './player-photo-url.js';

const RFEP = PHOTO_CDNS.rfep;
const WSE = PHOTO_CDNS.worldskate;

/**
 * Bug de cobertura: las fotos que el CDN sirve como `{id}.jpg` (sin `_n`) no se
 * encontraban porque solo se sondeaba `{id}_{1..6}.jpg` → 404 → silueta.
 */
describe('idNumFromSourceRef', () => {
  it('extrae el id de una ref fep_player_*', () => {
    expect(idNumFromSourceRef('fep_player_7455')).toBe('7455');
    expect(idNumFromSourceRef('fep_player_abc12')).toBe('abc12');
  });

  it('devuelve null si la ref no encaja (no tocar)', () => {
    for (const bad of ['', 'fep_player_', 'player_1', 'fep_team_1', 'fep_player_1_x']) {
      expect(idNumFromSourceRef(bad), bad).toBeNull();
    }
  });
});

describe('photoAreaForTeamRefs', () => {
  it('los equipos `wse_*` son del portal World Skate', () => {
    expect(photoAreaForTeamRefs(['wse_1130'])).toBe('worldskate');
  });

  it('los equipos de la FEP (clubes) son del portal rfep', () => {
    expect(photoAreaForTeamRefs(['fep_3408'])).toBe('rfep');
  });

  it('sin equipos o con refs desconocidas → rfep (comportamiento previo)', () => {
    expect(photoAreaForTeamRefs([])).toBe('rfep');
    expect(photoAreaForTeamRefs(['otro'])).toBe('rfep');
  });

  it('basta un equipo de World Skate para elegir ese portal', () => {
    expect(photoAreaForTeamRefs(['fep_1', 'wse_2'])).toBe('worldskate');
  });

  it('tolera refs nulas (equipo sin source_ref, o jugador sin equipo en team_players)', () => {
    expect(photoAreaForTeamRefs([null])).toBe('rfep');
    expect(photoAreaForTeamRefs([null, 'wse_2'])).toBe('worldskate');
    expect(photoAreaForTeamRefs([undefined])).toBe('rfep');
  });
});

describe('resolvePlayerPhoto', () => {
  it('recupera la foto que solo existe como {id}.jpg (el caso roto)', async () => {
    const existing = new Set([`${RFEP}/19297.jpg`]);
    expect(await resolvePlayerPhoto('19297', 'rfep', async (u) => existing.has(u))).toBe(`${RFEP}/19297.jpg`);
  });

  it('prefiere una variante _n sobre {id}.jpg cuando ambas existen', async () => {
    const existing = new Set([`${RFEP}/7455_1.jpg`, `${RFEP}/7455.jpg`]);
    expect(await resolvePlayerPhoto('7455', 'rfep', async (u) => existing.has(u))).toBe(`${RFEP}/7455_1.jpg`);
  });

  it('en World Skate con `{id}.jpg` y `{id}_1.jpg` presentes elige la variante (ambas son del jugador)', async () => {
    const existing = new Set([`${WSE}/89.jpg`, `${WSE}/89_1.jpg`]);
    expect(await resolvePlayerPhoto('89', 'worldskate', async (u) => existing.has(u))).toBe(`${WSE}/89_1.jpg`);
  });

  it('devuelve null cuando no existe ninguna (jugador sin foto)', async () => {
    expect(await resolvePlayerPhoto('999', 'rfep', async () => false)).toBeNull();
  });

  it('solo sondea la carpeta del portal pedido: una ficha en la OTRA carpeta NO cuenta', async () => {
    // Bug reportado: el id 89 existe en el portal FEP (otro jugador). Para el
    // jugador de World Skate eso no es su foto.
    const existing = new Set([`${RFEP}/89.jpg`]);
    const probed: string[] = [];
    const got = await resolvePlayerPhoto('89', 'worldskate', async (u) => {
      probed.push(u);
      return existing.has(u);
    });
    expect(got).toBeNull();
    expect(probed.length).toBe(PHOTO_GAP + 1);
    expect(probed.every((u) => u.startsWith(WSE))).toBe(true);
  });

  it('coge la ficha MÁS RECIENTE aunque pase de 6 (Marc Grau tiene _1…_8; antes se quedaba en _6, de 2024)', async () => {
    const existing = new Set(Array.from({ length: 8 }, (_, i) => `${RFEP}/4646_${i + 1}.jpg`));
    expect(await resolvePlayerPhoto('4646', 'rfep', async (u) => existing.has(u))).toBe(`${RFEP}/4646_8.jpg`);
  });

  it('tolera huecos en la numeración (una ficha borrada) hasta PHOTO_GAP seguidos', async () => {
    const existing = new Set([`${RFEP}/10_1.jpg`, `${RFEP}/10_4.jpg`]);
    expect(await resolvePlayerPhoto('10', 'rfep', async (u) => existing.has(u))).toBe(`${RFEP}/10_4.jpg`);
  });

  it('jugador sin foto: pocas peticiones (PHOTO_GAP huecos + {id}.jpg)', async () => {
    const probed: string[] = [];
    await resolvePlayerPhoto('999', 'rfep', async (u) => { probed.push(u); return false; });
    expect(probed).toHaveLength(PHOTO_GAP + 1);
  });
});

describe('resolvePlayerPhotoIfNeeded (pasada rápida)', () => {
  it('conserva la URL guardada si sigue existiendo y no hay ficha posterior', async () => {
    const stored = `${RFEP}/7455_1.jpg`;
    const calls: string[] = [];
    const exists = async (u: string) => { calls.push(u); return u === stored; };
    expect(await resolvePlayerPhotoIfNeeded('7455', 'rfep', stored, exists)).toBe(stored);
    // La guardada + PHOTO_GAP posteriores (_2…): nada de volver a empezar.
    expect(calls).toEqual([stored, ...Array.from({ length: PHOTO_GAP }, (_, i) => `${RFEP}/7455_${i + 2}.jpg`)]);
  });

  it('recoge la ficha nueva subida tras la guardada (_6 guardada, _7 y _8 nuevas)', async () => {
    const existing = new Set([6, 7, 8].map((n) => `${RFEP}/4646_${n}.jpg`));
    expect(await resolvePlayerPhotoIfNeeded('4646', 'rfep', `${RFEP}/4646_6.jpg`, async (u) => existing.has(u))).toBe(`${RFEP}/4646_8.jpg`);
  });

  it('si la guardada ya no existe, resuelve de cero (recupera {id}.jpg)', async () => {
    const existing = new Set([`${RFEP}/19297.jpg`]);
    const got = await resolvePlayerPhotoIfNeeded('19297', 'rfep', `${RFEP}/19297_1.jpg`, async (u) => existing.has(u));
    expect(got).toBe(`${RFEP}/19297.jpg`);
  });

  it('sin URL guardada, resuelve de cero', async () => {
    expect(await resolvePlayerPhotoIfNeeded('999', 'rfep', null, async () => false)).toBeNull();
  });

  it('corrige una URL guardada del portal EQUIVOCADO (colisión de id entre portales)', async () => {
    // Caso real: la ficha de España tenía guardada `/rfep/images/fichas/89.jpg`
    // (la foto de otro jugador en el portal FEP) existiendo la de World Skate.
    const existing = new Set([`${RFEP}/89.jpg`, `${WSE}/89.jpg`]);
    const got = await resolvePlayerPhotoIfNeeded('89', 'worldskate', `${RFEP}/89.jpg`, async (u) => existing.has(u));
    expect(got).toBe(`${WSE}/89.jpg`);
  });

  it('corrige una URL guardada de OTRO id (foto antigua que no se autocorregía)', async () => {
    // Caso real: `fep_player_7733` guardaba `fichas/28150_1.jpg`.
    const existing = new Set([`${RFEP}/28150_1.jpg`, `${RFEP}/7733.jpg`]);
    const got = await resolvePlayerPhotoIfNeeded('7733', 'rfep', `${RFEP}/28150_1.jpg`, async (u) => existing.has(u));
    expect(got).toBe(`${RFEP}/7733.jpg`);
  });
});

/**
 * A1/A3: con refs por portal, la carpeta del CDN sale de la propia ref. Antes
 * todo lo que no era `wse_*` iba a /rfep/: Martí Serra Molist (FECAPA 14782)
 * mostraba la foto del jugador 14782 de RFEP, otra persona.
 */
describe('photoTargetFromRef (A1/A3)', () => {
  it('FECAPA va a su propia carpeta', async () => {
    expect(photoTargetFromRef('fecapa_player_14782', [])).toEqual({ idNum: '14782', area: 'fecapa' });
    const probed: string[] = [];
    await resolvePlayerPhoto('14782', 'fecapa', async (u) => { probed.push(u); return false; });
    expect(probed[0]!).toContain('/fecapa/images/fichas/14782_');
  });
  it('wse_player_ va a worldskate', () => {
    expect(photoTargetFromRef('wse_player_192', [])).toEqual({ idNum: '192', area: 'worldskate' });
  });
  it('fep_player_ heredado sigue decidiendo por los equipos', () => {
    expect(photoTargetFromRef('fep_player_192', ['wse_1130'])).toEqual({ idNum: '192', area: 'worldskate' });
    expect(photoTargetFromRef('fep_player_4646', ['3408'])).toEqual({ idNum: '4646', area: 'rfep' });
  });
  it('una ref que no es de jugador no se toca', () => {
    expect(photoTargetFromRef('basura', [])).toBeNull();
  });
});

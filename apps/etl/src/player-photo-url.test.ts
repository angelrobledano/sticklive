import { describe, it, expect } from 'vitest';
import {
  photoCandidates, idNumFromSourceRef, resolvePlayerPhoto, resolvePlayerPhotoIfNeeded,
  PHOTO_CDN, MAX_PHOTO_INDEX,
} from './player-photo-url.js';

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

describe('photoCandidates', () => {
  it('prefiere las variantes _n de mayor a menor y termina con {id}.jpg', () => {
    expect(photoCandidates('7455')).toEqual([
      `${PHOTO_CDN}/7455_6.jpg`, `${PHOTO_CDN}/7455_5.jpg`, `${PHOTO_CDN}/7455_4.jpg`,
      `${PHOTO_CDN}/7455_3.jpg`, `${PHOTO_CDN}/7455_2.jpg`, `${PHOTO_CDN}/7455_1.jpg`,
      `${PHOTO_CDN}/7455.jpg`,
    ]);
    expect(photoCandidates('x')).toHaveLength(MAX_PHOTO_INDEX + 1);
  });
});

describe('resolvePlayerPhoto', () => {
  it('recupera la foto que solo existe como {id}.jpg (el caso roto)', async () => {
    const existing = new Set([`${PHOTO_CDN}/19297.jpg`]);
    expect(await resolvePlayerPhoto('19297', async (u) => existing.has(u))).toBe(`${PHOTO_CDN}/19297.jpg`);
  });

  it('prefiere una variante _n sobre {id}.jpg cuando ambas existen', async () => {
    const existing = new Set([`${PHOTO_CDN}/7455_1.jpg`, `${PHOTO_CDN}/7455.jpg`]);
    expect(await resolvePlayerPhoto('7455', async (u) => existing.has(u))).toBe(`${PHOTO_CDN}/7455_1.jpg`);
  });

  it('devuelve null cuando no existe ninguna (jugador sin foto)', async () => {
    expect(await resolvePlayerPhoto('999', async () => false)).toBeNull();
  });
});

describe('resolvePlayerPhotoIfNeeded (pasada rápida)', () => {
  it('conserva la URL guardada si sigue existiendo (una sola comprobación)', async () => {
    const stored = `${PHOTO_CDN}/7455_1.jpg`;
    const calls: string[] = [];
    const exists = async (u: string) => { calls.push(u); return u === stored; };
    expect(await resolvePlayerPhotoIfNeeded('7455', stored, exists)).toBe(stored);
    expect(calls).toEqual([stored]);
  });

  it('si la guardada ya no existe, resuelve de cero (recupera {id}.jpg)', async () => {
    const existing = new Set([`${PHOTO_CDN}/19297.jpg`]);
    const got = await resolvePlayerPhotoIfNeeded('19297', `${PHOTO_CDN}/19297_1.jpg`, async (u) => existing.has(u));
    expect(got).toBe(`${PHOTO_CDN}/19297.jpg`);
  });

  it('sin URL guardada, resuelve de cero', async () => {
    expect(await resolvePlayerPhotoIfNeeded('999', null, async () => false)).toBeNull();
  });
});

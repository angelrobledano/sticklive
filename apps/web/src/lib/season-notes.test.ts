import { describe, it, expect } from 'vitest';
import { SEASON_NOTES, seasonNote, seasonNoteI18nKey } from './season-notes';

/**
 * #389: la nota de temporada es un dato curado indexado por slug. La función
 * debe ser estricta: sin par exacto (competición + temporada) no hay nota, para
 * no colgar el texto equivocado en una temporada que no corresponde.
 */
describe('seasonNote (#389)', () => {
  it('devuelve la nota del caso curado', () => {
    expect(seasonNote('ok-liga-masculina', '2019-20')).toEqual({ code: 'covid', matchday: 25 });
  });

  it('no casa si la competición o la temporada no coinciden', () => {
    expect(seasonNote('ok-liga-masculina', '2020-21')).toBeNull();
    expect(seasonNote('copa-del-rey', '2019-20')).toBeNull();
  });

  it('no casa si falta algún slug (evita falsos positivos)', () => {
    expect(seasonNote(null, '2019-20')).toBeNull();
    expect(seasonNote('ok-liga-masculina', null)).toBeNull();
    expect(seasonNote(undefined, undefined)).toBeNull();
  });

  it('deriva la clave i18n del código', () => {
    expect(seasonNoteI18nKey('covid')).toBe('season.note.covid');
  });

  it('todas las notas curadas apuntan al namespace i18n esperado', () => {
    for (const note of Object.values(SEASON_NOTES)) {
      expect(seasonNoteI18nKey(note.code)).toMatch(/^season\.note\.[a-z_]+$/);
    }
  });
});

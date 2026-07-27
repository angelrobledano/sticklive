import { describe, it, expect } from 'vitest';
import { competitionName } from './names';

describe('competitionName', () => {
  it('elige el idioma activo cuando existe', () => {
    const i18n = { es: 'Campeonato de Europa Sub-17', en: 'U17 European Championship' };
    expect(competitionName('Campeonato de Europa Sub-17', i18n, 'en')).toBe('U17 European Championship');
  });

  it('cae al español si el idioma no está traducido', () => {
    const i18n = { es: 'OK Liga' }; // sólo es
    expect(competitionName('OK Liga', i18n, 'it')).toBe('OK Liga');
  });

  it('cae al name plano si name_i18n es null (fila sin traducir)', () => {
    expect(competitionName('Copa del Rey', null, 'en')).toBe('Copa del Rey');
  });

  it('cae al name plano si name_i18n es undefined', () => {
    expect(competitionName('OK Liga', undefined, 'fr')).toBe('OK Liga');
  });

  it('un objeto sin es ni el locale pedido cae al name', () => {
    // Caso defensivo: jsonb con una clave inesperada.
    expect(competitionName('OK Liga', { pt: 'Liga OK' }, 'en')).toBe('OK Liga');
  });
});

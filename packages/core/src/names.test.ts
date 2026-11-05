import { describe, it, expect } from 'vitest';
import {
  competitionName,
  clubName,
  playerDisplayName,
  teamTitleName,
  teamQualifiedName,
  teamDisplayName,
} from './names';

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

// #338: el title/meta de un partido debe usar el nombre COMPLETO normalizado,
// no el shortName (que `clubName()` degrada: "CPAH" → "Cpah").
describe('clubName (F3-2)', () => {
  it('resuelve siglas con puntos y une iniciales separadas', () => {
    expect(clubName('C.E. NOIA FREIXENET')).toBe('CE Noia Freixenet');
    expect(clubName('C.E NOIA FREIXENET')).toBe('CE Noia Freixenet');
    expect(clubName('C. P. SAN CRISTOBAL')).toBe('CP San Cristobal');
    expect(clubName('C.H. OLEIROS')).toBe('CH Oleiros');
  });

  it('conserva siglas cortas y baja conectores', () => {
    expect(clubName('IGUALADA RIGAT HC')).toBe('Igualada Rigat HC');
    expect(clubName('COPA DEL REY')).toBe('Copa del Rey');
    expect(clubName('OK LIGA')).toBe('OK Liga');
  });

  it('respeta nombres ya curados (con minúsculas)', () => {
    expect(clubName('CE Noia Freixenet')).toBe('CE Noia Freixenet');
    expect(clubName('Barça')).toBe('Barça');
    expect(clubName('HC Sant Just')).toBe('HC Sant Just');
  });

  it('no deja gritadas palabras cortas que no son siglas', () => {
    expect(clubName('CLUB PATIN ALCALA HOCKEY')).toBe('Club Patin Alcala Hockey');
    expect(clubName('REY SUR SAN')).toBe('Rey Sur San');
  });
});

describe('playerDisplayName', () => {
  it('conserva el apellido compuesto con partícula', () => {
    expect(playerDisplayName('CARLO', 'DI BENEDETTO')).toBe('Carlo Di Benedetto');
    expect(playerDisplayName('ANA', 'DE LA CRUZ')).toBe('Ana De La Cruz');
    expect(playerDisplayName('JOHN', 'VAN DER BERG')).toBe('John Van Der Berg');
  });

  it('usa solo el primer apellido cuando no es compuesto', () => {
    expect(playerDisplayName('FERRAN', 'FONT SÁNCHEZ')).toBe('Ferran Font');
  });
});

describe('teamQualifiedName (F3-4)', () => {
  it('añade la sección que falta sin duplicar la que ya está en el nombre', () => {
    expect(teamQualifiedName('España', 'Femenina · Sub-19')).toBe('España (Femenina · Sub-19)');
    expect(teamQualifiedName('España Femenina', 'Femenina · Sub-19')).toBe('España Femenina (Sub-19)');
    expect(teamQualifiedName('España Femenina Sub-19', 'Femenina · Sub-19')).toBe('España Femenina Sub-19');
    expect(teamQualifiedName('CE Noia', '')).toBe('CE Noia');
  });
});

describe('teamTitleName (#338)', () => {
  it('prefiere el nombre completo normalizado sobre el shortName', () => {
    expect(teamTitleName('CLUB PATIN ALCALA HOCKEY', 'CPAH')).toBe('Club Patin Alcala Hockey');
    expect(teamTitleName('DP BERENGUELA AXILTEC', 'DPBA')).toBe('DP Berenguela Axiltec');
  });

  it('conserva siglas reales (≤3 letras) del nombre completo', () => {
    expect(teamTitleName('IGUALADA RIGAT HC', null)).toBe('Igualada Rigat HC');
  });

  it('cae al shortName CRUDO (sin Title-Case) si no hay nombre completo', () => {
    expect(teamTitleName(null, 'CPAH')).toBe('CPAH');
    expect(teamTitleName('', 'GAT')).toBe('GAT');
    expect(teamTitleName(undefined, 'LUB')).toBe('LUB');
  });

  it('devuelve cadena vacía si no hay nada', () => {
    expect(teamTitleName(null, null)).toBe('');
    expect(teamTitleName(undefined, undefined)).toBe('');
  });
});

// Casos que venían de los tests de la app móvil.
describe('clubName (casos de la app)', () => {
  it('trata VIC como palabra y no como sigla (Vic, la ciudad)', () => {
    expect(clubName('CLUB PATI VIC')).toBe('Club Pati Vic');
    expect(clubName('CP VIC')).toBe('CP Vic');
  });

  it('devuelve cadena vacía ante un nombre vacío', () => {
    expect(clubName('')).toBe('');
  });
});

describe('teamDisplayName (alias deprecado de teamTitleName)', () => {
  it('es el mismo comportamiento que teamTitleName', () => {
    expect(teamDisplayName).toBe(teamTitleName);
  });

  it('prefiere el nombre completo sobre un shortName críptico', () => {
    expect(teamDisplayName('CLUB PATIN ALCOBENDAS', 'CPA')).toBe('Club Patin Alcobendas');
    expect(teamDisplayName('', 'CPA')).toBe('CPA');
    expect(teamDisplayName(null, 'CEV')).toBe('CEV');
    expect(teamDisplayName('   ', 'CEV')).toBe('CEV');
    expect(teamDisplayName(null, undefined)).toBe('');
  });
});

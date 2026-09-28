import { describe, it, expect } from 'vitest';
import {
  normalizeGender,
  squadLevelLetter,
  sectionSuffix,
  orderClubTeams,
  type ClubTeamRow,
} from './team-section.js';

/**
 * #196/#197: en hockey patines un club tiene varias "secciones" (club × género ×
 * categoría × filial) que hoy compartían nombre/escudo. Estos helpers derivan la
 * etiqueta compacta que las desambigua y fijan el orden del bloque "otros equipos
 * del club". Son puros y sin i18n (las siglas M/F/B son neutras).
 */

describe('normalizeGender (#196)', () => {
  it('acepta la escala cerrada de teams.gender (migración 032), case-insensitive', () => {
    expect(normalizeGender('male')).toBe('male');
    expect(normalizeGender('FEMALE')).toBe('female');
    expect(normalizeGender(' Mixed ')).toBe('mixed');
    expect(normalizeGender('unknown')).toBe('unknown');
  });

  it('valor ausente o desconocido → null (no inventa género)', () => {
    expect(normalizeGender(null)).toBeNull();
    expect(normalizeGender(undefined)).toBeNull();
    expect(normalizeGender('')).toBeNull();
    expect(normalizeGender('otro')).toBeNull();
  });
});

describe('squadLevelLetter (#196)', () => {
  it('1 = primer equipo (sin letra); 2 = B, 3 = C…', () => {
    expect(squadLevelLetter(1)).toBe('');
    expect(squadLevelLetter(2)).toBe('B');
    expect(squadLevelLetter(3)).toBe('C');
  });

  it('sin dato se asume primer equipo', () => {
    expect(squadLevelLetter(null)).toBe('');
    expect(squadLevelLetter(undefined)).toBe('');
  });

  it('niveles fuera de rango se recortan a Z (nunca caracteres raros)', () => {
    expect(squadLevelLetter(30)).toBe('Z');
    expect(squadLevelLetter(0)).toBe('');
    expect(squadLevelLetter(-3)).toBe('');
  });
});

describe('sectionSuffix (#196)', () => {
  it('femenino primer equipo → F', () => {
    expect(sectionSuffix({ gender: 'female', squad_level: 1 })).toBe('F');
  });

  it('masculino filial B → B (el masculino de primer equipo no lleva token)', () => {
    expect(sectionSuffix({ gender: 'male', squad_level: 2 })).toBe('B');
  });

  it('femenino filial C → F · C', () => {
    expect(sectionSuffix({ gender: 'female', squad_level: 3 })).toBe('F · C');
  });

  it('primer equipo masculino/sin género → vacío (no ensucia la lista)', () => {
    expect(sectionSuffix({ gender: 'male', squad_level: 1 })).toBe('');
    expect(sectionSuffix({})).toBe('');
    expect(sectionSuffix({ gender: 'mixed', squad_level: 1 })).toBe('');
  });
});

describe('orderClubTeams (#197)', () => {
  const rows: ClubTeamRow[] = [
    { id: 'f1', name: 'Club Fem', short_name: null, logo_url: null, gender: 'female', age_category: 'senior', squad_level: 1 },
    { id: 'm2', name: 'Club B', short_name: null, logo_url: null, gender: 'male', age_category: 'senior', squad_level: 2 },
    { id: 'm1', name: 'Club', short_name: null, logo_url: null, gender: 'male', age_category: 'senior', squad_level: 1 },
    { id: 'mj', name: 'Club Juvenil', short_name: null, logo_url: null, gender: 'male', age_category: 'juvenil', squad_level: 1 },
  ];

  it('ordena de forma determinista: género → categoría → filial → nombre', () => {
    expect(orderClubTeams(rows).map((r) => r.id)).toEqual(['mj', 'm1', 'm2', 'f1']);
  });

  it('no muta el array de entrada', () => {
    const before = rows.map((r) => r.id);
    orderClubTeams(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('datos incompletos no rompen el orden (nulos al final)', () => {
    const out = orderClubTeams([
      { id: 'x', name: 'Sin datos', short_name: null, logo_url: null },
      { id: 'm', name: 'Masculino', short_name: null, logo_url: null, gender: 'male', age_category: 'senior', squad_level: 1 },
    ]);
    expect(out.map((r) => r.id)).toEqual(['m', 'x']);
  });
});

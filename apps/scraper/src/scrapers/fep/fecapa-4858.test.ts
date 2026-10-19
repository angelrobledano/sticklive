import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// El módulo del scraper exige FEP_SOURCE_ID al importarse.
vi.hoisted(() => {
  process.env['FEP_SOURCE_ID'] = '00000000-0000-0000-0000-000000000000';
});

import * as cheerio from 'cheerio';
import { collectCalendarRows } from '../../core/sidgad-structure.js';
import { planSourceStructure } from '@sports/shared-types';
import { FepStandingsScraper } from './fep-standings.scraper.js';

/**
 * Caso real FECAPA idc 4858 — «FRIT RAVICH LLIGA CATALANA» 2026/27.
 *
 * Formato: 12 equipos en 3 grupos de 4 (una vuelta, 3 jornadas) y después
 * semifinales + final. El calendario trae las DOS fases en el mismo idc:
 * content_fase_4859 (grupos) y content_fase_5093 (eliminatorias).
 */

const calendarHtml = readFileSync(
  new URL('./__fixtures__/fecapa-4858-calendar.html', import.meta.url),
  'utf8',
);
const standingsHtml = readFileSync(
  new URL('./__fixtures__/fecapa-4858-standings.html', import.meta.url),
  'utf8',
);

describe('FECAPA 4858 — estructura del calendario', () => {
  const $ = cheerio.load(calendarHtml);
  const rows = collectCalendarRows($, 'fecapa');
  const plan = planSourceStructure(rows.map((r) => r.structure));

  it('lee las 18 jornadas de grupo y las 3 eliminatorias', () => {
    expect(rows).toHaveLength(21);
    expect(rows.filter((r) => r.structure.phaseRef === 'fecapa_fase_4859')).toHaveLength(18);
    expect(rows.filter((r) => r.structure.phaseRef === 'fecapa_fase_5093')).toHaveLength(3);
  });

  it('clasifica la fase catalana «FASE DE GRUPS» como grupos (no como liga)', () => {
    const groups = plan.phases.find((p) => p.ref === 'fecapa_fase_4859');
    expect(groups?.kind).toBe('groups');
    expect(groups?.rounds.map((r) => [r.number, r.roundType])).toEqual([
      [1, 'regular'],
      [2, 'regular'],
      [3, 'regular'],
    ]);
  });

  it('clasifica «FASES FINALS» como eliminatoria: semifinales y final', () => {
    const ko = plan.phases.find((p) => p.ref === 'fecapa_fase_5093');
    expect(ko?.kind).toBe('knockout');
    expect(ko?.rounds.map((r) => r.stage)).toEqual(['semis', 'final']);
  });
});

describe('FECAPA 4858 — clasificación', () => {
  const scraper = new FepStandingsScraper({ idc: '4858' });
  const standings = scraper.parseStandings(standingsHtml, '4858');

  it('lee los tres grupos A/B/C y descarta la tabla de la fase final', () => {
    expect(standings).toHaveLength(12);
    expect(standings.filter((s) => s.groupName === 'A')).toHaveLength(4);
    expect(standings.filter((s) => s.groupName === 'B')).toHaveLength(4);
    expect(standings.filter((s) => s.groupName === 'C')).toHaveLength(4);
  });

  it('extrae posición, puntos y goles del primer clasificado del grupo A', () => {
    const igualada = standings.find((s) => s.teamRef === 'IGUALADA HC');
    expect(igualada).toMatchObject({
      groupName: 'A',
      position: 1,
      played: 3,
      won: 3,
      drawn: 0,
      lost: 0,
      goalsFor: 16,
      goalsAgainst: 9,
      points: 9,
    });
  });

  it('conserva el CDN correcto del portal FECAPA en los escudos', () => {
    const withLogo = standings.find((s) => s.logoUrl);
    expect(withLogo?.logoUrl).toContain('/fecapa/images/logos_clubes/');
    expect(withLogo?.logoUrl).not.toContain('//logos_clubes');
  });
});

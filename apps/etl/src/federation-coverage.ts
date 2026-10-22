/**
 * B3 — Plan de cobertura de un portal autonómico (FECAPA primero).
 *
 * OKMob cubre 110 competiciones vigentes de FECAPA (base, femenino, territorial)
 * y Stick Live una. La materia prima es la misma (sidgad); falta el alta. Esto
 * lee el catálogo vigente del portal, clasifica cada competición y genera los
 * comandos de alta por `seed-fep-competition` (que ya aplica refs por portal,
 * clubes por escudo y refs de inscripción por temporada: A1/A4/A5).
 *
 * No escribe nada: imprime el plan. El alta se hace competición a competición
 * revisando el dry-run de cada seed, como dice el runbook de altas.
 *
 * CLI: apps/etl/src/plan-federation-coverage.ts
 */
import { FEDERATIONS, seasonLabelFromTempId } from './federations.js';
import { sourceForPortal, competitionSourceRefForSeed } from '../../scraper/src/core/sources.js';

export interface CatalogEntry { idc: string; name: string; group: string; tempId: string | null }
export interface Classification { gender: 'male' | 'female'; ageCategory: string; review: boolean; reason?: string }

const AGE_BY_WORD: Array<[RegExp, string]> = [
  [/\bPRE ?BENJAM[IÍ]/i, 'prebenjamin'],
  [/\bBENJAM[IÍ]/i, 'benjamin'],
  [/\bALEV[IÍ]/i, 'alevin'],
  [/\bINFANTIL/i, 'infantil'],
  [/\bJUVENIL/i, 'juvenil'],
  [/\bJ[UÚ]NIOR/i, 'junior'],
  [/\bVETERAN|M[AÀ]STER\s*\d+/i, 'veteranos'],
];

/** Femení N (sub-N) → la categoría mixta equivalente. Es una equivalencia, se marca para revisar. */
const FEM_AGE: Record<string, string> = { '19': 'junior', '17': 'juvenil', '15': 'infantil', '13': 'alevin', '11': 'benjamin' };

export function classifyCompetition(name: string, group: string): Classification {
  const text = `${name} ${group}`;
  const fem = /\bFEM(EN[IÍ]|ENINA)?\s*(\d{2})\b|\bFEM(\d{2})\b/i.exec(text);
  if (fem) {
    const n = fem[2] ?? fem[3]!;
    const age = FEM_AGE[n];
    return age
      ? { gender: 'female', ageCategory: age, review: true, reason: `Femení ${n}: equivalencia de edad a confirmar` }
      : { gender: 'female', ageCategory: 'base', review: true, reason: `Femení ${n} sin equivalencia` };
  }
  if (/MINIFEM|\bMINI\b/i.test(text)) {
    return { gender: /FEM/i.test(text) ? 'female' : 'male', ageCategory: 'base', review: true, reason: 'categoría mini' };
  }
  const female = /FEMENINA|FEMEN[IÍ]\b/i.test(name);
  for (const [re, age] of AGE_BY_WORD) {
    if (re.test(text)) return { gender: female ? 'female' : 'male', ageCategory: age, review: false };
  }
  if (/\b(NACIONAL|PRIMERA|SEGONA|TERCERA) CATALANA\b|\bLLIGA CATALANA\b/i.test(name)) {
    return { gender: female ? 'female' : 'male', ageCategory: 'senior', review: false };
  }
  return { gender: female ? 'female' : 'male', ageCategory: 'senior', review: true, reason: 'sin categoría reconocible en el nombre' };
}

export interface PlannedCompetition extends CatalogEntry, Classification { command: string }

export function planCoverage(portal: string, catalog: CatalogEntry[], existingRefs: ReadonlySet<string>) {
  const source = sourceForPortal(portal);
  const fed = FEDERATIONS.find((f) => f.prefix === portal);
  const existing: CatalogEntry[] = [];
  const pending: PlannedCompetition[] = [];
  for (const c of catalog) {
    if (existingRefs.has(competitionSourceRefForSeed(source, c.idc)) || existingRefs.has(c.idc)) {
      existing.push(c);
      continue;
    }
    const cls = classifyCompetition(c.name, c.group);
    const season = (c.tempId && seasonLabelFromTempId(c.tempId)?.replace(/^Temporada /, '')) || '2026/27';
    const startYear = Number(season.slice(0, 4));
    const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    const command = [
      `SIDGAD_PORTAL=${portal}`, `SIDGAD_REFERER=${source.client.referer}`,
      'npx tsx apps/etl/src/seed-fep-competition.ts',
      `--idc=${c.idc}`, `--name=${q(c.name)}`, `--gender=${cls.gender}`, `--age=${cls.ageCategory}`,
      `--organizer=${fed?.org ?? portal.toUpperCase()}`, ...(fed ? [`--region=${q(fed.region)}`] : []),
      '--scope=regional', `--season=${season}`, ...(c.tempId ? [`--temp=${c.tempId}`] : []),
      `--start=${startYear}-09-01`, `--end=${startYear + 1}-06-30`,
    ].join(' ');
    pending.push({ ...c, ...cls, command });
  }
  return { existing, pending };
}


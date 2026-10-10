/**
 * Resúmenes deterministas de lo que la plataforma ENTIENDE de una página real
 * de la fuente. Son la salida que la batería de casos reales compara con lo
 * aprobado (`esperado.json`). Ver `casos-reales/README.md`.
 *
 * Solo funciones puras: sin red, sin BD, reloj inyectado.
 */
import * as cheerio from 'cheerio';
import {
  STAGE_ORDER,
  planSourceStructure,
  type KnockoutStage,
  type PhaseKind,
  type ScrapedMatch,
  type StructurePlan,
  type StructureRow,
} from '@sports/shared-types';
import { collectCalendarRows } from '../core/sidgad-structure.js';
import { parseMcIdpIndex, parseMcStates } from '../scrapers/worldskate/mc-idp.js';
import { parseWorldskateCalendar } from '../scrapers/worldskate/worldskate.scraper.js';

const KIND: Record<PhaseKind, string> = { league: 'liga', groups: 'grupos', knockout: 'eliminatoria' };
const STAGE: Record<KnockoutStage, string> = {
  round_of_16: 'octavos', quarters: 'cuartos', semis: 'semis', final: 'final',
  third_place: 'tercer_puesto', placement: 'colocacion',
};

/**
 * Formato legible de un plan: la secuencia de fases tal y como la entiende la
 * plataforma. Es lo que se contrasta con el formato que dicen las normas de la
 * federación (`formato` en caso.json, escrito a mano).
 *
 *   liga → eliminatoria[cuartos,semis,final]·series → colocacion·series
 */
export function formatoDelPlan(plan: StructurePlan): string {
  return plan.phases.map((p) => {
    const asig = plan.assignments.filter((a) => a.phaseRef === p.ref);
    const maxGame = Math.max(0, ...asig.map((a) => a.seriesGame ?? 0));
    const serie = maxGame >= 3 ? '·series' : maxGame === 2 ? '·ida-vuelta' : '';
    // Colocación: se presenta como la fase por el título (series o partidos).
    if (p.isPlacement) return 'colocacion';
    if (p.kind !== 'knockout') return KIND[p.kind];
    const stages = [...new Set(p.rounds.map((r) => r.stage).filter((s): s is KnockoutStage => !!s))]
      .sort((a, b) => STAGE_ORDER[a] - STAGE_ORDER[b]);
    return `eliminatoria${stages.length ? `[${stages.map((s) => STAGE[s]).join(',')}]` : ''}${serie}`;
  }).join(' → ');
}

function detallePlan(rows: StructureRow[], plan: StructurePlan) {
  const roundOf = new Map(plan.phases.flatMap((p) => p.rounds.map((r) => [r.key, { p, r }] as const)));
  return {
    fases: plan.phases.map((p) => ({
      orden: p.ordinal,
      ref: p.ref,
      nombre: p.name,
      tipo: p.kind,
      colocacion: p.isPlacement,
      evidencia: p.resolvedBy,
      rondas: p.rounds.map((r) => ({
        numero: r.number,
        fase: r.stage,
        nombre: r.name,
        tipo: r.roundType,
        filas: plan.assignments.filter((a) => a.roundKey === r.key).length,
      })),
    })),
    // Una línea por fila del calendario: etiqueta de la fuente → cómo se entiende.
    filas: rows.map((row, i) => {
      const a = plan.assignments[i]!;
      const hit = roundOf.get(a.roundKey);
      const ronda = hit ? `F${hit.p.ordinal} R${hit.r.number}${hit.r.stage ? `/${STAGE[hit.r.stage]}` : ''}` : '¿?';
      const serie = a.seriesGame != null ? ` P${a.seriesGame}` : '';
      const grupo = a.groupName ? ` G${a.groupName}` : '';
      return `${row.date ?? 'sin-fecha'} | ${row.roundLabel ?? '(sin etiqueta)'} → ${ronda}${serie}${grupo} | ${row.homeRef ?? '¿'}-${row.awayRef ?? '¿'}`;
    }),
  };
}

export interface CasoCalendario {
  tipo: 'calendario';
  portal: string;
  ficheros: string[];
  declarado?: PhaseKind | null;
}

/** Calendario(s) sidgad de una competición → plan de estructura. */
export function resumirCalendario(caso: CasoCalendario, leer: (f: string) => string) {
  const rows: StructureRow[] = [];
  for (const f of caso.ficheros) {
    const $ = cheerio.load(leer(f));
    for (const r of collectCalendarRows($, caso.portal)) rows.push({ ...r.structure, docIndex: rows.length });
  }
  const plan = planSourceStructure(rows, { declaredKind: caso.declarado ?? null });
  return { formato: formatoDelPlan(plan), ...detallePlan(rows, plan) };
}

export interface CasoWorldskate {
  tipo: 'worldskate';
  calendario: string;
  matchCenter: string;
  zona: string;
}

function lineaPartido(m: ScrapedMatch): string {
  const marcador = m.homeScore != null && m.awayScore != null ? `${m.homeScore}-${m.awayScore}` : '·';
  const fase = m.stage ? `/${STAGE[m.stage]}` : '';
  const serie = m.seriesGame != null ? ` P${m.seriesGame}` : '';
  const grupo = m.groupName ? ` G${m.groupName}` : '';
  return `${m.scheduledAt ?? 'sin-fecha'} | ${m.homeTeamRef}-${m.awayTeamRef} | ${m.sourceRef ?? 'sin-idp'} | `
    + `${m.status ?? 'sin-estado'} ${marcador} | F${m.phaseOrdinal ?? '?'} ${m.roundRef ?? ''}${fase}${serie}${grupo}`;
}

/** Calendario World Skate + su match center del mismo instante → partidos y estructura. */
export function resumirWorldskate(caso: CasoWorldskate, leer: (f: string) => string, ahora: Date) {
  const html = leer(caso.calendario);
  const mc = leer(caso.matchCenter);
  const $ = cheerio.load(html);
  const rows = collectCalendarRows($, 'wse').map((r, i) => ({ ...r.structure, docIndex: i }));
  const plan = planSourceStructure(rows);
  const parsed = parseWorldskateCalendar(
    html, { seasonId: 'temporada', sourceId: 'fuente', timezone: caso.zona }, ahora,
    parseMcIdpIndex(mc), parseMcStates(mc),
  );
  return {
    formato: formatoDelPlan(plan),
    fases: detallePlan(rows, plan).fases,
    partidos: parsed.matches.map(lineaPartido).sort(),
  };
}

export interface CasoFeed {
  tipo: 'feed-fep';
  fichero: string;
}

/** Feed de directo FEP → estado y marcador de cada partido. */
export function resumirFeedFep(
  matches: ScrapedMatch[],
) {
  const estados: Record<string, number> = {};
  for (const m of matches) estados[m.status ?? 'sin-estado'] = (estados[m.status ?? 'sin-estado'] ?? 0) + 1;
  return {
    estados,
    partidos: matches.map((m) => {
      const marcador = m.homeScore != null && m.awayScore != null ? `${m.homeScore}-${m.awayScore}` : '·';
      return `${m.sourceRef} | ${m.homeTeamRef}-${m.awayTeamRef} | ${m.status ?? 'sin-estado'} ${marcador} | ${m.scheduledAt ?? 'sin-fecha'}`;
    }).sort(),
  };
}

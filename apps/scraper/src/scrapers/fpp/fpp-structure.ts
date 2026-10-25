/**
 * De filas crudas de la FPP (varias secciones = varios ids) a los DTO del ETL:
 * partidos, rondas y clasificaciones de UNA competición de Stick Live.
 *
 * La estructura (fases, rondas, grupos, eliminatorias) la decide
 * `planSourceStructure`, el mismo algoritmo que usan FEP y World Skate.
 *
 * Puro: sin red, sin BD y con el reloj inyectado.
 */
import type {
  ScrapedMatch, ScrapedRound, ScrapedStanding, MatchStatus, StructureRow,
} from '@sports/shared-types';
import { planSourceStructure } from '@sports/shared-types';
import { zonedToUtc } from '../../core/eu-timezone.js';
import {
  FPP_TIMEZONE, fppMatchRef, fppPhaseRef, fppTeamRef,
  type FppCompetition, type FppSection,
} from './fpp-catalog.js';
import { isPlaceholderTeam, type FppCalendarRow, type FppStandingRow } from './fpp.parser.js';

/** Base de la web. Configurable SOLO para pruebas locales (servidor falso). */
export const FPP_BASE_URL = process.env['FPP_BASE_URL'] ?? 'https://hp.fpp.pt';

/**
 * Margen tras la hora de inicio para dar por bueno un marcador del calendario.
 * La FPP pinta el marcador PROVISIONAL en el calendario mientras se juega, así
 * que un resultado no significa "terminado" hasta que el partido ha tenido
 * tiempo de acabar (2×25 min + descansos + tiempos muertos ≈ 1h45).
 */
export const FINISHED_GRACE_MIN = 150;

export interface FppSectionData {
  section: FppSection;
  calendar: FppCalendarRow[];
  standings: FppStandingRow[];
}

export interface FppBuildContext {
  seasonId: string;
  sourceId: string;
  now: Date;
  timezone?: string | null;
}

export interface FppBuilt {
  matches: ScrapedMatch[];
  rounds: ScrapedRound[];
  standings: ScrapedStanding[];
  /** Filas descartadas por equipos sin decidir ("Vencedor Jogo N"). */
  pendingTeams: number;
}

function kickoffUtc(row: FppCalendarRow, tz: string): Date | null {
  if (!row.date) return null;
  const [y, mo, d] = row.date.split('-').map(Number) as [number, number, number];
  const [h, mi] = (row.time ?? '00:00').split(':').map(Number) as [number, number];
  const at = zonedToUtc(tz, y, mo - 1, d, h, mi);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function buildFppCompetition(
  comp: FppCompetition,
  data: FppSectionData[],
  ctx: FppBuildContext,
): FppBuilt {
  const tz = ctx.timezone || FPP_TIMEZONE;
  const scrapedAt = ctx.now;
  const teamRef = (name: string) => fppTeamRef(comp.gender, comp.teamAge, name);

  // 1) Filas planas con su sección, en orden de sección y documento.
  const flat: Array<{ row: FppCalendarRow; section: FppSection; placeholder: boolean }> = [];
  for (const d of data) {
    for (const row of d.calendar) {
      flat.push({
        row, section: d.section,
        placeholder: isPlaceholderTeam(row.homeName) || isPlaceholderTeam(row.awayName),
      });
    }
  }

  const structureInput: StructureRow[] = flat.map(({ row, section, placeholder }, i) => ({
    phaseRef: fppPhaseRef(comp.key, section.phase),
    phaseTitle: section.phaseTitle,
    roundLabel: row.roundLabel || null,
    date: row.date,
    homeRef: placeholder ? null : teamRef(row.homeName),
    awayRef: placeholder ? null : teamRef(row.awayName),
    groupName: section.group,
    docIndex: i,
  }));
  const plan = planSourceStructure(structureInput);
  const phaseByRef = new Map(plan.phases.map((p) => [p.ref, p]));

  const phaseFields = (ref: string) => {
    const p = phaseByRef.get(ref)!;
    return {
      phaseRef: p.ref, phaseName: p.name, phaseKind: p.kind,
      phaseIsPlacement: p.isPlacement, phaseOrdinal: p.ordinal, phaseResolvedBy: p.resolvedBy,
    };
  };

  // 2) Partidos.
  const matches: ScrapedMatch[] = [];
  let pendingTeams = 0;
  flat.forEach(({ row, section, placeholder }, i) => {
    if (placeholder) { pendingTeams++; return; }
    const a = plan.assignments[i]!;
    const phase = phaseByRef.get(a.phaseRef)!;
    const round = phase.rounds.find((r) => r.key === a.roundKey)!;
    const at = kickoffUtc(row, tz);

    const hasScore = row.homeScore !== null && row.awayScore !== null;
    const settled = hasScore && !!at && ctx.now.getTime() - at.getTime() >= FINISHED_GRACE_MIN * 60_000;
    // Sin señal, el loader conserva el estado (nunca se declara "en juego" por reloj).
    const status: MatchStatus | undefined = settled ? 'finished' : undefined;

    matches.push({
      seasonId: ctx.seasonId,
      roundRef: round.name ?? undefined,
      roundNumber: round.number,
      roundType: round.roundType,
      homeTeamRef: teamRef(row.homeName),
      awayTeamRef: teamRef(row.awayName),
      homeScore: settled ? row.homeScore! : undefined,
      awayScore: settled ? row.awayScore! : undefined,
      status,
      scheduledAt: at?.toISOString(),
      groupName: a.groupName ?? undefined,
      competitionName: comp.name,
      sourceId: ctx.sourceId,
      sourceRef: fppMatchRef(section.fppId, row.numero),
      sourceUrl: row.jogoPath ? `${FPP_BASE_URL}${row.jogoPath}` : `${FPP_BASE_URL}/Competicao/${section.fppId}`,
      ...(row.videoUrl ? { videoUrl: row.videoUrl } : {}),
      scrapedAt,
      ...phaseFields(a.phaseRef),
      stage: round.stage,
      seriesGame: a.seriesGame,
    } as ScrapedMatch);
  });

  // 3) Rondas (también las de cruces sin decidir: la estructura existe ya).
  const rounds: ScrapedRound[] = [];
  for (const p of plan.phases) {
    for (const r of p.rounds) {
      rounds.push({
        seasonId: ctx.seasonId,
        number: r.number,
        name: r.name ?? undefined,
        roundType: r.roundType,
        sourceId: ctx.sourceId,
        scrapedAt,
        ...phaseFields(p.ref),
        stage: r.stage,
      });
    }
  }

  // 4) Clasificaciones (una por sección con liga; el grupo las separa).
  const standings: ScrapedStanding[] = [];
  for (const d of data) {
    if (!d.section.hasStandings) continue;
    for (const s of d.standings) {
      standings.push({
        teamRef: teamRef(s.name),
        groupName: d.section.group ?? undefined,
        position: s.position,
        points: s.points,
        played: s.played,
        won: s.won,
        drawn: s.drawn,
        lost: s.lost,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
        logoUrl: s.logoUrl ?? undefined,
        phaseTitle: d.section.phaseTitle,
        sourceId: ctx.sourceId,
        sourceUrl: `${FPP_BASE_URL}/Classificacao/${d.section.fppId}`,
        scrapedAt,
      } as ScrapedStanding);
    }
  }

  return { matches, rounds, standings, pendingTeams };
}

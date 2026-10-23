/**
 * Filas de la API vasca → DTO del ETL (partidos, rondas, clasificaciones) de
 * UNA competición de Stick Live. La estructura la decide `planSourceStructure`,
 * el mismo algoritmo que FEP, World Skate y FPP. Puro: sin red ni BD.
 */
import type { ScrapedMatch, ScrapedRound, ScrapedStanding, MatchStatus, StructureRow } from '@sports/shared-types';
import { planSourceStructure } from '@sports/shared-types';
import { zonedToUtc } from '../../core/eu-timezone.js';
import { FVP_TIMEZONE, fvpMatchRef, fvpPhaseRef, fvpTeamRef, type FvpCompetition } from './fvp-catalog.js';
import { statusOf, type FvpRow, type FvpStandingRow } from './fvp.parser.js';

export const FVP_BASE_URL = process.env['FVP_BASE_URL'] ?? 'https://www.fvpatinaje.eus';

export interface FvpFaseStandings { faseId: string; faseNombre: string; rows: FvpStandingRow[] }

export interface FvpBuilt {
  matches: ScrapedMatch[];
  rounds: ScrapedRound[];
  standings: ScrapedStanding[];
  /** Cruces sin equipos decididos (no generan partido). */
  pendingTeams: number;
  /** Estados de la API que no sabemos traducir (para avisar, nunca en silencio). */
  unknownStates: string[];
}

function kickoffUtc(row: FvpRow, tz: string): Date | null {
  if (!row.date) return null;
  const [y, mo, d] = row.date.split('-').map(Number) as [number, number, number];
  const [h, mi] = (row.time ?? '00:00').split(':').map(Number) as [number, number];
  const at = zonedToUtc(tz, y, mo - 1, d, h, mi);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function buildFvpCompetition(
  comp: FvpCompetition,
  rows: FvpRow[],
  standings: FvpFaseStandings[],
  ctx: { seasonId: string; sourceId: string; now: Date; timezone?: string | null },
): FvpBuilt {
  const tz = ctx.timezone || FVP_TIMEZONE;
  const teamRef = (name: string) => fvpTeamRef(comp.teamScope, comp.nameAliases?.[name] ?? name);
  const placeholder = (r: FvpRow) => !r.homeName || !r.awayName;

  const structureInput: StructureRow[] = rows.map((r, i) => ({
    phaseRef: fvpPhaseRef(r.faseId),
    phaseTitle: r.faseNombre || null,
    roundLabel: r.jornadaNombre || null,
    date: r.date,
    homeRef: placeholder(r) ? null : teamRef(r.homeName!),
    awayRef: placeholder(r) ? null : teamRef(r.awayName!),
    groupName: null,
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

  const matches: ScrapedMatch[] = [];
  const unknown = new Set<string>();
  let pendingTeams = 0;
  rows.forEach((row, i) => {
    if (placeholder(row)) { pendingTeams++; return; }
    const a = plan.assignments[i]!;
    const phase = phaseByRef.get(a.phaseRef)!;
    const round = phase.rounds.find((r) => r.key === a.roundKey)!;
    const at = kickoffUtc(row, tz);

    const mapped = statusOf(row.estado);
    if (mapped === undefined && row.estado) unknown.add(row.estado);
    // El calendario no declara "en juego": eso es del directo (cron-live).
    const status: MatchStatus | undefined = mapped === 'live' ? undefined : mapped;
    const finished = status === 'finished' && row.homeGoals !== null && row.awayGoals !== null;

    matches.push({
      seasonId: ctx.seasonId,
      roundRef: round.name ?? undefined,
      roundNumber: round.number,
      roundType: round.roundType,
      homeTeamRef: teamRef(row.homeName!),
      awayTeamRef: teamRef(row.awayName!),
      homeTeamAbbr: row.homeAbbr,
      awayTeamAbbr: row.awayAbbr,
      homeTeamLogoUrl: row.homeLogo,
      awayTeamLogoUrl: row.awayLogo,
      homeScore: finished ? row.homeGoals! : undefined,
      awayScore: finished ? row.awayGoals! : undefined,
      // Un FINISHED sin marcador no se da por terminado (dato incompleto en origen).
      status: status === 'finished' && !finished ? undefined : status,
      scheduledAt: at?.toISOString(),
      venueName: row.venue ?? undefined,
      competitionName: comp.name,
      sourceId: ctx.sourceId,
      sourceRef: fvpMatchRef(row.matchId),
      sourceUrl: `${FVP_BASE_URL}/api/public/partidos/${row.matchId}`,
      scrapedAt: ctx.now,
      ...phaseFields(a.phaseRef),
      stage: round.stage,
      seriesGame: a.seriesGame,
    } as ScrapedMatch);
  });

  const rounds: ScrapedRound[] = [];
  for (const p of plan.phases) {
    for (const r of p.rounds) {
      rounds.push({
        seasonId: ctx.seasonId,
        number: r.number,
        name: r.name ?? undefined,
        roundType: r.roundType,
        sourceId: ctx.sourceId,
        scrapedAt: ctx.now,
        ...phaseFields(p.ref),
        stage: r.stage,
      });
    }
  }

  const out: ScrapedStanding[] = [];
  for (const f of standings) {
    for (const s of f.rows) {
      out.push({
        teamRef: teamRef(s.name),
        position: s.position,
        points: s.points,
        played: s.played,
        won: s.won,
        drawn: s.drawn,
        lost: s.lost,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
        logoUrl: s.logoUrl ?? undefined,
        abbreviation: s.abbr,
        phaseTitle: f.faseNombre,
        sourceId: ctx.sourceId,
        sourceUrl: `${FVP_BASE_URL}/api/hierarchy/fase/${f.faseId}/clasificacion`,
        scrapedAt: ctx.now,
      } as ScrapedStanding);
    }
  }

  return { matches, rounds, standings: out, pendingTeams, unknownStates: [...unknown] };
}

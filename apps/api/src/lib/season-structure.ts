/**
 * Estructura de una temporada para la API: fases → rondas → partidos.
 *
 * La estructura es la que guardó el ETL desde la fuente (tabla `phases`,
 * `rounds.stage`, `matches.phase_id/series_game`). Aquí NO se reinterpreta:
 * solo se expone y se calculan desde ella los campos legados que ya consumen
 * web y app (`roundNumber` 1/2/3/0, `roundType`, `competitionFormat`).
 *
 * Única excepción, aislada y marcada (`stageInferred`): temporadas HEREDADAS
 * (fase `legacy` del backfill 072, aún sin re-scrapear) cuyo playoff vive en
 * una sola ronda sin fase eliminatoria (la antigua ronda 100 de OK Liga). Ahí
 * se conserva la deducción cronológica de siempre para no empeorar lo que ya
 * se veía; en cuanto la fuente se vuelve a cargar, la fase pasa a ser explícita
 * y esta rama deja de aplicarse.
 *
 * Función pura: la ruta hace las consultas y esto decide el payload.
 */
import {
  STAGE_ORDER,
  compatCompetitionFormat,
  compatRoundNumber,
  isKnockoutStage,
  type KnockoutStage,
  type PhaseKind,
} from '@sports/shared-types';
import { normalizeCompetitionFormat, type CompetitionFormat } from './competition-format.js';

export interface StructurePhaseRow {
  id: string;
  ordinal: number;
  kind: PhaseKind;
  is_placement: boolean;
  name: string | null;
  /** 'legacy' = fase del backfill 072, todavía sin estructura de la fuente. */
  resolved_by: string;
}

export interface StructureRoundRow {
  id: string;
  number: number;
  name: string | null;
  round_type: string;
  phase_id: string | null;
  stage: string | null;
}

export interface StructureMatchRow {
  id: string;
  round_id: string | null;
  phase_id: string | null;
  series_game: number | null;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: Date | string | null;
}

export interface SeasonPhaseView {
  id: string;
  ordinal: number;
  kind: PhaseKind;
  isPlacement: boolean;
  name: string | null;
  /** La clasificación de la temporada pertenece a esta fase. */
  hasStandings: boolean;
  /** Fases eliminatorias presentes (cuartos, semis…), en orden de juego. */
  stages: KnockoutStage[];
  /** Alguna fase eliminatoria de esta fase es deducida (solo datos heredados). */
  stagesInferred: boolean;
}

export interface MatchStructure {
  phaseId: string | null;
  stage: KnockoutStage | null;
  seriesGame: number | null;
  /** Legado: jornada en liga/grupos; 1=cuartos, 2=semis, 3=final, 0=colocación en eliminatorias. */
  roundNumber: number | null;
  roundType: string;
  /** La fase eliminatoria no viene de la fuente sino de la cronología (datos heredados). */
  stageInferred: boolean;
}

export interface SeasonStructure {
  phases: SeasonPhaseView[];
  byMatch: Map<string, MatchStructure>;
  competitionFormat: CompetitionFormat;
  visibleRoundIds: Set<string>;
}

export interface SeasonStructureInput {
  phases: StructurePhaseRow[];
  rounds: StructureRoundRow[];
  matches: StructureMatchRow[];
  /** La temporada tiene filas de clasificación. */
  hasStandings: boolean;
  /** `competition_sources.external_ids.format` (metadato declarado). */
  declaredFormat: string | null;
}

const isLegacy = (p: StructurePhaseRow | undefined): boolean => p?.resolved_by === 'legacy';

function time(d: Date | string | null): number {
  if (!d) return Number.MAX_SAFE_INTEGER;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/**
 * Deducción cronológica HEREDADA (la que hacía la ruta para todo playoff): por
 * eliminatoria (pareja de equipos) ordenada por su primera fecha, la última es
 * la final, las dos anteriores semis y el resto cuartos; una serie anterior a
 * semis cuyos equipos no reaparecen después es de colocación (9.º-10.º).
 * Solo vale para un cuadro COMPLETO, por eso únicamente se usa con datos
 * heredados (temporadas terminadas sin re-scrapear).
 */
function legacyChronology(pool: StructureMatchRow[]): Map<string, KnockoutStage> {
  const seriesMap = new Map<string, { firstDate: number; matches: StructureMatchRow[] }>();
  for (const m of pool) {
    const key = [m.home_team_id, m.away_team_id].sort().join('|');
    const entry = seriesMap.get(key) ?? { firstDate: Number.MAX_SAFE_INTEGER, matches: [] };
    entry.firstDate = Math.min(entry.firstDate, time(m.scheduled_at));
    entry.matches.push(m);
    seriesMap.set(key, entry);
  }
  const series = [...seriesMap.values()].sort((a, b) => a.firstDate - b.firstDate);
  const n = series.length;
  const out = new Map<string, KnockoutStage>();
  series.forEach((s, idx) => {
    const stage: KnockoutStage = idx === n - 1 ? 'final' : idx >= n - 3 ? 'semis' : 'quarters';
    for (const m of s.matches) out.set(m.id, stage);
  });

  if (n > 4) {
    const laterTeams = new Set<string>();
    for (const s of series.slice(n - 3)) {
      for (const m of s.matches) { laterTeams.add(m.home_team_id); laterTeams.add(m.away_team_id); }
    }
    for (const s of series.slice(0, n - 3)) {
      if (!s.matches.some((m) => laterTeams.has(m.home_team_id) || laterTeams.has(m.away_team_id))) {
        for (const m of s.matches) out.set(m.id, 'placement');
      }
    }
  }
  return out;
}

export function buildSeasonStructure(input: SeasonStructureInput): SeasonStructure {
  const phaseById = new Map(input.phases.map((p) => [p.id, p]));
  const roundById = new Map(input.rounds.map((r) => [r.id, r]));
  const declaredKnockout = input.declaredFormat === 'bracket' || input.declaredFormat === 'final_four';

  const roundStage = (r: StructureRoundRow | undefined): KnockoutStage | null =>
    r && isKnockoutStage(r.stage) ? r.stage : null;
  const phaseOf = (m: StructureMatchRow): StructurePhaseRow | undefined => {
    const id = m.phase_id ?? (m.round_id ? roundById.get(m.round_id)?.phase_id : null) ?? null;
    return id ? phaseById.get(id) : undefined;
  };

  // ── Rama heredada (aislada): playoff legado en una sola ronda sin fase ──
  // Mismas condiciones que la deducción anterior: ninguna ronda del playoff
  // heredado tiene fase eliminatoria, todo está en (como mucho) una ronda y la
  // competición no es una final four declarada (sus rondas eran la verdad).
  const legacyPool = input.matches.filter((m) => {
    const p = phaseOf(m);
    const r = m.round_id ? roundById.get(m.round_id) : undefined;
    if (p) return isLegacy(p) && p.kind === 'knockout';
    return r ? r.round_type === 'playoff' : declaredKnockout;
  });
  const legacyRounds = new Set(legacyPool.map((m) => m.round_id).filter((x): x is string => !!x));
  const inferred =
    legacyPool.length > 0 &&
    legacyRounds.size <= 1 &&
    input.declaredFormat !== 'final_four' &&
    legacyPool.every((m) => roundStage(m.round_id ? roundById.get(m.round_id) : undefined) === null)
      ? legacyChronology(legacyPool)
      : new Map<string, KnockoutStage>();

  // ── Partido → estructura ──
  const byMatch = new Map<string, MatchStructure>();
  const roundsWithMatches = new Set<string>();
  const phasesWithMatches = new Set<string>();
  for (const m of input.matches) {
    const r = m.round_id ? roundById.get(m.round_id) : undefined;
    const p = phaseOf(m);
    if (r) roundsWithMatches.add(r.id);
    if (p) phasesWithMatches.add(p.id);

    const explicit = roundStage(r);
    const deduced = explicit ? undefined : inferred.get(m.id);
    const stage = explicit ?? deduced ?? null;
    const knockout = p ? p.kind === 'knockout' : (r ? r.round_type === 'playoff' : declaredKnockout) || deduced !== undefined;

    let roundNumber: number | null;
    if (!knockout) roundNumber = r?.number ?? null;
    else if (stage) roundNumber = compatRoundNumber(stage, p?.is_placement ?? false);
    // Sin fase eliminatoria: lo heredado conserva su número de siempre; en la
    // estructura nueva el número de ronda es interno y no se expone.
    else roundNumber = !p || isLegacy(p) ? (r?.number ?? null) : null;

    byMatch.set(m.id, {
      phaseId: p?.id ?? null,
      stage,
      seriesGame: m.series_game,
      roundNumber,
      roundType: r?.round_type ?? (knockout ? 'playoff' : 'regular'),
      stageInferred: deduced !== undefined,
    });
  }

  // ── Rondas visibles: con partidos, con fase eliminatoria o publicadas por
  // la fuente. Las rondas heredadas vacías (p. ej. la ronda 100 tras mover sus
  // partidos) no se exponen. ──
  const visibleRoundIds = new Set<string>();
  for (const r of input.rounds) {
    const p = r.phase_id ? phaseById.get(r.phase_id) : undefined;
    if (roundsWithMatches.has(r.id) || roundStage(r) !== null || !p || !isLegacy(p)) visibleRoundIds.add(r.id);
  }

  // ── Fases visibles, con sus fases eliminatorias ──
  const visiblePhases = input.phases
    .filter((p) => phasesWithMatches.has(p.id) || input.rounds.some((r) => r.phase_id === p.id && visibleRoundIds.has(r.id)))
    .sort((a, b) => a.ordinal - b.ordinal);

  // La clasificación (aún no tiene fase propia) es de la primera liguilla por el título.
  const standingsPhase = input.hasStandings
    ? visiblePhases.find((p) => !p.is_placement && (p.kind === 'league' || p.kind === 'groups'))
    : undefined;

  const phases: SeasonPhaseView[] = visiblePhases.map((p) => {
    const stages = new Set<KnockoutStage>();
    let stagesInferred = false;
    for (const r of input.rounds) {
      const s = roundStage(r);
      if (r.phase_id === p.id && s && visibleRoundIds.has(r.id)) stages.add(s);
    }
    for (const s of byMatch.values()) {
      if (s.phaseId === p.id && s.stage) {
        stages.add(s.stage);
        if (s.stageInferred) stagesInferred = true;
      }
    }
    return {
      id: p.id,
      ordinal: p.ordinal,
      kind: p.kind,
      isPlacement: p.is_placement,
      name: p.name,
      hasStandings: p.id === standingsPhase?.id,
      stages: [...stages].sort((a, b) => STAGE_ORDER[a] - STAGE_ORDER[b]),
      stagesInferred,
    };
  });

  // Formato legado: con estructura de la fuente, se deriva de las fases; una
  // temporada solo con fases heredadas conserva el formato declarado de antes.
  const fromSource = visiblePhases.some((p) => !isLegacy(p));
  const competitionFormat = fromSource
    ? compatCompetitionFormat(phases.map((p) => ({ kind: p.kind, isPlacement: p.isPlacement, stages: p.stages })))
    : normalizeCompetitionFormat(input.declaredFormat);

  return { phases, byMatch, competitionFormat, visibleRoundIds };
}

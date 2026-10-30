/**
 * Persiste el plan de estructura de una temporada (fases + rondas) y lo
 * devuelve como mapas para asignar cada partido a su fase/ronda.
 *
 * El plan lo decide `planSourceStructure` (@sports/shared-types) a partir de lo
 * que publica la fuente; aquí solo se escribe (idempotente, adoptando lo legado
 * — ver `ensurePhase`/`ensurePhaseRound`). Es el mismo camino para cualquier
 * competición: no hay listas de idc ni casos especiales.
 */
import * as Sentry from '@sentry/node';
import { createLogger } from '@sports/logger';
import { ensurePhase, ensurePhaseRound, pruneStalePhases, pruneStaleRounds } from '@sports/db';
import type { PhaseKind, ScrapedMatch, StructurePlan, StructureRow } from '@sports/shared-types';

const log = createLogger({ module: 'structure' });

export interface AppliedStructure {
  phaseIdByRef: Map<string, string>;
  roundIdByKey: Map<string, string>;
}

/**
 * Tipo de fase DECLARADO en `competition_sources.external_ids.format` (metadato
 * de nivel 2: solo se usa si la fuente no deja claro el tipo de una fase).
 */
export function declaredKindFromFormat(format: string | null | undefined): PhaseKind | null {
  if (format === 'bracket' || format === 'final_four') return 'knockout';
  if (format === 'league') return 'league';
  if (format === 'groups') return 'groups';
  return null;
}

export async function applyStructurePlan(
  seasonId: string,
  plan: StructurePlan,
  sourceId?: string | null,
): Promise<AppliedStructure> {
  const phaseIdByRef = new Map<string, string>();
  const roundIdByKey = new Map<string, string>();

  for (const phase of plan.phases) {
    if (phase.resolvedBy === 'fallback') {
      // Visible, nunca silencioso: la fuente no dejó claro el formato de esta
      // fase y se pinta como liga. Declarar `format` en competition_sources o
      // revisar la fuente.
      log.warn({ seasonId, phaseRef: phase.ref, name: phase.name },
        'Fase sin estructura reconocible en la fuente — se trata como liga (fallback)');
      Sentry.captureMessage(`Estructura de fase no resuelta por la fuente (${phase.ref}) — fallback a liga`, {
        level: 'warning',
        fingerprint: ['structure-fallback', seasonId, phase.ref],
        extra: { seasonId, phaseRef: phase.ref, name: phase.name },
      });
    }
    const phaseId = await ensurePhase({
      seasonId,
      sourceRef: phase.ref,
      kind: phase.kind,
      isPlacement: phase.isPlacement,
      name: phase.name,
      ordinal: phase.ordinal,
      resolvedBy: phase.resolvedBy,
      sourceId: sourceId ?? null,
    });
    phaseIdByRef.set(phase.ref, phaseId);
    for (const round of phase.rounds) {
      const roundId = await ensurePhaseRound({
        seasonId,
        phaseId,
        roundType: round.roundType,
        number: round.number,
        stage: round.stage,
        name: round.name,
        sourceId: sourceId ?? null,
      });
      roundIdByKey.set(round.key, roundId);
    }
  }

  log.info(
    { seasonId, phases: plan.phases.map((p) => `${p.ordinal}:${p.kind}${p.isPlacement ? '(colocación)' : ''}@${p.resolvedBy}`) },
    'Estructura de la temporada aplicada',
  );
  return { phaseIdByRef, roundIdByKey };
}

/**
 * Tras cargar los partidos con su nueva ronda: retira las rondas VACÍAS de esas
 * fases que la fuente ya no publica (p. ej. la antigua ronda 100 "Playoff por
 * el título" una vez sus partidos han pasado a cuartos/semis/final). Nunca
 * toca una ronda con partidos.
 */
export async function pruneAfterLoad(seasonId: string, applied: AppliedStructure): Promise<number> {
  const pruned = await pruneStaleRounds(seasonId, [...applied.phaseIdByRef.values()], [...applied.roundIdByKey.values()]);
  if (pruned > 0) log.info({ seasonId, pruned }, 'Rondas vacías que la fuente ya no publica, retiradas');
  const phases = await pruneStalePhases(seasonId, [...applied.phaseIdByRef.values()]);
  if (phases > 0) log.info({ seasonId, phases }, 'Fases vacías que la fuente ya no publica, retiradas');
  return pruned;
}

/**
 * Asigna a cada partido scrapeado su fase, ronda y nº de partido de serie según
 * el plan. `rows[i]` debe corresponder a `plan.assignments[i]`.
 */
export function assignStructure(
  rows: Array<{ structure: StructureRow; match: ScrapedMatch | null }>,
  plan: StructurePlan,
  applied: AppliedStructure,
): void {
  rows.forEach(({ match }, i) => {
    if (!match) return;
    const a = plan.assignments[i];
    if (!a) return;
    const roundId = applied.roundIdByKey.get(a.roundKey);
    const phaseId = applied.phaseIdByRef.get(a.phaseRef);
    if (roundId) match.roundId = roundId;
    if (phaseId) match.phaseId = phaseId;
    if (a.seriesGame != null) match.seriesGame = a.seriesGame;
    if (a.groupName && !match.groupName) match.groupName = a.groupName;
  });
}

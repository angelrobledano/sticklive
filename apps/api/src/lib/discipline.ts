/** Hechos de disciplina de una temporada (C4). */

export interface DisciplineCardRow {
  matchId: string;
  teamId: string;
  playerId: string | null;
  firstName: string | null;
  lastName: string | null;
  minute: number | null;
  roundNumber: number | null;
  roundName: string | null;
  roundType: string | null;
}

export interface LastRoundRed {
  matchId: string;
  teamId: string;
  playerId: string | null;
  firstName: string | null;
  lastName: string | null;
  minute: number | null;
}

export interface SeasonDiscipline {
  /** Última jornada de liga con partidos terminados, si existe. */
  roundNumber: number | null;
  roundName: string | null;
  reds: LastRoundRed[];
}

/**
 * Solo hechos: rojas de la última jornada de liga. No deduce sanciones ni
 * "no juega": una roja no lleva una suspensión automática fija.
 */
export function buildSeasonDiscipline(
  rows: DisciplineCardRow[],
  lastRound: { number: number | null; name: string | null },
): SeasonDiscipline {
  if (lastRound.number === null) return { roundNumber: null, roundName: null, reds: [] };
  const last = rows.filter((r) => r.roundType === 'regular' && r.roundNumber === lastRound.number);
  return {
    roundNumber: lastRound.number,
    roundName: lastRound.name,
    reds: last.map((r) => ({
      matchId: r.matchId,
      teamId: r.teamId,
      playerId: r.playerId,
      firstName: r.firstName,
      lastName: r.lastName,
      minute: r.minute,
    })),
  };
}

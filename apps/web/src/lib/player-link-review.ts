/**
 * Ayudas del panel de revisión de jugadores (B1, /admin/jugadores).
 * La decisión de unir dos fichas es siempre humana: aquí solo se resaltan señales.
 */
export interface ReviewTeam { team: string; season: string; competition: string }
export interface ReviewSide { refs: string[]; teams: ReviewTeam[] }

const PORTALS: Record<string, string> = {
  fep: 'RFEP', fecapa: 'FECAPA', wse: 'World Skate',
  fmp: 'FMP', fap: 'FAP', fpcv: 'FPCV', fgp: 'FGP',
};

/** Federación de cada ref (`fecapa_player_14782` → FECAPA). */
export function portalLabels(refs: readonly string[]): string[] {
  return refs.map((r) => {
    const key = r.split('_player_')[0] ?? r;
    return PORTALS[key] ?? key;
  });
}

/**
 * Señal fuerte de que son DOS personas: en la misma temporada y la misma
 * competición, cada ficha juega con un equipo distinto. Club y selección, o
 * liga y copa, no cuentan: son competiciones distintas.
 */
export function seasonConflicts(a: ReviewSide, b: ReviewSide) {
  const out: { season: string; competition: string; teamA: string; teamB: string }[] = [];
  for (const ta of a.teams) {
    for (const tb of b.teams) {
      if (ta.season === tb.season && ta.competition === tb.competition && ta.team !== tb.team) {
        out.push({ season: ta.season, competition: ta.competition, teamA: ta.team, teamB: tb.team });
      }
    }
  }
  return out;
}

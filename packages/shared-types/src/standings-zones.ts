/**
 * B2 — Zonas de clasificación como datos (ascenso, descenso, play-off…).
 *
 * Se declaran por temporada en `standings_zones` (migración 085) con su fuente
 * normativa, y opcionalmente por fase y grupo. A diferencia de OKMob (regex
 * sobre el nombre de la competición, aplicada en cliente), la zona se aplica
 * en el servidor y un cambio de patrocinador no la rompe.
 */
export type StandingsZoneKind =
  | 'champion'
  | 'promotion'
  | 'promotion_playoff'
  | 'final_phase'
  | 'placement'
  | 'playout'
  | 'relegation';

export interface StandingsZone {
  kind: StandingsZoneKind;
  posFrom: number;
  posTo: number;
  /** Competición de destino ("OK Liga Plata"), si aplica. */
  target: string | null;
  /** null = cualquier fase de la temporada. */
  phaseId: string | null;
  /** null = cualquier grupo. */
  groupName: string | null;
}

/**
 * Zona de una posición. Con solapes (campeón dentro de play-off de ascenso)
 * gana la más específica: el rango más corto.
 */
export function zoneForPosition(
  zones: readonly StandingsZone[],
  position: number | null | undefined,
  ctx: { phaseId?: string | null; groupName?: string | null } = {},
): StandingsZone | null {
  if (position == null) return null;
  let best: StandingsZone | null = null;
  for (const z of zones) {
    if (position < z.posFrom || position > z.posTo) continue;
    if (z.phaseId && z.phaseId !== (ctx.phaseId ?? null)) continue;
    if (z.groupName && z.groupName !== (ctx.groupName ?? null)) continue;
    if (!best || z.posTo - z.posFrom < best.posTo - best.posFrom) best = z;
  }
  return best;
}

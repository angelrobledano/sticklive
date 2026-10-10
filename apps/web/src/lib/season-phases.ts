/**
 * Fases eliminatorias de una temporada tal y como las publica la fuente
 * (`season.phases`, `stage` y `seriesGame` de cada partido): qué partidos y
 * rondas son de cada fase y con qué cuadro se pinta.
 *
 * El cuadro se decide por la ESTRUCTURA, no por el formato declarado de la
 * competición: una fase que empieza en semifinales es una final four aunque
 * vaya tras una fase de grupos; una serie con 3.er partido publicado es al
 * mejor de N; el resto es un cuadro de eliminatorias (partido único o ida y
 * vuelta, que se resuelve por goles).
 *
 * Devuelve `null` cuando la temporada no trae fases de la fuente (payload
 * antiguo o temporada heredada sin re-scrapear): el llamante mantiene la
 * presentación de siempre. Funciones puras y testeadas.
 */
import type { SeasonMatch, SeasonPhase, SeasonRound, KnockoutStage } from '@/lib/api/client';

export type KnockoutLayout = 'series' | 'final_four' | 'bracket';

export interface KnockoutPhaseView {
  phase: SeasonPhase;
  matches: SeasonMatch[];
  /** Rondas de la fase (incluidas las declaradas aún sin partidos). */
  rounds: SeasonRound[];
  layout: KnockoutLayout;
}

const FINAL_FOUR_STAGES = new Set<KnockoutStage>(['semis', 'final', 'third_place']);

export function knockoutLayout(phase: SeasonPhase, matches: SeasonMatch[]): KnockoutLayout {
  // Al mejor de N: la fuente numera los partidos de la serie y publica el 3.º
  // ("3 CUARTOS"). Dos partidos sin más son ida y vuelta (por goles).
  if (matches.some((m) => (m.seriesGame ?? 0) >= 3)) return 'series';
  const stages = phase.stages.filter((s) => s !== 'placement');
  if (stages.includes('semis') && stages.every((s) => FINAL_FOUR_STAGES.has(s))) return 'final_four';
  return 'bracket';
}

export function knockoutPhaseViews(
  phases: SeasonPhase[] | undefined,
  rounds: SeasonRound[],
  matches: SeasonMatch[],
): KnockoutPhaseView[] | null {
  if (!phases || phases.length === 0) return null;
  const knockout = phases.filter((p) => p.kind === 'knockout');
  if (knockout.some((p) => p.fromSource === false)) return null;

  const views = knockout
    .slice()
    .sort((a, b) => Number(a.isPlacement) - Number(b.isPlacement) || a.ordinal - b.ordinal)
    .map((phase) => ({
      phase,
      matches: matches.filter((m) => m.phaseId === phase.id),
      rounds: rounds.filter((r) => r.phaseId === phase.id),
      layout: 'bracket' as KnockoutLayout,
    }));
  // Una fase de colocación (9.º-10.º, 5.º-8.º) se presenta como la del título:
  // en un playoff a series, es una serie más; si no, partidos del cuadro.
  const titleLayout = views.find((v) => !v.phase.isPlacement);
  for (const v of views) {
    if (!v.phase.isPlacement) v.layout = knockoutLayout(v.phase, v.matches);
  }
  for (const v of views) {
    if (v.phase.isPlacement) v.layout = titleLayout?.layout === 'series' ? 'series' : 'bracket';
  }
  return views;
}

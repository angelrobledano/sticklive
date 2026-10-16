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

  const views: KnockoutPhaseView[] = [];
  for (const phase of knockout) {
    const own = matches.filter((m) => m.phaseId === phase.id);
    const ownRounds = rounds.filter((r) => r.phaseId === phase.id);
    if (phase.isPlacement) {
      views.push({ phase, matches: own, rounds: ownRounds, layout: 'bracket' });
      continue;
    }
    // Una fase por el título puede traer rondas de COLOCACIÓN dentro (5.º-8.º en
    // la fase final de World Skate, o una ronda heredada). Nunca entran en el
    // cuadro por el título: van a su propia vista de colocación.
    const isPl = (s: string | null | undefined) => s === 'placement';
    views.push({
      phase: { ...phase, stages: phase.stages.filter((s) => !isPl(s)) },
      matches: own.filter((m) => !isPl(m.stage)),
      rounds: ownRounds.filter((r) => !isPl(r.stage)),
      layout: 'bracket',
    });
    const plMatches = own.filter((m) => isPl(m.stage));
    if (plMatches.length > 0) {
      views.push({
        phase: { ...phase, id: `${phase.id}:colocacion`, isPlacement: true, name: null, stages: ['placement'] },
        matches: plMatches,
        rounds: ownRounds.filter((r) => isPl(r.stage)),
        layout: 'bracket',
      });
    }
  }
  views.sort((a, b) => Number(a.phase.isPlacement) - Number(b.phase.isPlacement) || a.phase.ordinal - b.phase.ordinal);
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

/**
 * ¿La fase final ya manda en la competición? (spec 2026-10-16). Sí cuando hay
 * partidos eliminatorios y, o bien alguno ya se ha jugado o se está jugando, o
 * bien la liga/fase de grupos está cerrada (todo terminado o cancelado). Con la
 * fase regular aún viva y los cruces solo publicados, todavía no.
 */
export function finalPhaseStarted(matches: Pick<SeasonMatch, 'roundType' | 'status'>[]): boolean {
  const knockout = matches.filter((m) => m.roundType === 'playoff');
  if (knockout.length === 0) return false;
  if (knockout.some((m) => m.status === 'live' || m.status === 'finished')) return true;
  return matches
    .filter((m) => m.roundType !== 'playoff')
    .every((m) => m.status === 'finished' || m.status === 'cancelled');
}

/**
 * Clave i18n del nombre de la pestaña del cuadro: «Playoffs» para series al
 * mejor de N (OK Liga), «Final Four» para un torneo a cuatro y «Eliminatorias»
 * para el resto de cuadros (partido único o ida y vuelta, como un Mundial).
 * Sin fases de la fuente (temporada heredada): «Playoffs», como siempre.
 */
export function knockoutTabLabelKey(
  format: string | null | undefined,
  phases: SeasonPhase[] | undefined,
  rounds: SeasonRound[],
  matches: SeasonMatch[],
): string {
  if (format === 'final_four') return 'playoffs.final_four';
  const views = knockoutPhaseViews(phases, rounds, matches);
  const title = views?.find((v) => !v.phase.isPlacement);
  if (!title) return 'match_tabs.playoffs';
  if (title.layout === 'series') return 'match_tabs.playoffs';
  if (title.layout === 'final_four') return 'playoffs.final_four';
  return 'match_tabs.knockout';
}

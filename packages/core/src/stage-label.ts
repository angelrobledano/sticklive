/**
 * stage-label.ts — nombre legible de la fase en que se juega un partido o una
 * ronda (spec 2026-10-16): «Cuartos de final», «Semifinal», «Final», «3.er y
 * 4.º puesto», «Fase de grupos · Grupo A · Jornada 2»…
 *
 * La fase eliminatoria sale SIEMPRE del `stage` explícito de la fuente
 * (migración 072). Sin `stage` se usa el nombre de la ronda tal cual: aquí no
 * se deduce nada del nombre ni del número. Funciones puras.
 */
import type { KnockoutStage, MatchRound } from './api';

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Lo que la ficha del partido sabe de su ronda (`match.round` de la API). */
export type MatchRoundInfo = MatchRound;

const STAGES = new Set<KnockoutStage>(['round_of_16', 'quarters', 'semis', 'final', 'third_place', 'placement']);

export function isKnockoutStage(s: string | null | undefined): s is KnockoutStage {
  return !!s && STAGES.has(s as KnockoutStage);
}

/**
 * Etiqueta de una fase eliminatoria. `one` = un partido concreto («Semifinal»);
 * sin él, la ronda entera («Semifinales»). `placement` no tiene nombre genérico:
 * devuelve `null` y el llamante usa el nombre de la fuente («Puestos 5º-8º»).
 */
export function stageLabel(stage: KnockoutStage, t: T, one = false): string | null {
  switch (stage) {
    case 'round_of_16': return t('playoffs.stage_round_of_16');
    case 'quarters':    return t('playoffs.stage_quarters');
    case 'semis':       return t(one ? 'playoffs.stage_semi_one' : 'playoffs.stage_semis');
    case 'final':       return t('playoffs.stage_final');
    case 'third_place': return t('playoffs.third_place');
    default:            return null;
  }
}

/**
 * Nombres de ronda que la fuente escribe en texto libre y que en realidad son
 * enumerables: se traducen por clave en vez de copiarlos tal cual (i18n de
 * datos). Un nombre propio desconocido se devuelve sin tocar.
 */
const SOURCE_ROUNDS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /^hist[oó]rico$/i, key: 'playoffs.round_historic' },
  { pattern: /^fase final$/i, key: 'playoffs.round_final_phase' },
  { pattern: /^cuartos( de final)?$/i, key: 'playoffs.stage_quarters' },
  { pattern: /^semifinal(es)?$/i, key: 'playoffs.stage_semis' },
  { pattern: /^final$/i, key: 'playoffs.stage_final' },
  { pattern: /^(tercer|3\.?er).*(cuarto|4\.?º).*puesto$/i, key: 'playoffs.third_place' },
];

const PLACEMENT_RANGE = /^puestos?\s+(\d+)\s*[ºo]?\s*[-–—]\s*(\d+)\s*[ºo]?$/i;

/** Traduce un nombre de ronda enumerable; deja intacto un nombre propio. */
export function roundNameLabel(name: string | null | undefined, t: T): string | null {
  const clean = name?.trim();
  if (!clean) return null;

  const placement = PLACEMENT_RANGE.exec(clean);
  if (placement) {
    return t('playoffs.placement_range', { from: placement[1]!, to: placement[2]! });
  }
  for (const { pattern, key } of SOURCE_ROUNDS) {
    if (pattern.test(clean)) return t(key);
  }
  return clean;
}

/**
 * Línea de fase de la ficha del partido, o `null` si no hay nada que decir.
 *  · eliminatoria: «Semifinal» (+ «· Partido 2» en series)
 *  · colocación: nombre de la fuente («Puestos 5º-8º»)
 *  · grupos: «Fase de grupos · Grupo A · Jornada 2»
 *  · liga: «Jornada 12»
 *  · resto (copa, amistoso, heredado sin stage): nombre de la ronda
 */
export function matchRoundLabel(round: MatchRoundInfo | null | undefined, t: T): string | null {
  if (!round) return null;
  const parts: string[] = [];

  if (isKnockoutStage(round.stage)) {
    const label = stageLabel(round.stage, t, true) ?? roundNameLabel(round.name, t);
    if (label) parts.push(label);
    if (round.seriesGame != null && round.seriesGame > 0 && round.stage !== 'placement') {
      parts.push(t('playoffs.game_n', { n: round.seriesGame }));
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  if (round.type === 'regular') {
    const isGroups = round.phaseKind === 'groups' || !!round.groupName;
    if (isGroups) parts.push(t('playoffs.group_stage'));
    if (round.groupName) parts.push(t('playoffs.group_n', { g: round.groupName }));
    if (round.number != null) parts.push(t('fixtures.matchday', { n: round.number }));
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  return roundNameLabel(round.name, t);
}

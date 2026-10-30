/**
 * Portada de Competiciones (spec 2026-10-29; datos, spec 2026-10-30).
 *
 * Todo sale de la curación en datos (`featured_rank` + `tier`, migración 100,
 * editable desde el admin): aquí no hay listas de competiciones.
 *
 *  1. Principales: destacadas de primer nivel (tier 1) que no son copa.
 *  2. Copas y torneos: copas e internacionales destacados, solo cerca de sus
 *     fechas (14 días antes, mientras se juegan y una semana después).
 *  3. Segundo nivel: el resto de destacadas, por país.
 *
 * Funciones puras, testeadas.
 */
import type { CompetitionSummary } from '@/lib/api/client';
import { isFeaturedCompetition } from '@sports/shared-types';
import { isCup, isInternational } from '@/lib/competition-groups';

/** Orden de los países del segundo nivel; el resto, detrás por código. */
const COUNTRY_ORDER = ['ES', 'PT', 'IT'];

const byRank = (a: CompetitionSummary, b: CompetitionSummary) => (a.featuredRank ?? 999) - (b.featuredRank ?? 999);

/** Copa o torneo: por nombre, o internacional que no es una liga de primer nivel (Mundial sí, WSE Champions no). */
export function isCupLike(c: CompetitionSummary): boolean {
  return isCup(c) || (isInternational(c) && c.tier !== 1);
}

const DAY = 86_400_000;
const BEFORE_DAYS = 14;
const AFTER_DAYS = 7;

/** Una copa se destaca en juego, 14 días antes de su próximo partido o hasta 7 días después del último. */
export function cupIsActive(c: CompetitionSummary, now: Date): boolean {
  const s = c.season;
  if (!s) return false;
  if ((s.liveMatches ?? 0) > 0) return true;
  const t = now.getTime();
  const next = s.nextMatchAt ? new Date(s.nextMatchAt).getTime() : null;
  if (next != null && next - t <= BEFORE_DAYS * DAY) return true;
  const last = s.lastMatchAt ? new Date(s.lastMatchAt).getTime() : null;
  const first = s.firstMatchAt ? new Date(s.firstMatchAt).getTime() : null;
  // Torneo concentrado ya empezado (Mundial, Supercopa): hasta una semana después del último partido.
  return first != null && last != null && first <= t && t - last <= AFTER_DAYS * DAY;
}

export interface CompetitionsHome {
  big: CompetitionSummary[];
  cups: CompetitionSummary[];
  /** Segundo nivel por país (ISO-2), en el orden de `secondCountries`. */
  second: Record<string, CompetitionSummary[]>;
  secondCountries: string[];
}

export function buildCompetitionsHome(comps: CompetitionSummary[], now: Date = new Date()): CompetitionsHome {
  const featured = comps.filter(isFeaturedCompetition).sort(byRank);
  const big = featured.filter((c) => c.tier === 1 && !isCupLike(c));
  const cups = featured.filter((c) => isCupLike(c) && cupIsActive(c, now))
    .sort((a, b) => Number((b.season?.liveMatches ?? 0) > 0) - Number((a.season?.liveMatches ?? 0) > 0)
      || String(a.season?.nextMatchAt ?? a.season?.lastMatchAt ?? '').localeCompare(String(b.season?.nextMatchAt ?? b.season?.lastMatchAt ?? '')));
  const second: Record<string, CompetitionSummary[]> = {};
  for (const c of featured) {
    if (big.includes(c) || isCupLike(c)) continue;
    const k = (c.federation?.country ?? c.country ?? '').toUpperCase();
    if (!k) continue;
    (second[k] ??= []).push(c);
  }
  const rank = (k: string) => { const i = COUNTRY_ORDER.indexOf(k); return i === -1 ? 100 : i; };
  const secondCountries = Object.keys(second).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { big, cups, second, secondCountries };
}

const VARIANT = /\s+(norte|sur|nord|sud|sul)$/i;

export interface VariantRow {
  /** Nombre común (sin «Norte»/«Sur»). */
  label: string;
  /** Primera competición del grupo (logo, enlace principal). */
  main: CompetitionSummary;
  /** Variantes (Norte, Sur…); vacío si es una competición sola. */
  variants: { label: string; comp: CompetitionSummary }[];
}

/** Agrupa las variantes geográficas de una misma liga (Plata Norte/Sur) en una fila. */
export function groupVariants(comps: CompetitionSummary[]): VariantRow[] {
  const rows: VariantRow[] = [];
  for (const c of comps) {
    const m = c.name.match(VARIANT);
    if (!m) { rows.push({ label: c.name, main: c, variants: [] }); continue; }
    const base = c.name.replace(VARIANT, '');
    const v = { label: m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase(), comp: c };
    const row = rows.find((r) => r.variants.length > 0 && r.label === base);
    if (row) row.variants.push(v);
    else rows.push({ label: base, main: c, variants: [v] });
  }
  return rows;
}

export type CompetitionStatus =
  | { kind: 'live'; live: number; matchday: number | null }
  | { kind: 'champion'; team: NonNullable<NonNullable<CompetitionSummary['season']>['champion']> }
  | { kind: 'matchday'; current: number; total: number }
  | { kind: 'next'; at: string }
  | { kind: 'last'; at: string };

/** Estado corto de una competición: en juego > campeón > jornada > próximo > último. */
export function competitionStatus(c: CompetitionSummary): CompetitionStatus | null {
  const s = c.season;
  if (!s) return null;
  if ((s.liveMatches ?? 0) > 0) return { kind: 'live', live: s.liveMatches!, matchday: s.matchday?.current ?? null };
  if (s.champion) return { kind: 'champion', team: s.champion };
  if (s.matchday) return { kind: 'matchday', current: s.matchday.current, total: s.matchday.total };
  if (s.nextMatchAt) return { kind: 'next', at: s.nextMatchAt };
  if (s.lastMatchAt) return { kind: 'last', at: s.lastMatchAt };
  return null;
}

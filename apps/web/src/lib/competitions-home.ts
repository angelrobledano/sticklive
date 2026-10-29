/**
 * Portada de Competiciones (spec 2026-10-29, Ángel):
 *
 *  1. Principales, fijos arriba: OK Liga, Campeonato Placard (PT), OK Liga
 *     Iberdrola, Serie A1 (IT) y la WSE Champions cuando exista.
 *  2. Segundo nivel por país: Plata/Bronce, Nacional Catalana, 2ª Divisão y
 *     Feminino (PT), Serie A2 y Femminile (IT).
 *  3. Copas y torneos dinámicos: solo cerca de sus fechas (14 días antes,
 *     mientras se juegan y una semana después para ver al campeón). Incluye
 *     los torneos internacionales (Mundiales, Europeos).
 *
 * Las competiciones que aún no existen en la base de datos simplemente no
 * salen. Funciones puras, testeadas.
 */
import type { CompetitionSummary } from '@/lib/api/client';

type Matcher = (c: CompetitionSummary) => boolean;
const slug = (s: string): Matcher => (c) => c.slug === s;
const name = (re: RegExp): Matcher => (c) => re.test(c.name);

const BIG: Matcher[] = [
  slug('ok-liga-masculina'),
  slug('campeonato-placard-portugal'),
  slug('ok-liga-femenina'),
  slug('campionato-serie-a1'),
  (c) => c.organizer === 'WSE' && /champions/i.test(c.name),
];

export type HomeCountry = 'ES' | 'PT' | 'IT';
export const HOME_SECOND_COUNTRIES: HomeCountry[] = ['ES', 'PT', 'IT'];

const SECOND: Record<HomeCountry, Matcher[]> = {
  ES: [
    slug('ok-liga-plata-norte'), slug('ok-liga-plata-sur'), slug('ok-liga-plata-femenina'),
    slug('ok-liga-bronce-masculina-norte'), slug('ok-liga-bronce-masculina-sur'),
    slug('nacional-catalana-masculina'), slug('nacional-catalana-femenina'),
  ],
  PT: [slug('campeonato-nacional-feminino-portugal'), slug('2-divisao-portugal')],
  IT: [slug('campionato-serie-a2'), name(/serie\s*a\s*femminile/i)],
};

const CUPS: Matcher[] = [
  slug('copa-del-rey'), slug('copa-de-la-reina-iberdrola'),
  slug('supercopa-de-espana-masculina'), slug('supercopa-de-espana-femenina'),
  slug('copa-sar-la-princesa-masculina'), slug('copa-sar-la-princesa-femenina'),
  slug('taca-de-portugal'), slug('elite-cup-portugal'), slug('elite-cup-feminina-portugal'),
  slug('supertaca-portugal'), slug('supertaca-feminina-portugal'),
  name(/coppa italia(?!.*serie b)/i), name(/supercoppa italiana/i),
  (c) => c.scope === 'international' && !BIG.some((m) => m(c)),
];

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

function pick(comps: CompetitionSummary[], matchers: Matcher[]): CompetitionSummary[] {
  const out: CompetitionSummary[] = [];
  for (const m of matchers) {
    for (const c of comps) if (m(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

export interface CompetitionsHome {
  big: CompetitionSummary[];
  cups: CompetitionSummary[];
  second: Record<HomeCountry, CompetitionSummary[]>;
}

export function buildCompetitionsHome(comps: CompetitionSummary[], now: Date = new Date()): CompetitionsHome {
  const big = pick(comps, BIG);
  const cups = pick(comps.filter((c) => !big.includes(c)), CUPS)
    .filter((c) => cupIsActive(c, now))
    .sort((a, b) => Number((b.season?.liveMatches ?? 0) > 0) - Number((a.season?.liveMatches ?? 0) > 0)
      || String(a.season?.nextMatchAt ?? a.season?.lastMatchAt ?? '').localeCompare(String(b.season?.nextMatchAt ?? b.season?.lastMatchAt ?? '')));
  const second = Object.fromEntries(
    HOME_SECOND_COUNTRIES.map((k) => [k, pick(comps, SECOND[k])]),
  ) as Record<HomeCountry, CompetitionSummary[]>;
  return { big, cups, second };
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

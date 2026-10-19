/**
 * Motor de insights de temporada (C2, docs/PLAN_CONTENIDO_DATOS_2026-10-19.md §4).
 *
 * Generadores PUROS: reciben los datos de la temporada y devuelven un insight
 * tipado, o nada si no supera su umbral de muestra. Nunca texto: la web pone
 * la frase con la plantilla de cada idioma. Así una cifra se puede comprobar
 * contra los datos y la traducción no inventa nada.
 *
 * Los que dependen de eventos (goles por parte, balón parado, primer gol) solo
 * se calculan con actas completas en al menos el 80 % de los partidos jugados:
 * con menos, el porcentaje describiría la muestra, no la liga.
 */

export interface InsightTeam { id: string; name: string }

export interface InsightMatch {
  id: string;
  date: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  /** Partido de liga o fase de grupos (no eliminatoria). */
  league: boolean;
  /** Acta completa (`event_coverage = 'full'`): sus eventos son fiables. */
  fullEvents: boolean;
}

export interface InsightGoal { matchId: string; teamId: string; period: number | null; minute: number | null }
export interface InsightSetPiece { matchId: string; teamId: string; kind: 'penalty' | 'direct_foul'; scored: boolean }
export interface InsightScorer { playerId: string; teamId: string; goals: number }

export interface InsightInput {
  teams: InsightTeam[];
  /** Partidos terminados con marcador. */
  matches: InsightMatch[];
  goals: InsightGoal[];
  setPieces: InsightSetPiece[];
  scorers: InsightScorer[];
  /** Sin partidos pendientes: las rachas "en curso" ya no lo están. */
  seasonFinished?: boolean;
}

export type InsightKind =
  | 'only_unbeaten'
  | 'win_streak'
  | 'losing_streak'
  | 'best_attack'
  | 'best_defense'
  | 'perfect_home'
  | 'home_win_pct'
  | 'second_half_goals'
  | 'team_second_half'
  | 'late_goals'
  | 'penalty_pct'
  | 'direct_foul_pct'
  | 'penalty_drought'
  | 'scorer_share'
  | 'biggest_win'
  | 'highest_scoring'
  | 'first_goal_wins';

export interface Insight {
  /** Estable entre llamadas: tipo + entidades. Sirve de clave y de semilla. */
  id: string;
  kind: InsightKind;
  /** 0-100: rareza e interés. La web destaca uno de los más altos. */
  priority: number;
  teamIds: string[];
  playerIds: string[];
  matchId: string | null;
  values: Record<string, number>;
}

/** Umbrales: un insight que no los supera no sale nunca. */
export const THRESHOLDS = {
  minCoverage: 0.8,
  unbeatenPlayed: 4,
  streak: 3,
  losingStreak: 4,
  teamMatches: 3,
  perfectHome: 3,
  leagueMatches: 20,
  leagueGoals: 40,
  teamGoals: 15,
  teamSecondHalfPct: 60,
  lateGoals: 4,
  setPieceLeague: 15,
  penaltyDrought: 5,
  scorerTeamGoals: 10,
  scorerGoals: 5,
  scorerSharePct: 35,
  bigWinMargin: 5,
  highScoring: 12,
} as const;

const pct = (part: number, total: number) => Math.round((part / total) * 100);
const round1 = (n: number) => Math.round(n * 10) / 10;

interface TeamLine { teamId: string; result: 'W' | 'D' | 'L'; gf: number; ga: number; home: boolean; date: string }

function teamLines(matches: InsightMatch[]): Map<string, TeamLine[]> {
  const out = new Map<string, TeamLine[]>();
  const push = (l: TeamLine) => { const a = out.get(l.teamId) ?? []; a.push(l); out.set(l.teamId, a); };
  for (const m of matches) {
    const date = m.date ?? '';
    const r = (gf: number, ga: number): TeamLine['result'] => (gf > ga ? 'W' : gf < ga ? 'L' : 'D');
    push({ teamId: m.homeTeamId, result: r(m.homeScore, m.awayScore), gf: m.homeScore, ga: m.awayScore, home: true, date });
    push({ teamId: m.awayTeamId, result: r(m.awayScore, m.homeScore), gf: m.awayScore, ga: m.homeScore, home: false, date });
  }
  for (const lines of out.values()) lines.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function currentStreak(lines: TeamLine[], result: 'W' | 'L'): number {
  let n = 0;
  for (let i = lines.length - 1; i >= 0 && lines[i]!.result === result; i--) n++;
  return n;
}

/** Máximo único: si dos empatan en lo más alto, no hay "el que más". */
function uniqueMax<T>(items: T[], score: (t: T) => number): T | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  if (sorted.length > 1 && score(sorted[0]!) === score(sorted[1]!)) return null;
  return sorted[0]!;
}

function insight(kind: InsightKind, priority: number, opts: Partial<Omit<Insight, 'id' | 'kind' | 'priority'>> = {}): Insight {
  const teamIds = opts.teamIds ?? [];
  const playerIds = opts.playerIds ?? [];
  const matchId = opts.matchId ?? null;
  return {
    id: [kind, ...teamIds, ...playerIds, matchId].filter(Boolean).join(':'),
    kind, priority: Math.max(0, Math.min(100, Math.round(priority))),
    teamIds, playerIds, matchId, values: opts.values ?? {},
  };
}

export function computeSeasonInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const league = input.matches.filter((m) => m.league);
  const lines = teamLines(league);
  const T = THRESHOLDS;

  // ── Invictos y rachas ────────────────────────────────────────────────
  const unbeaten = [...lines.entries()].filter(([, l]) => l.length >= T.unbeatenPlayed && l.every((x) => x.result !== 'L'));
  if (unbeaten.length === 1) {
    const [teamId, l] = unbeaten[0]!;
    out.push(insight('only_unbeaten', 70, {
      teamIds: [teamId],
      values: { played: l.length, won: l.filter((x) => x.result === 'W').length, drawn: l.filter((x) => x.result === 'D').length },
    }));
  }
  const win = input.seasonFinished ? null : uniqueMax([...lines.entries()], ([, l]) => currentStreak(l, 'W'));
  if (win && currentStreak(win[1], 'W') >= T.streak) {
    const n = currentStreak(win[1], 'W');
    out.push(insight('win_streak', 40 + n * 5, { teamIds: [win[0]], values: { n } }));
  }
  const lose = input.seasonFinished ? null : uniqueMax([...lines.entries()], ([, l]) => currentStreak(l, 'L'));
  if (lose && currentStreak(lose[1], 'L') >= T.losingStreak) {
    const n = currentStreak(lose[1], 'L');
    out.push(insight('losing_streak', 30 + n * 3, { teamIds: [lose[0]], values: { n } }));
  }

  // ── Ataque y defensa ─────────────────────────────────────────────────
  const regulars = [...lines.entries()].filter(([, l]) => l.length >= T.teamMatches);
  if (regulars.length >= 3) {
    const gf = (l: TeamLine[]) => l.reduce((n, x) => n + x.gf, 0);
    const ga = (l: TeamLine[]) => l.reduce((n, x) => n + x.ga, 0);
    const attack = uniqueMax(regulars, ([, l]) => gf(l) / l.length);
    if (attack) {
      out.push(insight('best_attack', 35, {
        teamIds: [attack[0]], values: { goals: gf(attack[1]), played: attack[1].length, perMatch: round1(gf(attack[1]) / attack[1].length) },
      }));
    }
    const defense = uniqueMax(regulars, ([, l]) => -ga(l) / l.length);
    if (defense) {
      out.push(insight('best_defense', 35, {
        teamIds: [defense[0]], values: { conceded: ga(defense[1]), played: defense[1].length, perMatch: round1(ga(defense[1]) / defense[1].length) },
      }));
    }
  }

  // ── Casa y fuera ─────────────────────────────────────────────────────
  const perfect = [...lines.entries()]
    .map(([teamId, l]) => ({ teamId, home: l.filter((x) => x.home) }))
    .filter((t) => t.home.length >= T.perfectHome && t.home.every((x) => x.result === 'W'));
  if (perfect.length === 1) {
    out.push(insight('perfect_home', 55, { teamIds: [perfect[0]!.teamId], values: { played: perfect[0]!.home.length } }));
  }
  if (league.length >= T.leagueMatches) {
    out.push(insight('home_win_pct', 20, {
      values: { pct: pct(league.filter((m) => m.homeScore > m.awayScore).length, league.length), matches: league.length },
    }));
  }

  // ── Marcadores ───────────────────────────────────────────────────────
  const big = uniqueMax(input.matches, (m) => Math.abs(m.homeScore - m.awayScore));
  if (big && Math.abs(big.homeScore - big.awayScore) >= T.bigWinMargin) {
    out.push(insight('biggest_win', 40, {
      teamIds: [big.homeTeamId, big.awayTeamId], matchId: big.id, values: { home: big.homeScore, away: big.awayScore },
    }));
  }
  const many = uniqueMax(input.matches, (m) => m.homeScore + m.awayScore);
  if (many && many.homeScore + many.awayScore >= T.highScoring && many.id !== big?.id) {
    out.push(insight('highest_scoring', 35, {
      teamIds: [many.homeTeamId, many.awayTeamId], matchId: many.id, values: { home: many.homeScore, away: many.awayScore },
    }));
  }

  // ── Goleadores ───────────────────────────────────────────────────────
  const teamGoals = new Map<string, number>();
  for (const l of lines.values()) for (const x of l) teamGoals.set(x.teamId, (teamGoals.get(x.teamId) ?? 0) + x.gf);
  const share = uniqueMax(
    input.scorers.filter((s) => s.goals >= T.scorerGoals && (teamGoals.get(s.teamId) ?? 0) >= T.scorerTeamGoals),
    (s) => s.goals / teamGoals.get(s.teamId)!,
  );
  if (share) {
    const total = teamGoals.get(share.teamId)!;
    const p = pct(share.goals, total);
    if (p >= T.scorerSharePct) {
      out.push(insight('scorer_share', 45 + Math.min(20, p - T.scorerSharePct), {
        teamIds: [share.teamId], playerIds: [share.playerId], values: { goals: share.goals, teamGoals: total, pct: p },
      }));
    }
  }

  // ── Con actas: solo si la cobertura es suficiente ────────────────────
  const full = new Set(input.matches.filter((m) => m.fullEvents).map((m) => m.id));
  if (input.matches.length === 0 || full.size / input.matches.length < T.minCoverage) {
    return out.sort((a, b) => b.priority - a.priority);
  }
  const goals = input.goals.filter((g) => full.has(g.matchId));

  if (goals.length >= T.leagueGoals) {
    const second = goals.filter((g) => g.period === 2).length;
    out.push(insight('second_half_goals', 30, { values: { pct: pct(second, goals.length), goals: goals.length } }));
  }
  const byTeam = new Map<string, InsightGoal[]>();
  for (const g of goals) byTeam.set(g.teamId, [...(byTeam.get(g.teamId) ?? []), g]);
  const secondHalf = uniqueMax(
    [...byTeam.entries()].filter(([, g]) => g.length >= T.teamGoals),
    ([, g]) => g.filter((x) => x.period === 2).length / g.length,
  );
  if (secondHalf) {
    const p = pct(secondHalf[1].filter((x) => x.period === 2).length, secondHalf[1].length);
    if (p >= T.teamSecondHalfPct) {
      out.push(insight('team_second_half', 40 + Math.min(15, p - T.teamSecondHalfPct), {
        teamIds: [secondHalf[0]], values: { pct: p, goals: secondHalf[1].length },
      }));
    }
  }
  // Últimos 5 minutos: el minuto es el de la parte (1-25), la 2.ª es period 2.
  const late = uniqueMax([...byTeam.entries()], ([, g]) => g.filter((x) => x.period === 2 && (x.minute ?? 0) >= 21).length);
  if (late) {
    const n = late[1].filter((x) => x.period === 2 && (x.minute ?? 0) >= 21).length;
    if (n >= T.lateGoals) out.push(insight('late_goals', 45, { teamIds: [late[0]], values: { goals: n, teamGoals: late[1].length } }));
  }

  const sp = input.setPieces.filter((s) => full.has(s.matchId));
  for (const kind of ['penalty', 'direct_foul'] as const) {
    const shots = sp.filter((s) => s.kind === kind);
    if (shots.length >= T.setPieceLeague) {
      out.push(insight(kind === 'penalty' ? 'penalty_pct' : 'direct_foul_pct', 30, {
        values: { pct: pct(shots.filter((s) => s.scored).length, shots.length), scored: shots.filter((s) => s.scored).length, total: shots.length },
      }));
    }
  }
  const penByTeam = new Map<string, InsightSetPiece[]>();
  for (const s of sp.filter((x) => x.kind === 'penalty')) penByTeam.set(s.teamId, [...(penByTeam.get(s.teamId) ?? []), s]);
  const drought = uniqueMax(
    [...penByTeam.entries()].filter(([, s]) => s.length >= T.penaltyDrought && s.every((x) => !x.scored)),
    ([, s]) => s.length,
  );
  if (drought) out.push(insight('penalty_drought', 55, { teamIds: [drought[0]], values: { total: drought[1].length } }));

  // Quien marca primero: partidos con actas y al menos un gol.
  const firstGoal = new Map<string, InsightGoal>();
  for (const g of [...goals].sort((a, b) => (a.period ?? 0) - (b.period ?? 0) || (a.minute ?? 0) - (b.minute ?? 0))) {
    if (!firstGoal.has(g.matchId)) firstGoal.set(g.matchId, g);
  }
  const decided = input.matches.filter((m) => firstGoal.has(m.id));
  if (decided.length >= T.leagueMatches) {
    const won = decided.filter((m) => {
      const t = firstGoal.get(m.id)!.teamId;
      return t === m.homeTeamId ? m.homeScore > m.awayScore : m.awayScore > m.homeScore;
    }).length;
    out.push(insight('first_goal_wins', 30, { values: { pct: pct(won, decided.length), matches: decided.length } }));
  }

  return out.sort((a, b) => b.priority - a.priority);
}

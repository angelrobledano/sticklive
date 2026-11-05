import type { PlayerInsights, PlayerMetricKind } from '@sports/core/api';

const COPY: Record<string, {
  title: string;
  season: (competition: string, season: string) => string;
  labels: Record<PlayerMetricKind, string>;
  percentile: (pct: number) => string;
  rank: (rank: number, peers: number) => string;
  sample: (n: number) => string;
  factsTitle: string;
  goalShare: (pct: number, goals: number, total: number) => string;
  scorerRank: (rank: number) => string;
  scoringStreak: (n: number) => string;
  hatTricks: (n: number) => string;
}> = {
  es: {
    title: 'Percentiles de la liga',
    season: (c, s) => `${c} · ${s}`,
    labels: {
      goals_per_match: 'Goles por partido',
      assists_per_match: 'Asistencias por partido',
      participation: 'Participación en goles',
      penalty_pct: 'Penaltis marcados',
    },
    percentile: (pct) => `Percentil ${pct}`,
    rank: (rank, peers) => `Puesto ${rank} de ${peers}`,
    sample: (n) => `Muestra: ${n} jugadores con 5+ partidos`,
    factsTitle: 'Sus números',
    goalShare: (pct, goals, total) => `${pct} % de los goles de su equipo (${goals} de ${total}).`,
    scorerRank: (rank) => `${rank}.º en la tabla de goleadores.`,
    scoringStreak: (n) => `${n} partidos seguidos marcando.`,
    hatTricks: (n) => `${n} hat-tricks.`,
  },
  en: {
    title: 'League percentiles',
    season: (c, s) => `${c} · ${s}`,
    labels: {
      goals_per_match: 'Goals per match',
      assists_per_match: 'Assists per match',
      participation: 'Goal involvement',
      penalty_pct: 'Penalties scored',
    },
    percentile: (pct) => `${pct}th percentile`,
    rank: (rank, peers) => `Rank ${rank} of ${peers}`,
    sample: (n) => `Sample: ${n} players with 5+ matches`,
    factsTitle: 'Their numbers',
    goalShare: (pct, goals, total) => `${pct}% of their team's goals (${goals} of ${total}).`,
    scorerRank: (rank) => `No. ${rank} in the scoring chart.`,
    scoringStreak: (n) => `${n} matches in a row scoring.`,
    hatTricks: (n) => `${n} hat-tricks.`,
  },
  pt: {
    title: 'Percentis da liga',
    season: (c, s) => `${c} · ${s}`,
    labels: {
      goals_per_match: 'Golos por jogo',
      assists_per_match: 'Assistências por jogo',
      participation: 'Participação em golos',
      penalty_pct: 'Penáltis marcados',
    },
    percentile: (pct) => `Percentil ${pct}`,
    rank: (rank, peers) => `${rank}º de ${peers}`,
    sample: (n) => `Amostra: ${n} jogadores com 5+ jogos`,
    factsTitle: 'Os seus números',
    goalShare: (pct, goals, total) => `${pct} % dos golos da sua equipa (${goals} de ${total}).`,
    scorerRank: (rank) => `${rank}.º na tabela de marcadores.`,
    scoringStreak: (n) => `${n} jogos seguidos a marcar.`,
    hatTricks: (n) => `${n} hat-tricks.`,
  },
  fr: {
    title: 'Percentiles du championnat',
    season: (c, s) => `${c} · ${s}`,
    labels: {
      goals_per_match: 'Buts par match',
      assists_per_match: 'Passes par match',
      participation: 'Participation aux buts',
      penalty_pct: 'Penalties transformés',
    },
    percentile: (pct) => `${pct}e percentile`,
    rank: (rank, peers) => `${rank}e sur ${peers}`,
    sample: (n) => `Échantillon : ${n} joueurs avec 5+ matchs`,
    factsTitle: 'Ses chiffres',
    goalShare: (pct, goals, total) => `${pct} % des buts de son équipe (${goals} sur ${total}).`,
    scorerRank: (rank) => `${rank}e au classement des buteurs.`,
    scoringStreak: (n) => `${n} matchs de suite en marquant.`,
    hatTricks: (n) => `${n} triplés.`,
  },
  it: {
    title: 'Percentili del campionato',
    season: (c, s) => `${c} · ${s}`,
    labels: {
      goals_per_match: 'Gol a partita',
      assists_per_match: 'Assist a partita',
      participation: 'Partecipazione ai gol',
      penalty_pct: 'Rigori segnati',
    },
    percentile: (pct) => `${pct}° percentile`,
    rank: (rank, peers) => `${rank}° su ${peers}`,
    sample: (n) => `Campione: ${n} giocatori con 5+ partite`,
    factsTitle: 'I suoi numeri',
    goalShare: (pct, goals, total) => `${pct}% dei gol della sua squadra (${goals} su ${total}).`,
    scorerRank: (rank) => `${rank}° nella classifica marcatori.`,
    scoringStreak: (n) => `${n} partite consecutive a segno.`,
    hatTricks: (n) => `${n} triplette.`,
  },
};

export function PlayerPercentiles({ data, locale }: { data: PlayerInsights | null; locale: string }) {
  if (!data || !data.season || data.metrics.length === 0) return null;
  const c = COPY[locale] ?? COPY['en']!;
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  return (
    <section className="card p-4 space-y-3" aria-labelledby="player-percentiles-title">
      <div>
        <h2 id="player-percentiles-title" className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {c.title}
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {c.season(data.season.competitionName, data.season.name)}
        </p>
      </div>
      <ul className="space-y-3">
        {data.metrics.map((m) => (
          <li key={m.kind}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{c.labels[m.kind]}</span>
              <span className="font-score text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">
                {num.format(m.value)}{m.kind === 'penalty_pct' ? ' %' : ''}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="img" aria-label={c.percentile(m.percentile)}>
              <div className="h-full rounded-full bg-rink-passion" style={{ width: `${m.percentile}%` }} />
            </div>
            <p className="mt-1 flex justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>{c.percentile(m.percentile)}</span>
              <span>{c.rank(m.rank, m.peers)}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{c.sample(data.metrics[0]!.peers)}</p>
      {data.facts && (
        <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{c.factsTitle}</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-700 dark:text-slate-300">
            {data.facts.goalSharePct !== null && data.facts.teamGoals !== null && (
              <li>{c.goalShare(data.facts.goalSharePct, data.facts.goals, data.facts.teamGoals)}</li>
            )}
            {data.facts.scorerRank !== null && <li>{c.scorerRank(data.facts.scorerRank)}</li>}
            {data.facts.scoringStreak > 0 && <li>{c.scoringStreak(data.facts.scoringStreak)}</li>}
            {data.facts.hatTricks > 0 && <li>{c.hatTricks(data.facts.hatTricks)}</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

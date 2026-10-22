import type { CompetitionSummary } from '@/lib/content-summary';
import type { InsightPart } from '@/lib/insights';
import type { Insight, SeasonInsights, SeasonLeader, SeasonStandingRow, SeasonStats } from '@/lib/api/types';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName, playerDisplayName, playerNameFromRaw } from '@/lib/names';
import { isRenderable, renderInsight } from '@/lib/insights';

const COPY: Record<string, {
  champion: string; regular: string; awards: string; records: string;
  topScorer: string; topAssists: string; bestAttack: string; bestDefense: string; goals: string;
}> = {
  es: { champion: 'Campeón', regular: '1.º de la clasificación final', awards: 'Premios de la temporada', records: 'Récords y momentos', topScorer: 'Máximo goleador', topAssists: 'Máximo asistente', bestAttack: 'Equipo más goleador', bestDefense: 'Mejor defensa', goals: 'goles' },
  en: { champion: 'Champion', regular: '1st in the final standings', awards: 'Season awards', records: 'Records and moments', topScorer: 'Top scorer', topAssists: 'Top assists', bestAttack: 'Top-scoring team', bestDefense: 'Best defence', goals: 'goals' },
  pt: { champion: 'Campeão', regular: '1.º na classificação final', awards: 'Prémios da temporada', records: 'Recordes e momentos', topScorer: 'Melhor marcador', topAssists: 'Melhor assistente', bestAttack: 'Equipa mais goleadora', bestDefense: 'Melhor defesa', goals: 'golos' },
  fr: { champion: 'Champion', regular: '1er du classement final', awards: 'Récompenses de la saison', records: 'Records et moments', topScorer: 'Meilleur buteur', topAssists: 'Meilleur passeur', bestAttack: 'Meilleure attaque', bestDefense: 'Meilleure défense', goals: 'buts' },
  it: { champion: 'Campione', regular: '1° nella classifica finale', awards: 'Premi della stagione', records: 'Record e momenti', topScorer: 'Capocannoniere', topAssists: 'Miglior assist', bestAttack: 'Miglior attacco', bestDefense: 'Miglior difesa', goals: 'gol' },
};

function leaderName(l: SeasonLeader | undefined): string {
  if (!l) return '';
  return l.firstName && l.lastName ? playerDisplayName(l.firstName, l.lastName) : playerNameFromRaw(l.playerName);
}

function Sentence({ parts }: { parts: InsightPart[] }) {
  return (
    <>
      {parts.map((p, i) => typeof p === 'string'
        ? <span key={i}>{p}</span>
        : <Link key={i} href={p.href} className="font-semibold underline decoration-slate-300 underline-offset-2 hover:decoration-rink-passion">{p.text}</Link>)}
    </>
  );
}

function uniqueBest(rows: SeasonStandingRow[], score: (r: SeasonStandingRow) => number): SeasonStandingRow | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  return sorted[0] ?? null;
}

export function ClosedSeasonHighlights({ summary, stats, insights, standings, locale }: {
  summary: CompetitionSummary;
  stats: SeasonStats | null;
  insights: SeasonInsights | null;
  standings: SeasonStandingRow[];
  locale: string;
}) {
  const c = COPY[locale] ?? COPY['en']!;
  const champion = summary.podium?.gold ?? (summary.leader
    ? { teamId: summary.leader.teamId, teamName: summary.leader.teamName }
    : null);
  const championLabel = summary.podium ? c.champion : c.regular;
  const scorer = stats?.topScorers?.[0];
  const assister = stats?.topAssists?.[0];
  const attack = uniqueBest(standings, (r) => r.goalsFor);
  const defense = uniqueBest(standings, (r) => -r.goalsAgainst);
  const recordKinds = new Set<Insight['kind']>([
    'only_unbeaten', 'win_streak', 'losing_streak', 'biggest_win', 'highest_scoring', 'best_attack', 'best_defense',
  ]);
  const records = insights?.insights.filter((i) => recordKinds.has(i.kind) && isRenderable(i, insights)) ?? [];
  const hasAwards = Boolean(scorer || assister || attack || defense);
  if (!champion && !hasAwards && records.length === 0) return null;

  return (
    <section className="grid gap-3 sm:grid-cols-2" aria-label={c.awards}>
      {champion && (
        <div className="card p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">{championLabel}</p>
          <Link href={`/teams/${champion.teamId}`} className="mt-2 flex items-center gap-2">
            <TeamShield teamId={champion.teamId} teamName={champion.teamName} size={36} className="shrink-0" />
            <span className="text-lg font-bold text-slate-900 dark:text-slate-50">{clubName(champion.teamName)}</span>
          </Link>
        </div>
      )}

      {hasAwards && (
        <div className="card p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{c.awards}</h2>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            {scorer && <li><span className="text-slate-500 dark:text-slate-400">{c.topScorer}: </span>{scorer.playerId ? <Link href={`/players/${scorer.playerId}`} className="font-semibold hover:underline">{leaderName(scorer)}</Link> : leaderName(scorer)} <span className="font-score tabular-nums">({scorer.value} {c.goals})</span></li>}
            {assister && <li><span className="text-slate-500 dark:text-slate-400">{c.topAssists}: </span>{assister.playerId ? <Link href={`/players/${assister.playerId}`} className="font-semibold hover:underline">{leaderName(assister)}</Link> : leaderName(assister)} <span className="font-score tabular-nums">({assister.value})</span></li>}
            {attack && <li><span className="text-slate-500 dark:text-slate-400">{c.bestAttack}: </span><Link href={`/teams/${attack.teamId}`} className="font-semibold hover:underline">{clubName(attack.teamName)}</Link> <span className="font-score tabular-nums">({attack.goalsFor})</span></li>}
            {defense && <li><span className="text-slate-500 dark:text-slate-400">{c.bestDefense}: </span><Link href={`/teams/${defense.teamId}`} className="font-semibold hover:underline">{clubName(defense.teamName)}</Link> <span className="font-score tabular-nums">({defense.goalsAgainst})</span></li>}
          </ul>
        </div>
      )}

      {records.length > 0 && insights && (
        <div className="card p-4 sm:col-span-2">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{c.records}</h2>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            {records.map((i) => <li key={i.id}><Sentence parts={renderInsight(i, insights, locale, 'past')} /></li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

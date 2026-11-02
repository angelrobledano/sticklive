import type { ReactNode } from 'react';
import type { CompetitionSummary as CompetitionSummaryData } from '@/lib/content-summary';
import type { SeasonInsights } from '@/lib/api/types';
import { isRenderable, pickDailyInsight, renderInsight, TOURNAMENT_SKIP, type InsightPart } from '@/lib/insights';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { TeamShield } from '@/components/shared/TeamShield';
import { PlayerAvatar } from '@/components/shared/PlayerAvatar';
import { clubName, playerDisplayName } from '@/lib/names';
import { ViewerDateTime } from './ViewerDateTime';

interface Copy {
  live: string; done: string;
  /** Torneo (final four, cuadro, grupos) y competición sin arrancar. */
  liveT: string; doneT: string; startL: string; startT: string; moreT: (n: number) => string;
  matchday: (c: number, t: number) => string;
  leader: string; finalFirst: string; pts: string;
  champion: string; finalVs: (team: string) => string;
  ahead: (n: number, team: string) => string; tied: (team: string) => string;
  featured: string; next: string; versus: (h: string, a: string) => string; round: (n: number) => string;
  scorer: string; goals: string; team: string;
  scorerAhead: (n: number, name: string | null) => string; scorerTied: (name: string | null) => string;
  matches: (n: number) => string; gpm: (n: string) => string; homeWins: (n: number) => string;
  ordinal: (n: number) => string;
  medals: string; gold: string; silver: string; bronze: string;
  didYouKnow: string; more: (n: number) => string;
  sentOff: string; sentOffRound: (n: number) => string; matchLink: string;
}

const COPY: Record<string, Copy> = {
  es: {
    champion: 'Campeón', finalVs: (team) => `Ganó la final a ${team}`,
    liveT: 'Así va el torneo', doneT: 'Así terminó el torneo', startL: 'Así arranca la liga', startT: 'Así arranca el torneo', moreT: (n) => `Más datos del torneo (${n})`,
    live: 'Así va la liga', done: 'Así terminó', matchday: (c, t) => `Jornada ${c} de ${t}`,
    leader: 'Líder', finalFirst: '1.º en la clasificación final', pts: 'pts',
    ahead: (n, team) => `+${n} sobre ${team}`, tied: (team) => `Empatado a puntos con ${team}`,
    featured: 'Partido destacado', next: 'Próximo partido', versus: (h, a) => `${h} contra ${a}`, round: (n) => `Jornada ${n}`,
    scorer: 'Máximo goleador', goals: 'goles', team: 'Equipo',
    scorerAhead: (n, name) => name ? `+${n} sobre ${name} (2.º)` : `+${n} sobre el 2.º`,
    scorerTied: (name) => name ? `Empatado con ${name} (2.º)` : 'Empatado con el 2.º',
    matches: (n) => `${n} partidos`, gpm: (n) => `${n} goles por partido`, homeWins: (n) => `${n} % de victorias locales`,
    ordinal: (n) => `${n}.º`,
    didYouKnow: '¿Sabías que…?', more: (n) => `Más datos de la liga (${n})`,
    sentOff: 'Expulsados en la última jornada', sentOffRound: (n) => `Jornada ${n}`, matchLink: 'Ver partido',
    medals: 'Medallero', gold: 'Oro', silver: 'Plata', bronze: 'Bronce',
  },
  en: {
    champion: 'Champion', finalVs: (team) => `Beat ${team} in the final`,
    liveT: 'The tournament so far', doneT: 'How the tournament ended', startL: 'The league kicks off', startT: 'The tournament kicks off', moreT: (n) => `More tournament facts (${n})`,
    live: 'The league so far', done: 'How it ended', matchday: (c, t) => `Matchday ${c} of ${t}`,
    leader: 'Leader', finalFirst: '1st in the final standings', pts: 'pts',
    ahead: (n, team) => `+${n} over ${team}`, tied: (team) => `Level on points with ${team}`,
    featured: 'Match of the round', next: 'Next match', versus: (h, a) => `${h} vs ${a}`, round: (n) => `Matchday ${n}`,
    scorer: 'Top scorer', goals: 'goals', team: 'Team',
    scorerAhead: (n, name) => name ? `+${n} over ${name} (2nd)` : `+${n} over 2nd`,
    scorerTied: (name) => name ? `Level with ${name} (2nd)` : 'Level with 2nd',
    matches: (n) => `${n} matches`, gpm: (n) => `${n} goals per match`, homeWins: (n) => `${n}% home wins`,
    ordinal: (n) => {
      const s = new Intl.PluralRules('en', { type: 'ordinal' }).select(n);
      return `${n}${({ one: 'st', two: 'nd', few: 'rd' } as Record<string, string>)[s] ?? 'th'}`;
    },
    didYouKnow: 'Did you know?', more: (n) => `More league facts (${n})`,
    sentOff: 'Sent off on the last matchday', sentOffRound: (n) => `Matchday ${n}`, matchLink: 'View match',
    medals: 'Medal table', gold: 'Gold', silver: 'Silver', bronze: 'Bronze',
  },
  pt: {
    champion: 'Campeão', finalVs: (team) => `Venceu a final frente a ${team}`,
    liveT: 'Assim vai o torneio', doneT: 'Assim terminou o torneio', startL: 'Assim arranca a liga', startT: 'Assim arranca o torneio', moreT: (n) => `Mais dados do torneio (${n})`,
    live: 'Assim vai a liga', done: 'Assim terminou', matchday: (c, t) => `Jornada ${c} de ${t}`,
    leader: 'Líder', finalFirst: '1.º na classificação final', pts: 'pts',
    ahead: (n, team) => `+${n} sobre ${team}`, tied: (team) => `Empatado em pontos com ${team}`,
    featured: 'Jogo em destaque', next: 'Próximo jogo', versus: (h, a) => `${h} contra ${a}`, round: (n) => `Jornada ${n}`,
    scorer: 'Melhor marcador', goals: 'golos', team: 'Equipa',
    scorerAhead: (n, name) => name ? `+${n} sobre ${name} (2.º)` : `+${n} sobre o 2.º`,
    scorerTied: (name) => name ? `Empatado com ${name} (2.º)` : 'Empatado com o 2.º',
    matches: (n) => `${n} jogos`, gpm: (n) => `${n} golos por jogo`, homeWins: (n) => `${n} % de vitórias em casa`,
    ordinal: (n) => `${n}.º`,
    didYouKnow: 'Sabia que…?', more: (n) => `Mais dados da liga (${n})`,
    sentOff: 'Expulsos na última jornada', sentOffRound: (n) => `Jornada ${n}`, matchLink: 'Ver jogo',
    medals: 'Medalheiro', gold: 'Ouro', silver: 'Prata', bronze: 'Bronze',
  },
  fr: {
    champion: 'Champion', finalVs: (team) => `Vainqueur de la finale face à ${team}`,
    liveT: 'Le tournoi en cours', doneT: 'Bilan du tournoi', startL: 'Le championnat commence', startT: 'Le tournoi commence', moreT: (n) => `Plus de chiffres du tournoi (${n})`,
    live: 'Le championnat en cours', done: 'Bilan de la saison', matchday: (c, t) => `Journée ${c} sur ${t}`,
    leader: 'Leader', finalFirst: '1er du classement final', pts: 'pts',
    ahead: (n, team) => `+${n} sur ${team}`, tied: (team) => `À égalité de points avec ${team}`,
    featured: 'Match à suivre', next: 'Prochain match', versus: (h, a) => `${h} contre ${a}`, round: (n) => `Journée ${n}`,
    scorer: 'Meilleur buteur', goals: 'buts', team: 'Équipe',
    scorerAhead: (n, name) => name ? `+${n} sur ${name} (2e)` : `+${n} sur le 2e`,
    scorerTied: (name) => name ? `À égalité avec ${name} (2e)` : 'À égalité avec le 2e',
    matches: (n) => `${n} matchs`, gpm: (n) => `${n} buts par match`, homeWins: (n) => `${n} % de victoires à domicile`,
    ordinal: (n) => (n === 1 ? '1er' : `${n}e`),
    didYouKnow: 'Le saviez-vous ?', more: (n) => `Plus de chiffres du championnat (${n})`,
    sentOff: 'Exclus lors de la dernière journée', sentOffRound: (n) => `Journée ${n}`, matchLink: 'Voir le match',
    medals: 'Tableau des médailles', gold: 'Or', silver: 'Argent', bronze: 'Bronze',
  },
  it: {
    champion: 'Campione', finalVs: (team) => `Ha vinto la finale contro ${team}`,
    liveT: 'Il torneo finora', doneT: 'Com’è finito il torneo', startL: 'Si parte: il campionato', startT: 'Si parte: il torneo', moreT: (n) => `Altri dati del torneo (${n})`,
    live: 'Il campionato finora', done: 'Com’è finita', matchday: (c, t) => `Giornata ${c} di ${t}`,
    leader: 'Capolista', finalFirst: '1º nella classifica finale', pts: 'pt',
    ahead: (n, team) => `+${n} su ${team}`, tied: (team) => `A pari punti con ${team}`,
    featured: 'Partita da seguire', next: 'Prossima partita', versus: (h, a) => `${h} contro ${a}`, round: (n) => `Giornata ${n}`,
    scorer: 'Capocannoniere', goals: 'gol', team: 'Squadra',
    scorerAhead: (n, name) => name ? `+${n} su ${name} (2°)` : `+${n} sul 2º`,
    scorerTied: (name) => name ? `A pari con ${name} (2°)` : 'A pari con il 2º',
    matches: (n) => `${n} partite`, gpm: (n) => `${n} gol a partita`, homeWins: (n) => `${n}% di vittorie in casa`,
    ordinal: (n) => `${n}º`,
    didYouKnow: 'Lo sapevi?', more: (n) => `Altri dati del campionato (${n})`,
    sentOff: 'Espulsi nell’ultima giornata', sentOffRound: (n) => `Giornata ${n}`, matchLink: 'Vedi partita',
    medals: 'Medagliere', gold: 'Oro', silver: 'Argento', bronze: 'Bronzo',
  },
};

COPY['ca'] = {
    champion: 'Campió', finalVs: (team) => `Va guanyar la final contra ${team}`,
  live: 'Així va la lliga', done: 'Així va acabar', matchday: (c, t) => `Jornada ${c} de ${t}`,
  liveT: 'Així va el torneig', doneT: 'Així va acabar el torneig', startL: 'Així arrenca la lliga', startT: 'Així arrenca el torneig', moreT: (n) => `Més dades del torneig (${n})`,
  leader: 'Líder', finalFirst: '1r a la classificació final', pts: 'pts',
  ahead: (n, team) => `+${n} sobre ${team}`, tied: (team) => `Empatat a punts amb ${team}`,
  featured: 'Partit destacat', next: 'Proper partit', versus: (h, a) => `${h} contra ${a}`, round: (n) => `Jornada ${n}`,
  scorer: 'Màxim golejador', goals: 'gols', team: 'Equip',
  scorerAhead: (n, name) => name ? `+${n} sobre ${name} (2n)` : `+${n} sobre el 2n`,
  scorerTied: (name) => name ? `Empatat amb ${name} (2n)` : 'Empatat amb el 2n',
  matches: (n) => `${n} partits`, gpm: (n) => `${n} gols per partit`, homeWins: (n) => `${n} % de victòries locals`,
  ordinal: (n) => (n === 1 ? '1r' : n === 2 ? '2n' : n === 3 ? '3r' : n === 4 ? '4t' : `${n}è`),
  didYouKnow: 'Sabies que…?', more: (n) => `Més dades de la lliga (${n})`,
  sentOff: 'Expulsats a la darrera jornada', sentOffRound: (n) => `Jornada ${n}`, matchLink: 'Veure el partit',
  medals: 'Medaller', gold: 'Or', silver: 'Plata', bronze: 'Bronze',
};

function Sentence({ parts }: { parts: InsightPart[] }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string'
        ? <span key={i}>{p}</span>
        : (
          <Link key={i} href={p.href} className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-rink-passion dark:text-slate-50 dark:decoration-slate-600">
            {p.text}
          </Link>
        )))}
    </>
  );
}

function Tile({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  const body = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-2 space-y-1">{children}</div>
    </>
  );
  const cls = 'block h-full min-w-0 rounded-lg border border-slate-200 p-3 dark:border-white/[0.06]';
  return (
    <li className="w-[78%] shrink-0 snap-start sm:w-auto">
      {href ? (
        <Link href={href} className={`${cls} transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]`}>{body}</Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/**
 * "Así va la liga" (C0): jornada, líder con su ventaja, partido destacado de la
 * próxima jornada y pichichi, cada uno enlazado a su ficha, más las cifras de
 * la liga. Server-rendered y solo con datos reales: lo que no hay no se pinta.
 */
export function CompetitionSummary({ data, locale, insights, seed, day }: {
  data: CompetitionSummaryData;
  locale: string;
  /** Datos destacados de la temporada (C2); sin ellos el bloque sigue igual. */
  insights?: SeasonInsights | null;
  /** Semilla y día (AAAA-MM-DD) del dato del día: mismo dato durante todo el día. */
  seed?: string;
  day?: string;
}) {
  const c = COPY[locale] ?? COPY['en']!;
  const { leader, featured, topScorer, figures, matchday, podium } = data;
  // Con medallero el campeón ya sale en él (oro).
  const champion = podium ? null : data.champion;
  const scope = data.kind === 'tournament' ? 'tournament' : 'league';
  const facts = insights
    ? insights.insights.filter((i) => isRenderable(i, insights) && !(scope === 'tournament' && TOURNAMENT_SKIP.has(i.kind)))
    : [];
  const daily = insights && seed && day ? pickDailyInsight(facts, seed, day) : null;
  const rest = facts.filter((i) => i !== daily);
  const hasDiscipline = Boolean(insights?.discipline && insights.discipline.reds.length > 0);
  if (!champion && !leader && !featured && !topScorer && !podium && !daily && !hasDiscipline) return null;
  const tiles = [champion, leader, featured, topScorer].filter(Boolean).length;

  // "Campeón" no: en ligas cuyo título se decide en un playoff de otra
  // competición (OK Liga), el 1.º de la tabla no lo es.
  const leaderLabel = data.status === 'finished' ? c.finalFirst : c.leader;
  const num = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <section className="card space-y-3 p-4" aria-labelledby="competition-summary-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="competition-summary-title" className="text-base font-bold text-slate-900 dark:text-slate-50">
          {data.kind === 'tournament'
            ? (data.status === 'finished' ? c.doneT : data.status === 'not_started' ? c.startT : c.liveT)
            : (data.status === 'finished' ? c.done : data.status === 'not_started' ? c.startL : c.live)}
        </h2>
        {data.status !== 'finished' && matchday && (
          <p className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
            {c.matchday(matchday.current, matchday.total)}
          </p>
        )}
      </div>

      {podium && (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-white/[0.06]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {c.medals}
          </p>
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/[0.06]">
            {[
              { medal: '1', tone: 'bg-amber-400 text-amber-950', label: c.gold, team: podium.gold },
              { medal: '2', tone: 'bg-slate-300 text-slate-800', label: c.silver, team: podium.silver },
              { medal: '3', tone: 'bg-amber-700 text-white', label: c.bronze, team: podium.bronze },
            ].map(({ medal, tone, label, team }) => (
              <li key={medal} className="flex items-center gap-2.5 py-1.5 first:pt-0 last:pb-0">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${tone}`}
                  aria-hidden="true"
                >
                  {medal}
                </span>
                <TeamShield teamId={team.teamId} teamName={team.teamName} size={22} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {clubName(team.teamName)}
                </span>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className={`-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0 ${
        tiles >= 3 ? 'sm:grid-cols-3' : tiles === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
        {champion && (
          <Tile href={`/teams/${champion.teamId}`} label={c.champion}>
            <div className="flex items-center gap-2">
              <TeamShield teamId={champion.teamId} teamName={champion.teamName} size={28} className="shrink-0" />
              <span className="line-clamp-2 text-sm font-semibold leading-tight text-slate-900 dark:text-slate-50">{clubName(champion.teamName)}</span>
            </div>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {c.finalVs(clubName(champion.runnerUpName))}
            </p>
          </Tile>
        )}

        {leader && (
          <Tile href={`/teams/${leader.teamId}`} label={leaderLabel}>
            <div className="flex items-center gap-2">
              <TeamShield teamId={leader.teamId} teamName={leader.teamName} size={28} className="shrink-0" />
              <span className="line-clamp-2 text-sm font-semibold leading-tight text-slate-900 dark:text-slate-50">{clubName(leader.teamName)}</span>
            </div>
            <p className="font-score text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {leader.points} <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{c.pts}</span>
            </p>
            {leader.gap !== null && leader.secondTeamName && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {leader.gap > 0 ? c.ahead(leader.gap, clubName(leader.secondTeamName)) : c.tied(clubName(leader.secondTeamName))}
              </p>
            )}
          </Tile>
        )}

        {featured && (
          <Tile
            href={`/matches/${featured.id}`}
            label={featured.homePosition !== null && featured.awayPosition !== null ? c.featured : c.next}
          >
            {[
              { id: featured.homeTeamId, name: featured.homeName },
              { id: featured.awayTeamId, name: featured.awayName },
            ].map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <TeamShield teamId={t.id} teamName={t.name} size={20} className="shrink-0" />
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{clubName(t.name)}</span>
              </div>
            ))}
            {featured.date && (
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                <ViewerDateTime iso={featured.date} locale={locale} />
              </p>
            )}
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {[
                featured.homePosition !== null && featured.awayPosition !== null
                  ? c.versus(c.ordinal(featured.homePosition), c.ordinal(featured.awayPosition))
                  : null,
                featured.roundType === 'regular' && featured.roundNumber ? c.round(featured.roundNumber) : null,
              ].filter(Boolean).join(' · ')}
            </p>
          </Tile>
        )}

        {topScorer && (
          <Tile href={topScorer.playerId ? `/players/${topScorer.playerId}` : null} label={c.scorer}>
            <div className="flex items-center gap-2">
              <PlayerAvatar photoUrl={topScorer.photoUrl} name={topScorer.displayName} className="h-7 w-7 shrink-0 rounded-full" />
              <span className="line-clamp-2 text-sm font-semibold leading-tight text-slate-900 dark:text-slate-50">{topScorer.displayName}</span>
            </div>
            <p className="font-score text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {topScorer.value} <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{c.goals}</span>
            </p>
            {topScorer.gap !== null && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {topScorer.gap > 0 ? c.scorerAhead(topScorer.gap, topScorer.secondName) : c.scorerTied(topScorer.secondName)}
              </p>
            )}
            {topScorer.teamName && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {c.team}: {clubName(topScorer.teamName)}
              </p>
            )}
          </Tile>
        )}
      </ul>

      {daily && insights && (
        <div className="flex gap-3 rounded-lg border-l-4 border-rink-passion bg-rink-passion/[0.06] px-3 py-3 dark:bg-rink-passion/15">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-rink-passion dark:text-rose-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
          </svg>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-rink-passion dark:text-rose-400">{c.didYouKnow}</p>
            <p className="mt-1 text-[15px] font-medium leading-snug text-slate-800 dark:text-slate-100">
              <Sentence parts={renderInsight(daily, insights, locale, data.status === 'finished' ? 'past' : 'present', scope)} />
            </p>
          </div>
        </div>
      )}

      {insights?.discipline && insights.discipline.reds.length > 0 && insights.discipline.roundNumber !== null && (
        <div className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2.5 dark:border-red-900/40 dark:bg-red-950/20">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
            {c.sentOff} · {c.sentOffRound(insights.discipline.roundNumber)}
          </p>
          <ul className="mt-1 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            {insights.discipline.reds.map((r) => {
              const player = r.playerId && insights.players[r.playerId]
                ? playerDisplayName(insights.players[r.playerId]!.firstName, insights.players[r.playerId]!.lastName)
                : (r.firstName || r.lastName ? playerDisplayName(r.firstName ?? '', r.lastName ?? '') : '—');
              const team = insights.teams[r.teamId] ? clubName(insights.teams[r.teamId]!.name) : '';
              const hasMatch = Boolean(insights.matches[r.matchId]);
              return (
                <li key={`${r.matchId}-${r.playerId ?? r.minute ?? 'x'}`} className="leading-snug">
                  {r.playerId ? (
                    <Link href={`/players/${r.playerId}`} className="font-semibold underline decoration-slate-300 underline-offset-2 hover:decoration-rink-passion">{player}</Link>
                  ) : <span className="font-semibold">{player}</span>}
                  {team ? ` (${team})` : ''}
                  {r.minute !== null ? `, ${r.minute}'` : ''}
                  {hasMatch ? (
                    <> · <Link href={`/matches/${r.matchId}`} className="text-xs underline decoration-slate-300 underline-offset-2 hover:decoration-rink-passion">{c.matchLink}</Link></>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {figures && (
        <ul className="flex flex-wrap gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          {[
            c.matches(figures.matchesPlayed),
            figures.goalsPerMatch !== null ? c.gpm(num.format(figures.goalsPerMatch)) : null,
            figures.homeWinPct !== null ? c.homeWins(figures.homeWinPct) : null,
          ].filter(Boolean).map((text) => (
            <li key={text} className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-white/[0.05]">{text}</li>
          ))}
        </ul>
      )}

      {rest.length > 0 && insights && (
        <details className="group text-sm">
          <summary className="cursor-pointer select-none text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">
            {data.kind === 'tournament' ? c.moreT(rest.length) : c.more(rest.length)}
          </summary>
          <ul className="mt-2 space-y-1.5 text-slate-700 dark:text-slate-300">
            {rest.map((i) => (
              <li key={i.id} className="leading-snug"><Sentence parts={renderInsight(i, insights, locale, data.status === 'finished' ? 'past' : 'present', scope)} /></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

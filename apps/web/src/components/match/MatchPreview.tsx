import type {
  CrossMetric,
  CrossMetricKey,
  MatchPreview as MatchPreviewData,
  TeamObservationKind,
  TeamSnapshot,
} from '@/lib/content-summary';
import { duelBar, headToHeadBalance } from '@/lib/preview-duel';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName } from '@/lib/names';

interface Copy {
  title: string; position: string; points: string; form: string; h2h: string; emptyH2h: string; lastFive: string;
  home: string; away: string;
  observations: string; cross: string;
  shortHome: string; shortAway: string; draws: string; wins: string; goals: string; letters: Record<'W' | 'D' | 'L', string>; crossHint: string;
  obs: Record<TeamObservationKind, (value: number, total: number) => string>;
  crossLabels: Record<CrossMetricKey, string>;
}

const COPY: Record<string, Copy> = {
  es: {
    title: 'Previa del partido', position: 'Posición', points: 'Puntos', form: 'Forma',
    shortHome: 'casa', shortAway: 'fuera',
    draws: 'Empates', wins: 'Victorias', goals: 'goles', letters: { W: 'V', D: 'E', L: 'D' }, crossHint: 'Resaltado, quien sale mejor en cada dato.',
    h2h: 'Enfrentamientos previos', emptyH2h: 'Sin enfrentamientos previos esta temporada.', lastFive: 'Últimos 5',
    home: 'Local', away: 'Visitante',
    observations: 'Cómo llega', cross: 'Números del cruce',
    obs: {
      recent_goals: (v, t) => `${v} goles en sus últimos ${t} partidos.`,
      win_streak: (v) => `${v} victorias seguidas.`,
      unbeaten: (v) => `${v} partidos sin perder.`,
      home_wins: (v, t) => `${v} victorias en sus últimos ${t} partidos en casa.`,
      away_wins: (v, t) => `${v} victorias en sus últimos ${t} partidos fuera.`,
      goals_per_match: (v, t) => `${v} goles por partido en la temporada (${t} partidos).`,
    },
    crossLabels: {
      goals_per_match: 'Goles por partido', minutes_goal: 'Minutos por gol', minutes_conceded: 'Minutos por gol encajado',
      fouls: 'Faltas por partido', direct_fouls: 'Faltas directas por partido', direct_foul_pct: 'Acierto faltas directas',
      penalty_pct: 'Penaltis marcados', cards: 'Tarjetas por partido',
    },
  },
  en: {
    title: 'Match preview', position: 'Position', points: 'Points', form: 'Form',
    shortHome: 'home', shortAway: 'away',
    draws: 'Draws', wins: 'Wins', goals: 'goals', letters: { W: 'W', D: 'D', L: 'L' }, crossHint: 'Highlighted: who comes out better in each stat.',
    h2h: 'Previous meetings', emptyH2h: 'No previous meetings this season.', lastFive: 'Last 5',
    home: 'Home', away: 'Away',
    observations: 'Recent form', cross: 'Head-to-head numbers',
    obs: {
      recent_goals: (v, t) => `${v} goals in their last ${t} matches.`,
      win_streak: (v) => `${v} wins in a row.`,
      unbeaten: (v) => `${v} matches unbeaten.`,
      home_wins: (v, t) => `${v} wins in their last ${t} home matches.`,
      away_wins: (v, t) => `${v} wins in their last ${t} away matches.`,
      goals_per_match: (v, t) => `${v} goals per match this season (${t} matches).`,
    },
    crossLabels: {
      goals_per_match: 'Goals per match', minutes_goal: 'Minutes per goal', minutes_conceded: 'Minutes per goal conceded',
      fouls: 'Fouls per match', direct_fouls: 'Direct free hits per match', direct_foul_pct: 'Direct free-hit conversion',
      penalty_pct: 'Penalties scored', cards: 'Cards per match',
    },
  },
  pt: {
    title: 'Antevisão do jogo', position: 'Posição', points: 'Pontos', form: 'Forma',
    shortHome: 'casa', shortAway: 'fora',
    draws: 'Empates', wins: 'Vitórias', goals: 'golos', letters: { W: 'V', D: 'E', L: 'D' }, crossHint: 'Em destaque, quem sai melhor em cada dado.',
    h2h: 'Confrontos anteriores', emptyH2h: 'Sem confrontos anteriores esta temporada.', lastFive: 'Últimos 5',
    home: 'Casa', away: 'Fora',
    observations: 'Como chega', cross: 'Números do confronto',
    obs: {
      recent_goals: (v, t) => `${v} golos nos últimos ${t} jogos.`,
      win_streak: (v) => `${v} vitórias seguidas.`,
      unbeaten: (v) => `${v} jogos sem perder.`,
      home_wins: (v, t) => `${v} vitórias nos últimos ${t} jogos em casa.`,
      away_wins: (v, t) => `${v} vitórias nos últimos ${t} jogos fora.`,
      goals_per_match: (v, t) => `${v} golos por jogo na temporada (${t} jogos).`,
    },
    crossLabels: {
      goals_per_match: 'Golos por jogo', minutes_goal: 'Minutos por golo', minutes_conceded: 'Minutos por golo sofrido',
      fouls: 'Faltas por jogo', direct_fouls: 'Livres diretos por jogo', direct_foul_pct: 'Aproveitamento de livres diretos',
      penalty_pct: 'Penáltis marcados', cards: 'Cartões por jogo',
    },
  },
  fr: {
    title: 'Avant-match', position: 'Position', points: 'Points', form: 'Forme',
    shortHome: 'dom.', shortAway: 'ext.',
    draws: 'Nuls', wins: 'Victoires', goals: 'buts', letters: { W: 'V', D: 'N', L: 'D' }, crossHint: 'En évidence : qui fait mieux sur chaque donnée.',
    h2h: 'Confrontations précédentes', emptyH2h: 'Aucune confrontation cette saison.', lastFive: '5 derniers',
    home: 'Dom.', away: 'Ext.',
    observations: 'Forme récente', cross: 'Chiffres du duel',
    obs: {
      recent_goals: (v, t) => `${v} buts lors de ses ${t} derniers matchs.`,
      win_streak: (v) => `${v} victoires de suite.`,
      unbeaten: (v) => `${v} matchs sans défaite.`,
      home_wins: (v, t) => `${v} victoires lors de ses ${t} derniers matchs à domicile.`,
      away_wins: (v, t) => `${v} victoires lors de ses ${t} derniers matchs à l'extérieur.`,
      goals_per_match: (v, t) => `${v} buts par match cette saison (${t} matchs).`,
    },
    crossLabels: {
      goals_per_match: 'Buts par match', minutes_goal: 'Minutes par but', minutes_conceded: 'Minutes par but encaissé',
      fouls: 'Fautes par match', direct_fouls: 'Coups francs directs par match', direct_foul_pct: 'Réussite des coups francs directs',
      penalty_pct: 'Penalties transformés', cards: 'Cartons par match',
    },
  },
  it: {
    title: 'Anteprima partita', position: 'Posizione', points: 'Punti', form: 'Forma',
    shortHome: 'casa', shortAway: 'fuori',
    draws: 'Pareggi', wins: 'Vittorie', goals: 'gol', letters: { W: 'V', D: 'N', L: 'S' }, crossHint: 'In evidenza chi fa meglio in ogni dato.',
    h2h: 'Precedenti', emptyH2h: 'Nessun precedente in questa stagione.', lastFive: 'Ultime 5',
    home: 'Casa', away: 'Trasferta',
    observations: 'Come arriva', cross: 'Numeri del confronto',
    obs: {
      recent_goals: (v, t) => `${v} gol nelle ultime ${t} partite.`,
      win_streak: (v) => `${v} vittorie di fila.`,
      unbeaten: (v) => `${v} partite senza perdere.`,
      home_wins: (v, t) => `${v} vittorie nelle ultime ${t} partite in casa.`,
      away_wins: (v, t) => `${v} vittorie nelle ultime ${t} partite fuori.`,
      goals_per_match: (v, t) => `${v} gol a partita in stagione (${t} partite).`,
    },
    crossLabels: {
      goals_per_match: 'Gol a partita', minutes_goal: 'Minuti per gol', minutes_conceded: 'Minuti per gol subito',
      fouls: 'Falli a partita', direct_fouls: 'Tiri diretti a partita', direct_foul_pct: 'Conversione dei tiri diretti',
      penalty_pct: 'Rigori segnati', cards: 'Cartellini a partita',
    },
  },
};

COPY['ca'] = {
  title: 'Prèvia del partit', position: 'Posició', points: 'Punts', form: 'Forma',
    shortHome: 'casa', shortAway: 'fora',
  draws: 'Empats', wins: 'Victòries', goals: 'gols', letters: { W: 'V', D: 'E', L: 'D' }, crossHint: 'Destacat, qui surt millor en cada dada.',
  h2h: 'Enfrontaments previs', emptyH2h: 'Sense enfrontaments previs aquesta temporada.', lastFive: 'Últims 5',
  home: 'Local', away: 'Visitant',
  observations: 'Com arriba', cross: 'Números del creuament',
  obs: {
    recent_goals: (v, t) => `${v} gols en els darrers ${t} partits.`,
    win_streak: (v) => `${v} victòries seguides.`,
    unbeaten: (v) => `${v} partits sense perdre.`,
    home_wins: (v, t) => `${v} victòries en els darrers ${t} partits a casa.`,
    away_wins: (v, t) => `${v} victòries en els darrers ${t} partits fora.`,
    goals_per_match: (v, t) => `${v} gols per partit a la temporada (${t} partits).`,
  },
  crossLabels: {
    goals_per_match: 'Gols per partit', minutes_goal: 'Minuts per gol', minutes_conceded: 'Minuts per gol encaixat',
    fouls: 'Faltes per partit', direct_fouls: 'Faltes directes per partit', direct_foul_pct: 'Encert en faltes directes',
    penalty_pct: 'Penals marcats', cards: 'Targetes per partit',
  },
};

type Result = 'W' | 'D' | 'L';
const RESULT_BG: Record<Result, string> = {
  W: 'bg-emerald-600 text-white',
  D: 'bg-slate-400 text-white dark:bg-slate-500',
  L: 'bg-rink-passion text-white',
};
// Local en granate (la marca), visitante en azul: los dos colores del duelo.
const SIDE = {
  home: { bar: 'bg-rink-passion', text: 'text-rink-passion dark:text-rose-400' },
  away: { bar: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400' },
} as const;

function formatCross(metric: CrossMetric, value: number | null, locale: string): string {
  if (value === null) return '—';
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (metric.unit === 'pct') return `${num.format(value)}%`;
  if (metric.unit === 'minutes') return `${num.format(value)}′`;
  return num.format(value);
}

function FormStrip({ form, copy, align }: { form: string[]; copy: Copy; align: 'start' | 'end' }) {
  if (form.length === 0) return null;
  return (
    <div className={`flex gap-1 ${align === 'end' ? 'justify-end' : ''}`} aria-label={copy.form}>
      {form.map((r, i) => (
        <span key={`${r}-${i}`} className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${RESULT_BG[r as Result] ?? RESULT_BG.D}`}>
          {copy.letters[r as Result] ?? r}
        </span>
      ))}
    </div>
  );
}

/** Cabecera del duelo: escudos, posición en grande, puntos y forma. */
function DuelHeader({ data, copy }: { data: MatchPreviewData; copy: Copy }) {
  const side = (team: TeamSnapshot, align: 'start' | 'end') => (
    <div className={`flex min-w-0 flex-1 flex-col gap-2 ${align === 'end' ? 'items-end text-right' : 'items-start'}`}>
      <TeamShield teamId={team.teamId} teamName={team.teamName} size={44} />
      <p className="w-full truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{clubName(team.teamName)}</p>
      {team.position !== null && (
        <p className="flex items-baseline gap-1.5 leading-none">
          <span className="font-score text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{team.position}º</span>
          {team.points !== null && <span className="text-xs text-slate-500 dark:text-slate-400">{team.points} {copy.points.toLowerCase()}</span>}
        </p>
      )}
      <FormStrip form={team.form.length > 0 ? team.form : team.recent.map((r) => r.result).reverse()} copy={copy} align={align} />
    </div>
  );
  return (
    <div className="flex items-start gap-3">
      {side(data.home, 'start')}
      <div className="flex flex-col items-center pt-3">
        <span className="font-score text-xs font-bold tracking-widest text-slate-400">VS</span>
        <span className="mt-1 h-16 w-px bg-gradient-to-b from-slate-300 to-transparent dark:from-slate-600" />
      </div>
      {side(data.away, 'end')}
    </div>
  );
}

/** Últimos 5 en fichas de resultado (marcador sobre el color del resultado). */
function RecentTiles({ team, copy }: { team: TeamSnapshot; copy: Copy }) {
  if (team.recent.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <TeamShield teamId={team.teamId} teamName={team.teamName} size={16} />
        <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">{clubName(team.teamName)}</p>
      </div>
      <ul className="grid grid-cols-5 gap-1.5">
        {[...team.recent].reverse().map((r) => (
          <li key={r.id}>
            <Link
              href={`/matches/${r.id}`}
              title={`${r.isHome ? copy.home : copy.away} · ${clubName(r.opponentName)}`}
              className="flex flex-col items-center gap-1 rounded-lg bg-slate-50 px-1 py-1.5 transition-colors hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
            >
              <TeamShield teamId={r.opponentId} teamName={r.opponentName} size={18} />
              <span className={`w-full rounded-md py-0.5 text-center font-score text-[11px] font-bold tabular-nums ${RESULT_BG[r.result as Result] ?? RESULT_BG.D}`}>
                {r.goalsFor}-{r.goalsAgainst}
              </span>
              <span className="text-[9px] uppercase tracking-wide text-slate-400">{r.isHome ? copy.shortHome : copy.shortAway}</span>
            </Link>
          </li>
        ))}
      </ul>
      {team.observations.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {team.observations.map((f) => (
            <li key={f.kind} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] leading-snug text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {copy.obs[f.kind](f.value, f.total)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Números del cruce como barras enfrentadas: cada lado su parte, el mejor resaltado. */
function CrossBars({ data, copy, locale }: { data: MatchPreviewData; copy: Copy; locale: string }) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">{copy.cross}</h3>
        <p className="text-[10px] text-slate-400">{copy.crossHint}</p>
      </div>
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold">
        <span className={`flex items-center gap-1.5 ${SIDE.home.text}`}><span className={`h-2 w-2 rounded-full ${SIDE.home.bar}`} />{clubName(data.home.teamName)}</span>
        <span className={`flex items-center gap-1.5 ${SIDE.away.text}`}>{clubName(data.away.teamName)}<span className={`h-2 w-2 rounded-full ${SIDE.away.bar}`} /></span>
      </div>
      <ul className="space-y-3">
        {data.cross.map((m) => {
          const bar = duelBar(m);
          const val = (side: 'home' | 'away') => (
            <span className={`font-score text-sm tabular-nums ${
              bar.better === side ? `font-bold ${SIDE[side].text}` : 'text-slate-500 dark:text-slate-400'
            }`}>
              {formatCross(m, m[side], locale)}
            </span>
          );
          return (
            <li key={m.key}>
              <div className="mb-1 flex items-center justify-between gap-2">
                {val('home')}
                <span className="text-center text-[11px] text-slate-500 dark:text-slate-400">{copy.crossLabels[m.key]}</span>
                {val('away')}
              </div>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={`h-full rounded-l-full ${SIDE.home.bar} ${bar.better === 'away' ? 'opacity-40' : ''}`}
                  style={{ width: `${Math.round(bar.homeShare * 100)}%` }}
                />
                <div
                  className={`h-full rounded-r-full ${SIDE.away.bar} ${bar.better === 'home' ? 'opacity-40' : ''}`}
                  style={{ width: `${Math.round(bar.awayShare * 100)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HeadToHead({ data, copy, locale }: { data: MatchPreviewData; copy: Copy; locale: string }) {
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  if (data.headToHead.length === 0) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{copy.h2h}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">{copy.emptyH2h}</p>
      </div>
    );
  }
  const b = headToHeadBalance(data.headToHead, data.home.teamId);
  const total = b.homeWins + b.draws + b.awayWins;
  const seg = (n: number, cls: string) => (n > 0 ? <div className={`h-full ${cls}`} style={{ width: `${(n / total) * 100}%` }} /> : null);
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{copy.h2h}</h3>
      {total > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 grid grid-cols-3 text-center">
            <div className="flex flex-col items-center"><TeamShield teamId={data.home.teamId} teamName={data.home.teamName} size={20} /><p className={`font-score text-2xl font-bold tabular-nums ${SIDE.home.text}`}>{b.homeWins}</p><p className="text-[10px] uppercase tracking-wide text-slate-500">{copy.wins}</p></div>
            <div className="flex flex-col items-center justify-end"><p className="font-score text-2xl font-bold tabular-nums text-slate-500">{b.draws}</p><p className="text-[10px] uppercase tracking-wide text-slate-500">{copy.draws}</p></div>
            <div className="flex flex-col items-center"><TeamShield teamId={data.away.teamId} teamName={data.away.teamName} size={20} /><p className={`font-score text-2xl font-bold tabular-nums ${SIDE.away.text}`}>{b.awayWins}</p><p className="text-[10px] uppercase tracking-wide text-slate-500">{copy.wins}</p></div>
          </div>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
            {seg(b.homeWins, SIDE.home.bar)}
            {seg(b.draws, 'bg-slate-300 dark:bg-slate-600')}
            {seg(b.awayWins, SIDE.away.bar)}
          </div>
          <p className="mt-1 text-center text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-score tabular-nums">{b.homeGoals}-{b.awayGoals}</span> {copy.goals}
          </p>
        </div>
      )}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {data.headToHead.map((m) => (
          <li key={m.id}>
            <Link href={`/matches/${m.id}`} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <span className="flex min-w-0 items-center justify-end gap-1.5 text-right">
                <span className="truncate text-slate-700 dark:text-slate-200">{clubName(m.homeName)}</span>
                {m.homeTeamId && <TeamShield teamId={m.homeTeamId} teamName={m.homeName} size={18} className="shrink-0" />}
              </span>
              <span className="flex flex-col items-center">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-score text-sm font-bold tabular-nums text-slate-900 dark:bg-slate-800 dark:text-slate-50">
                  {m.homeScore ?? '-'} - {m.awayScore ?? '-'}
                </span>
                {m.date && <span className="mt-0.5 text-[10px] text-slate-400">{dateFmt.format(new Date(m.date))}</span>}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                {m.awayTeamId && <TeamShield teamId={m.awayTeamId} teamName={m.awayName} size={18} className="shrink-0" />}
                <span className="truncate text-slate-700 dark:text-slate-200">{clubName(m.awayName)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MatchPreview({ data, locale }: { data: MatchPreviewData; locale: string }) {
  const copy = COPY[locale] ?? COPY['en']!;
  const hasStanding = data.home.position !== null || data.away.position !== null
    || data.home.form.length > 0 || data.away.form.length > 0
    || data.home.recent.length > 0 || data.away.recent.length > 0;
  if (!hasStanding && data.headToHead.length === 0 && data.cross.length === 0) return null;
  const hasRecent = data.home.recent.length > 0 || data.away.recent.length > 0;

  return (
    <section className="card overflow-hidden" aria-labelledby="match-preview-title">
      <div className="bg-gradient-to-b from-rink-passion/10 to-transparent px-4 pb-4 pt-4 dark:from-rink-passion/20">
        <h2 id="match-preview-title" className="mb-4 text-xs font-bold uppercase tracking-widest text-rink-passion dark:text-rose-400">
          {copy.title}
        </h2>
        {hasStanding && <DuelHeader data={data} copy={copy} />}
      </div>

      <div className="space-y-6 px-4 pb-5">
        {hasRecent && (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{copy.observations}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <RecentTiles team={data.home} copy={copy} />
              <RecentTiles team={data.away} copy={copy} />
            </div>
          </div>
        )}
        {data.cross.length > 0 && <CrossBars data={data} copy={copy} locale={locale} />}
        <HeadToHead data={data} copy={copy} locale={locale} />
      </div>
    </section>
  );
}

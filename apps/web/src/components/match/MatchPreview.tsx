import type {
  CrossMetric,
  CrossMetricKey,
  MatchPreview as MatchPreviewData,
  TeamObservation,
  TeamObservationKind,
} from '@/lib/content-summary';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName } from '@/lib/names';

interface Copy {
  title: string; position: string; points: string; form: string; h2h: string; emptyH2h: string; lastFive: string;
  observations: string; cross: string;
  obs: Record<TeamObservationKind, (value: number, total: number) => string>;
  crossLabels: Record<CrossMetricKey, string>;
}

const COPY: Record<string, Copy> = {
  es: {
    title: 'Previa del partido', position: 'Posición', points: 'Puntos', form: 'Forma',
    h2h: 'Enfrentamientos previos', emptyH2h: 'Sin enfrentamientos previos esta temporada.', lastFive: 'Últimos 5',
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
    h2h: 'Previous meetings', emptyH2h: 'No previous meetings this season.', lastFive: 'Last 5',
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
    h2h: 'Confrontos anteriores', emptyH2h: 'Sem confrontos anteriores esta temporada.', lastFive: 'Últimos 5',
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
    h2h: 'Confrontations précédentes', emptyH2h: 'Aucune confrontation cette saison.', lastFive: '5 derniers',
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
    h2h: 'Precedenti', emptyH2h: 'Nessun precedente in questa stagione.', lastFive: 'Ultime 5',
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

function FormDots({ form }: { form: string[] }) {
  return (
    <div className="flex gap-1" aria-label="W/D/L">
      {form.map((r, i) => (
        <span
          key={`${r}-${i}`}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white ${
            r === 'W' ? 'bg-emerald-600' : r === 'L' ? 'bg-red-600' : 'bg-slate-400'
          }`}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

function ObservationList({ facts, copy }: { facts: TeamObservation[]; copy: Copy }) {
  if (facts.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
      {facts.map((f) => <li key={f.kind}>{copy.obs[f.kind](f.value, f.total)}</li>)}
    </ul>
  );
}

function formatCross(metric: CrossMetric, value: number | null, locale: string): string {
  if (value === null) return '—';
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (metric.unit === 'pct') return `${num.format(value)}%`;
  if (metric.unit === 'minutes') return `${num.format(value)}′`;
  return num.format(value);
}

export function MatchPreview({ data, locale }: { data: MatchPreviewData; locale: string }) {
  const copy = COPY[locale] ?? COPY['en']!;
  const hasStanding = data.home.position !== null || data.away.position !== null
    || data.home.form.length > 0 || data.away.form.length > 0
    || data.home.recent.length > 0 || data.away.recent.length > 0;
  if (!hasStanding && data.headToHead.length === 0 && data.cross.length === 0) return null;

  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <section className="card p-4 space-y-4" aria-labelledby="match-preview-title">
      <h2 id="match-preview-title" className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {copy.title}
      </h2>

      {hasStanding && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[data.home, data.away].map((team, teamIndex) => (
            <div
              key={team.teamId}
              className={`rounded-xl border-l-4 bg-slate-50 p-3 dark:bg-slate-800/60 ${
                teamIndex === 0 ? 'border-rink-passion' : 'border-sky-500'
              }`}
            >
              <div className="flex items-center gap-2">
                <TeamShield teamId={team.teamId} teamName={team.teamName} size={28} className="shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{clubName(team.teamName)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {team.position !== null ? `#${team.position}` : '-'}
                    {team.points !== null ? ` · ${team.points} ${copy.points.toLowerCase()}` : ''}
                  </p>
                </div>
              </div>
              {team.form.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{copy.form}</p>
                  <FormDots form={team.form} />
                </div>
              )}
              {team.recent.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{copy.lastFive}</p>
                  <ul className="space-y-1">
                    {team.recent.map((r) => (
                      <li key={r.id}>
                        <Link href={`/matches/${r.id}`} className="flex items-center gap-1.5 text-[11px] hover:underline">
                          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${r.result === 'W' ? 'bg-emerald-600' : r.result === 'L' ? 'bg-red-600' : 'bg-slate-400'}`} />
                          <TeamShield teamId={r.opponentId} teamName={r.opponentName} size={14} className="shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{r.isHome ? 'vs' : '@'} {clubName(r.opponentName)}</span>
                          <span className="font-score shrink-0 tabular-nums text-slate-700 dark:text-slate-200">{r.goalsFor}-{r.goalsAgainst}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {team.observations.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{copy.observations}</p>
                  <ObservationList facts={team.observations} copy={copy} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data.cross.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{copy.cross}</h3>
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <th className="px-2 py-1.5 text-left font-semibold">{clubName(data.home.teamName)}</th>
                  <th className="px-2 py-1.5 text-center font-semibold" />
                  <th className="px-2 py-1.5 text-right font-semibold">{clubName(data.away.teamName)}</th>
                </tr>
              </thead>
              <tbody>
                {data.cross.map((m) => (
                  <tr key={m.key} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5 text-right font-score tabular-nums text-slate-800 dark:text-slate-100">{formatCross(m, m.home, locale)}</td>
                    <td className="px-2 py-1.5 text-center text-slate-500 dark:text-slate-400">{copy.crossLabels[m.key]}</td>
                    <td className="px-2 py-1.5 text-left font-score tabular-nums text-slate-800 dark:text-slate-100">{formatCross(m, m.away, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{copy.h2h}</h3>
        {data.headToHead.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{copy.emptyH2h}</p>
        ) : (
          <ul className="space-y-1.5">
            {data.headToHead.map((m) => (
              <li key={m.id}>
                <Link href={`/matches/${m.id}`} className="flex items-center justify-between gap-2 text-xs text-slate-600 hover:underline dark:text-slate-300">
                  <span className="truncate">{clubName(m.homeName)} - {clubName(m.awayName)}</span>
                  <span className="shrink-0 font-score font-semibold tabular-nums">{m.homeScore ?? '-'}-{m.awayScore ?? '-'}</span>
                  {m.date && <span className="shrink-0 text-slate-400">{dateFmt.format(new Date(m.date))}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

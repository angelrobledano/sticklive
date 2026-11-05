import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type {
  CrossMetric,
  CrossMetricKey,
  MatchPreview as MatchPreviewData,
  TeamObservationKind,
  TeamSnapshot,
} from '@sports/core/content-summary';
import { duelBar, headToHeadBalance } from '@/src/lib/preview-duel';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { clubName } from '@sports/core/names';

interface Copy {
  title: string;
  titlePost: string;
  pointOne: string;
  shortHome: string;
  shortAway: string;
  position: string;
  points: string;
  form: string;
  h2h: string;
  emptyH2h: string;
  lastFive: string;
  home: string;
  away: string;
  observations: string;
  cross: string;
  draws: string;
  wins: string;
  goals: string;
  letters: Record<'W' | 'D' | 'L', string>;
  crossHint: string;
  obs: Record<TeamObservationKind, (value: number, total: number) => string>;
  crossLabels: Record<CrossMetricKey, string>;
}

const COPY: Record<string, Copy> = {
  es: {
    title: 'Previa del partido',
    titlePost: 'Así llegaban',
    pointOne: 'punto',
    shortHome: 'casa',
    shortAway: 'fuera',
    position: 'Posición',
    points: 'Puntos',
    form: 'Forma',
    draws: 'Empates',
    wins: 'Victorias',
    goals: 'goles',
    letters: { W: 'V', D: 'E', L: 'D' },
    crossHint: 'Resaltado, quien sale mejor en cada dato.',
    h2h: 'Enfrentamientos previos',
    emptyH2h: 'Sin enfrentamientos previos esta temporada.',
    lastFive: 'Últimos 5',
    home: 'Local',
    away: 'Visitante',
    observations: 'Cómo llega',
    cross: 'Números del cruce',
    obs: {
      recent_goals: (v, t) => `${v} goles en sus últimos ${t} partidos.`,
      win_streak: (v) => `${v} victorias seguidas.`,
      unbeaten: (v) => `${v} partidos sin perder.`,
      home_wins: (v, t) => `${v} victorias en sus últimos ${t} partidos en casa.`,
      away_wins: (v, t) => `${v} victorias en sus últimos ${t} partidos fuera.`,
      goals_per_match: (v, t) => `${v} goles por partido en la temporada (${t} partidos).`,
    },
    crossLabels: {
      goals_per_match: 'Goles por partido',
      minutes_goal: 'Minutos por gol',
      minutes_conceded: 'Minutos por gol encajado',
      fouls: 'Faltas por partido',
      direct_fouls: 'Faltas directas por partido',
      direct_foul_pct: 'Acierto faltas directas',
      penalty_pct: 'Penaltis marcados',
      cards: 'Tarjetas por partido',
    },
  },
  ca: {
    title: 'Prèvia del partit',
    titlePost: 'Com arribaven',
    pointOne: 'punt',
    shortHome: 'casa',
    shortAway: 'fora',
    position: 'Posició',
    points: 'Punts',
    form: 'Forma',
    draws: 'Empats',
    wins: 'Victòries',
    goals: 'gols',
    letters: { W: 'V', D: 'E', L: 'D' },
    crossHint: 'Ressaltat, qui surt millor a cada dada.',
    h2h: 'Enfrontaments previs',
    emptyH2h: 'Sense enfrontaments previs aquesta temporada.',
    lastFive: 'Últims 5',
    home: 'Local',
    away: 'Visitant',
    observations: 'Com arriba',
    cross: 'Xifres del creuament',
    obs: {
      recent_goals: (v, t) => `${v} gols en els seus últims ${t} partits.`,
      win_streak: (v) => `${v} victòries seguides.`,
      unbeaten: (v) => `${v} partits sense perdre.`,
      home_wins: (v, t) => `${v} victòries en els últims ${t} partits a casa.`,
      away_wins: (v, t) => `${v} victòries en els últims ${t} partits fora.`,
      goals_per_match: (v, t) => `${v} gols per partit a la temporada (${t} partits).`,
    },
    crossLabels: {
      goals_per_match: 'Gols per partit',
      minutes_goal: 'Minuts per gol',
      minutes_conceded: 'Minuts per gol encaixat',
      fouls: 'Faltes per partit',
      direct_fouls: 'Faltes directes per partit',
      direct_foul_pct: 'Aprofitament faltes directes',
      penalty_pct: 'Penals marcats',
      cards: 'Targetes per partit',
    },
  },
  en: {
    title: 'Match preview',
    titlePost: 'How they came in',
    pointOne: 'point',
    shortHome: 'home',
    shortAway: 'away',
    position: 'Position',
    points: 'Points',
    form: 'Form',
    draws: 'Draws',
    wins: 'Wins',
    goals: 'goals',
    letters: { W: 'W', D: 'D', L: 'L' },
    crossHint: 'Highlighted: who comes out better in each stat.',
    h2h: 'Previous meetings',
    emptyH2h: 'No previous meetings this season.',
    lastFive: 'Last 5',
    home: 'Home',
    away: 'Away',
    observations: 'Recent form',
    cross: 'Head-to-head numbers',
    obs: {
      recent_goals: (v, t) => `${v} goals in their last ${t} matches.`,
      win_streak: (v) => `${v} wins in a row.`,
      unbeaten: (v) => `${v} matches unbeaten.`,
      home_wins: (v, t) => `${v} wins in their last ${t} home matches.`,
      away_wins: (v, t) => `${v} wins in their last ${t} away matches.`,
      goals_per_match: (v, t) => `${v} goals per match this season (${t} matches).`,
    },
    crossLabels: {
      goals_per_match: 'Goals per match',
      minutes_goal: 'Minutes per goal',
      minutes_conceded: 'Minutes per goal conceded',
      fouls: 'Fouls per match',
      direct_fouls: 'Direct free hits per match',
      direct_foul_pct: 'Direct free-hit conversion',
      penalty_pct: 'Penalties scored',
      cards: 'Cards per match',
    },
  },
  fr: {
    title: 'Avant-match',
    titlePost: 'Avant le match',
    pointOne: 'point',
    shortHome: 'dom.',
    shortAway: 'ext.',
    position: 'Position',
    points: 'Points',
    form: 'Forme',
    draws: 'Nuls',
    wins: 'Victoires',
    goals: 'buts',
    letters: { W: 'V', D: 'N', L: 'D' },
    crossHint: 'En surbrillance, l’équipe qui a l’avantage.',
    h2h: 'Confrontations directes',
    emptyH2h: 'Aucune confrontation cette saison.',
    lastFive: '5 derniers',
    home: 'Domicile',
    away: 'Extérieur',
    observations: 'Dynamique',
    cross: 'Face-à-face en chiffres',
    obs: {
      recent_goals: (v, t) => `${v} buts sur ses ${t} derniers matches.`,
      win_streak: (v) => `${v} victoires de suite.`,
      unbeaten: (v) => `${v} matches sans défaite.`,
      home_wins: (v, t) => `${v} victoires sur ses ${t} derniers matches à domicile.`,
      away_wins: (v, t) => `${v} victoires sur ses ${t} derniers matches à l’extérieur.`,
      goals_per_match: (v, t) => `${v} buts par match cette saison (${t} matches).`,
    },
    crossLabels: {
      goals_per_match: 'Buts par match',
      minutes_goal: 'Minutes par but',
      minutes_conceded: 'Minutes par but concédé',
      fouls: 'Fautes par match',
      direct_fouls: 'Coups francs directs par match',
      direct_foul_pct: 'Efficacité sur coups francs directs',
      penalty_pct: 'Penalties transformés',
      cards: 'Cartons par match',
    },
  },
  pt: {
    title: 'Antevisão do jogo',
    titlePost: 'Como chegavam',
    pointOne: 'ponto',
    shortHome: 'casa',
    shortAway: 'fora',
    position: 'Posição',
    points: 'Pontos',
    form: 'Forma',
    draws: 'Empates',
    wins: 'Vitórias',
    goals: 'golos',
    letters: { W: 'V', D: 'E', L: 'D' },
    crossHint: 'Em destaque, quem sai melhor em cada dado.',
    h2h: 'Confrontos anteriores',
    emptyH2h: 'Sem confrontos anteriores esta temporada.',
    lastFive: 'Últimos 5',
    home: 'Casa',
    away: 'Fora',
    observations: 'Como chega',
    cross: 'Números do confronto',
    obs: {
      recent_goals: (v, t) => `${v} golos nos últimos ${t} jogos.`,
      win_streak: (v) => `${v} vitórias seguidas.`,
      unbeaten: (v) => `${v} jogos sem perder.`,
      home_wins: (v, t) => `${v} vitórias nos últimos ${t} jogos em casa.`,
      away_wins: (v, t) => `${v} vitórias nos últimos ${t} jogos fora.`,
      goals_per_match: (v, t) => `${v} golos por jogo na temporada (${t} jogos).`,
    },
    crossLabels: {
      goals_per_match: 'Golos por jogo',
      minutes_goal: 'Minutos por golo',
      minutes_conceded: 'Minutos por golo sofrido',
      fouls: 'Faltas por jogo',
      direct_fouls: 'Livres diretos por jogo',
      direct_foul_pct: 'Aproveitamento de livres diretos',
      penalty_pct: 'Penáltis marcados',
      cards: 'Cartões por jogo',
    },
  },
  it: {
    title: 'Presentazione della partita',
    titlePost: 'Come arrivavano',
    pointOne: 'punto',
    shortHome: 'casa',
    shortAway: 'fuori',
    position: 'Posizione',
    points: 'Punti',
    form: 'Forma',
    draws: 'Pareggi',
    wins: 'Vittorie',
    goals: 'gol',
    letters: { W: 'V', D: 'P', L: 'S' },
    crossHint: 'In evidenza la squadra messa meglio in ogni dato.',
    h2h: 'Scontri diretti',
    emptyH2h: 'Nessun precedente in questa stagione.',
    lastFive: 'Ultime 5',
    home: 'Casa',
    away: 'Trasferta',
    observations: 'Come arrivano',
    cross: 'I numeri del match',
    obs: {
      recent_goals: (v, t) => `${v} gol nelle ultime ${t} partite.`,
      win_streak: (v) => `${v} vittorie consecutive.`,
      unbeaten: (v) => `${v} partite senza sconfitte.`,
      home_wins: (v, t) => `${v} vittorie nelle ultime ${t} partite in casa.`,
      away_wins: (v, t) => `${v} vittorie nelle ultime ${t} partite fuori casa.`,
      goals_per_match: (v, t) => `${v} gol a partita in stagione (${t} partite).`,
    },
    crossLabels: {
      goals_per_match: 'Gol a partita',
      minutes_goal: 'Minuti per gol segnato',
      minutes_conceded: 'Minuti per gol subito',
      fouls: 'Falli a partita',
      direct_fouls: 'Tiri diretti a partita',
      direct_foul_pct: 'Percentuale tiri diretti',
      penalty_pct: 'Rigori segnati',
      cards: 'Cartellini a partita',
    },
  },
};

const FORM_BG: Record<string, string> = {
  W: 'bg-emerald-600',
  D: 'bg-slate-400 dark:bg-slate-500',
  L: 'bg-rink-passion',
};

function DuelSide({
  team,
  label,
  copy,
}: {
  team: TeamSnapshot;
  label: string;
  copy: Copy;
}) {
  // Sin clasificación (copas), la forma sale de los últimos resultados, como en la web.
  const form = team.form.length > 0 ? team.form : team.recent.map((r) => r.result).reverse();
  return (
    <View className="flex-1 items-center">
      <Avatar
        uri={teamLogoUri(team.teamId, 64)}
        name={team.teamName}
        size={36}
      />
      <Text numberOfLines={1} className="mt-1 text-xs font-bold text-slate-900 dark:text-slate-50 text-center">
        {clubName(team.teamName)}
      </Text>
      <Text className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-400">
        {label}
      </Text>

      {/* Posición y Puntos */}
      <View className="mt-2 items-center">
        {team.position != null ? (
          <Text className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {team.position}º
          </Text>
        ) : null}
        {team.points != null ? (
          <Text className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            {team.points} {team.points === 1 ? copy.pointOne : copy.points.toLowerCase()}
          </Text>
        ) : null}
      </View>

      {/* Forma reciente */}
      {form.length > 0 ? (
        <View className="mt-2 flex-row gap-1" accessibilityLabel={copy.form}>
          {form.map((res, i) => (
            <View
              key={i}
              className={`h-4 w-4 items-center justify-center rounded-sm ${
                FORM_BG[res] ?? 'bg-slate-300'
              }`}
            >
              <Text className="text-[9px] font-bold text-white leading-none">
                {copy.letters[res as 'W' | 'D' | 'L'] ?? res}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ObservationChip({
  obs,
  copy,
}: {
  obs: { kind: TeamObservationKind; value: number; total: number };
  copy: Copy;
}) {
  const textFn = copy.obs[obs.kind];
  if (!textFn) return null;
  return (
    <View className="rounded-xl bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
      <Text className="text-xs text-slate-700 dark:text-slate-300">{textFn(obs.value, obs.total)}</Text>
    </View>
  );
}

function CrossMetricRow({
  m,
  copy,
  locale,
}: {
  m: CrossMetric;
  copy: Copy;
  locale: string;
}) {
  const duel = duelBar(m);
  const label = copy.crossLabels[m.key] ?? m.key;

  const fmt = (v: number | null) => {
    if (v == null) return '—';
    if (m.unit === 'pct') return `${v}%`;
    return v.toFixed(1).replace('.', locale === 'en' ? '.' : ',');
  };

  return (
    <View className="space-y-1">
      <View className="flex-row items-baseline justify-between">
        <Text
          className={`font-mono text-xs font-bold tabular-nums ${
            duel.better === 'home'
              ? 'text-rink-passion dark:text-rose-400 font-extrabold'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {fmt(m.home)}
        </Text>
        <Text className="text-[11px] font-medium text-slate-500 dark:text-slate-400 text-center flex-1 px-2" numberOfLines={1}>
          {label}
        </Text>
        <Text
          className={`font-mono text-xs font-bold tabular-nums ${
            duel.better === 'away'
              ? 'text-rink-passion dark:text-rose-400 font-extrabold'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {fmt(m.away)}
        </Text>
      </View>

      {/* Barra de proporción enfrentada */}
      <View className="flex-row h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 gap-0.5">
        <View
          style={{ width: `${duel.homeShare * 100}%` }}
          className={`h-full ${
            duel.better === 'home' ? 'bg-rink-passion' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        />
        <View
          style={{ width: `${duel.awayShare * 100}%` }}
          className={`h-full ${
            duel.better === 'away' ? 'bg-rink-passion' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        />
      </View>
    </View>
  );
}

const RESULT_TILE: Record<string, string> = {
  W: 'bg-emerald-600',
  D: 'bg-slate-400 dark:bg-slate-500',
  L: 'bg-rink-passion',
};

/** Últimos 5 en fichas (marcador sobre el color del resultado) y sus observaciones. */
function RecentTiles({ team, copy }: { team: TeamSnapshot; copy: Copy }) {
  const router = useRouter();
  if (team.recent.length === 0 && team.observations.length === 0) return null;
  return (
    <View>
      <View className="mb-1.5 flex-row items-center gap-2">
        <Avatar uri={teamLogoUri(team.teamId, 32)} name={team.teamName} size={16} />
        <Text numberOfLines={1} className="flex-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
          {clubName(team.teamName)}
        </Text>
      </View>
      {team.recent.length > 0 ? (
        <View className="flex-row gap-1.5">
          {[...team.recent].reverse().map((r) => (
            <Pressable
              key={r.id}
              onPress={() => router.push(`/match/${r.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${r.isHome ? copy.home : copy.away} · ${clubName(r.opponentName)} ${r.goalsFor}-${r.goalsAgainst}`}
              className="flex-1 items-center gap-1 rounded-lg bg-slate-50 px-1 py-1.5 active:opacity-70 dark:bg-slate-800/60"
            >
              <Avatar uri={teamLogoUri(r.opponentId, 32)} fallbackUri={r.opponentLogoUrl} name={r.opponentName} size={18} />
              <View className={`w-full rounded-md py-0.5 ${RESULT_TILE[r.result] ?? RESULT_TILE.D}`}>
                <Text className="text-center font-mono text-[11px] font-bold tabular-nums text-white">
                  {r.goalsFor}-{r.goalsAgainst}
                </Text>
              </View>
              <Text className="text-[10px] uppercase tracking-wide text-slate-400">
                {r.isHome ? copy.shortHome : copy.shortAway}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {team.observations.length > 0 ? (
        <View className="mt-2 flex-row flex-wrap gap-1.5">
          {team.observations.map((obs) => (
            <ObservationChip key={obs.kind} obs={obs} copy={copy} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * `variant="post"` (partido empezado o terminado): la misma información,
 * plegada y titulada «Así llegaban», como en la web.
 */
export function MatchPreview({
  data,
  locale = 'es',
  variant = 'pre',
}: {
  data: MatchPreviewData;
  locale?: string;
  variant?: 'pre' | 'post';
}) {
  const router = useRouter();
  const copy = COPY[locale] ?? COPY['es']!;
  const [open, setOpen] = useState(false);

  const balance = useMemo(
    () => headToHeadBalance(data.headToHead, data.home.teamId),
    [data.headToHead, data.home.teamId],
  );
  const dateFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return null;
    }
  }, [locale]);

  const totalH2H = balance.homeWins + balance.draws + balance.awayWins;
  const hasStanding = data.home.position !== null || data.away.position !== null
    || data.home.form.length > 0 || data.away.form.length > 0
    || data.home.recent.length > 0 || data.away.recent.length > 0;
  if (!hasStanding && data.headToHead.length === 0 && data.cross.length === 0) return null;
  const hasRecent = data.home.recent.length > 0 || data.away.recent.length > 0
    || data.home.observations.length > 0 || data.away.observations.length > 0;

  const body = (
    <>
      {/* Cabecera de duelo */}
      {hasStanding ? (
        <View className="flex-row items-start justify-between">
          <DuelSide team={data.home} label={copy.home} copy={copy} />
          <View className="items-center justify-center pt-3">
            <Text className="font-mono text-sm font-black text-slate-300 dark:text-slate-600">VS</Text>
          </View>
          <DuelSide team={data.away} label={copy.away} copy={copy} />
        </View>
      ) : null}

      {/* Cómo llega cada equipo: últimos 5 y observaciones */}
      {hasRecent ? (
        <View className="gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {copy.observations}
          </Text>
          <RecentTiles team={data.home} copy={copy} />
          <RecentTiles team={data.away} copy={copy} />
        </View>
      ) : null}

      {/* Números del cruce */}
      {data.cross.length > 0 ? (
        <View className="space-y-2.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          <View className="flex-row items-baseline justify-between">
            <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {copy.cross}
            </Text>
            <Text className="text-[9px] text-slate-400">{copy.crossHint}</Text>
          </View>
          <View className="space-y-2.5">
            {data.cross.map((m) => (
              <CrossMetricRow key={m.key} m={m} copy={copy} locale={locale} />
            ))}
          </View>
        </View>
      ) : null}

      {/* Enfrentamientos previos (H2H) */}
      <View className="space-y-2.5 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {copy.h2h}
        </Text>
        {data.headToHead.length === 0 ? (
          <Text className="text-xs text-slate-500 dark:text-slate-400">{copy.emptyH2h}</Text>
        ) : null}

        {totalH2H > 0 ? (
          <View className="items-center py-1">
            <View className="flex-row items-center justify-around w-full mb-1">
              <Text className="font-mono text-base font-bold text-rink-passion dark:text-rose-400">
                {balance.homeWins} {copy.wins.toLowerCase()}
              </Text>
              <Text className="font-mono text-sm font-semibold text-slate-400">
                {balance.draws} {copy.draws.toLowerCase()}
              </Text>
              <Text className="font-mono text-base font-bold text-slate-700 dark:text-slate-300">
                {balance.awayWins} {copy.wins.toLowerCase()}
              </Text>
            </View>
            <Text className="font-mono text-[11px] tabular-nums text-slate-400">
              {balance.homeGoals} - {balance.awayGoals} {copy.goals}
            </Text>
          </View>
        ) : null}

        <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {data.headToHead.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => router.push(`/match/${m.id}`)}
              className="flex-row items-center justify-between py-2 active:opacity-70"
            >
              <View className="flex-1 flex-row items-center justify-end gap-1.5 pr-2">
                <Text numberOfLines={1} className="text-xs text-slate-700 dark:text-slate-300">
                  {clubName(m.homeName)}
                </Text>
                {m.homeTeamId ? (
                  <Avatar uri={teamLogoUri(m.homeTeamId, 32)} name={m.homeName} size={16} />
                ) : null}
              </View>

              <View className="items-center">
                <View className="rounded-md bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                  <Text className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-slate-50">
                    {m.homeScore ?? '-'} – {m.awayScore ?? '-'}
                  </Text>
                </View>
                {m.date && dateFmt ? (
                  <Text className="mt-0.5 text-[10px] text-slate-400">{dateFmt.format(new Date(m.date))}</Text>
                ) : null}
              </View>

              <View className="flex-1 flex-row items-center gap-1.5 pl-2">
                {m.awayTeamId ? (
                  <Avatar uri={teamLogoUri(m.awayTeamId, 32)} name={m.awayName} size={16} />
                ) : null}
                <Text numberOfLines={1} className="text-xs text-slate-700 dark:text-slate-300">
                  {clubName(m.awayName)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </>
  );

  if (variant === 'post') {
    return (
      <View className="mx-3 my-3 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          className="min-h-[44px] flex-row items-center justify-between px-4 active:opacity-70"
        >
          <Text className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">
            {copy.titlePost}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#64748b" />
        </Pressable>
        {open ? <View className="space-y-5 px-4 pb-4">{body}</View> : null}
      </View>
    );
  }

  return (
    <View className="mx-3 my-3 overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-5">
      <View className="flex-row items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-rink-passion dark:text-rose-400">
          {copy.title}
        </Text>
      </View>
      {body}
    </View>
  );
}

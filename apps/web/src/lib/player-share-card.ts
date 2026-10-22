/**
 * Contenido de la imagen para compartir el perfil de un jugador. Pura, como
 * team-share-card y match-share-card: la ruta solo pinta lo que sale de aquí.
 */
import type { PlayerDetail, PlayerInsights } from './api/types';
import { playerDisplayName, teamTitleName } from './names';
import { isSupportedLocale, type Locale } from './locales';

export interface PlayerShareStat { label: string; value: string }

export interface PlayerShareCard {
  firstName: string;
  lastName: string;
  number: number | null;
  goalkeeper: boolean;
  photoUrl: string | null;
  teamId: string | null;
  team: string | null;
  competition: string | null;
  season: string | null;
  /** La cifra grande: goles (o partidos, si es portero). */
  hero: PlayerShareStat;
  stats: PlayerShareStat[];
  /** Frases cortas con lo más destacable de la temporada (máx. 4). */
  highlights: string[];
}

interface Copy {
  goals: string; matches: string; played: string; assists: string; perMatch: string; penalties: string;
  blue: string; red: string; follow: string; goalkeeper: string;
  rank: (n: number) => string; share: (n: number) => string; streak: (n: number) => string; hatTricks: (n: number) => string;
  decimal: string;
}

export const PLAYER_SHARE_COPY: Record<Locale, Copy> = {
  es: {
    goals: 'Goles', matches: 'Partidos', played: 'PJ', assists: 'Asist.', perMatch: 'Goles/PJ', penalties: 'Penaltis',
    blue: 'Azules', red: 'Rojas', follow: 'Estadísticas en directo', goalkeeper: 'Portero',
    rank: (n) => `${n}.º máximo goleador`, share: (n) => `${n} % de los goles del equipo`,
    streak: (n) => `Marca en ${n} partidos seguidos`, hatTricks: (n) => (n === 1 ? '1 hat-trick' : `${n} hat-tricks`), decimal: ',',
  },
  ca: {
    goals: 'Gols', matches: 'Partits', played: 'PJ', assists: 'Assist.', perMatch: 'Gols/PJ', penalties: 'Penals',
    blue: 'Blaves', red: 'Vermelles', follow: 'Estadístiques en directe', goalkeeper: 'Porter',
    rank: (n) => `${n}è màxim golejador`, share: (n) => `${n} % dels gols de l'equip`,
    streak: (n) => `Marca en ${n} partits seguits`, hatTricks: (n) => (n === 1 ? '1 hat-trick' : `${n} hat-tricks`), decimal: ',',
  },
  en: {
    goals: 'Goals', matches: 'Matches', played: 'MP', assists: 'Assists', perMatch: 'Goals/MP', penalties: 'Penalties',
    blue: 'Blue', red: 'Red', follow: 'Live stats', goalkeeper: 'Goalkeeper',
    rank: (n) => `No. ${n} top scorer`, share: (n) => `${n}% of team goals`,
    streak: (n) => `Scored in ${n} straight games`, hatTricks: (n) => (n === 1 ? '1 hat-trick' : `${n} hat-tricks`), decimal: '.',
  },
  pt: {
    goals: 'Golos', matches: 'Jogos', played: 'J', assists: 'Assist.', perMatch: 'Golos/J', penalties: 'Penáltis',
    blue: 'Azuis', red: 'Vermelhos', follow: 'Estatísticas em direto', goalkeeper: 'Guarda-redes',
    rank: (n) => `${n}.º melhor marcador`, share: (n) => `${n} % dos golos da equipa`,
    streak: (n) => `Marca há ${n} jogos seguidos`, hatTricks: (n) => (n === 1 ? '1 hat-trick' : `${n} hat-tricks`), decimal: ',',
  },
  fr: {
    goals: 'Buts', matches: 'Matchs', played: 'MJ', assists: 'Passes', perMatch: 'Buts/MJ', penalties: 'Penaltys',
    blue: 'Bleus', red: 'Rouges', follow: 'Statistiques en direct', goalkeeper: 'Gardien',
    rank: (n) => (n === 1 ? 'Meilleur buteur' : `${n}e meilleur buteur`), share: (n) => `${n} % des buts de l’équipe`,
    streak: (n) => `A marqué ${n} matchs de suite`, hatTricks: (n) => (n === 1 ? '1 triplé' : `${n} triplés`), decimal: ',',
  },
  it: {
    goals: 'Gol', matches: 'Partite', played: 'PG', assists: 'Assist', perMatch: 'Gol/PG', penalties: 'Rigori',
    blue: 'Blu', red: 'Rossi', follow: 'Statistiche in diretta', goalkeeper: 'Portiere',
    rank: (n) => `${n}º nella classifica marcatori`, share: (n) => `${n}% dei gol della squadra`,
    streak: (n) => `In gol da ${n} partite di fila`, hatTricks: (n) => (n === 1 ? '1 tripletta' : `${n} triplette`), decimal: ',',
  },
};

export function playerShareCard(
  detail: PlayerDetail, insights: PlayerInsights | null, opts: { locale: string },
): PlayerShareCard {
  const locale: Locale = isSupportedLocale(opts.locale) ? opts.locale : 'es';
  const copy = PLAYER_SHARE_COPY[locale];
  const p = detail.player;
  const tot = detail.seasonTotals;
  const display = playerDisplayName(p.firstName, p.lastName);
  const first = display.split(' ')[0] ?? '';
  const last = display.slice(first.length).trim();

  const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', copy.decimal);

  const hero: PlayerShareStat = p.isGoalkeeper
    ? { value: String(tot.pj), label: copy.matches }
    : { value: String(tot.goals), label: copy.goals };

  const stats: PlayerShareStat[] = p.isGoalkeeper
    ? [
        { label: copy.assists, value: String(tot.assists) },
        { label: copy.blue, value: String(tot.blueCards) },
        { label: copy.red, value: String(tot.redCards) },
      ]
    : [
        { label: copy.played, value: String(tot.pj) },
        { label: copy.assists, value: String(tot.assists) },
        ...(tot.pj > 0 ? [{ label: copy.perMatch, value: fmt(tot.goals / tot.pj) }] : []),
        ...(tot.penaltiesTotal > 0 ? [{ label: copy.penalties, value: `${tot.penaltiesScored}/${tot.penaltiesTotal}` }] : []),
      ];

  const highlights: string[] = [];
  const f = insights?.facts;
  if (f && !p.isGoalkeeper) {
    if (f.scorerRank != null && f.scorerRank <= 10 && f.goals > 0) highlights.push(copy.rank(f.scorerRank));
    if (f.goalSharePct != null && f.goalSharePct >= 15) highlights.push(copy.share(Math.round(f.goalSharePct)));
    if (f.scoringStreak >= 3) highlights.push(copy.streak(f.scoringStreak));
    if (f.hatTricks > 0) highlights.push(copy.hatTricks(f.hatTricks));
  }

  return {
    firstName: first,
    lastName: last,
    number: detail.currentTeam?.jerseyNumber ?? null,
    goalkeeper: p.isGoalkeeper,
    photoUrl: p.photoUrl ?? null,
    teamId: detail.currentTeam?.id ?? null,
    team: detail.currentTeam ? teamTitleName(detail.currentTeam.name, detail.currentTeam.shortName) : null,
    competition: insights?.season?.competitionName ?? null,
    season: insights?.season?.name ?? null,
    hero,
    stats,
    highlights: highlights.slice(0, 4),
  };
}

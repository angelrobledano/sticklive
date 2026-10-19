/**
 * Frases de los insights de temporada (C2) y elección del dato del día.
 *
 * La API da el dato (tipo, cifras, entidades); aquí se pone la frase en cada
 * idioma. Una frase es una lista de trozos: texto o enlace a la ficha que cita,
 * para que el bloque más visible de la página reparta enlazado interno.
 */
import type { Insight, InsightKind, SeasonInsights } from '@/lib/api/types';
import { clubName, playerDisplayName } from '@/lib/names';

export type InsightPart = string | { href: string; text: string };

interface Ctx {
  team: (i: number) => InsightPart;
  player: (i: number) => InsightPart;
  match: InsightPart;
  v: (key: string) => string;
}

type Template = (c: Ctx) => InsightPart[];

const T: Record<string, Record<InsightKind, Template>> = {
  es: {
    only_unbeaten: (c) => [c.team(0), ` es el único invicto: ${c.v('won')} victorias y ${c.v('drawn')} empates en ${c.v('played')} partidos.`],
    win_streak: (c) => [c.team(0), ` encadena ${c.v('n')} victorias seguidas.`],
    losing_streak: (c) => [c.team(0), ` suma ${c.v('n')} derrotas seguidas.`],
    best_attack: (c) => [c.team(0), ` es el equipo más goleador: ${c.v('goals')} goles en ${c.v('played')} partidos (${c.v('perMatch')} por partido).`],
    best_defense: (c) => [c.team(0), ` es el menos goleado: ${c.v('conceded')} goles encajados en ${c.v('played')} partidos.`],
    perfect_home: (c) => [c.team(0), ` ha ganado sus ${c.v('played')} partidos en casa.`],
    home_win_pct: (c) => [`El equipo local gana el ${c.v('pct')} % de los partidos de esta liga.`],
    second_half_goals: (c) => [`El ${c.v('pct')} % de los goles de la liga llegan en la segunda parte.`],
    team_second_half: (c) => [c.team(0), ` marca el ${c.v('pct')} % de sus goles en la segunda parte.`],
    late_goals: (c) => [c.team(0), ` es el que más goles marca en los últimos cinco minutos: ${c.v('goals')} de sus ${c.v('teamGoals')}.`],
    penalty_pct: (c) => [`En esta liga se marca el ${c.v('pct')} % de los penaltis (${c.v('scored')} de ${c.v('total')}).`],
    direct_foul_pct: (c) => [`El ${c.v('pct')} % de las faltas directas acaban en gol (${c.v('scored')} de ${c.v('total')}).`],
    penalty_drought: (c) => [c.team(0), ` no ha marcado ninguno de sus ${c.v('total')} penaltis.`],
    scorer_share: (c) => [c.player(0), ` ha marcado ${c.v('goals')} de los ${c.v('teamGoals')} goles de `, c.team(0), ` (${c.v('pct')} %).`],
    biggest_win: (c) => ['La mayor goleada de la temporada: ', c.match, '.'],
    highest_scoring: (c) => ['El partido con más goles de la temporada: ', c.match, '.'],
    first_goal_wins: (c) => [`Quien marca primero gana el ${c.v('pct')} % de los partidos.`],
    most_blue_cards: (c) => [c.team(0), ` es el equipo con más tarjetas azules: ${c.v('n')}.`],
    most_red_cards: (c) => [c.team(0), ` es el equipo con más expulsiones: ${c.v('n')} tarjetas rojas.`],
  },
  en: {
    only_unbeaten: (c) => [c.team(0), ` are the only unbeaten side: ${c.v('won')} wins and ${c.v('drawn')} draws in ${c.v('played')} matches.`],
    win_streak: (c) => [c.team(0), ` have won ${c.v('n')} in a row.`],
    losing_streak: (c) => [c.team(0), ` have lost ${c.v('n')} in a row.`],
    best_attack: (c) => [c.team(0), ` are the top scorers: ${c.v('goals')} goals in ${c.v('played')} matches (${c.v('perMatch')} per match).`],
    best_defense: (c) => [c.team(0), ` have the best defence: ${c.v('conceded')} goals conceded in ${c.v('played')} matches.`],
    perfect_home: (c) => [c.team(0), ` have won all ${c.v('played')} of their home matches.`],
    home_win_pct: (c) => [`The home side wins ${c.v('pct')}% of the matches in this league.`],
    second_half_goals: (c) => [`${c.v('pct')}% of the league's goals come in the second half.`],
    team_second_half: (c) => [c.team(0), ` score ${c.v('pct')}% of their goals in the second half.`],
    late_goals: (c) => [c.team(0), ` score the most goals in the last five minutes: ${c.v('goals')} of their ${c.v('teamGoals')}.`],
    penalty_pct: (c) => [`${c.v('pct')}% of penalties are scored in this league (${c.v('scored')} of ${c.v('total')}).`],
    direct_foul_pct: (c) => [`${c.v('pct')}% of direct free hits end in a goal (${c.v('scored')} of ${c.v('total')}).`],
    penalty_drought: (c) => [c.team(0), ` have missed all ${c.v('total')} of their penalties.`],
    scorer_share: (c) => [c.player(0), ` has scored ${c.v('goals')} of `, c.team(0), `'s ${c.v('teamGoals')} goals (${c.v('pct')}%).`],
    biggest_win: (c) => ['Biggest win of the season: ', c.match, '.'],
    highest_scoring: (c) => ['Highest-scoring match of the season: ', c.match, '.'],
    first_goal_wins: (c) => [`The team that scores first wins ${c.v('pct')}% of matches.`],
    most_blue_cards: (c) => [c.team(0), ` have the most blue cards: ${c.v('n')}.`],
    most_red_cards: (c) => [c.team(0), ` have the most red cards: ${c.v('n')}.`],
  },
  pt: {
    only_unbeaten: (c) => [c.team(0), ` é a única equipa invicta: ${c.v('won')} vitórias e ${c.v('drawn')} empates em ${c.v('played')} jogos.`],
    win_streak: (c) => [c.team(0), ` soma ${c.v('n')} vitórias seguidas.`],
    losing_streak: (c) => [c.team(0), ` soma ${c.v('n')} derrotas seguidas.`],
    best_attack: (c) => [c.team(0), ` é o melhor ataque: ${c.v('goals')} golos em ${c.v('played')} jogos (${c.v('perMatch')} por jogo).`],
    best_defense: (c) => [c.team(0), ` é a melhor defesa: ${c.v('conceded')} golos sofridos em ${c.v('played')} jogos.`],
    perfect_home: (c) => [c.team(0), ` venceu os ${c.v('played')} jogos em casa.`],
    home_win_pct: (c) => [`A equipa da casa vence ${c.v('pct')} % dos jogos desta liga.`],
    second_half_goals: (c) => [`${c.v('pct')} % dos golos da liga surgem na segunda parte.`],
    team_second_half: (c) => [c.team(0), ` marca ${c.v('pct')} % dos seus golos na segunda parte.`],
    late_goals: (c) => [c.team(0), ` é quem mais marca nos últimos cinco minutos: ${c.v('goals')} dos seus ${c.v('teamGoals')}.`],
    penalty_pct: (c) => [`Nesta liga marcam-se ${c.v('pct')} % dos penáltis (${c.v('scored')} de ${c.v('total')}).`],
    direct_foul_pct: (c) => [`${c.v('pct')} % dos livres diretos acabam em golo (${c.v('scored')} de ${c.v('total')}).`],
    penalty_drought: (c) => [c.team(0), ` não marcou nenhum dos seus ${c.v('total')} penáltis.`],
    scorer_share: (c) => [c.player(0), ` marcou ${c.v('goals')} dos ${c.v('teamGoals')} golos de `, c.team(0), ` (${c.v('pct')} %).`],
    biggest_win: (c) => ['A maior goleada da época: ', c.match, '.'],
    highest_scoring: (c) => ['O jogo com mais golos da época: ', c.match, '.'],
    first_goal_wins: (c) => [`Quem marca primeiro vence ${c.v('pct')} % dos jogos.`],
    most_blue_cards: (c) => [c.team(0), ` é a equipa com mais cartões azuis: ${c.v('n')}.`],
    most_red_cards: (c) => [c.team(0), ` é a equipa com mais expulsões: ${c.v('n')} cartões vermelhos.`],
  },
  fr: {
    only_unbeaten: (c) => [c.team(0), ` est la seule équipe invaincue : ${c.v('won')} victoires et ${c.v('drawn')} nuls en ${c.v('played')} matchs.`],
    win_streak: (c) => [c.team(0), ` enchaîne ${c.v('n')} victoires de suite.`],
    losing_streak: (c) => [c.team(0), ` enchaîne ${c.v('n')} défaites de suite.`],
    best_attack: (c) => [c.team(0), ` a la meilleure attaque : ${c.v('goals')} buts en ${c.v('played')} matchs (${c.v('perMatch')} par match).`],
    best_defense: (c) => [c.team(0), ` a la meilleure défense : ${c.v('conceded')} buts encaissés en ${c.v('played')} matchs.`],
    perfect_home: (c) => [c.team(0), ` a gagné ses ${c.v('played')} matchs à domicile.`],
    home_win_pct: (c) => [`L'équipe qui reçoit gagne ${c.v('pct')} % des matchs de ce championnat.`],
    second_half_goals: (c) => [`${c.v('pct')} % des buts du championnat sont marqués en seconde période.`],
    team_second_half: (c) => [c.team(0), ` marque ${c.v('pct')} % de ses buts en seconde période.`],
    late_goals: (c) => [c.team(0), ` est l'équipe qui marque le plus dans les cinq dernières minutes : ${c.v('goals')} de ses ${c.v('teamGoals')} buts.`],
    penalty_pct: (c) => [`Dans ce championnat, ${c.v('pct')} % des penalties sont transformés (${c.v('scored')} sur ${c.v('total')}).`],
    direct_foul_pct: (c) => [`${c.v('pct')} % des coups francs directs finissent au fond (${c.v('scored')} sur ${c.v('total')}).`],
    penalty_drought: (c) => [c.team(0), ` n'a transformé aucun de ses ${c.v('total')} penalties.`],
    scorer_share: (c) => [c.player(0), ` a marqué ${c.v('goals')} des ${c.v('teamGoals')} buts de `, c.team(0), ` (${c.v('pct')} %).`],
    biggest_win: (c) => ['Le plus large succès de la saison : ', c.match, '.'],
    highest_scoring: (c) => ['Le match le plus prolifique de la saison : ', c.match, '.'],
    first_goal_wins: (c) => [`L'équipe qui ouvre le score gagne ${c.v('pct')} % des matchs.`],
    most_blue_cards: (c) => [c.team(0), ` est l'équipe avec le plus de cartons bleus : ${c.v('n')}.`],
    most_red_cards: (c) => [c.team(0), ` est l'équipe avec le plus d'exclusions : ${c.v('n')} cartons rouges.`],
  },
  it: {
    only_unbeaten: (c) => [c.team(0), ` è l'unica imbattuta: ${c.v('won')} vittorie e ${c.v('drawn')} pareggi in ${c.v('played')} partite.`],
    win_streak: (c) => [c.team(0), ` ha vinto ${c.v('n')} partite di fila.`],
    losing_streak: (c) => [c.team(0), ` ha perso ${c.v('n')} partite di fila.`],
    best_attack: (c) => [c.team(0), ` ha il miglior attacco: ${c.v('goals')} gol in ${c.v('played')} partite (${c.v('perMatch')} a partita).`],
    best_defense: (c) => [c.team(0), ` ha la miglior difesa: ${c.v('conceded')} gol subiti in ${c.v('played')} partite.`],
    perfect_home: (c) => [c.team(0), ` ha vinto tutte le ${c.v('played')} partite in casa.`],
    home_win_pct: (c) => [`La squadra di casa vince il ${c.v('pct')}% delle partite di questo campionato.`],
    second_half_goals: (c) => [`Il ${c.v('pct')}% dei gol del campionato arriva nel secondo tempo.`],
    team_second_half: (c) => [c.team(0), ` segna il ${c.v('pct')}% dei suoi gol nel secondo tempo.`],
    late_goals: (c) => [c.team(0), ` è la squadra che segna di più negli ultimi cinque minuti: ${c.v('goals')} dei suoi ${c.v('teamGoals')} gol.`],
    penalty_pct: (c) => [`In questo campionato si segna il ${c.v('pct')}% dei rigori (${c.v('scored')} su ${c.v('total')}).`],
    direct_foul_pct: (c) => [`Il ${c.v('pct')}% dei tiri diretti finisce in gol (${c.v('scored')} su ${c.v('total')}).`],
    penalty_drought: (c) => [c.team(0), ` non ha segnato nessuno dei suoi ${c.v('total')} rigori.`],
    scorer_share: (c) => [c.player(0), ` ha segnato ${c.v('goals')} dei ${c.v('teamGoals')} gol di `, c.team(0), ` (${c.v('pct')}%).`],
    biggest_win: (c) => ['La vittoria più larga della stagione: ', c.match, '.'],
    highest_scoring: (c) => ['La partita con più gol della stagione: ', c.match, '.'],
    first_goal_wins: (c) => [`Chi segna per primo vince il ${c.v('pct')}% delle partite.`],
    most_blue_cards: (c) => [c.team(0), ` è la squadra con più cartellini blu: ${c.v('n')}.`],
    most_red_cards: (c) => [c.team(0), ` è la squadra con più espulsioni: ${c.v('n')} cartellini rossi.`],
  },
};

/** Frase de un insight en el idioma dado, con enlaces a las fichas que cita. */
export function renderInsight(insight: Insight, data: SeasonInsights, locale: string): InsightPart[] {
  const tpl = (T[locale] ?? T['en']!)[insight.kind];
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const teamName = (id: string) => clubName(data.teams[id]?.name ?? '');
  const match = insight.matchId ? data.matches[insight.matchId] : undefined;
  return tpl({
    team: (i) => {
      const id = insight.teamIds[i];
      return id ? { href: `/teams/${id}`, text: teamName(id) } : '';
    },
    player: (i) => {
      const id = insight.playerIds[i];
      const p = id ? data.players[id] : undefined;
      return id && p ? { href: `/players/${id}`, text: playerDisplayName(p.firstName, p.lastName) } : '';
    },
    match: match && insight.matchId
      ? {
          href: `/matches/${insight.matchId}`,
          text: `${teamName(match.homeTeamId)} ${insight.values['home'] ?? ''}-${insight.values['away'] ?? ''} ${teamName(match.awayTeamId)}`,
        }
      : '',
    v: (key) => num.format(insight.values[key] ?? 0),
  });
}

/** Un insight se puede pintar si todo lo que cita está en el diccionario. */
export function isRenderable(insight: Insight, data: SeasonInsights): boolean {
  return insight.teamIds.every((id) => data.teams[id])
    && insight.playerIds.every((id) => data.players[id])
    && (!insight.matchId || Boolean(data.matches[insight.matchId]));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Dato del día: uno de los más interesantes, elegido con una semilla de la
 * entidad y la fecha. Durante el día es siempre el mismo (Google ve el mismo
 * contenido y la caché sirve) y al día siguiente cambia.
 */
export function pickDailyInsight(insights: Insight[], seed: string, day: string, pool = 5): Insight | null {
  const top = [...insights].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, pool);
  if (top.length === 0) return null;
  return top[hash(`${seed}|${day}`) % top.length]!;
}

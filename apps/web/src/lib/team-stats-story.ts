/**
 * Relato de la temporada de un equipo a partir de sus números. La pestaña de
 * estadísticas era una cuadrícula de cifras: aquí cada bloque lleva una frase
 * que lo explica ("Mucho más fuerte en casa"), y la UI la acompaña de gráficos.
 * Puro y testeable: sin React.
 */
import type { TeamMatchSummary, TeamSeasonStats } from '@sports/core/api';
import { teamResult, type TeamResult } from '@sports/core/team-calendar';
import { clubName } from '@sports/core/names';
import { isSupportedLocale, type Locale } from './locales';

export interface Record3 { w: number; d: number; l: number }

export interface TeamStory {
  headline: { title: string; sub: string };
  results: { all: Record3; home: Record3; away: Record3; sentence: string; venue: string | null; streak: TeamResult[] };
  scoring: { forPerMatch: number; againstPerMatch: number; diff: number; sentence: string; biggestWin: { text: string; matchId: string } | null };
  discipline: { foulsPerMatch: number; bluePerMatch: number; reds: number; sentence: string };
  setPieces: {
    penalties: { scored: number; total: number; pct: number | null };
    directFouls: { scored: number; total: number; pct: number | null };
    sentence: string | null;
  };
}

interface Copy {
  dec: string;
  streakWin: (n: number) => [string, string];
  streakUnbeaten: (n: number) => [string, string];
  streakLoss: (n: number) => [string, string];
  rate: (w: number, p: number) => [string, string];
  record: (w: number, d: number, l: number, p: number) => string;
  strongerHome: (h: number, a: number) => string;
  strongerAway: (h: number, a: number) => string;
  balancedVenue: string;
  scoring: (gf: string, ga: string, diff: number) => string;
  biggestWin: (score: string, opp: string) => string;
  discipline: (fouls: string, blueEvery: string | null, reds: number) => string;
  setPieces: (pen: string | null, df: string | null) => string;
}

const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

const COPY: Record<Locale, Copy> = {
  es: {
    dec: ',',
    streakWin: (n) => [`${n} victorias seguidas`, 'El equipo llega lanzado: no pierde desde hace semanas.'],
    streakUnbeaten: (n) => [`${n} partidos sin perder`, 'Una racha que lo mantiene arriba en la tabla.'],
    streakLoss: (n) => [`${n} derrotas seguidas`, 'Un bache que necesita cortar cuanto antes.'],
    rate: (w, p) => [`Gana ${w} de cada ${p} partidos`, 'Así va su temporada, partido a partido.'],
    record: (w, d, l, p) => `${w} victorias, ${d} empates y ${l} derrotas en ${p} partidos.`,
    strongerHome: (h, a) => `Mucho más fuerte en casa: suma el ${h} % de los puntos posibles, por el ${a} % fuera.`,
    strongerAway: (h, a) => `Rinde mejor lejos de su pista: ${a} % de los puntos fuera, ${h} % en casa.`,
    balancedVenue: 'Rinde igual en casa que fuera.',
    scoring: (gf, ga, diff) => `Marca ${gf} goles por partido y encaja ${ga}. Diferencia de goles: ${sign(diff)}.`,
    biggestWin: (s, o) => `Mayor victoria: ${s} ante ${o}.`,
    discipline: (f, b, r) => `${f} faltas por partido${b ? `, una azul cada ${b} partidos` : ', sin tarjetas azules'}${r > 0 ? ` y ${r} roja${r > 1 ? 's' : ''}` : ''}.`,
    setPieces: (p, d) => [p && `Penaltis: ${p}`, d && `faltas directas: ${d}`].filter(Boolean).join(' · ') + '.',
  },
  ca: {
    dec: ',',
    streakWin: (n) => [`${n} victòries seguides`, "L'equip arriba llançat: fa setmanes que no perd."],
    streakUnbeaten: (n) => [`${n} partits sense perdre`, 'Una ratxa que el manté a dalt de la taula.'],
    streakLoss: (n) => [`${n} derrotes seguides`, 'Un sotrac que ha de tallar com més aviat millor.'],
    rate: (w, p) => [`Guanya ${w} de cada ${p} partits`, 'Així va la seva temporada, partit a partit.'],
    record: (w, d, l, p) => `${w} victòries, ${d} empats i ${l} derrotes en ${p} partits.`,
    strongerHome: (h, a) => `Molt més fort a casa: suma el ${h} % dels punts possibles, pel ${a} % fora.`,
    strongerAway: (h, a) => `Rendeix millor lluny de la seva pista: ${a} % dels punts fora, ${h} % a casa.`,
    balancedVenue: 'Rendeix igual a casa que fora.',
    scoring: (gf, ga, diff) => `Marca ${gf} gols per partit i n'encaixa ${ga}. Diferència de gols: ${sign(diff)}.`,
    biggestWin: (s, o) => `Victòria més àmplia: ${s} contra ${o}.`,
    discipline: (f, b, r) => `${f} faltes per partit${b ? `, una blava cada ${b} partits` : ', sense targetes blaves'}${r > 0 ? ` i ${r} vermella${r > 1 ? 'es' : ''}` : ''}.`,
    setPieces: (p, d) => [p && `Penals: ${p}`, d && `faltes directes: ${d}`].filter(Boolean).join(' · ') + '.',
  },
  en: {
    dec: '.',
    streakWin: (n) => [`${n} wins in a row`, 'The team is flying: no defeat in weeks.'],
    streakUnbeaten: (n) => [`${n} games unbeaten`, 'A run that keeps them near the top.'],
    streakLoss: (n) => [`${n} defeats in a row`, 'A slump they need to end quickly.'],
    rate: (w, p) => [`Wins ${w} of every ${p} games`, 'Their season, game by game.'],
    record: (w, d, l, p) => `${w} wins, ${d} draws and ${l} defeats in ${p} games.`,
    strongerHome: (h, a) => `Much stronger at home: ${h}% of the available points, against ${a}% away.`,
    strongerAway: (h, a) => `Better on the road: ${a}% of the points away, ${h}% at home.`,
    balancedVenue: 'Just as good at home as away.',
    scoring: (gf, ga, diff) => `Scores ${gf} goals per game and concedes ${ga}. Goal difference: ${sign(diff)}.`,
    biggestWin: (s, o) => `Biggest win: ${s} against ${o}.`,
    discipline: (f, b, r) => `${f} fouls per game${b ? `, a blue card every ${b} games` : ', no blue cards'}${r > 0 ? ` and ${r} red${r > 1 ? 's' : ''}` : ''}.`,
    setPieces: (p, d) => [p && `Penalties: ${p}`, d && `direct free hits: ${d}`].filter(Boolean).join(' · ') + '.',
  },
  pt: {
    dec: ',',
    streakWin: (n) => [`${n} vitórias seguidas`, 'A equipa chega lançada: não perde há semanas.'],
    streakUnbeaten: (n) => [`${n} jogos sem perder`, 'Uma série que a mantém no topo.'],
    streakLoss: (n) => [`${n} derrotas seguidas`, 'Uma má fase que tem de travar depressa.'],
    rate: (w, p) => [`Ganha ${w} em cada ${p} jogos`, 'Assim vai a sua temporada, jogo a jogo.'],
    record: (w, d, l, p) => `${w} vitórias, ${d} empates e ${l} derrotas em ${p} jogos.`,
    strongerHome: (h, a) => `Muito mais forte em casa: ${h} % dos pontos possíveis, contra ${a} % fora.`,
    strongerAway: (h, a) => `Rende mais fora: ${a} % dos pontos fora, ${h} % em casa.`,
    balancedVenue: 'Rende o mesmo em casa e fora.',
    scoring: (gf, ga, diff) => `Marca ${gf} golos por jogo e sofre ${ga}. Diferença de golos: ${sign(diff)}.`,
    biggestWin: (s, o) => `Maior vitória: ${s} frente ao ${o}.`,
    discipline: (f, b, r) => `${f} faltas por jogo${b ? `, um azul a cada ${b} jogos` : ', sem cartões azuis'}${r > 0 ? ` e ${r} vermelho${r > 1 ? 's' : ''}` : ''}.`,
    setPieces: (p, d) => [p && `Penáltis: ${p}`, d && `livres diretos: ${d}`].filter(Boolean).join(' · ') + '.',
  },
  fr: {
    dec: ',',
    streakWin: (n) => [`${n} victoires de suite`, 'L’équipe est lancée : aucune défaite depuis des semaines.'],
    streakUnbeaten: (n) => [`${n} matchs sans défaite`, 'Une série qui la maintient en haut du classement.'],
    streakLoss: (n) => [`${n} défaites de suite`, 'Un passage à vide à stopper au plus vite.'],
    rate: (w, p) => [`Gagne ${w} matchs sur ${p}`, 'Sa saison, match après match.'],
    record: (w, d, l, p) => `${w} victoires, ${d} nuls et ${l} défaites en ${p} matchs.`,
    strongerHome: (h, a) => `Bien plus fort à domicile : ${h} % des points possibles, contre ${a} % à l’extérieur.`,
    strongerAway: (h, a) => `Meilleur à l’extérieur : ${a} % des points dehors, ${h} % à domicile.`,
    balancedVenue: 'Aussi performant à domicile qu’à l’extérieur.',
    scoring: (gf, ga, diff) => `Marque ${gf} buts par match et en encaisse ${ga}. Différence de buts : ${sign(diff)}.`,
    biggestWin: (s, o) => `Plus large victoire : ${s} contre ${o}.`,
    discipline: (f, b, r) => `${f} fautes par match${b ? `, un carton bleu tous les ${b} matchs` : ', aucun carton bleu'}${r > 0 ? ` et ${r} rouge${r > 1 ? 's' : ''}` : ''}.`,
    setPieces: (p, d) => [p && `Penaltys : ${p}`, d && `coups francs directs : ${d}`].filter(Boolean).join(' · ') + '.',
  },
  it: {
    dec: ',',
    streakWin: (n) => [`${n} vittorie di fila`, 'La squadra è lanciata: non perde da settimane.'],
    streakUnbeaten: (n) => [`${n} partite senza perdere`, 'Una serie che la tiene in alto in classifica.'],
    streakLoss: (n) => [`${n} sconfitte di fila`, 'Un momento difficile da interrompere subito.'],
    rate: (w, p) => [`Vince ${w} partite su ${p}`, 'La sua stagione, partita dopo partita.'],
    record: (w, d, l, p) => `${w} vittorie, ${d} pareggi e ${l} sconfitte in ${p} partite.`,
    strongerHome: (h, a) => `Molto più forte in casa: ${h}% dei punti disponibili, contro il ${a}% in trasferta.`,
    strongerAway: (h, a) => `Rende meglio in trasferta: ${a}% dei punti fuori, ${h}% in casa.`,
    balancedVenue: 'Rende allo stesso modo in casa e fuori.',
    scoring: (gf, ga, diff) => `Segna ${gf} gol a partita e ne subisce ${ga}. Differenza reti: ${sign(diff)}.`,
    biggestWin: (s, o) => `Vittoria più larga: ${s} contro ${o}.`,
    discipline: (f, b, r) => `${f} falli a partita${b ? `, un blu ogni ${b} partite` : ', nessun cartellino blu'}${r > 0 ? ` e ${r} ross${r > 1 ? 'i' : 'o'}` : ''}.`,
    setPieces: (p, d) => [p && `Rigori: ${p}`, d && `tiri diretti: ${d}`].filter(Boolean).join(' · ') + '.',
  },
};

const time = (m: TeamMatchSummary) => new Date(m.scheduledAt ?? m.finishedAt ?? 0).getTime();
const pts = (r: Record3) => r.w * 3 + r.d;
const pctPoints = (r: Record3) => {
  const played = r.w + r.d + r.l;
  return played > 0 ? Math.round((pts(r) / (played * 3)) * 100) : 0;
};

export function teamStatsStory(
  stats: TeamSeasonStats, matches: TeamMatchSummary[], teamId: string, opts: { locale: string },
): TeamStory {
  const locale: Locale = isSupportedLocale(opts.locale) ? opts.locale : 'es';
  const c = COPY[locale];
  const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', c.dec);

  const finished = matches
    .map((m) => ({ m, r: teamResult(teamId, m) }))
    .filter((x): x is { m: TeamMatchSummary; r: TeamResult } => x.r !== null)
    .sort((a, b) => time(a.m) - time(b.m));

  const home: Record3 = { w: 0, d: 0, l: 0 };
  const away: Record3 = { w: 0, d: 0, l: 0 };
  for (const { m, r } of finished) {
    const bucket = m.homeTeam.id === teamId ? home : away;
    bucket[r === 'W' ? 'w' : r === 'D' ? 'd' : 'l']++;
  }
  const all: Record3 = { w: stats.won, d: stats.drawn, l: stats.lost };
  const played = stats.played;

  // Racha actual, del más reciente hacia atrás.
  const recent = [...finished].reverse().map((x) => x.r);
  const count = (pred: (r: TeamResult) => boolean) => { let n = 0; for (const r of recent) { if (!pred(r)) break; n++; } return n; };
  const wins = count((r) => r === 'W');
  const unbeaten = count((r) => r !== 'L');
  const losses = count((r) => r === 'L');

  let headline: [string, string];
  if (wins >= 3) headline = c.streakWin(wins);
  else if (unbeaten >= 4) headline = c.streakUnbeaten(unbeaten);
  else if (losses >= 3) headline = c.streakLoss(losses);
  else {
    // "Gana 3 de cada 7": fracción reducida a un denominador legible (≤ 10).
    const per = played > 10 ? 10 : played;
    const w = played > 10 ? Math.round((stats.won / played) * 10) : stats.won;
    headline = c.rate(w, per);
  }

  let venue: string | null = null;
  const hp = pctPoints(home);
  const ap = pctPoints(away);
  if (home.w + home.d + home.l >= 2 && away.w + away.d + away.l >= 2) {
    venue = hp - ap >= 20 ? c.strongerHome(hp, ap) : ap - hp >= 20 ? c.strongerAway(hp, ap) : c.balancedVenue;
  }

  const forPm = played > 0 ? stats.goalsFor / played : 0;
  const againstPm = played > 0 ? stats.goalsAgainst / played : 0;
  const diff = stats.goalsFor - stats.goalsAgainst;

  let biggestWin: TeamStory['scoring']['biggestWin'] = null;
  let best = 0;
  for (const { m, r } of finished) {
    if (r !== 'W') continue;
    const isHome = m.homeTeam.id === teamId;
    const mine = (isHome ? m.score.home : m.score.away) ?? 0;
    const theirs = (isHome ? m.score.away : m.score.home) ?? 0;
    if (mine - theirs > best) {
      best = mine - theirs;
      const opp = isHome ? m.awayTeam : m.homeTeam;
      biggestWin = { text: c.biggestWin(`${mine}-${theirs}`, clubName(opp.name)), matchId: m.id };
    }
  }

  const foulsPm = played > 0 ? stats.teamFouls / played : 0;
  const bluePm = played > 0 ? stats.blueCards / played : 0;
  const blueEvery = stats.blueCards > 0 ? fmt(played / stats.blueCards) : null;

  const conv = (p: { scored: number; total: number; pct: number | null }) =>
    p.total > 0 ? `${p.scored}/${p.total} (${p.pct ?? Math.round((p.scored / p.total) * 100)} %)`.replace(' %', locale === 'en' || locale === 'it' ? '%' : ' %') : null;
  const penText = conv(stats.penalties);
  const dfText = conv(stats.directFouls);

  return {
    headline: { title: headline[0], sub: headline[1] },
    results: { all, home, away, sentence: c.record(all.w, all.d, all.l, played), venue, streak: recent.slice(0, 5).reverse() },
    scoring: { forPerMatch: forPm, againstPerMatch: againstPm, diff, sentence: c.scoring(fmt(forPm), fmt(againstPm), diff), biggestWin },
    discipline: { foulsPerMatch: foulsPm, bluePerMatch: bluePm, reds: stats.redCards, sentence: c.discipline(fmt(foulsPm), blueEvery, stats.redCards) },
    setPieces: {
      penalties: stats.penalties,
      directFouls: stats.directFouls,
      sentence: penText || dfText ? c.setPieces(penText, dfText) : null,
    },
  };
}

/**
 * Portada de una federación (SEO, 2026-10-31): además de sus competiciones,
 * los últimos resultados, los próximos partidos y un texto con datos reales
 * de la temporada. Funciones puras, testeadas.
 */
import type { CompetitionSummary, Match } from '@/lib/api/client';
import type { Locale } from '@/lib/locales';

export interface FederationOverview {
  live: Match[];
  upcoming: Match[];
  results: Match[];
  competitions: number;
  matches: number;
  seasonName: string | null;
  nextMatchAt: string | null;
  champions: { team: string; competition: string }[];
}

const MAX = 6;

export function buildFederationOverview(comps: CompetitionSummary[], matches: Match[], now: Date = new Date()): FederationOverview {
  const ids = new Set(comps.map((c) => c.id));
  const own = matches.filter((m) => m.competitionId && ids.has(m.competitionId) && m.scheduledAt);
  const at = (m: Match) => new Date(m.scheduledAt!).getTime();
  const t = now.getTime();
  const live = own.filter((m) => m.status === 'live');
  const upcoming = own.filter((m) => m.status === 'scheduled' && at(m) >= t).sort((a, b) => at(a) - at(b)).slice(0, MAX);
  const results = own.filter((m) => m.status === 'finished').sort((a, b) => at(b) - at(a)).slice(0, MAX);
  const seasons = comps.map((c) => c.season).filter((s): s is NonNullable<typeof s> => !!s);
  const nexts = seasons.map((s) => s.nextMatchAt).filter((d): d is string => !!d).sort();
  const names = seasons.map((s) => s.name).filter((n): n is string => !!n);
  return {
    live,
    upcoming,
    results,
    competitions: comps.length,
    matches: seasons.reduce((n, s) => n + (s.matchCount ?? 0), 0),
    seasonName: names.sort().at(-1) ?? null,
    nextMatchAt: nexts[0] ?? null,
    champions: comps.flatMap((c) => (c.season?.champion ? [{ team: c.season.champion.name, competition: c.name }] : [])),
  };
}

type Txt = {
  intro: (f: string, n: number, season: string | null, matches: number) => string;
  where: string;
  next: (d: string) => string;
  champions: (list: string) => string;
};

const TEXT: Record<Locale, Txt> = {
  es: {
    intro: (f, n, s, m) => `La ${f} organiza ${n} ${n === 1 ? 'competición' : 'competiciones'} de hockey patines${s ? ` en la temporada ${s}` : ''}${m ? `, con ${m} partidos en el calendario` : ''}.`,
    where: 'En Stick Live tienes sus resultados en directo, calendarios, clasificaciones y estadísticas de jugadores.',
    next: (d) => `Próximo partido: ${d}.`,
    champions: (l) => `Campeones de la temporada: ${l}.`,
  },
  ca: {
    intro: (f, n, s, m) => `La ${f} organitza ${n} ${n === 1 ? 'competició' : 'competicions'} d'hoquei patins${s ? ` a la temporada ${s}` : ''}${m ? `, amb ${m} partits al calendari` : ''}.`,
    where: 'A Stick Live tens els seus resultats en directe, calendaris, classificacions i estadístiques de jugadors.',
    next: (d) => `Proper partit: ${d}.`,
    champions: (l) => `Campions de la temporada: ${l}.`,
  },
  en: {
    intro: (f, n, s, m) => `${f} runs ${n} rink hockey ${n === 1 ? 'competition' : 'competitions'}${s ? ` in the ${s} season` : ''}${m ? `, with ${m} matches on the calendar` : ''}.`,
    where: 'Stick Live has its live results, fixtures, standings and player stats.',
    next: (d) => `Next match: ${d}.`,
    champions: (l) => `Season champions: ${l}.`,
  },
  pt: {
    intro: (f, n, s, m) => `A ${f} organiza ${n} ${n === 1 ? 'competição' : 'competições'} de hóquei em patins${s ? ` na época ${s}` : ''}${m ? `, com ${m} jogos no calendário` : ''}.`,
    where: 'No Stick Live tens os resultados em direto, calendários, classificações e estatísticas dos jogadores.',
    next: (d) => `Próximo jogo: ${d}.`,
    champions: (l) => `Campeões da época: ${l}.`,
  },
  fr: {
    intro: (f, n, s, m) => `La ${f} organise ${n} ${n === 1 ? 'compétition' : 'compétitions'} de rink hockey${s ? ` pour la saison ${s}` : ''}${m ? `, avec ${m} matchs au calendrier` : ''}.`,
    where: 'Sur Stick Live, retrouvez ses résultats en direct, calendriers, classements et statistiques des joueurs.',
    next: (d) => `Prochain match : ${d}.`,
    champions: (l) => `Champions de la saison : ${l}.`,
  },
  it: {
    intro: (f, n, s, m) => `La ${f} organizza ${n} ${n === 1 ? 'competizione' : 'competizioni'} di hockey su pista${s ? ` nella stagione ${s}` : ''}${m ? `, con ${m} partite in calendario` : ''}.`,
    where: 'Su Stick Live trovi risultati in diretta, calendari, classifiche e statistiche dei giocatori.',
    next: (d) => `Prossima partita: ${d}.`,
    champions: (l) => `Campioni della stagione: ${l}.`,
  },
};

/** Párrafo de presentación con datos reales (no texto de relleno). */
export function federationIntro(o: FederationOverview, fedName: string, locale: Locale, tz = 'Europe/Madrid'): string {
  const x = TEXT[locale] ?? TEXT.es;
  const parts = [x.intro(fedName, o.competitions, o.seasonName, o.matches), x.where];
  if (o.nextMatchAt) {
    const d = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(o.nextMatchAt));
    parts.push(x.next(d));
  }
  if (o.champions.length > 0) parts.push(x.champions(o.champions.map((c) => `${c.team} (${c.competition})`).join(', ')));
  return parts.join(' ');
}

/**
 * Contenido de la imagen para compartir el resultado de un partido (historia
 * 9:16 y publicación 16:9). Pura, como team-share-card: la ruta solo pinta.
 */
import type { MatchDetail, MatchEvent } from './api/types';
import { teamTitleName } from './names';
import { eventSurname } from '@/components/match/format';
import { matchRoundLabel } from './stage-label';
import { serverT } from './server-t';
import { OG_COPY } from './og-image';
import { isSupportedLocale, type Locale } from './locales';

export type MatchShareState = 'finished' | 'live' | 'scheduled' | 'other';

export interface MatchShareSide {
  id: string;
  name: string;
  score: number | null;
  /** Goleadores en orden de su primer gol, con el minuto de partido de cada gol. */
  scorers: Array<{ name: string; minutes: number[] }>;
}

export interface MatchShareCard {
  state: MatchShareState;
  competition: string | null;
  round: string | null;
  home: MatchShareSide;
  away: MatchShareSide;
  /** Prórroga / Penaltis 3–2; null en partidos normales. */
  note: string | null;
  /** Fecha y hora en la zona de la competición. */
  when: string | null;
}

/**
 * Minuto de partido de un gol, al estilo fútbol (1–50, prórroga 51–60). El acta
 * da el crono RESTANTE de la parte ("MM:SS", 25 min; 5 en prórroga) y, en
 * eventos antiguos, solo el minuto transcurrido dentro de la parte.
 */
export function goalMinute(e: Pick<MatchEvent, 'period' | 'clock' | 'minute'>): number | null {
  const period = e.period ?? 1;
  const len = period <= 2 ? 25 : 5;
  const offset = period <= 2 ? (period - 1) * 25 : 50 + (period - 3) * 5;
  const clock = e.clock ? /^(\d{1,2}):(\d{2})$/.exec(e.clock) : null;
  let inPeriod: number | null = null;
  if (clock) {
    const remaining = Number(clock[1]) * 60 + Number(clock[2]);
    inPeriod = Math.floor(Math.max(0, len * 60 - remaining) / 60) + 1;
  } else if (e.minute != null) {
    // Algunas fuentes ya dan el minuto absoluto: no se vuelve a sumar la parte.
    if (e.minute > len) return e.minute;
    inPeriod = Math.max(1, e.minute);
  }
  if (inPeriod == null) return null;
  return offset + Math.min(inPeriod, len);
}

function scorers(events: MatchEvent[], home: boolean): MatchShareSide['scorers'] {
  const goals = events
    .filter((e) => e.eventType === 'goal' && e.isHomeTeam === home && e.player)
    .map((e, i) => ({ name: eventSurname(e.player!), minute: goalMinute(e), i }))
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999) || a.i - b.i);
  const byName = new Map<string, number[]>();
  for (const g of goals) {
    const list = byName.get(g.name) ?? [];
    if (g.minute != null) list.push(g.minute);
    else list.push(NaN);
    byName.set(g.name, list);
  }
  return [...byName].map(([name, mins]) => ({ name, minutes: mins }));
}

export function matchShareCard(detail: MatchDetail, opts: { locale: string }): MatchShareCard {
  const locale: Locale = isSupportedLocale(opts.locale) ? opts.locale : 'es';
  const t = serverT(locale);
  const m = detail.match;
  const state: MatchShareState =
    m.status === 'finished' ? 'finished' : m.status === 'live' ? 'live' : m.status === 'scheduled' ? 'scheduled' : 'other';
  const showScore = state === 'finished' || state === 'live';

  let note: string | null = null;
  if (m.winType === 'overtime') note = t('match_states.overtime');
  if (m.winType === 'penalties') {
    note = t('match_states.penalties_label')
      + (m.penalties?.home != null && m.penalties?.away != null ? ` ${m.penalties.home}–${m.penalties.away}` : '');
  }

  const when = m.scheduledAt
    ? new Intl.DateTimeFormat(OG_COPY[locale].dateLocale, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        timeZone: m.competitionTimezone ?? 'Europe/Madrid',
      }).format(new Date(m.scheduledAt))
    : null;

  const side = (id: string, team: typeof m.homeTeam, score: number | null, home: boolean): MatchShareSide => ({
    id,
    name: teamTitleName(team?.name, team?.shortName),
    score: showScore ? (score ?? 0) : null,
    scorers: scorers(detail.events ?? [], home),
  });

  return {
    state,
    competition: m.competitionName ?? null,
    round: matchRoundLabel(m.round ?? null, t),
    home: side(m.homeTeamId, m.homeTeam, m.score.home, true),
    away: side(m.awayTeamId, m.awayTeam, m.score.away, false),
    note,
    when,
  };
}

/** Solo el dominio para el pie de las imágenes: "https://www.sticklive.eu/x" → "sticklive.eu". */
export function shareSiteHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host.replace(/^www\./, '');
  } catch {
    return siteUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]!;
  }
}

/** Textos propios de la imagen de partido que no están en los diccionarios. */
export const MATCH_SHARE_COPY: Record<Locale, { final: string; live: string; follow: string; vs: string }> = {
  es: { final: 'Final', live: 'En directo', follow: 'Resultados en directo', vs: 'VS' },
  ca: { final: 'Final', live: 'En directe', follow: 'Resultats en directe', vs: 'VS' },
  en: { final: 'Full time', live: 'Live', follow: 'Live results', vs: 'VS' },
  pt: { final: 'Final', live: 'Em direto', follow: 'Resultados em direto', vs: 'VS' },
  fr: { final: 'Terminé', live: 'En direct', follow: 'Résultats en direct', vs: 'VS' },
  it: { final: 'Finale', live: 'In diretta', follow: 'Risultati in diretta', vs: 'VS' },
};

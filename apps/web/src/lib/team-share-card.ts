/**
 * Contenido de la imagen para compartir la ficha de un equipo (historia 9:16 y
 * publicación 16:9). Función pura: la ruta de imagen solo pinta lo que sale de
 * aquí, así las reglas (forma, último y próximo partido) se testean sin Satori.
 */
import type { TeamDetail, TeamMatchSummary } from './api/types';
import { clubName } from './names';
import { teamSectionLabel } from './team-section-label';
import { OG_COPY } from './og-image';
import { isSupportedLocale, type Locale } from './locales';

export type Outcome = 'W' | 'D' | 'L';
export type ShareFormat = 'story' | 'post';
export type ShareTheme = 'dark' | 'light';

export interface TeamShareCard {
  teamName: string;
  section: string;
  competition: string | null;
  season: string | null;
  position: number | null;
  points: number | null;
  record: { played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number } | null;
  /** Últimos 5 terminados, del más antiguo al más reciente. */
  form: Outcome[];
  lastMatch: { opponent: string; opponentId: string; home: boolean; teamGoals: number; opponentGoals: number; outcome: Outcome } | null;
  nextMatch: { opponent: string; opponentId: string; home: boolean; when: string } | null;
}

/** Formato y tema de la query, con valores por defecto si llegan raros. */
export function shareImageQuery(q: URLSearchParams): { format: ShareFormat; theme: ShareTheme } {
  return {
    format: q.get('format') === 'story' ? 'story' : 'post',
    theme: q.get('theme') === 'light' ? 'light' : 'dark',
  };
}

const time = (m: TeamMatchSummary) => new Date(m.scheduledAt ?? m.finishedAt ?? 0).getTime();

function outcomeFor(teamId: string, m: TeamMatchSummary): Outcome | null {
  const { home, away } = m.score;
  if (home == null || away == null) return null;
  if (m.winnerTeamId) return m.winnerTeamId === teamId ? 'W' : 'L';
  const mine = m.homeTeam.id === teamId ? home : away;
  const theirs = m.homeTeam.id === teamId ? away : home;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}

export function teamShareCard(d: TeamDetail, opts: { locale: string; now?: Date }): TeamShareCard {
  const locale: Locale = isSupportedLocale(opts.locale) ? opts.locale : 'es';
  const now = (opts.now ?? new Date()).getTime();
  const teamId = d.team.id;
  const st = d.standing;
  const season = d.seasons?.find((s) => s.id === (d.selectedSeasonId ?? st?.seasonId)) ?? null;

  const finished = d.matches
    .filter((m) => m.status === 'finished' && outcomeFor(teamId, m) !== null)
    .sort((a, b) => time(a) - time(b));
  const upcoming = d.matches
    .filter((m) => m.status === 'scheduled' && m.scheduledAt && time(m) >= now)
    .sort((a, b) => time(a) - time(b));

  const last = finished.at(-1) ?? null;
  const next = upcoming[0] ?? null;
  const rival = (m: TeamMatchSummary) => (m.homeTeam.id === teamId ? m.awayTeam : m.homeTeam);

  let lastMatch: TeamShareCard['lastMatch'] = null;
  if (last) {
    const home = last.homeTeam.id === teamId;
    lastMatch = {
      opponent: clubName(rival(last).name), opponentId: rival(last).id, home,
      teamGoals: (home ? last.score.home : last.score.away)!,
      opponentGoals: (home ? last.score.away : last.score.home)!,
      outcome: outcomeFor(teamId, last)!,
    };
  }

  let nextMatch: TeamShareCard['nextMatch'] = null;
  if (next) {
    const when = new Intl.DateTimeFormat(OG_COPY[locale].dateLocale, {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      timeZone: next.competitionTimezone ?? 'Europe/Madrid',
    }).format(new Date(next.scheduledAt!));
    nextMatch = { opponent: clubName(rival(next).name), opponentId: rival(next).id, home: next.homeTeam.id === teamId, when };
  }

  return {
    teamName: clubName(d.team.name),
    section: teamSectionLabel(d.team, locale),
    competition: st?.competitionShort ?? st?.competitionName ?? season?.competitionShort ?? season?.competitionName ?? null,
    season: season?.name ?? null,
    position: st?.position ?? null,
    points: st?.points ?? null,
    record: st ? { played: st.played, won: st.won, drawn: st.drawn, lost: st.lost, goalsFor: st.goalsFor, goalsAgainst: st.goalsAgainst } : null,
    form: finished.slice(-5).map((m) => outcomeFor(teamId, m)!),
    lastMatch,
    nextMatch,
  };
}

/** Textos de la imagen por idioma. Las letras de forma siguen la convención local. */
export const SHARE_COPY: Record<Locale, {
  position: string; points: string; played: string; won: string; drawn: string; lost: string;
  goals: string; form: string; last: string; next: string; home: string; away: string;
  outcome: Record<Outcome, string>; follow: string;
}> = {
  es: { position: 'Posición', points: 'pts', played: 'PJ', won: 'G', drawn: 'E', lost: 'P', goals: 'Goles', form: 'Forma', last: 'Último', next: 'Próximo', home: 'en casa', away: 'fuera', outcome: { W: 'V', D: 'E', L: 'D' }, follow: 'Síguelo en directo' },
  ca: { position: 'Posició', points: 'pts', played: 'PJ', won: 'G', drawn: 'E', lost: 'P', goals: 'Gols', form: 'Forma', last: 'Últim', next: 'Proper', home: 'a casa', away: 'fora', outcome: { W: 'V', D: 'E', L: 'D' }, follow: 'Segueix-lo en directe' },
  en: { position: 'Position', points: 'pts', played: 'P', won: 'W', drawn: 'D', lost: 'L', goals: 'Goals', form: 'Form', last: 'Last', next: 'Next', home: 'home', away: 'away', outcome: { W: 'W', D: 'D', L: 'L' }, follow: 'Follow it live' },
  pt: { position: 'Posição', points: 'pts', played: 'J', won: 'V', drawn: 'E', lost: 'D', goals: 'Golos', form: 'Forma', last: 'Último', next: 'Próximo', home: 'em casa', away: 'fora', outcome: { W: 'V', D: 'E', L: 'D' }, follow: 'Segue em direto' },
  fr: { position: 'Position', points: 'pts', played: 'J', won: 'G', drawn: 'N', lost: 'P', goals: 'Buts', form: 'Forme', last: 'Dernier', next: 'Prochain', home: 'à domicile', away: 'à l’extérieur', outcome: { W: 'V', D: 'N', L: 'D' }, follow: 'Suivez-le en direct' },
  it: { position: 'Posizione', points: 'pt', played: 'G', won: 'V', drawn: 'N', lost: 'P', goals: 'Gol', form: 'Forma', last: 'Ultima', next: 'Prossima', home: 'in casa', away: 'in trasferta', outcome: { W: 'V', D: 'N', L: 'S' }, follow: 'Seguila in diretta' },
};

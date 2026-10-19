import type { TeamDetail, TeamMatchSummary, TeamSummary } from '@/lib/api/types';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { clubName } from '@/lib/names';

const COPY: Record<string, { title: string; competition: string }> = {
  es: { title: 'Rivales', competition: 'Competición' },
  en: { title: 'Opponents', competition: 'Competition' },
  pt: { title: 'Adversários', competition: 'Competição' },
  fr: { title: 'Adversaires', competition: 'Compétition' },
  it: { title: 'Avversari', competition: 'Competizione' },
};

/**
 * Rivales únicos de la temporada mostrada, sin el propio equipo.
 *
 * Los partidos de `TeamDetail` ya vienen acotados a la temporada elegida. Se
 * deduplica por id y se ordena por nombre para que el HTML sea estable.
 */
export function teamOpponents(matches: TeamMatchSummary[], teamId: string): TeamSummary[] {
  const byId = new Map<string, TeamSummary>();
  for (const match of matches) {
    for (const team of [match.homeTeam, match.awayTeam]) {
      if (team.id !== teamId && !byId.has(team.id)) byId.set(team.id, team);
    }
  }
  return [...byId.values()].sort((a, b) => clubName(a.name).localeCompare(clubName(b.name)));
}

/**
 * Enlaces internos server-rendered equipo → competición y equipo → rivales.
 * Existe para que las fichas de equipo no queden huérfanas: el HTML inicial
 * enlaza a todas las fichas rivales de la temporada, sin depender de las tabs.
 */
export function TeamOpponents({ data, locale }: { data: TeamDetail; locale: string }) {
  const copy = COPY[locale] ?? COPY['es']!;
  const opponents = teamOpponents(data.matches, data.team.id);

  const competition = data.standing
    ? {
        id: data.standing.competitionId,
        name: data.standing.competitionName,
        seasonId: data.standing.seasonId,
      }
    : data.season && data.selectedSeasonId
      ? {
          id: data.season.competitionId,
          name: data.season.competitionName,
          seasonId: data.selectedSeasonId,
        }
      : null;

  if (opponents.length === 0 && !competition) return null;

  return (
    <section className="card p-5 space-y-3" aria-labelledby="team-opponents-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="team-opponents-title" className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {copy.title}
        </h2>
        {competition && (
          <Link
            href={`/competitions/${competition.id}?season=${competition.seasonId}`}
            className="text-xs font-medium text-rink-passion hover:underline dark:text-rink-accent"
          >
            {copy.competition}: {competition.name} →
          </Link>
        )}
      </div>

      {opponents.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {opponents.map((opponent) => (
            <li key={opponent.id}>
              <Link
                href={`/teams/${opponent.id}`}
                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-rink-passion hover:text-rink-passion dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-rink-accent dark:hover:text-rink-accent"
              >
                {clubName(opponent.name)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import type { TeamDetail, TeamMatchSummary, TeamSummary } from '@sports/core/api';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { clubName } from '@sports/core/names';
import { competitionPath } from '@/lib/competition-path';

const COPY: Record<string, { title: string; competition: string; show: string; hide: string }> = {
  es: { title: 'Rivales', competition: 'Competición', show: 'Ver rivales', hide: 'Ocultar' },
  en: { title: 'Opponents', competition: 'Competition', show: 'Show opponents', hide: 'Hide' },
  pt: { title: 'Adversários', competition: 'Competição', show: 'Ver adversários', hide: 'Ocultar' },
  fr: { title: 'Adversaires', competition: 'Compétition', show: 'Voir les adversaires', hide: 'Masquer' },
  it: { title: 'Avversari', competition: 'Competizione', show: 'Vedi avversari', hide: 'Nascondi' },
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
        slug: data.standing.competitionSlug,
        name: data.standing.competitionName,
        seasonId: data.standing.seasonId,
      }
    : data.season && data.selectedSeasonId
      ? {
          id: data.season.competitionId,
          slug: data.season.competitionSlug,
          name: data.season.competitionName,
          seasonId: data.selectedSeasonId,
        }
      : null;

  if (opponents.length === 0 && !competition) return null;

  return (
    // Plegado (auditoría UX 03/11/2026): los enlaces siguen en el HTML para el
    // enlazado interno, pero la nube de chips ya no ocupa media pantalla.
    <section className="card p-5 space-y-3" aria-labelledby="team-opponents-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="team-opponents-title" className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {copy.title}{opponents.length > 0 ? ` (${opponents.length})` : ''}
        </h2>
        {competition && (
          <Link
            href={competitionPath(competition.id, competition.slug, competition.seasonId)}
            className="text-xs font-medium text-rink-passion hover:underline dark:text-rink-accent"
          >
            {copy.competition}: {competition.name} →
          </Link>
        )}
      </div>

      {opponents.length > 0 && (
        <details className="group">
        <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span className="group-open:hidden">{copy.show}</span>
          <span className="hidden group-open:inline">{copy.hide}</span>
        </summary>
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
        </details>
      )}
    </section>
  );
}

import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { getClubDetail, isApiNotFound, type ClubDetail, type ClubDetailMatch } from '@/lib/api/client';
import type { ClubDetailTeam, ClubTeamMatch } from '@/lib/api/types';
import { BackLink } from '@/components/shared/BackLink';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';
import { JsonLd } from '@/components/shared/JsonLd';
import { TeamShield } from '@/components/shared/TeamShield';
import { BREADCRUMB_LABELS } from '@/lib/breadcrumbs';
import { competitionPath } from '@/lib/competition-path';
import { clubName } from '@/lib/names';
import { clubTeamLabel, clubText, groupClubSections } from '@/lib/club-sections';
import { clubJsonLd, clubMetaTitle, CLUB_COPY } from '@/lib/club-page';
import { breadcrumbJsonLd, isSupportedLocale, localeAlternates, metadataOnError, socialMeta } from '@/lib/seo';
import type { Locale } from '@/lib/locales';

/**
 * Ficha de club (Plan B1): hub de todas las secciones del club (masculino,
 * femenino, base, filiales) con sus partidos recientes y próximos. Ataca la
 * búsqueda de marca ("CP Voltregà"); la ficha de equipo ataca "club +
 * categoría". La URL pública es `/clubs/<slug>`; el UUID responde 308.
 */

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const fallback = localeAlternates(locale, `/clubs/${params.id}`);
  try {
    const data = await getClubDetail(params.id);
    const path = `/clubs/${data.club.slug}`;
    const name = clubName(data.club.name);
    const copy = CLUB_COPY[locale];
    const title = clubMetaTitle(locale, name);
    const description = copy.description(name, data.teams.length);
    return {
      title,
      description,
      alternates: localeAlternates(locale, path),
      // Matriz de indexación (auditoría SEO): sin sección activa esta temporada,
      // la ficha se sirve pero no se indexa; sigue repartiendo enlaces.
      ...(data.indexable ? {} : { robots: { index: false, follow: true } }),
      ...socialMeta({ locale, path, title: name, description }),
    };
  } catch (err) {
    return metadataOnError(err, fallback);
  }
}

function formatDate(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function shortDate(iso: string | null, locale: Locale, withTime: boolean): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso));
}

const RESULT_TONE: Record<'W' | 'D' | 'L', string> = {
  W: 'bg-emerald-500 text-white', D: 'bg-slate-400 text-white', L: 'bg-rink-passion text-white',
};
const RESULT_LETTER: Record<Locale, Record<'W' | 'D' | 'L', string>> = {
  es: { W: 'V', D: 'E', L: 'D' }, ca: { W: 'V', D: 'E', L: 'D' }, pt: { W: 'V', D: 'E', L: 'D' },
  en: { W: 'W', D: 'D', L: 'L' }, fr: { W: 'V', D: 'N', L: 'D' }, it: { W: 'V', D: 'P', L: 'S' },
};

/** Último resultado o próximo partido de un equipo: dato arriba, rival debajo. */
function TeamMatchLine({ label, m, locale, next }: { label: string; m: ClubTeamMatch | null | undefined; locale: Locale; next: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      {!m ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{next ? clubText(locale, 'no_next', 'Sin partido programado') : '—'}</p>
      ) : (
        <Link href={`/matches/${m.id}`} className="mt-0.5 block min-w-0 text-xs text-slate-700 hover:text-rink-passion dark:text-slate-300">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            {next ? (
              <span className="truncate font-semibold">
                {m.home ? clubText(locale, 'home', 'En casa') : clubText(locale, 'away', 'Fuera')} · {shortDate(m.scheduledAt, locale, true)}
              </span>
            ) : (
              <>
                {m.result && (
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-black ${RESULT_TONE[m.result]}`}>
                    {RESULT_LETTER[locale][m.result]}
                  </span>
                )}
                {m.goalsFor != null && m.goalsAgainst != null && (
                  <span className="font-score font-bold tabular-nums">{m.goalsFor}–{m.goalsAgainst}</span>
                )}
                <span className="truncate text-slate-500 dark:text-slate-400">{shortDate(m.scheduledAt, locale, false)}</span>
              </>
            )}
          </span>
          <span className="block truncate text-slate-500 dark:text-slate-400">{next ? '' : 'vs '}{clubName(m.opponent)}</span>
        </Link>
      )}
    </div>
  );
}

/** Tarjeta de un equipo del club: categoría, competición, último y próximo (referencia OKmob). */
function ClubTeamCard({ team, locale, positionLabel }: { team: ClubDetailTeam; locale: Locale; positionLabel: (n: number) => string }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <Link href={`/teams/${team.id}`} className="text-sm font-bold text-slate-900 hover:text-rink-passion dark:text-slate-50">
          {clubTeamLabel(team, locale)}
        </Link>
        {team.competition?.isCurrent && team.position ? (
          <span className="shrink-0 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{positionLabel(team.position)}</span>
        ) : null}
      </div>
      {team.competition && (
        <Link href={competitionPath(team.competition.id, team.competition.slug)}
              className="block truncate text-xs text-slate-500 hover:text-rink-passion dark:text-slate-400">
          {clubName(team.competition.name)}
        </Link>
      )}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <TeamMatchLine label={clubText(locale, 'last', 'Último')} m={team.lastMatch} locale={locale} next={false} />
        <TeamMatchLine label={clubText(locale, 'next', 'Próximo')} m={team.nextMatch} locale={locale} next />
      </div>
    </li>
  );
}

function MatchList({ title, matches, locale }: { title: string; matches: ClubDetailMatch[]; locale: Locale }) {
  if (matches.length === 0) return null;
  return (
    <section className="card overflow-hidden" aria-label={title}>
      <h2 className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {matches.map((m) => {
          const played = m.homeScore !== null && m.awayScore !== null && m.status !== 'scheduled';
          return (
            <li key={m.id} className="px-4 py-2.5">
              <Link href={`/matches/${m.id}`} className="flex items-center gap-3 group">
                <span className="flex-1 min-w-0 text-sm text-slate-800 dark:text-slate-200 group-hover:text-rink-passion">
                  <span className="block truncate">
                    {clubName(m.home.name)} {played ? `${m.homeScore} - ${m.awayScore}` : '-'} {clubName(m.away.name)}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {m.competition.name} · {formatDate(m.scheduledAt, locale)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function ClubPage(props: Props) {
  const params = await props.params;
  const locale: Locale = isSupportedLocale(params.locale) ? params.locale : 'en';

  let data: ClubDetail;
  try {
    data = await getClubDetail(params.id);
  } catch (err) {
    if (isApiNotFound(err)) notFound();
    throw err; // error boundary con reintento: una caída de la API no es un 404
  }

  // UUID (o slug antiguo con otra forma) → URL canónica por slug.
  if (params.id !== data.club.slug) permanentRedirect(`/${locale}/clubs/${data.club.slug}`);

  const copy = CLUB_COPY[locale];
  const name = clubName(data.club.name);
  const path = `/clubs/${data.club.slug}`;
  const shieldTeam = data.teams[0]?.id;

  const crumbs = [
    { label: BREADCRUMB_LABELS[locale].home, href: '/' },
    { label: name, href: path },
  ];

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <JsonLd data={clubJsonLd(locale, data)} />
      <JsonLd data={breadcrumbJsonLd(locale, crumbs.map(({ label, href }) => ({ name: label, path: href })))} />
      <BackLink href="/" />
      <Breadcrumbs items={crumbs} />

      <header className="card p-5 flex items-center gap-4">
        {shieldTeam && <TeamShield teamId={shieldTeam} teamName={name} size={56} />}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {[data.club.city, copy.teamsCount(data.teams.length)].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {groupClubSections(data.teams).map(({ section, teams }) => (
              <a key={section} href={`#club-section-${section}`}
                 className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
                {teams.length} {clubText(locale, `section_${section}`, section).toLowerCase()}
              </a>
            ))}
          </p>
        </div>
      </header>

      {groupClubSections(data.teams).map(({ section, teams }) => (
        <section key={section} className="card overflow-hidden" aria-labelledby={`club-section-${section}`}>
          <h2 id={`club-section-${section}`} className="flex items-baseline justify-between px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <span>{clubText(locale, `section_${section}`, section)}</span>
            <span className="tabular-nums">{teams.length}</span>
          </h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {teams.map((t) => <ClubTeamCard key={t.id} team={t} locale={locale} positionLabel={copy.position} />)}
          </ul>
        </section>
      ))}

      <MatchList title={copy.recent} matches={data.recent} locale={locale} />
      <MatchList title={copy.upcoming} matches={data.upcoming} locale={locale} />
    </div>
  );
}

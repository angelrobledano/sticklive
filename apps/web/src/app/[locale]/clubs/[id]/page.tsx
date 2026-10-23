import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { getClubDetail, isApiNotFound, type ClubDetail, type ClubDetailMatch } from '@/lib/api/client';
import { BackLink } from '@/components/shared/BackLink';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';
import { JsonLd } from '@/components/shared/JsonLd';
import { TeamShield } from '@/components/shared/TeamShield';
import { BREADCRUMB_LABELS } from '@/lib/breadcrumbs';
import { competitionPath } from '@/lib/competition-path';
import { clubName } from '@/lib/names';
import { teamSectionLabel } from '@/lib/team-section-label';
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
        </div>
      </header>

      {data.teams.length > 0 && (
        <section className="card overflow-hidden" aria-labelledby="club-teams">
          <h2 id="club-teams" className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {copy.teams}
          </h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {data.teams.map((t) => {
              const section = teamSectionLabel(t, locale);
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <TeamShield teamId={t.id} teamName={t.name} size={28} />
                  <div className="flex-1 min-w-0">
                    <Link href={`/teams/${t.id}`} className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200 hover:text-rink-passion">
                      {clubName(t.name)}{section ? ` · ${section}` : ''}
                    </Link>
                    {t.competition && (
                      <Link
                        href={competitionPath(t.competition.id, t.competition.slug)}
                        className="block truncate text-[11px] text-slate-500 dark:text-slate-400 hover:text-rink-passion"
                      >
                        {t.competition.name}
                        {t.competition.isCurrent && t.position ? ` · ${copy.position(t.position)}` : ''}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <MatchList title={copy.recent} matches={data.recent} locale={locale} />
      <MatchList title={copy.upcoming} matches={data.upcoming} locale={locale} />
    </div>
  );
}

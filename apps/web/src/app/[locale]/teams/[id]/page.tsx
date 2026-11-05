import type { Metadata } from 'next';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { getTeamDetail, isApiNotFound } from '@/lib/api/client';
import { TeamCenterClient } from '@/components/team/TeamCenterClient';
import { TeamOpponents } from '@/components/team/TeamOpponents';
import { ClubKit } from '@/components/team/ClubKit';
import { BackLink } from '@/components/shared/BackLink';
import { JsonLd } from '@/components/shared/JsonLd';
import { redirectOrNotFound } from '@/lib/entity-redirect';
import { localeAlternates, socialMeta, isSupportedLocale, breadcrumbJsonLd, teamJsonLd, teamMetaTitle, metadataOnError, SITE_URL } from '@/lib/seo';
import { BREADCRUMB_LABELS } from '@/lib/breadcrumbs';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';
import { clubName, playerDisplayName, teamQualifiedName } from '@sports/core/names';
import { teamSectionLabel } from '@/lib/team-section-label';
import { teamHistory } from '@/lib/team-histories';
import { competitionPath } from '@/lib/competition-path';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

interface Props {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ season?: string }>;
}

const DESC: Record<string, (n: string) => string> = {
  es: (n) => `${n}: plantilla, calendario, resultados y estadísticas de hockey patines en Stick Live.`,
  en: (n) => `${n}: squad, fixtures, results and rink hockey stats on Stick Live.`,
  pt: (n) => `${n}: plantel, calendário, resultados e estatísticas de hóquei em patins no Stick Live.`,
  fr: (n) => `${n} : effectif, calendrier, résultats et statistiques de rink hockey sur Stick Live.`,
  it: (n) => `${n}: rosa, calendario, risultati e statistiche di hockey su pista su Stick Live.`,
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const alternates = localeAlternates(locale, `/teams/${params.id}`);
  try {
    const data = await getTeamDetail(params.id);
    const name = clubName(data.team.name);
    const section = teamSectionLabel(data.team, locale);
    const qualified = teamQualifiedName(name, section);
    const title = teamMetaTitle({ locale, name, section });
    const description = (DESC[locale] ?? DESC['en'])!(qualified);
    return { title, description, alternates, ...socialMeta({ locale, path: `/teams/${params.id}`, title: qualified, description, dynamicImage: true }) };
  } catch (err) {
    return metadataOnError(err, alternates);
  }
}

export default async function TeamDetailPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  let data;
  try {
    data = await getTeamDetail(params.id, searchParams.season);
  } catch (err) {
    // F1-7: si la ficha se fusionó o la sustituye otra, 308 a esa ficha.
    if (isApiNotFound(err)) {
      await redirectOrNotFound('team', params.id, isSupportedLocale(params.locale) ? params.locale : 'en');
    }
    throw err; // error boundary con reintento — no convertir caídas de API en 404
  }

  const teamName = clubName(data.team.name);
  const section = teamSectionLabel(data.team, locale);
  const qualifiedTeamName = teamQualifiedName(teamName, section);

  const jsonLd = teamJsonLd({
    locale,
    id: data.team.id,
    name: qualifiedTeamName,
    city: data.team.city,
    // El escudo real lo sirve `${API}/teams/:id/logo` (fichero del volumen o proxy
    // del CDN con Referer); `/escudos/*.png` no existe y el JSON-LD declaraba un
    // 404 (#169). No usamos `logoUrl` directo porque el CDN bloquea el hotlink.
    logoUrl: `${API_URL}/teams/${data.team.id}/logo`,
    competitionId: data.standing?.competitionId ?? data.season?.competitionId,
    competitionSlug: data.standing?.competitionSlug ?? data.season?.competitionSlug,
    competitionName: data.standing?.competitionName ?? data.season?.competitionName,
    clubSlug: data.team.club?.slug,
    clubName: data.team.club ? clubName(data.team.club.canonicalName) : null,
  });

  // F5-6: migas visibles + BreadcrumbList (Inicio › Competiciones › Competición › Equipo).
  const compName = data.standing?.competitionName ?? data.season?.competitionName;
  const compId = data.standing?.competitionId ?? data.season?.competitionId;
  const compSlug = data.standing?.competitionSlug ?? data.season?.competitionSlug;
  const crumbs = [
    { label: BREADCRUMB_LABELS[locale].home, href: '/' },
    { label: BREADCRUMB_LABELS[locale].competitions, href: '/competitions' },
    ...(compName && compId ? [{ label: compName, href: competitionPath(compId, compSlug) }] : []),
    { label: qualifiedTeamName, href: `/teams/${data.team.id}` },
  ];
  const breadcrumbLd = breadcrumbJsonLd(
    locale,
    crumbs.map(({ label, href }) => ({ name: label, path: href })),
  );

  // Historia y palmarés editorial del club (ver `lib/team-histories`): texto
  // propio y verificado al final de la ficha, server-rendered.
  const history = teamHistory(params.id);

  // «Para el club» (04/11/2026): último resultado para la imagen de redes.
  const lastMatch = [...data.matches]
    .filter((m) => m.status === 'finished')
    .sort((a, b) => Date.parse(b.scheduledAt ?? '') - Date.parse(a.scheduledAt ?? ''))[0];
  const lastFinished = lastMatch
    ? { id: lastMatch.id, label: `${clubName(lastMatch.homeTeam.name)} ${lastMatch.score.home ?? ''}-${lastMatch.score.away ?? ''} ${clubName(lastMatch.awayTeam.name)}` }
    : null;

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <JsonLd data={jsonLd} />
      <JsonLd data={breadcrumbLd} />
      <BackLink href="/" />
      <Breadcrumbs items={crumbs} />

      <TeamCenterClient data={data} />

      <TeamOpponents data={data} locale={locale} />

      <ClubKit siteUrl={SITE_URL} teamId={data.team.id} teamName={clubName(data.team.name)} lastMatch={lastFinished} />

      {/* #339: la plantilla vive en un tab client-side, así que el HTML inicial
          no enlazaba ninguna ficha de jugador (`grep /players/` = 0). Esta lista
          server-side las hace descubribles por el crawler. Se oculta a la vista
          y a lectores de pantalla porque duplica el tab Plantilla, no aporta
          navegación nueva. */}
      {data.squad.length > 0 && (
        <nav className="sr-only" aria-hidden="true">
          <ul>
            {data.squad.map((p) => (
              <li key={p.playerId}>
                <Link href={`/players/${p.playerId}`} tabIndex={-1}>
                  {playerDisplayName(p.firstName, p.lastName)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {history && (
        <section className="card p-5 space-y-3" aria-labelledby="team-history">
          <h2 id="team-history" className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Historia y palmarés
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{history.history}</p>
          {history.honours.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {history.honours.map((honour) => (
                <li key={honour}>{honour}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Fuentes: {history.sources.join(' · ')} · actualizado el {history.updatedAt}
          </p>
        </section>
      )}
    </div>
  );
}

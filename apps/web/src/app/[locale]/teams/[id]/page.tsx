import type { Metadata } from 'next';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { getTeamDetail, isApiNotFound } from '@/lib/api/client';
import { TeamCenterClient } from '@/components/team/TeamCenterClient';
import { BackLink } from '@/components/shared/BackLink';
import { JsonLd } from '@/components/shared/JsonLd';
import { redirectOrNotFound } from '@/lib/entity-redirect';
import { localeAlternates, socialMeta, isSupportedLocale, SITE_URL, metadataOnError } from '@/lib/seo';
import { clubName, playerDisplayName } from '@/lib/names';

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
    const title = `${name} | Stick Live`;
    const description = (DESC[locale] ?? DESC['en'])!(name);
    return { title, description, alternates, ...socialMeta({ locale, path: `/teams/${params.id}`, title: name, description, dynamicImage: true }) };
  } catch (err) {
    return metadataOnError(err, alternates);
  }
}

export default async function TeamDetailPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: clubName(data.team.name),
    sport: 'Roller Hockey',
    url: `${SITE_URL}/${params.locale}/teams/${data.team.id}`,
    // El escudo real lo sirve `${API}/teams/:id/logo` (fichero del volumen o proxy
    // del CDN con Referer); `/escudos/*.png` no existe y el JSON-LD declaraba un
    // 404 (#169). No usamos `logoUrl` directo porque el CDN bloquea el hotlink.
    logo: `${API_URL}/teams/${data.team.id}/logo`,
    location: data.team.city ? { '@type': 'Place', name: data.team.city } : undefined,
  };

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <JsonLd data={jsonLd} />
      <BackLink href="/" />

      <TeamCenterClient data={data} />

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
    </div>
  );
}

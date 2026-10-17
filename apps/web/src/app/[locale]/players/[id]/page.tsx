import type { Metadata } from 'next';
import { getPlayerDetail, isApiNotFound } from '@/lib/api/client';
import type { PlayerDetail } from '@/lib/api/client';
import { PlayerProfileClient } from '@/components/player/PlayerProfileClient';
import { JsonLd } from '@/components/shared/JsonLd';
import { redirectOrNotFound } from '@/lib/entity-redirect';
import { localeAlternates, socialMeta, isSupportedLocale, SITE_URL, metadataOnError } from '@/lib/seo';
import { toTitleCase, clubName } from '@/lib/names';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

const DESC: Record<string, (n: string, t: string | null) => string> = {
  es: (n, t) => `${n}${t ? ` (${t})` : ''}: goles, tarjetas y estadísticas de hockey patines, temporada a temporada, en Stick Live.`,
  en: (n, t) => `${n}${t ? ` (${t})` : ''}: rink hockey goals, cards and season-by-season stats on Stick Live.`,
  pt: (n, t) => `${n}${t ? ` (${t})` : ''}: golos, cartões e estatísticas de hóquei em patins, época a época, no Stick Live.`,
  fr: (n, t) => `${n}${t ? ` (${t})` : ''} : buts, cartons et statistiques de rink hockey, saison par saison, sur Stick Live.`,
  it: (n, t) => `${n}${t ? ` (${t})` : ''}: gol, cartellini e statistiche di hockey su pista, stagione per stagione, su Stick Live.`,
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const alternates = localeAlternates(locale, `/players/${params.id}`);
  try {
    const data = await getPlayerDetail(params.id);
    const name = toTitleCase(`${data.player.firstName} ${data.player.lastName}`);
    const team = data.currentTeam ? clubName(data.currentTeam.name) : null;
    const title = `${name} | Stick Live`;
    const description = (DESC[locale] ?? DESC['en'])!(name, team);
    return { title, description, alternates, ...socialMeta({ locale, path: `/players/${params.id}`, title: name, description, type: 'profile', dynamicImage: true }) };
  } catch (err) {
    return metadataOnError(err, alternates);
  }
}

export default async function PlayerProfilePage(props: Props) {
  const params = await props.params;
  let data: PlayerDetail;
  try {
    data = await getPlayerDetail(params.id);
  } catch (err) {
    // F1-7: si la ficha se fusionó o la sustituye otra, 308 a esa ficha.
    if (isApiNotFound(err)) {
      await redirectOrNotFound('player', params.id, isSupportedLocale(params.locale) ? params.locale : 'en');
    }
    throw err; // error boundary con reintento — la API puede estar reiniciándose
  }

  const name = toTitleCase(`${data.player.firstName} ${data.player.lastName}`);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    url: `${SITE_URL}/${params.locale}/players/${data.player.id}`,
    ...(data.player.photoUrl ? { image: data.player.photoUrl } : {}),
    ...(data.currentTeam ? {
      memberOf: { '@type': 'SportsTeam', name: clubName(data.currentTeam.name) },
    } : {}),
    jobTitle: 'Roller Hockey Player',
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      <PlayerProfileClient data={data} />
    </>
  );
}

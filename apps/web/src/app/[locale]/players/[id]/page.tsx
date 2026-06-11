import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlayerDetail } from '@/lib/api/client';
import type { PlayerDetail } from '@/lib/api/client';
import { PlayerProfileClient } from '@/components/player/PlayerProfileClient';
import { JsonLd } from '@/components/shared/JsonLd';
import { localeAlternates, isSupportedLocale, SITE_URL } from '@/lib/seo';
import { toTitleCase, clubName } from '@/lib/names';

interface Props {
  params: { locale: string; id: string };
}

const DESC: Record<string, (n: string, t: string | null) => string> = {
  es: (n, t) => `${n}${t ? ` (${t})` : ''}: goles, tarjetas y estadísticas de hockey patines, temporada a temporada, en Stick Live.`,
  en: (n, t) => `${n}${t ? ` (${t})` : ''}: rink hockey goals, cards and season-by-season stats on Stick Live.`,
  pt: (n, t) => `${n}${t ? ` (${t})` : ''}: golos, cartões e estatísticas de hóquei em patins, época a época, no Stick Live.`,
  fr: (n, t) => `${n}${t ? ` (${t})` : ''} : buts, cartons et statistiques de rink hockey, saison par saison, sur Stick Live.`,
  it: (n, t) => `${n}${t ? ` (${t})` : ''}: gol, cartellini e statistiche di hockey su pista, stagione per stagione, su Stick Live.`,
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const alternates = localeAlternates(locale, `/players/${params.id}`);
  try {
    const data = await getPlayerDetail(params.id);
    const name = toTitleCase(`${data.player.firstName} ${data.player.lastName}`);
    const team = data.currentTeam ? clubName(data.currentTeam.name) : null;
    const title = `${name} | Stick Live`;
    const description = (DESC[locale] ?? DESC['en'])!(name, team);
    return { title, description, alternates, openGraph: { title, description, type: 'profile' } };
  } catch {
    return { alternates };
  }
}

export default async function PlayerProfilePage({ params }: Props) {
  let data: PlayerDetail;
  try {
    data = await getPlayerDetail(params.id);
  } catch {
    notFound();
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

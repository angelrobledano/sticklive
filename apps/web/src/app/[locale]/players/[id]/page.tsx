import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlayerDetail } from '@/lib/api/client';
import type { PlayerDetail } from '@/lib/api/client';
import { PlayerProfileClient } from '@/components/player/PlayerProfileClient';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';

interface Props {
  params: { locale: string; id: string };
}

export function generateMetadata({ params }: Props): Metadata {
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return { alternates: localeAlternates(locale, `/players/${params.id}`) };
}

export default async function PlayerProfilePage({ params }: Props) {
  let data: PlayerDetail;
  try {
    data = await getPlayerDetail(params.id);
  } catch {
    notFound();
  }

  return <PlayerProfileClient data={data} />;
}

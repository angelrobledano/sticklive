import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTeamDetail, isApiNotFound } from '@/lib/api/client';
import { TeamCenterClient } from '@/components/team/TeamCenterClient';
import { BackLink } from '@/components/shared/BackLink';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';

interface Props {
  params: { locale: string; id: string };
}

export function generateMetadata({ params }: Props): Metadata {
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return { alternates: localeAlternates(locale, `/teams/${params.id}`) };
}

export default async function TeamDetailPage({ params }: Props) {
  let data;
  try {
    data = await getTeamDetail(params.id);
  } catch (err) {
    if (isApiNotFound(err)) notFound();
    throw err; // error boundary con reintento — no convertir caídas de API en 404
  }

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <BackLink href="/" />

      <TeamCenterClient data={data} />
    </div>
  );
}

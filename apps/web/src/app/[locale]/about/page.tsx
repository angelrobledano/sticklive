import type { Metadata } from 'next';
import { TrustPage, trustMetadata } from '../trust/TrustPage';

interface Props { params: Promise<{ locale: string }> }

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  return trustMetadata(locale, '/about', 'about');
}

export default async function AboutPage(props: Props) {
  const { locale } = await props.params;
  return <TrustPage locale={locale} pageKey="about" />;
}

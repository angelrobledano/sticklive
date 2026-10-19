import type { Metadata } from 'next';
import { localeAlternates, socialMeta, isSupportedLocale, SITE_URL } from '@/lib/seo';
import { JsonLd } from '@/components/shared/JsonLd';
import { trustDict } from './content';
import { TrustPageContent } from './TrustPageContent';

export function trustMetadata(locale: string, path: string, pageKey: 'about' | 'contact' | 'legal'): Metadata {
  const safe = isSupportedLocale(locale) ? locale : 'en';
  const page = trustDict(safe)[pageKey];
  return {
    title: `${page.title} | Stick Live`,
    description: page.description,
    alternates: localeAlternates(safe, path),
    ...socialMeta({ locale: safe, path, title: page.title, description: page.description }),
  };
}

export function TrustPage({ locale, pageKey }: { locale: string; pageKey: 'about' | 'contact' | 'legal' }) {
  const safe = isSupportedLocale(locale) ? locale : 'en';
  const page = trustDict(safe)[pageKey];
  const url = `${SITE_URL}/${safe}/${pageKey}`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': pageKey === 'about' ? 'AboutPage' : pageKey === 'contact' ? 'ContactPage' : 'WebPage',
    name: page.title,
    description: page.description,
    url,
    inLanguage: safe,
    isPartOf: { '@type': 'WebSite', name: 'Stick Live', url: SITE_URL },
  };
  return (
    <>
      <JsonLd data={ld} />
      <TrustPageContent page={page} locale={safe} current={pageKey} />
    </>
  );
}

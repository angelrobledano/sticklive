import type { Metadata } from 'next';
import {
  searchAll,
  isSearchable,
  normalizeSearchQuery,
  type SearchResults,
} from '@/lib/api/search';
import { SearchView } from '@/components/search/SearchView';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';

const TITLES: Record<string, string> = {
  es: 'Buscar · Stick Live',
  en: 'Search · Stick Live',
  pt: 'Pesquisar · Stick Live',
  fr: 'Rechercher · Stick Live',
  it: 'Cerca · Stick Live',
};

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return {
    title: TITLES[locale],
    // La búsqueda es dinámica: no interesa indexar resultados.
    robots: { index: false, follow: false },
    alternates: localeAlternates(locale, '/search'),
  };
}

export default async function SearchPage({
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const sp = await searchParams;
  const query = normalizeSearchQuery(typeof sp.q === 'string' ? sp.q : '');

  let results: SearchResults | null = null;
  let error: string | null = null;

  if (isSearchable(query)) {
    try {
      results = await searchAll(query);
    } catch (err) {
      error = err instanceof Error ? err.message : 'API error';
    }
  }

  return <SearchView initialQuery={query} results={results} error={error} />;
}

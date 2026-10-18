import type { Metadata } from 'next';
import {
  searchAll,
  isSearchable,
  normalizeSearchQuery,
  type SearchResults,
} from '@/lib/api/search';
import { SearchView } from '@/components/search/SearchView';
import { localeAlternates, socialMeta, isSupportedLocale } from '@/lib/seo';

const TITLES: Record<string, string> = {
  es: 'Buscar | Stick Live',
  en: 'Search | Stick Live',
  pt: 'Pesquisar | Stick Live',
  fr: 'Rechercher | Stick Live',
  it: 'Cerca | Stick Live',
};

const DESCRIPTIONS: Record<string, string> = {
  es: 'Busca partidos, equipos, jugadores y competiciones de hockey patines en Stick Live.',
  en: 'Search rink hockey matches, teams, players and competitions on Stick Live.',
  pt: 'Pesquisa jogos, equipas, jogadores e competições de hóquei em patins no Stick Live.',
  fr: 'Recherchez des matchs, équipes, joueurs et compétitions de rink hockey sur Stick Live.',
  it: 'Cerca partite, squadre, giocatori e competizioni di hockey su pista su Stick Live.',
};

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const description = DESCRIPTIONS[locale] ?? DESCRIPTIONS['en']!;
  return {
    title: TITLES[locale],
    description,
    // La búsqueda es dinámica: no interesa indexar resultados.
    robots: { index: false, follow: false },
    alternates: localeAlternates(locale, '/search'),
    // F3-7: og:url propio; antes heredaba el de la home (SEO-05).
    ...socialMeta({
      locale,
      path: '/search',
      title: (TITLES[locale] ?? TITLES['en']!).replace(' | Stick Live', ''),
      description,
    }),
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
      console.error('[search] searchAll falló:', err);
      error = 'search_failed';
    }
  }

  return <SearchView initialQuery={query} results={results} error={error} />;
}

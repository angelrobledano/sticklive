import type { Metadata } from 'next';
import { getCurrentMatches } from '@/lib/api/client';
import { MatchesView } from '@/components/shared/MatchesView';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return { alternates: localeAlternates(locale, '/') };
}

export default async function HomePage() {
  let matches: Awaited<ReturnType<typeof getCurrentMatches>> = [];
  let fetchError: string | null = null;

  try {
    matches = await getCurrentMatches();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Error al conectar con la API';
  }

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20
                        flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
               className="w-6 h-6 text-rink-passion">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          No hemos podido cargar los partidos
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Inténtalo de nuevo en unos segundos.
        </p>
      </div>
    );
  }

  return <MatchesView matches={matches} />;
}

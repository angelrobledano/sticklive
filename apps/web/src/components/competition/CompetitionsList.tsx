'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { CompetitionSummary } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { clubName } from '@/lib/names';

/** Normaliza para búsqueda: minúsculas y sin acentos */
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Nombre del país en el idioma activo (Intl, sin tablas a mano) */
function countryName(code: string | null, locale: string): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Código ISO 2 letras → emoji de bandera */
function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return '';
  const base = 0x1F1E6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(
    base + code.toUpperCase().charCodeAt(0),
    base + code.toUpperCase().charCodeAt(1)
  );
}

/** Top 5 del hockey patines mundial — sus países van siempre primero */
const COUNTRY_PRIORITY = ['ES', 'PT', 'IT', 'FR', 'AR'];
const OTHER_KEY = '__other';

function groupByCountry(
  competitions: CompetitionSummary[],
  locale: string
): Array<[string, CompetitionSummary[]]> {
  const groups = new Map<string, CompetitionSummary[]>();
  for (const comp of competitions) {
    const key = comp.country?.toUpperCase() ?? OTHER_KEY;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(comp);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    const ia = COUNTRY_PRIORITY.indexOf(a);
    const ib = COUNTRY_PRIORITY.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    }
    if (a === OTHER_KEY) return 1;
    if (b === OTHER_KEY) return -1;
    return (countryName(a, locale) ?? a).localeCompare(countryName(b, locale) ?? b, locale);
  });
}

function CompetitionCard({ comp }: { comp: CompetitionSummary }) {
  const { t } = useT();
  return (
    <Link
      href={`/competitions/${comp.id}`}
      className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow block"
    >
      <div className="w-11 h-11 rounded-xl bg-rink-passion/10 border border-rink-passion/20
                      flex items-center justify-center shrink-0">
        <span className="text-sm font-black text-rink-passion">
          {(comp.shortName ?? comp.name).slice(0, 2).toUpperCase()}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
          {clubName(comp.name)}
        </p>
        {comp.gender && (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {comp.gender === 'male' ? t('common.male') : comp.gender === 'female' ? t('common.female') : null}
          </p>
        )}
      </div>

      <div className="text-right shrink-0">
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
          {comp.season?.teamCount ?? 0} {t('common.teams_lc')}
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {comp.season?.matchCount ?? 0} {t('common.matches_lc')}
        </p>
      </div>

      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
           className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0">
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

export function CompetitionsList({ competitions, error }: {
  competitions: CompetitionSummary[];
  error: string | null;
}) {
  const { t, locale } = useT();
  const [query, setQuery] = useState('');
  // Filtro de categoría de edad — senior por defecto: es lo que busca el
  // 90% de visitantes; la cantera queda a un toque de chip o de buscador.
  const [ageFilter, setAgeFilter] = useState<string>('senior');

  // Categorías presentes en los datos, en orden de edad descendente
  const AGE_ORDER = ['senior', 'juvenil', 'junior', 'infantil', 'alevin', 'benjamin', 'prebenjamin', 'veteranos', 'base'];
  const availableAges = useMemo(() => {
    const present = new Set(competitions.map((c) => c.ageCategory ?? 'senior'));
    return AGE_ORDER.filter((a) => present.has(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitions]);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    // El buscador ignora el filtro de edad: si escribes, buscas en todo
    if (q) {
      return competitions.filter((c) =>
        norm(c.name).includes(q) ||
        norm(c.shortName ?? '').includes(q) ||
        norm(countryName(c.country, locale) ?? '').includes(q)
      );
    }
    return competitions.filter((c) => (c.ageCategory ?? 'senior') === ageFilter);
  }, [competitions, query, locale, ageFilter]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center gap-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('standings.no_data')}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 font-mono">{error}</p>
      </div>
    );
  }

  const groups = groupByCountry(filtered, locale);

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t('navigation.competitions')}</h1>

      {/* Buscador */}
      <div className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('common.search_competitions')}
          aria-label={t('common.search_competitions')}
          className="w-full min-h-[44px] pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700
                     bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                     placeholder:text-slate-400 dark:placeholder:text-slate-500
                     focus:outline-none focus:ring-2 focus:ring-rink-passion/40"
        />
      </div>

      {/* Chips de categoría de edad (ocultos mientras se busca) */}
      {!query.trim() && availableAges.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          {availableAges.map((age) => (
            <button
              key={age}
              onClick={() => setAgeFilter(age)}
              className={`px-3.5 py-1.5 min-h-[36px] rounded-full text-xs font-semibold whitespace-nowrap transition-colors shrink-0 ${
                ageFilter === age
                  ? 'bg-rink-passion text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {t(`age_categories.${age}`)}
            </button>
          ))}
        </div>
      )}

      {groups.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">
          {t('common.no_search_results')}
        </p>
      )}

      {groups.map(([code, comps]) => {
        // Dentro del país: nacional (RFEP) primero, luego cada federación
        // autonómica como subsección con su región.
        const national = comps.filter((c) => c.scope !== 'regional');
        const regionals = new Map<string, CompetitionSummary[]>();
        for (const c of comps.filter((c) => c.scope === 'regional')) {
          const key = c.region ?? c.organizer;
          if (!regionals.has(key)) regionals.set(key, []);
          regionals.get(key)!.push(c);
        }

        return (
          <section key={code} className="space-y-2">
            {/* Cabecera de país */}
            <div className="flex items-center gap-2 px-1">
              {code !== OTHER_KEY && <span className="text-base leading-none">{countryFlag(code)}</span>}
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                {code === OTHER_KEY ? t('common.other_competitions') : countryName(code, locale)}
              </h2>
            </div>
            <div className="space-y-3">
              {national.map((comp) => <CompetitionCard key={comp.id} comp={comp} />)}
            </div>
            {Array.from(regionals.entries()).sort(([a], [b]) => a.localeCompare(b, locale)).map(([region, regionComps]) => (
              <div key={region} className="space-y-2 pt-2">
                <h3 className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-600">
                  {region} · {regionComps.length}
                </h3>
                <div className="space-y-3">
                  {regionComps.map((comp) => <CompetitionCard key={comp.id} comp={comp} />)}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

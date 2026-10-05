'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { SeasonMatch } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { gameWinnerId } from '@/lib/playoff';
import { TrophyIcon } from '@/components/match/icons';
import { KnockoutMatchCard } from './KnockoutBracket';

/**
 * Cuadro de un torneo FINAL FOUR (formato Supercopa): dos semifinales a partido
 * único el sábado y la final el domingo. NO es una liga (no hay jornadas) ni una
 * eliminatoria de ida/vuelta (cada cruce se juega una vez).
 *
 * Se compone en vertical (semis → final → campeón) para leerse de arriba abajo
 * en móvil sin scroll horizontal: cada semifinal alimenta la final. La fase se
 * agrupa por el nombre de ronda de la fuente y, si no lo trae, por la numeración
 * canónica de la Final Four (semis=1, final=2) o por el tamaño de la ronda.
 */

type Bucket = 'semis' | 'final' | 'third';

/** Fase deducida SOLO del nombre de ronda (null si la fuente no da pista). */
function phaseOfName(name: string | null): Bucket | null {
  const n = (name ?? '').toLowerCase();
  if (/semi/.test(n)) return 'semis';
  if (/3.*4|tercer|bronce|small\s*final|3º|3rd|third/.test(n)) return 'third';
  if (/final/.test(n)) return 'final';
  return null;
}

function sortByDate(a: SeasonMatch, b: SeasonMatch): number {
  return (a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1;
}

export function FinalFourBracket({ matches }: { matches: SeasonMatch[] }) {
  const { t } = useT();

  const { semis, final, third } = useMemo(() => {
    // Preferimos los partidos con fase real; si el scrape aún no creó rondas
    // (todo 'regular'), usamos el set completo para no quedarnos en blanco.
    const playoff = matches.filter((m) => m.roundType === 'playoff');
    const pool = playoff.length > 0 ? playoff : matches;

    // Agrupamos por ronda (id o nombre) y clasificamos cada grupo una sola vez.
    const groups = new Map<string, SeasonMatch[]>();
    for (const m of pool) {
      const key = m.roundId ?? m.roundName ?? `rn:${m.roundNumber ?? 'null'}`;
      const g = groups.get(key);
      if (g) g.push(m);
      else groups.set(key, [m]);
    }

    const out: Record<Bucket, SeasonMatch[]> = { semis: [], final: [], third: [] };
    for (const group of groups.values()) {
      const first = group[0]!;
      let bucket = phaseOfName(first.roundName);
      if (!bucket) {
        if (first.roundNumber === 1) bucket = 'semis';
        else if (first.roundNumber === 2) bucket = 'final';
        else bucket = group.length >= 2 ? 'semis' : 'final';
      }
      out[bucket].push(...group);
    }
    return {
      semis: out.semis.sort(sortByDate),
      final: out.final.sort(sortByDate),
      third: out.third.sort(sortByDate),
    };
  }, [matches]);

  // Campeón: la final ya terminada y con ganador claro (penaltis/prórroga
  // mandan sobre el marcador). Una final en juego NO corona a nadie todavía.
  const finalMatch = final[0] ?? null;
  const championTeam = useMemo(() => {
    if (!finalMatch || finalMatch.status !== 'finished') return null;
    const winnerId = gameWinnerId(finalMatch);
    if (!winnerId) return null;
    return winnerId === finalMatch.homeTeam.id ? finalMatch.homeTeam : finalMatch.awayTeam;
  }, [finalMatch]);

  if (semis.length === 0 && final.length === 0) return null;

  const phaseHeading = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1';

  return (
    <div className="space-y-2">
      {semis.length > 0 && (
        <section aria-label={t('playoffs.semis')} className="space-y-2">
          <h3 className={phaseHeading}>{t('playoffs.semis')}</h3>
          <div className="space-y-2">
            {semis.map((m) => <KnockoutMatchCard key={m.id} m={m} />)}
          </div>
        </section>
      )}

      {/* Conector semis → final: el flujo del cuadro, sin decoración. */}
      {semis.length > 0 && final.length > 0 && (
        <div className="flex justify-center" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
               className="w-4 h-4 text-slate-300 dark:text-slate-600">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {final.length > 0 && (
        <section aria-label={t('playoffs.final')} className="space-y-2">
          <h3 className={phaseHeading}>{t('playoffs.final')}</h3>
          <div className="space-y-2">
            {final.map((m) => <KnockoutMatchCard key={m.id} m={m} />)}
          </div>

          {championTeam && (
            <Link
              href={`/teams/${championTeam.id}`}
              className="flex items-center gap-2 rounded-lg bg-rink-passion px-3 py-2 text-white
                         transition-colors hover:bg-rink-passion-light"
            >
              <TrophyIcon className="w-4 h-4 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                {t('playoffs.champion')}
              </span>
              <span className="flex-1 truncate text-right text-sm font-bold">{championTeam.name}</span>
            </Link>
          )}
        </section>
      )}

      {third.length > 0 && (
        <section aria-label={t('playoffs.third_place')} className="space-y-2">
          <h3 className={phaseHeading}>{t('playoffs.third_place')}</h3>
          <div className="space-y-2">
            {third.map((m) => <KnockoutMatchCard key={m.id} m={m} />)}
          </div>
        </section>
      )}
    </div>
  );
}

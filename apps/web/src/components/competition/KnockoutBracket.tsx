'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { SeasonMatch } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { TeamName as AdaptiveTeamName } from '@/components/shared/TeamName';
import { fmtDate, fmtTime } from './format';

/**
 * Cuadro de eliminatorias a partido único (formato World Skate: Cuartos →
 * Semis → Final, más 3º y 4º puesto). Distinto del playoff al mejor de N de
 * OK Liga: aquí cada cruce es un solo partido y las fases vienen con nombre
 * propio de la fuente (no la numeración 1/2/3 derivada).
 *
 * Se agrupa por nombre de ronda y se ordena por fase. Las columnas hacen
 * scroll horizontal en móvil.
 */

/** Rango de fase para ordenar las columnas (menor = antes). */
function phaseRank(name: string | null, roundNumber: number | null): number {
  const n = (name ?? '').toLowerCase();
  if (/cuartos|quarter/.test(n)) return 1;
  if (/semi/.test(n)) return 2;
  if (/3.*4|tercer|bronce|small\s*final|3º/.test(n)) return 4; // 3º y 4º puesto → tras la final
  if (/final/.test(n)) return 3;
  return 10 + (roundNumber ?? 0); // desconocidas, al final por número
}

function MatchCard({ m }: { m: SeasonMatch }) {
  const isFinished = m.status === 'finished';
  const isLive = m.status === 'live';
  const showScore = isFinished || isLive;

  const winnerId =
    m.winnerTeamId ??
    (m.score.home != null && m.score.away != null && m.score.home !== m.score.away
      ? (m.score.home > m.score.away ? m.homeTeam.id : m.awayTeam.id)
      : null);

  const sides = [
    { team: m.homeTeam, score: m.score.home },
    { team: m.awayTeam, score: m.score.away },
  ];

  return (
    <Link
      href={`/matches/${m.id}`}
      className={`block card overflow-hidden border transition-opacity hover:opacity-90
        ${isLive ? 'border-emerald-400/40' : 'border-slate-200 dark:border-slate-800'}`}
    >
      {sides.map(({ team, score }, idx) => {
        const isWinner = showScore && winnerId === team.id;
        return (
          <div
            key={idx}
            className={`flex items-center gap-2 px-2.5 py-2 ${idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''}
                        ${!showScore ? 'opacity-70' : ''}`}
          >
            <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={22} />
            <span className={`flex-1 text-[13px] truncate ${isWinner ? 'font-bold text-slate-900 dark:text-slate-50' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
              <AdaptiveTeamName name={team.name} shortName={team.shortName} mobile="abbr" />
            </span>
            {showScore && score != null && (
              <span className="font-score text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">{score}</span>
            )}
          </div>
        );
      })}
      <div className="px-2.5 pb-1.5 pt-1">
        <span className={`text-[9px] font-bold uppercase tracking-wider ${isLive ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`}>
          {isLive ? '🟢 Live'
            : isFinished ? `Final · ${fmtDate(m.finishedAt ?? m.scheduledAt)}`
            : `${fmtDate(m.scheduledAt)} · ${fmtTime(m.scheduledAt)}`}
        </span>
      </div>
    </Link>
  );
}

export function KnockoutBracket({ matches }: { matches: SeasonMatch[] }) {
  const columns = useMemo(() => {
    const ko = matches.filter((m) => m.roundType === 'playoff');
    const map = new Map<string, SeasonMatch[]>();
    for (const m of ko) {
      const key = m.roundName ?? `Ronda ${m.roundNumber ?? ''}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return [...map.entries()]
      .map(([name, ms]) => ({
        name,
        rank: phaseRank(name, ms[0]?.roundNumber ?? null),
        matches: ms.sort((a, b) => ((a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1)),
      }))
      .sort((a, b) => a.rank - b.rank);
  }, [matches]);

  if (columns.length === 0) return null;

  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-1">
      <div className="flex gap-3 min-w-min">
        {columns.map((col) => (
          <div key={col.name} className="flex flex-col gap-3 min-w-[220px] flex-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
              {col.name}
            </h3>
            <div className="flex flex-col gap-3 justify-around h-full">
              {col.matches.map((m) => <MatchCard key={m.id} m={m} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

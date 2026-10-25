'use client';

import { useViewerTz } from '@/hooks/useViewerTz';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useMemo } from 'react';
import type { SeasonMatch, SeasonRound } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { buildBracketRounds, type BracketRound } from '@/lib/bracket';
import { TeamShield } from '@/components/shared/TeamShield';
import { TeamName as AdaptiveTeamName } from '@/components/shared/TeamName';
import { fmtDate, fmtTime } from './format';
import { gameWinnerId } from '@/lib/playoff';
import { ChampionBlock } from './ChampionBlock';

/**
 * Cuadro de eliminatorias a partido único (formato World Skate: Cuartos → Semis
 * → Final, más 3º y 4º puesto) y de las copas con la fase mal etiquetada por la
 * fuente (Copa del Rey: todo "FINAL"). Las rondas se derivan en `lib/bracket`
 * (por nombre de fase o por el grafo de avance).
 *
 * Columnas con conectores (el ganador de cada cruce alimenta el siguiente) en
 * todos los anchos. En móvil, scroll lateral si las rondas no caben. Comparte el lenguaje visual del cuadro de Final Four.
 */

/** Tarjeta de un partido a partido único (bracket/copa/final four). */
export function KnockoutMatchCard({ m, label, showFinishedLabel = true, highlight = false }: {
  m: SeasonMatch;
  label?: string;
  showFinishedLabel?: boolean;
  /** Borde de acento (la final del cuadro). */
  highlight?: boolean;
}) {
  const { t, locale } = useT();
  const viewerTz = useViewerTz();
  const isFinished = m.status === 'finished';
  const isLive = m.status === 'live';
  const showScore = isFinished || isLive;

  // Ganador: el guardado o, si falta, el marcador o la tanda decidida.
  const winnerId = isFinished ? gameWinnerId(m) : null;
  // Cómo se decidió, visible también en el cuadro (que omite "Final").
  const decided = isFinished && (m.winType === 'penalties' || m.winType === 'overtime') ? m.winType : null;

  // Tanda de penaltis: se pinta junto al marcador para que un empate se
  // explique solo (quién pasó y cómo).
  const pens = isFinished && m.penalties?.home != null && m.penalties?.away != null ? m.penalties : null;

  const sides = [
    { team: m.homeTeam, score: m.score.home, pen: pens?.home ?? null, side: 'home' },
    { team: m.awayTeam, score: m.score.away, pen: pens?.away ?? null, side: 'away' },
  ];

  return (
    <Link
      href={`/matches/${m.id}`}
      className={`block card overflow-hidden border transition-opacity hover:opacity-90
        ${isLive ? 'border-emerald-400/40' : highlight ? 'border-rink-passion/50 ring-1 ring-rink-passion/20' : 'border-slate-200 dark:border-slate-800'}`}
    >
      {label && (
        <p className="px-2.5 pt-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {label}
        </p>
      )}
      {sides.map(({ team, score, pen, side }, idx) => {
        // Con ganador, el perdedor se atenúa (nombre, escudo y marcador): el
        // que pasa se lee de un vistazo, sin depender solo de la negrita.
        const result = winnerId == null ? undefined : winnerId === team.id ? 'win' : 'loss';
        const isWinner = result === 'win';
        return (
          <div
            key={idx}
            data-side={side}
            data-result={result}
            className={`flex items-center gap-2 px-2.5 py-2 ${idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''}
                        ${!showScore ? 'opacity-70' : result === 'loss' ? 'opacity-55' : ''}`}
          >
            <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={22} />
            <span className={`flex-1 text-[13px] truncate ${isWinner ? 'font-bold text-slate-900 dark:text-slate-50' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
              <AdaptiveTeamName name={team.name} shortName={team.shortName} mobile="abbr" />
            </span>
            {pen != null && (
              <span data-pen={side} className="font-score text-[11px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">({pen})</span>
            )}
            {showScore && score != null && (
              <span className={`font-score text-sm tabular-nums ${result === 'loss' ? 'font-medium text-slate-600 dark:text-slate-400' : 'font-bold text-slate-900 dark:text-slate-50'}`}>{score}</span>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pb-1.5 pt-1">
        {decided && (
          <span
            data-decided={decided}
            className="rounded bg-rink-passion/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rink-passion dark:bg-rink-passion/20 dark:text-rink-accent"
          >{t(decided === 'penalties' ? 'match_states.penalties_label' : 'match_states.overtime')}</span>
        )}
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isLive ? 'text-emerald-500' : 'text-slate-500 dark:text-slate-400'}`}>
          {isLive ? `🟢 ${t('playoffs.live')}`
            : isFinished
              ? `${showFinishedLabel ? `${t('match_states.final')} · ` : ''}${fmtDate(m.scheduledAt ?? m.finishedAt, viewerTz, locale)}`
              : `${fmtDate(m.scheduledAt, viewerTz, locale)} · ${fmtTime(m.scheduledAt, viewerTz, locale)}`}
        </span>
      </div>
    </Link>
  );
}

/** Campeón: el ganador de la final, si ya está decidida. */
function championOf(m: SeasonMatch): SeasonMatch['homeTeam'] | null {
  if (m.status !== 'finished') return null;
  const id = gameWinnerId(m);
  return id === m.homeTeam.id ? m.homeTeam : id === m.awayTeam.id ? m.awayTeam : null;
}

const HEADING = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1';

/** ¿Las rondas forman un cuadro binario limpio (4→2→1, 2→1, 8→4→2→1…)? */
function isBinaryBracket(rounds: BracketRound[]): boolean {
  const base = rounds[0]?.matches.length ?? 0;
  if (base < 2 || (base & (base - 1)) !== 0) return false; // potencia de 2
  return rounds.every((r, i) => r.matches.length === base / 2 ** i);
}

export function KnockoutBracket({ rounds = [], matches }: { rounds?: SeasonRound[]; matches: SeasonMatch[] }) {
  const { t } = useT();
  const bracketRounds = useMemo(() => buildBracketRounds(matches), [matches]);

  const third = bracketRounds.find((r) => r.key === 'third_place');
  const bracket = useMemo(
    () => bracketRounds.filter((r) => r.key !== 'third_place' && r.matches.length > 0),
    [bracketRounds],
  );

  // Fases DECLARADAS por la fuente (rounds) que aún no tienen partidos: los
  // cruces de la fase final se publican cuando cierran los grupos (WSG). Se
  // muestran como estructura "por determinar" para que la competición no
  // parezca una liga sin fase final (excluidas las que ya tienen partidos).
  const pending = useMemo(
    () => (rounds ?? [])
      .filter((r) => r.roundType === 'playoff' && !bracketRounds.some((b) => b.matches.some((m) => m.roundId === r.id)))
      .sort((a, b) => a.number - b.number),
    [rounds, bracketRounds],
  );

  if (bracket.length === 0 && !third && pending.length === 0) return null;

  const labelOf = (r: BracketRound, i: number) =>
    r.key ? t(`playoffs.${r.key}`) : (r.name ?? t('playoffs.round_n', { n: r.roundNumber ?? i + 1 }));

  const pendingBlock = pending.length > 0 ? (
    <div className="space-y-2">
      <h3 className={HEADING}>{t('playoffs.tbd')}</h3>
      <div className="space-y-1.5">
        {pending.map((r) => (
          <div
            key={r.id}
            className="card flex items-center justify-between px-3 py-2 border border-dashed border-slate-200 dark:border-slate-800"
          >
            <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
              {r.stage && r.stage !== 'placement' ? t(`playoffs.${r.stage}`) : r.name}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('playoffs.tbd')}
            </span>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const thirdBlock = third && third.matches.length > 0 ? (
    <div className="mx-auto w-full max-w-xs space-y-2">
      <h3 className={HEADING}>{t('playoffs.third_place')}</h3>
      {third.matches.map((m) => <KnockoutMatchCard key={m.id} m={m} showFinishedLabel={false} />)}
    </div>
  ) : null;

  // Una sola ronda (p. ej. una eliminatoria de ida/vuelta) o estructura no
  // binaria: lista simple etiquetada, sin inventar un cuadro.
  if (bracket.length < 2 || !isBinaryBracket(bracket)) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4">
        {bracket.map((r, i) => (
          <section key={i} className="space-y-2">
            {(r.key || r.name) && <h3 className={HEADING}>{labelOf(r, i)}</h3>}
            <div className="space-y-2">
              {r.matches.map((m) => <KnockoutMatchCard key={m.id} m={m} showFinishedLabel={false} highlight={r.key === 'final'} />)}
            </div>
            {r.key === 'final' && r.matches.length === 1 && (() => {
              const champion = championOf(r.matches[0]!);
              return champion ? <div className="mx-auto max-w-xs pt-1"><ChampionBlock team={champion} /></div> : null;
            })()}
          </section>
        ))}
        {thirdBlock}
        {pendingBlock}
      </div>
    );
  }

  const base = bracket[0]!.matches.length;
  const columns: string[] = [];
  bracket.forEach((_, i) => { if (i > 0) columns.push('20px'); columns.push('minmax(150px,1fr)'); });

  const lastRound = bracket[bracket.length - 1]!;
  const champion = lastRound.matches.length === 1 ? championOf(lastRound.matches[0]!) : null;

  return (
    <div className="space-y-3">
      {champion && <div className="md:hidden"><ChampionBlock team={champion} variant="row" /></div>}
      {/* Cuadro horizontal con conectores en todos los anchos (como la app
          de FotMob): en móvil, columnas de ancho mínimo y scroll lateral si no
          caben, en vez de rondas apiladas que se leían como una lista. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-auto md:w-full md:max-w-3xl md:overflow-visible md:px-0"
           data-bracket="tree">
        <div
          className="grid min-w-max md:min-w-0"
          style={{ gridTemplateColumns: columns.join(' '), gridTemplateRows: `auto repeat(${base}, minmax(0, 1fr))` }}
        >
          {/* Cabecera de cada ronda encima de su columna */}
          {bracket.map((r, ri) => (
            <h3 key={`h${ri}`} className={HEADING} style={{ gridColumn: ri * 2 + 1, gridRow: 1 }}>
              {labelOf(r, ri)}
            </h3>
          ))}

          {bracket.map((r, ri) => {
            const span = base / r.matches.length;
            const isFinal = ri === bracket.length - 1 && r.matches.length === 1;
            return r.matches.map((m, j) => {
              const champion = isFinal ? championOf(m) : null;
              return (
                <div
                  key={m.id}
                  className="relative flex items-center py-1.5"
                  style={{ gridColumn: ri * 2 + 1, gridRow: `${2 + j * span} / span ${span}` }}
                >
                  <div className="w-full">
                    <KnockoutMatchCard m={m} showFinishedLabel={false} highlight={isFinal} />
                  </div>
                  {/* Campeón colgado bajo la final, sin mover la tarjeta del
                      centro (los conectores apuntan a su mitad). */}
                  {champion && (
                    <div className="absolute inset-x-0 top-1/2 pt-[4.75rem]">
                      <ChampionBlock team={champion} />
                    </div>
                  )}
                </div>
              );
            });
          })}

          {bracket.slice(0, -1).map((r, ri) => {
            const children = r.matches.length;
            const parents = bracket[ri + 1]!.matches.length;
            const d: string[] = [];
            for (let p = 0; p < parents; p++) {
              const yP = (((p + 0.5) / parents) * 100).toFixed(2);
              for (const c of [2 * p, 2 * p + 1]) {
                if (c >= children) continue;
                d.push(`M0 ${(((c + 0.5) / children) * 100).toFixed(2)} H20 V${yP}`);
              }
              d.push(`M20 ${yP} H40`);
            }
            return (
              <svg
                key={`c${ri}`}
                viewBox="0 0 40 100"
                preserveAspectRatio="none"
                aria-hidden="true"
                className="h-full w-full text-slate-300 dark:text-slate-700"
                style={{ gridColumn: ri * 2 + 2, gridRow: `2 / span ${base}` }}
              >
                <path
                  d={d.join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            );
          })}
        </div>
      </div>

      {thirdBlock}
      {pendingBlock}
    </div>
  );
}

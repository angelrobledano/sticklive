'use client';

import { useMemo } from 'react';
import type { SeasonMatch, TeamSummary } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { gameWinnerId } from '@sports/core/playoff';
import { TeamShield } from '@/components/shared/TeamShield';
import { TeamName } from '@/components/shared/TeamName';
import { KnockoutMatchCard } from './KnockoutBracket';
import { ChampionBlock } from './ChampionBlock';

/**
 * Cuadro de un torneo FINAL FOUR (formato Supercopa): dos semifinales a partido
 * único y la final. NO es una liga (no hay jornadas) ni una eliminatoria de
 * ida/vuelta (cada cruce se juega una vez).
 *
 * Se compone como un CUADRO centrado: las dos semifinales a la izquierda, con
 * conectores que convergen en la final (centrada verticalmente a la derecha), y
 * el trofeo/campeón bajo la final cuando la final ya está resuelta. El 3er y 4º
 * puesto, si la fuente lo trae, va bajo el cuadro. Todo cabe en un móvil sin
 * scroll horizontal.
 *
 * La fase es la EXPLÍCITA de la fuente (`stage`). En temporadas heredadas sin
 * ella, se agrupa por el nombre de ronda y, si no lo trae, por la numeración
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

/** Fase EXPLÍCITA de la fuente (`stage`), si viene. */
function phaseOfStage(stage: string | null | undefined): Bucket | null {
  if (stage === 'semis') return 'semis';
  if (stage === 'final') return 'final';
  if (stage === 'third_place') return 'third';
  return null;
}

function sortByDate(a: SeasonMatch, b: SeasonMatch): number {
  return (a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1;
}

/** Ganador de un partido ya terminado (penaltis/prórroga mandan); null si no lo hay. */
function winnerOf(m: SeasonMatch | null): TeamSummary | null {
  if (!m || m.status !== 'finished') return null;
  const id = gameWinnerId(m);
  return id === m.homeTeam.id ? m.homeTeam : id === m.awayTeam.id ? m.awayTeam : null;
}

const LABEL_CLS = 'px-2.5 pt-1.5 text-[10px] font-bold uppercase tracking-widest';

/** Tarjeta de un cruce cuyos equipos aún no se conocen (fase por determinar). */
function PendingCard({ label, teams }: { label: string; teams: (TeamSummary | null)[] }) {
  const { t } = useT();
  return (
    <div className="card overflow-hidden border border-dashed border-slate-200 dark:border-slate-700">
      <p className={`${LABEL_CLS} text-slate-500 dark:text-slate-400`}>{label}</p>
      {[0, 1].map((i) => {
        const tm = teams[i] ?? null;
        return (
          <div
            key={i}
            className={`flex items-center gap-2 px-2.5 py-2 ${i === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}
          >
            {tm ? (
              <>
                <TeamShield teamId={tm.id} teamName={tm.shortName ?? tm.name} size={22} />
                <span className="flex-1 truncate text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  <TeamName name={tm.name} shortName={tm.shortName} mobile="abbr" />
                </span>
              </>
            ) : (
              <>
                <span
                  className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-slate-200 dark:border-slate-700"
                  aria-hidden="true"
                />
                <span className="flex-1 truncate text-[13px] italic text-slate-500 dark:text-slate-400">
                  {t('playoffs.tbd')}
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
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
      // Fase explícita que no es del cuadro (colocación): fuera, sin adivinar.
      if (first.stage && !phaseOfStage(first.stage)) continue;
      let bucket = phaseOfStage(first.stage) ?? phaseOfName(first.roundName);
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

  const finalMatch = final[0] ?? null;
  // Campeón: la final ya terminada y con ganador claro (penaltis/prórroga mandan
  // sobre el marcador). Una final en juego NO corona a nadie todavía.
  const championTeam = useMemo(() => winnerOf(finalMatch), [finalMatch]);

  if (semis.length === 0 && final.length === 0) return null;

  // Una Final Four tiene dos semifinales; si el scrape aún no trae una, su hueco
  // se dibuja como "por determinar" para que el cuadro no se rompa.
  const semiSlots: (SeasonMatch | null)[] = [semis[0] ?? null, semis[1] ?? null];
  const n = semiSlots.length;
  // Finalistas proyectados mientras la final no existe: ganadores de las semis.
  const projected = [winnerOf(semiSlots[0]), winnerOf(semiSlots[1])];

  // Centro vertical (%) de cada semifinal dentro del cuadro: con 2 semis quedan
  // al 25% y 75%, y la final al 50% — las líneas casan con esos centros.
  const centers = semiSlots.map((_, i) => (((i + 0.5) / n) * 100).toFixed(2));
  const connector = `${centers.map((y) => `M0 ${y} H20 V50`).join(' ')} M20 50 H40`;

  return (
    <div className="mx-auto w-full max-w-xl space-y-3">
      <div
        className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)]"
        style={{ gridTemplateRows: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {/* Semifinales (izquierda), centradas cada una en su fila */}
        {semiSlots.map((m, i) => (
          <div
            key={i}
            className="col-start-1 flex items-center py-1.5"
            style={{ gridRow: i + 1 }}
          >
            <div className="w-full">
              {m ? (
                <KnockoutMatchCard m={m} label={t('playoffs.semifinal_n', { n: i + 1 })} showFinishedLabel={false} />
              ) : (
                <PendingCard label={t('playoffs.semifinal_n', { n: i + 1 })} teams={[null, null]} />
              )}
            </div>
          </div>
        ))}

        {/* Conectores semis → final (trazos SVG, no decoración) */}
        <svg
          viewBox="0 0 40 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="col-start-2 row-span-full h-full w-full text-slate-300 dark:text-slate-700"
        >
          <path
            d={connector}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Final (derecha), centrada; el campeón se cuelga debajo al decidirse */}
        <div className="col-start-3 row-span-full grid grid-rows-[1fr_auto_1fr] pl-1">
          <div aria-hidden="true" />
          <div className="w-full">
            {finalMatch ? (
              <KnockoutMatchCard m={finalMatch} label={t('playoffs.final')} showFinishedLabel={false} />
            ) : (
              <PendingCard label={t('playoffs.final')} teams={projected} />
            )}
          </div>
          <div className="flex justify-center pt-2">
            {championTeam && <ChampionBlock team={championTeam} />}
          </div>
        </div>
      </div>

      {/* 3er y 4º puesto: solo si la fuente trae ese cruce */}
      {third.length > 0 && (
        <div className="mx-auto w-full max-w-xs">
          <KnockoutMatchCard m={third[0]!} label={t('playoffs.third_place')} showFinishedLabel={false} />
        </div>
      )}
    </div>
  );
}

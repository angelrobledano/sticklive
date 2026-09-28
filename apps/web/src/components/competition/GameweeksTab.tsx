'use client';

import { useMemo, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import type { SeasonMatch, SeasonRound, TeamSummary } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { AdBanner } from '@/components/shared/AdBanner';
import { adsenseConfig, listAdInsertIndex } from '@/lib/ads';
import { clubName } from '@/lib/names';
import { tt } from '@/components/search/translate';
import { fmtTime, madridDay, dayPillLabel, roundLabel } from './format';
import { dayDiff, madridTodayKey } from '@/lib/match-time';

/** Config AdSense (env inyectado en build). */
const ADS = adsenseConfig();

/** Sentinela interna para partidos sin fecha (no se traduce en el agrupado). */
const NO_DATE = '__nodate__';

/**
 * #157: filtro inicial de la pestaña Jornadas. El defecto anterior era la
 * última jornada jugada (o la primera ronda), pero una competición que aún no
 * ha empezado y no trae `rounds`/`roundNumber` (OK Liga 26/27: 182 partidos, la
 * primera jornada el 31/10) se quedaba con la lista vacía. Elegimos el DÍA MÁS
 * CERCANO con partidos (mismo patrón que la home): si el partido elegido tiene
 * jornada, activamos esa jornada; si no, esa fecha. A igual distancia gana el
 * futuro (la próxima jornada con contenido). Función pura, testeable sin
 * navegador.
 */
export type DefaultFilter =
  | { journey: number; date: null }
  | { journey: null; date: string };

export function pickDefaultFilter(
  rounds: SeasonRound[],
  matches: SeasonMatch[],
  todayKey: string,
): DefaultFilter {
  let bestDay: string | null = null;
  let bestJourney: number | null = null;
  let bestRank = Infinity;
  for (const m of matches) {
    const day = madridDay(m.scheduledAt, m.competitionTimezone);
    if (!day) continue;
    const diff = dayDiff(day, todayKey);
    // Distancia absoluta; en empate, el futuro (diff ≥ 0) va antes (rank menor).
    const rank = Math.abs(diff) * 2 + (diff < 0 ? 1 : 0);
    if (rank < bestRank) {
      bestRank = rank;
      bestDay = day;
      bestJourney = m.roundNumber;
    }
  }
  if (bestDay != null) {
    if (bestJourney != null) return { journey: bestJourney, date: null };
    return { journey: null, date: bestDay };
  }
  // Sin fechas: primera jornada CON partidos; si no la hay, la primera ronda.
  const withMatches = rounds.find((r) => matches.some((m) => m.roundNumber === r.number));
  return { journey: withMatches?.number ?? rounds[0]?.number ?? 1, date: null };
}

function MatchCard({ match }: { match: SeasonMatch }) {
  const { t, locale } = useT();
  const isLive     = match.status === 'live';
  const isFinished = match.status === 'finished';
  const showScore  = isLive || isFinished;
  const ht = match.homeTeam;
  const at = match.awayTeam;

  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
    >
      {/* Local */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <TeamShield teamId={ht.id} teamName={ht.shortName ?? ht.name} size={24} />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
          {ht.shortName ?? ht.name}
        </span>
      </div>

      {/* Marcador / hora */}
      <div className="shrink-0 flex flex-col items-center gap-0.5 min-w-[52px]">
        {showScore ? (
          <>
            <span className="font-score text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {match.score.home ?? 0} – {match.score.away ?? 0}
            </span>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
                {t('match_states.live')}
              </span>
            )}
            {isFinished && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">{t('match_states.final')}</span>
            )}
          </>
        ) : (
          <span className="font-score text-sm font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
            {fmtTime(match.scheduledAt, match.competitionTimezone, locale)}
          </span>
        )}
      </div>

      {/* Visitante */}
      <div className="flex items-center gap-2 flex-1 min-w-0 flex-row-reverse">
        <TeamShield teamId={at.id} teamName={at.shortName ?? at.name} size={24} />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate text-right">
          {at.shortName ?? at.name}
        </span>
      </div>
    </Link>
  );
}

/** Estado vacío estilizado para cruces de filtros sin partidos. */
function EmptyFixtures() {
  const { t } = useT();
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-3">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
           className="w-9 h-9 text-slate-300 dark:text-slate-700">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-slate-400 dark:text-slate-600">{t('fixtures.empty')}</p>
    </div>
  );
}

/** Lista de partidos agrupada por día (calendario completo de un equipo). */
function FixturesByDate({ matches }: { matches: SeasonMatch[] }) {
  const { t, locale } = useT();
  const groups = useMemo(() => {
    const map = new Map<string, SeasonMatch[]>();
    for (const m of matches) {
      const d = madridDay(m.scheduledAt, m.competitionTimezone) ?? NO_DATE;
      const arr = map.get(d);
      if (arr) arr.push(m); else map.set(d, [m]);
    }
    return [...map.entries()];
  }, [matches]);

  return (
    <div className="space-y-3">
      {groups.map(([d, ms]) => (
        <div key={d} className="card overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              {d === NO_DATE ? tt(t, 'team.no_date', 'Sin fecha') : dayPillLabel(d, locale)}
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {ms.map((m) => <MatchCard key={m.id} match={m} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GameweeksTab({ rounds, matches }: { rounds: SeasonRound[]; matches: SeasonMatch[] }) {
  const { t, locale } = useT();
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const journeyParam = sp.get('journey');
  const dateParam = sp.get('date');
  const teamParam = sp.get('team_id');

  // Rondas para el selector: regular por número, luego playoff/cup.
  const orderedRounds = useMemo(() => {
    const rank = (rt: string) => (rt === 'regular' ? 0 : 1);
    return [...rounds].sort((a, b) => rank(a.roundType) - rank(b.roundType) || a.number - b.number);
  }, [rounds]);

  // Equipos participantes (de los partidos), únicos y ordenados por nombre.
  const teams = useMemo(() => {
    const map = new Map<string, TeamSummary>();
    for (const m of matches) {
      if (m.homeTeam?.id) map.set(m.homeTeam.id, m.homeTeam);
      if (m.awayTeam?.id) map.set(m.awayTeam.id, m.awayTeam);
    }
    return [...map.values()].sort((a, b) => (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name));
  }, [matches]);

  // Días con actividad (Madrid), únicos y ordenados.
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) { const d = madridDay(m.scheduledAt, m.competitionTimezone); if (d) set.add(d); }
    return [...set].sort();
  }, [matches]);

  // #157: filtro inicial con contenido (día/jornada más cercano a hoy).
  const fallback = useMemo(
    () => pickDefaultFilter(orderedRounds, matches, madridTodayKey()),
    [orderedRounds, matches],
  );

  // #365: validar el parámetro de jornada — `?journey=basura` daba NaN y dejaba
  // la lista vacía en silencio. Si no es un entero positivo, usamos el defecto.
  const parsedJourney = journeyParam != null && /^\d+$/.test(journeyParam)
    ? Number(journeyParam)
    : null;
  const selectedTeam = teamParam ? teams.find((tm) => tm.id === teamParam) ?? null : null;

  // El filtro por defecto solo aplica si la URL no pide jornada/fecha/equipo.
  const hasExplicitFilter = parsedJourney != null || !!dateParam || selectedTeam != null;
  const activeDate = dateParam || (hasExplicitFilter ? null : fallback.date) || null;
  const activeJourney = parsedJourney ?? (activeDate != null ? null : fallback.journey);

  // Exclusión mutua: equipo > fecha > jornada.
  const filtered = useMemo(() => {
    if (selectedTeam) {
      return matches
        .filter((m) => m.homeTeam?.id === selectedTeam.id || m.awayTeam?.id === selectedTeam.id)
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
    }
    if (activeDate) {
      return matches
        .filter((m) => madridDay(m.scheduledAt, m.competitionTimezone) === activeDate)
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
    }
    return matches.filter((m) => (m.roundNumber ?? null) === activeJourney);
  }, [matches, selectedTeam, activeDate, activeJourney]);

  // Sincroniza la URL aplicando exclusión mutua (preserva otros params, p. ej. season).
  const apply = useCallback((patch: { journey?: number; date?: string; team?: string }) => {
    track('fixtures_filter_applied', {
      filter_type: patch.team ? 'team' : patch.date ? 'date' : 'round',
      value: patch.team ?? patch.date ?? (patch.journey != null ? String(patch.journey) : ''),
    });
    const params = new URLSearchParams(sp.toString());
    params.delete('journey'); params.delete('date'); params.delete('team_id');
    if (patch.team) params.set('team_id', patch.team);
    else if (patch.date) params.set('date', patch.date);
    else if (patch.journey != null) params.set('journey', String(patch.journey));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, pathname, router]);

  const journeyMode = !selectedTeam && !activeDate;

  // Banner "entre resultados" en la lista plana (jornada/fecha). -1 si no procede.
  const adIndex = useMemo(
    () => listAdInsertIndex(filtered.length, ADS.listEvery),
    [filtered.length],
  );

  return (
    <div className="space-y-3">
      {/* ── Toolbar de filtros ────────────────────────────────── */}
      <div className="space-y-2.5">
        {/* Jornada + chip de equipo activo */}
        <div className="flex items-center gap-2">
          {/* #157: si la fuente no trae jornadas (OK Liga), el selector salía
              vacío; en ese caso se oculta y se navega por las pastillas de fecha. */}
          {orderedRounds.length > 0 && (
            <div className="relative flex-1 min-w-0">
              <select
                value={journeyMode && activeJourney != null ? String(activeJourney) : ''}
                onChange={(e) => { if (e.target.value) apply({ journey: Number(e.target.value) }); }}
                className="w-full min-h-[40px] pl-3 pr-8 rounded-xl border border-slate-200 dark:border-slate-700
                           bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200
                           focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-red-400 cursor-pointer appearance-none"
                aria-label={t('fixtures.by_round')}
              >
                {!journeyMode && <option value="">{t('fixtures.by_round')}</option>}
                {orderedRounds.map((r) => (
                  <option key={r.id} value={r.number}>{roundLabel(r, t)}</option>
                ))}
              </select>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                   className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          {selectedTeam && (
            <button
              onClick={() => apply({})}
              className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1.5 rounded-full bg-rink-passion/10
                         text-rink-passion text-xs font-semibold shrink-0"
            >
              <TeamShield teamId={selectedTeam.id} teamName={selectedTeam.shortName ?? selectedTeam.name} size={20} />
              <span className="max-w-[120px] truncate">{clubName(selectedTeam.shortName ?? selectedTeam.name)}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-3.5 h-3.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Pastillas de fecha */}
        {dates.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
            {dates.map((d) => (
              <button
                key={d}
                onClick={() => apply({ date: d })}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  !selectedTeam && activeDate === d
                    ? 'bg-rink-passion text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {dayPillLabel(d, locale)}
              </button>
            ))}
          </div>
        )}

        {/* Escudos de equipos participantes */}
        {teams.length > 0 && (
          <div className="flex gap-2.5 overflow-x-auto scrollbar-none pb-1">
            {teams.map((tm) => (
              <button
                key={tm.id}
                onClick={() => apply(selectedTeam?.id === tm.id ? {} : { team: tm.id })}
                aria-label={tm.shortName ?? tm.name}
                className={`shrink-0 rounded-full p-0.5 transition-all ${
                  selectedTeam?.id === tm.id
                    ? 'ring-2 ring-rink-passion'
                    : 'ring-1 ring-transparent opacity-80 hover:opacity-100 hover:ring-slate-300 dark:hover:ring-slate-700'
                }`}
              >
                <TeamShield teamId={tm.id} teamName={tm.shortName ?? tm.name} size={36} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Resultados ────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyFixtures />
      ) : selectedTeam ? (
        <FixturesByDate matches={filtered} />
      ) : (
        <div className="card overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/60">
          {filtered.map((m, i) => (
            <Fragment key={m.id}>
              {i === adIndex && <AdBanner zone="list-inline" className="my-2" />}
              <MatchCard match={m} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

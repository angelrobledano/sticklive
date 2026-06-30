'use client';

import { useState, useMemo, useRef, useCallback, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { SeasonOverview, SeasonStandingRow, SeasonMatch, SeasonRound, CompetitionSeason, SeasonStats, SeasonLeader, TeamSummary } from '@/lib/api/client';
import { buildSeries, groupByPhase, placementMatches, type PlayoffSeries } from '@/lib/playoff';
import { PlayoffBracket } from '@/components/match/PlayoffBracket';
import { PlayerAvatar } from '@/components/shared/PlayerAvatar';
import { TeamName as AdaptiveTeamName } from '@/components/shared/TeamName';
import { FavoriteStar } from '@/components/shared/FavoriteStar';
import { ManageNotificationsButton } from '@/components/shared/ManageNotificationsButton';
import { track } from '@/lib/analytics';
import { ShareButton } from '@/components/shared/ShareButton';
import { useT } from '@/lib/i18n';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName } from '@/lib/names';


// ─── Helpers ─────────────────────────────────────────────────────────────────
// Nombres adaptativos: sistema global en @/components/shared/TeamName

function fmtTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid',
  });
}

// ─── Helper: etiqueta de federación ──────────────────────────────────────────

function fedLabelFromSeason(season: SeasonOverview['season'], locale: string): string {
  if (season.competitionScope === 'regional') return season.competitionRegion ?? season.competitionOrganizer;
  if (season.competitionScope === 'international') return 'Internacional';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(season.competitionCountry ?? '') ?? season.competitionOrganizer;
  } catch {
    return season.competitionOrganizer;
  }
}

// ─── Cabecera de la competición ───────────────────────────────────────────────

function CompetitionHeader({ data, seasons, competitionId }: {
  data: SeasonOverview;
  seasons?: CompetitionSeason[];
  competitionId?: string;
}) {
  const { season } = data;
  const router = useRouter();
  const { t, locale } = useT();
  const hasHistory = !!competitionId && (seasons?.length ?? 0) > 1;
  const fedLabel = fedLabelFromSeason(season, locale);

  return (
    <div className="card px-4 py-3.5 flex items-center gap-3.5">
      <div className="w-10 h-10 rounded-xl bg-rink-passion flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-5 h-5">
          <path d="M8 3h8v10a4 4 0 0 1-8 0V3Z" /><path d="M12 17v4M8 21h8" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
          {fedLabel}
        </p>
        <h1 className="text-base font-bold text-slate-900 dark:text-slate-50 leading-tight truncate">
          {season.competitionName}
        </h1>
        {/* Temporada: texto plano si no hay histórico; selector discreto si lo hay.
            Decisión UX: la temporada actual es el 99% de las visitas — el
            selector no compite visualmente, parece un subtítulo con caret. */}
        {hasHistory ? (
          <select
            value={season.id}
            onChange={(e) => router.push(`/competitions/${competitionId}?season=${e.target.value}`)}
            className="mt-0.5 -ml-1 text-xs font-light text-slate-400 dark:text-slate-500 bg-transparent
                       border-0 rounded-md px-1 py-0 pr-6 cursor-pointer appearance-auto
                       hover:text-slate-600 dark:hover:text-slate-300
                       focus:outline-none focus:ring-1 focus:ring-rink-passion/40"
            aria-label="Cambiar temporada"
          >
            {seasons!.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.isCurrent ? ` · ${t('common.current')}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs font-light text-slate-400 dark:text-slate-500">{season.name}</p>
        )}
      </div>

      {/* Compartir + favorito de liga */}
      <ShareButton kind="league" title={season.competitionName} className="shrink-0" />
      <FavoriteStar
        id={season.competitionId}
        kind="league"
        name={season.competitionShort ?? season.competitionName}
        className="shrink-0"
      />
      <ManageNotificationsButton
        kind="league"
        id={season.competitionId}
        name={season.competitionShort ?? season.competitionName}
        className="shrink-0"
      />
    </div>
  );
}

// ─── Tab A: Clasificación ─────────────────────────────────────────────────────

const PLAYOFF_SPOTS = 8;
const RELEGATION_SPOTS = 2; // últimos 2 descienden en OK Liga

function StandingsTab({ standings }: { standings: SeasonStandingRow[] }) {
  const { t } = useT();
  if (standings.length === 0) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-400 dark:text-slate-600">{t('standings.no_data')}</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Cabecera de la tabla — columnas de stats más estrechas para dar
          espacio al nombre del equipo y evitar truncados */}
      {/* border-l transparente: alinea la cabecera con las filas (que llevan
          barra lateral de 2px de zona) — sin él hay un micro-desplazamiento */}
      <div className="grid grid-cols-[24px_1fr_repeat(8,26px)] gap-x-1 px-3 py-1.5 border-l-2 border-l-transparent
                      bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800">
        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-center">#</span>
        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t('standings.team')}</span>
        {[t('standings.cols.pts'), t('standings.cols.played'), t('standings.cols.won'), t('standings.cols.drawn'),
          t('standings.cols.lost'), t('standings.cols.gf'), t('standings.cols.ga'), t('standings.cols.gd')].map((h) => (
          <span key={h} className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-center">{h}</span>
        ))}
      </div>

      {/* Filas */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {standings.map((row, idx) => {
          const pos = row.position ?? idx + 1;
          const total = standings.length;
          const isPlayoff    = pos <= PLAYOFF_SPOTS;
          const isRelegation = total > 0 && pos > total - RELEGATION_SPOTS;
          const isLast       = idx === total - 1;
          const showPlayoffBorder    = isPlayoff    && pos === PLAYOFF_SPOTS    && !isLast;
          const showRelegationBorder = isRelegation && pos === total - RELEGATION_SPOTS + 1;

          return (
            <div
              key={row.id}
              className={`grid grid-cols-[24px_1fr_repeat(8,26px)] gap-x-1 px-3 py-2 items-center border-l-2
                ${showPlayoffBorder    ? 'border-b-2 border-dashed border-b-rink-passion/30 dark:border-b-red-400/40' : ''}
                ${showRelegationBorder ? 'border-t-2 border-dashed border-t-orange-400/50 dark:border-t-orange-400/40' : ''}
                ${isPlayoff            ? 'border-l-rink-passion dark:border-l-red-400 bg-rink-passion/[0.03] dark:bg-red-400/[0.06]' :
                  isRelegation         ? 'border-l-orange-500 dark:border-l-orange-400 bg-orange-50/40 dark:bg-orange-400/[0.06]' :
                                         'border-l-transparent'}
              `}
            >
              {/* Posición — gris medio uniforme: la barra lateral ya marca la
                  zona, y así el nombre y los puntos son lo que destaca */}
              <span className="text-xs font-semibold text-center tabular-nums text-slate-500 dark:text-slate-400">
                {pos}
              </span>

              {/* Equipo */}
              <Link
                href={`/teams/${row.teamId}`}
                className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity"
              >
                <TeamShield teamId={row.teamId} teamName={row.teamName} size={20} />
                {/* Estrella solo en escritorio: en móvil la tabla queda 100%
                    limpia y se sigue desde el perfil del equipo o desde
                    Gestionar favoritos */}
                <FavoriteStar
                  id={row.teamId}
                  kind="team"
                  name={row.teamShortName ?? row.teamName}
                  className="shrink-0 !w-10 !h-10 !-m-2.5 !hidden md:!inline-flex"
                />
                <AdaptiveTeamName
                  name={row.teamName}
                  shortName={row.teamShortName}
                  className="flex-1 min-w-0 text-xs font-semibold text-slate-800 dark:text-slate-200 truncate"
                />
              </Link>

              {/* PT con penalización */}
              <div className="flex items-baseline justify-center gap-0.5">
                <span className="text-xs font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {row.points}
                </span>
                {row.penalizationPoints < 0 && (
                  <span className="text-[8px] font-bold text-red-500 tabular-nums leading-none">
                    {row.penalizationPoints}
                  </span>
                )}
              </div>

              {/* PJ, PG, PE, PP, GF, GC, DG */}
              {[row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst].map((v, i) => (
                <span key={i} className="text-[11px] text-slate-500 dark:text-slate-400 text-center tabular-nums">{v}</span>
              ))}
              <span className={`text-xs font-semibold text-center tabular-nums ${
                row.goalDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' :
                row.goalDiff < 0 ? 'text-red-500' : 'text-slate-400'
              }`}>
                {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
              </span>
            </div>
          );
        })}
      </div>

      {/* Leyenda — compacta y discreta: dots de color, gris medio neutro */}
      <div className="px-3 py-1.5 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-slate-100 dark:border-slate-800">
        {/* Los dots replican EXACTAMENTE los colores de las barras laterales */}
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-rink-passion dark:bg-red-400 shrink-0" />
          <span className="text-[10px] text-slate-400 dark:text-slate-500">{t('standings.playoffs_zone')}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 dark:bg-orange-400 shrink-0" />
          <span className="text-[10px] text-slate-400 dark:text-slate-500">{t('standings.relegation_zone')}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Tab B: Jornadas ──────────────────────────────────────────────────────────

function MatchCard({ match }: { match: SeasonMatch }) {
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
              <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-500 uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            )}
            {isFinished && (
              <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">Final</span>
            )}
          </>
        ) : (
          <span className="font-score text-sm font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
            {fmtTime(match.scheduledAt)}
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

// ─── Pestaña Jornadas: navegador de partidos con filtros (jornada/fecha/equipo) ──

/** YYYY-MM-DD en Europe/Madrid (clave de día estable). */
function madridDay(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

/** "2026-06-20" → "Vie 20 jun" (sin desfase de zona). */
function dayPillLabel(d: string): string {
  const s = new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function roundLabel(r: SeasonRound): string {
  if (r.roundType === 'regular') return r.name ?? `Jornada ${r.number}`;
  return r.name ? `Playoffs · ${r.name}` : `Playoffs ${r.number}`;
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
  const groups = useMemo(() => {
    const map = new Map<string, SeasonMatch[]>();
    for (const m of matches) {
      const d = madridDay(m.scheduledAt) ?? 'Sin fecha';
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
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              {d === 'Sin fecha' ? d : dayPillLabel(d)}
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

function GameweeksTab({ rounds, matches }: { rounds: SeasonRound[]; matches: SeasonMatch[] }) {
  const { t } = useT();
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
    for (const m of matches) { const d = madridDay(m.scheduledAt); if (d) set.add(d); }
    return [...set].sort();
  }, [matches]);

  // Jornada por defecto: la más reciente con partido jugado/en vivo.
  const defaultJourney = useMemo(() => {
    const active = matches
      .filter((m) => m.status === 'finished' || m.status === 'live')
      .map((m) => m.roundNumber ?? 0);
    if (active.length > 0) return Math.max(...active);
    return orderedRounds[0]?.number ?? 1;
  }, [matches, orderedRounds]);

  const activeJourney = journeyParam != null ? Number(journeyParam) : defaultJourney;
  const selectedTeam = teamParam ? teams.find((tm) => tm.id === teamParam) ?? null : null;

  // Exclusión mutua: equipo > fecha > jornada.
  const filtered = useMemo(() => {
    if (selectedTeam) {
      return matches
        .filter((m) => m.homeTeam?.id === selectedTeam.id || m.awayTeam?.id === selectedTeam.id)
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
    }
    if (dateParam) {
      return matches
        .filter((m) => madridDay(m.scheduledAt) === dateParam)
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
    }
    return matches.filter((m) => (m.roundNumber ?? null) === activeJourney);
  }, [matches, selectedTeam, dateParam, activeJourney]);

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

  const journeyMode = !selectedTeam && !dateParam;

  return (
    <div className="space-y-3">
      {/* ── Toolbar de filtros ─────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        {/* Jornada + chip de equipo activo */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <select
              value={journeyMode ? String(activeJourney) : ''}
              onChange={(e) => { if (e.target.value) apply({ journey: Number(e.target.value) }); }}
              className="w-full min-h-[40px] pl-3 pr-8 rounded-xl border border-slate-200 dark:border-slate-700
                         bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200
                         focus:outline-none focus:ring-2 focus:ring-rink-passion/40 cursor-pointer appearance-none"
              aria-label={t('fixtures.by_round')}
            >
              {!journeyMode && <option value="">{t('fixtures.by_round')}</option>}
              {orderedRounds.map((r) => (
                <option key={r.id} value={r.number}>{roundLabel(r)}</option>
              ))}
            </select>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
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
                  !selectedTeam && dateParam === d
                    ? 'bg-rink-passion text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {dayPillLabel(d)}
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

      {/* ── Resultados ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyFixtures />
      ) : selectedTeam ? (
        <FixturesByDate matches={filtered} />
      ) : (
        <div className="card overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/60">
          {filtered.map((m) => <MatchCard key={m.id} match={m} />)}
        </div>
      )}
    </div>
  );
}

// ─── Tab C: Playoffs ──────────────────────────────────────────────────────────

const PLAYOFF_PHASES = ['Cuartos', 'Semis', 'Final'] as const;
type PlayoffPhase = typeof PLAYOFF_PHASES[number];

// ─── Series de playoff (lógica compartida en @/lib/playoff) ─────────────────

/**
 * Eliminatoria a PARTIDO ÚNICO: tarjeta de partido limpia (sin marcador de
 * victorias de serie, que ahí sobra y confunde). Resalta al ganador y enlaza.
 */
function SingleMatchSeries({ serie, label }: { serie: PlayoffSeries; label: string }) {
  const g = serie.games[0]!;
  const isFinished = g.status === 'finished';
  const isLive = g.status === 'live';
  const showScore = isFinished || isLive;
  const sides = [
    { team: g.homeTeam, score: g.score.home },
    { team: g.awayTeam, score: g.score.away },
  ];

  const card = (
    <div className={`card overflow-hidden border ${isLive ? 'border-emerald-400/40' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
        <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</p>
        {isLive && <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">● Live</span>}
      </div>
      {sides.map(({ team, score }, idx) => {
        // Ganador explícito (penaltis/prórroga) manda; si no, se deriva del
        // marcador. Un empate sin ganador explícito no resalta a nadie.
        const winnerId = g.winnerTeamId
          ?? (g.score.home != null && g.score.away != null && g.score.home !== g.score.away
              ? (g.score.home > g.score.away ? g.homeTeam.id : g.awayTeam.id)
              : null);
        const winner = showScore && winnerId === team.id;
        return (
          <div key={idx} className={`flex items-center gap-2.5 px-3 py-2 ${idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''} ${!showScore ? 'opacity-60' : ''}`}>
            <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={24} />
            <span className={`flex-1 text-sm truncate ${winner ? 'font-bold text-slate-900 dark:text-slate-50' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
              <AdaptiveTeamName name={team.name} shortName={team.shortName} mobile="abbr" />
            </span>
            {showScore && score != null && (
              <span className="font-score text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">{score}</span>
            )}
          </div>
        );
      })}
      <div className="px-3 pb-2 pt-1">
        <span className={`text-[9px] font-bold uppercase tracking-wider ${isLive ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`}>
          {isLive ? '🟢 En directo'
            : isFinished ? `Final · ${fmtDate(g.finishedAt ?? g.scheduledAt)}`
            : `${fmtDate(g.scheduledAt)} · ${fmtTime(g.scheduledAt)}`}
        </span>
      </div>
    </div>
  );

  return <Link href={`/matches/${g.id}`} className="block hover:opacity-90 transition-opacity">{card}</Link>;
}

function SeriesCard({ serie, label }: { serie: PlayoffSeries; label: string }) {
  const { t } = useT();
  // Partido único → tarjeta de partido (sin marcador de victorias de serie).
  if (serie.games.length === 1) return <SingleMatchSeries serie={serie} label={label} />;
  const hasLive = serie.games.some((g) => g.status === 'live');
  const notStarted = serie.winsA === 0 && serie.winsB === 0 && !hasLive;
  const rows = [
    { team: serie.teamA, wins: serie.winsA, winner: serie.winsA > serie.winsB },
    { team: serie.teamB, wins: serie.winsB, winner: serie.winsB > serie.winsA },
  ];

  return (
    <div className={`card overflow-hidden border ${hasLive ? 'border-emerald-400/40' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
        <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</p>
        {/* No mostramos "al mejor de N": el formato varía por torneo y no es
            inferible de los partidos programados. Los badges de victorias ya
            cuentan la serie por sí solos. */}
        {hasLive && (
          <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">● {t('playoffs.live')}</span>
        )}
      </div>

      {rows.map(({ team, wins, winner }, idx) => (
        <div key={team.id}
             className={`flex items-center gap-2.5 px-3 py-2 ${idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''}
                         ${notStarted ? 'opacity-60' : ''}`}>
          <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={24} />
          <Link href={`/teams/${team.id}`}
                className={`flex-1 text-sm truncate hover:underline ${winner ? 'font-bold text-slate-900 dark:text-slate-50' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
            <AdaptiveTeamName name={team.name} shortName={team.shortName} mobile="abbr" />
          </Link>
          {/* Victorias de la serie — badge para diferenciarlo de un marcador de partido */}
          <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 rounded-md
                            font-score text-sm font-bold tabular-nums ${
            winner
              ? 'bg-rink-passion text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
          }`}>
            {wins}
          </span>
        </div>
      ))}

      {/* Partidos de la serie — pills neutras, siglas siempre */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2">
        {serie.games.map((g) => (
          <Link key={g.id} href={`/matches/${g.id}`}
                className={`text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  g.status === 'live'
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                    : g.status === 'finished'
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-rink-passion'
                      : 'bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-600'
                }`}>
            {g.status === 'finished' || g.status === 'live'
              ? `${(g.homeTeam.shortName ?? g.homeTeam.name).slice(0, 4)} ${g.score.home ?? '-'}-${g.score.away ?? '-'} ${(g.awayTeam.shortName ?? g.awayTeam.name).slice(0, 4)}`
              : fmtDate(g.scheduledAt)}
          </Link>
        ))}
      </div>
    </div>
  );
}

type PlayoffViewPhase = PlayoffPhase | '9º–10º';

/** Slugs de fase para la URL (?phase=). */
const PHASE_SLUG: Record<PlayoffViewPhase, string> = {
  'Cuartos': 'cuartos', 'Semis': 'semis', 'Final': 'final', '9º–10º': '9-10',
};
function phaseFromSlug(s: string | null): PlayoffViewPhase | null {
  if (!s) return null;
  return (Object.keys(PHASE_SLUG) as PlayoffViewPhase[]).find((p) => PHASE_SLUG[p] === s) ?? null;
}

function PlayoffsTab({ matches }: { standings?: SeasonStandingRow[]; matches: SeasonMatch[] }) {
  const { t } = useT();
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fases por roundNumber (1=QF, 2=SF, 3=F — derivado por la API).
  const byPhase = useMemo(() => groupByPhase(matches), [matches]);
  // Serie de colocación 9º–10º (rn=0): fuera del cuadro por el título,
  // pero decide la última plaza europea — fase propia.
  const placement = useMemo(() => placementMatches(matches), [matches]);

  // Pre-render filtering: SOLO fases con partidos reales (matches.length > 0).
  const visiblePhases = useMemo<PlayoffViewPhase[]>(() => [
    ...PLAYOFF_PHASES.filter((p) => (byPhase[p]?.length ?? 0) > 0),
    ...(placement.length > 0 ? (['9º–10º'] as const) : []),
  ], [byPhase, placement]);

  // Fase activa desde la URL (validada contra las visibles); si no, la primera.
  const requested = phaseFromSlug(sp.get('phase'));
  const activePhase: PlayoffViewPhase =
    requested && visiblePhases.includes(requested) ? requested : (visiblePhases[0] ?? 'Final');

  // Redirección elegante: si la URL pide una fase vacía/inexistente, normaliza a
  // la primera con contenido (solo si había un ?phase= explícito).
  useEffect(() => {
    const raw = sp.get('phase');
    if (!raw || visiblePhases.length === 0) return;
    if (requested && visiblePhases.includes(requested)) return;
    const params = new URLSearchParams(sp.toString());
    params.set('phase', PHASE_SLUG[visiblePhases[0]!]);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [sp, requested, visiblePhases, pathname, router]);

  const selectPhase = (phase: PlayoffViewPhase) => {
    const params = new URLSearchParams(sp.toString());
    params.set('phase', PHASE_SLUG[phase]);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  const renderPhase = (phase: PlayoffViewPhase) => {
    if (phase === '9º–10º') {
      const series = buildSeries(placement);
      return (
        <div className="space-y-3">
          {/* Contexto: sin él, este cruce parece un descenso */}
          <p className="px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {t('playoffs.placement_help')}
          </p>
          {series.map((serie, i) => (
            <SeriesCard key={i} serie={serie} label={t('playoffs.placement_label')} />
          ))}
        </div>
      );
    }

    const series = buildSeries(byPhase[phase]);
    if (series.length === 0) {
      return (
        <div className="card p-6 text-center opacity-60">
          <p className="text-sm text-slate-400 dark:text-slate-600">
            {phase === 'Cuartos' ? t('playoffs.no_quarters') : phase === 'Semis' ? t('playoffs.pending_quarters') : t('playoffs.pending_semis')}
          </p>
        </div>
      );
    }
    const labelOf = (i: number) => phase === 'Cuartos' ? t('playoffs.quarter_n', { n: i + 1 }) : phase === 'Semis' ? t('playoffs.semifinal_n', { n: i + 1 }) : t('playoffs.grand_final');
    return (
      <div className="space-y-3">
        {series.map((serie, i) => (
          <SeriesCard
            key={i}
            serie={serie}
            label={labelOf(i)}
          />
        ))}
      </div>
    );
  };

  const phaseLabel = (phase: PlayoffViewPhase) =>
    phase === '9º–10º' ? t('playoffs.placement')
    : phase === 'Cuartos' ? t('playoffs.quarters')
    : phase === 'Semis' ? t('playoffs.semis')
    : t('playoffs.final');

  return (
    <div className="space-y-3">
      {/* Vista general del cuadro por el título — informativa, sin enlaces */}
      <PlayoffBracket matches={matches} />

      {/* Sub-pestañas horizontales — solo las fases con contenido. Si solo hay
          una (o ninguna), no mostramos la barra: no aporta nada navegable. */}
      {visiblePhases.length > 1 && (
        <div className="flex gap-0 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
          {visiblePhases.map((phase) => (
            <button
              key={phase}
              onClick={() => selectPhase(phase)}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap ${
                activePhase === phase
                  ? 'bg-rink-passion text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {phaseLabel(phase)}
            </button>
          ))}
        </div>
      )}

      {/* Contenido de la fase activa */}
      {visiblePhases.length > 0 && (
        <div ref={scrollRef}>
          {renderPhase(activePhase)}
        </div>
      )}
    </div>
  );
}

// ─── Tab D: Líderes de temporada ─────────────────────────────────────────────

const LEADERBOARD_PREVIEW = 5;

function LeaderBoard({ title, leaders, valueLabel, extraLabel }: {
  title: string;
  leaders: SeasonLeader[];
  valueLabel: string;
  extraLabel?: string;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  if (leaders.length === 0) return null;

  const visible = expanded ? leaders : leaders.slice(0, LEADERBOARD_PREVIEW);
  const hiddenCount = leaders.length - LEADERBOARD_PREVIEW;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800
                      flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{title}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {valueLabel}{extraLabel ? ` / ${extraLabel}` : ''}
        </span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {visible.map((l, idx) => (
          <div key={`${l.playerId ?? l.playerName}-${idx}`} className="flex items-center gap-2.5 px-3 py-2">
            <span className="w-5 text-xs font-semibold text-slate-400 dark:text-slate-500 tabular-nums text-center">{idx + 1}</span>
            <PlayerAvatar
              photoUrl={l.photoUrl}
              name={toLeaderName(l.playerName)}
              className="w-8 h-8 rounded-full shrink-0"
            />
            <div className="flex-1 min-w-0">
              {l.playerId ? (
                <Link href={`/players/${l.playerId}`}
                      className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate hover:text-rink-passion hover:underline block">
                  {toLeaderName(l.playerName)}
                </Link>
              ) : (
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate block">{toLeaderName(l.playerName)}</span>
              )}
              <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate block">{clubName(l.teamName ?? l.teamShort ?? '')}</span>
            </div>
            <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">{l.value}</span>
            {extraLabel && (
              <span className="w-6 text-xs text-slate-500 dark:text-slate-400 tabular-nums text-right">{l.extra}</span>
            )}
          </div>
        ))}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full py-2.5 min-h-[44px] text-xs font-semibold text-rink-passion
                     border-t border-slate-100 dark:border-slate-800
                     hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
        >
          {expanded ? t('common.show_less') : t('common.show_more', { n: hiddenCount })}
        </button>
      )}
    </div>
  );
}

/** "ALABART GONZALEZ IGNACIO" o "Ferran Font Sánchez" → "Ignacio Alabart" estilo natural */
function toLeaderName(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const isUpper = clean === clean.toUpperCase();
  const parts = clean.split(' ');
  const title = (s: string) => s.toLowerCase().replace(/(^|\s|-)\p{L}/gu, (m) => m.toUpperCase());
  if (!isUpper || parts.length === 1) return title(clean);
  // Formato fuente "APELLIDO APELLIDO NOMBRE" → "Nombre Apellido"
  return title(`${parts[parts.length - 1]} ${parts[0]}`);
}

function StatsLeadersTab({ stats }: { stats: SeasonStats }) {
  const { t } = useT();
  const empty = stats.topScorers.length === 0 && stats.topAssists.length === 0 && stats.topCards.length === 0;
  if (empty) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-400 dark:text-slate-600">{t('leaders.no_data')}</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <LeaderBoard title={t('hockey_stats.top_scorers')} leaders={stats.topScorers} valueLabel={t('leaders.goals_short')} extraLabel={t('leaders.assists_short')} />
      <LeaderBoard title={t('hockey_stats.top_assisters')} leaders={stats.topAssists} valueLabel={t('hockey_stats.assists')} extraLabel={t('leaders.goals_short')} />
      <LeaderBoard title={t('hockey_stats.cards_leaderboard')} leaders={stats.topCards} valueLabel={t('leaders.blues_short')} extraLabel={t('leaders.reds_short')} />

      {/* Eficiencia a bola parada por equipo (la fuente no identifica al
          lanzador de las FD falladas, así que por jugador sería engañoso) */}
      {(stats.setPieces?.length ?? 0) > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800
                          flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('hockey_stats.efficiency')}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('leaders.directs_penalties')}
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {stats.setPieces!.map((tm) => (
              <div key={tm.teamId}
                   className="grid grid-cols-[1fr_84px_84px] items-center gap-2 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <TeamShield teamId={tm.teamId} teamName={tm.teamShort ?? tm.teamName ?? ''} size={20} />
                  <Link href={`/teams/${tm.teamId}`}
                        className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate hover:text-rink-passion hover:underline">
                    <AdaptiveTeamName name={tm.teamName ?? ''} shortName={tm.teamShort} />
                  </Link>
                </div>
                {[tm.directFouls, tm.penalties].map((m, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-x-1.5 text-right">
                    <span className="text-xs font-normal tabular-nums text-slate-600 dark:text-slate-300">
                      {m.total > 0 ? `${m.scored}/${m.total}` : '—'}
                    </span>
                    <span className={`w-9 text-xs font-bold tabular-nums ${
                      m.pct !== null && m.pct >= 50
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}>
                      {m.pct !== null ? `${m.pct}%` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

type MainTab = 'Clasificación' | 'Jornadas' | 'Playoffs' | 'Estadísticas';
// Etiquetas i18n (los valores internos siguen siendo estables en ES)
const MAIN_TAB_KEYS: Record<MainTab, string> = {
  'Clasificación': 'match_tabs.standing',
  'Jornadas':      'match_tabs.fixtures',
  'Playoffs':      'match_tabs.playoffs',
  'Estadísticas':  'match_tabs.stats',
};

export function CompetitionClient({ data, seasons, competitionId, stats }: {
  data: SeasonOverview;
  seasons?: CompetitionSeason[];
  competitionId?: string;
  stats?: SeasonStats | null;
}) {
  // Pestañas según los datos: una eliminatoria pura (playoff) no tiene
  // clasificación, y una liga sin fase final no necesita pestaña Playoffs.
  const visibleTabs = useMemo<MainTab[]>(() => {
    const tabs: MainTab[] = [];
    if (data.standings.length > 0) tabs.push('Clasificación');
    if (data.matches.some((m) => m.roundType === 'regular')) tabs.push('Jornadas');
    if (data.matches.some((m) => m.roundType === 'playoff')) tabs.push('Playoffs');
    if (stats && (stats.topScorers.length > 0 || stats.topAssists.length > 0 || stats.topCards.length > 0)) {
      tabs.push('Estadísticas');
    }
    return tabs.length > 0 ? tabs : ['Clasificación'];
  }, [data.standings, data.matches, stats]);

  const [activeTab, setActiveTab] = useState<MainTab>(visibleTabs[0]!);
  const currentTab = visibleTabs.includes(activeTab) ? activeTab : visibleTabs[0]!;
  const { t } = useT();

  return (
    <div className="space-y-4">
      <CompetitionHeader data={data} seasons={seasons} competitionId={competitionId} />

      {/* Pestañas principales */}
      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-800">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm border-b -mb-px transition-colors whitespace-nowrap ${
              currentTab === tab
                ? 'border-rink-passion text-rink-passion font-semibold'
                : 'border-transparent font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(MAIN_TAB_KEYS[tab])}
          </button>
        ))}
      </div>

      {currentTab === 'Clasificación' && <StandingsTab standings={data.standings} />}
      {currentTab === 'Jornadas'      && (
        <Suspense fallback={<div className="card h-40 animate-pulse" />}>
          <GameweeksTab rounds={data.rounds} matches={data.matches} />
        </Suspense>
      )}
      {currentTab === 'Playoffs'      && (
        <Suspense fallback={<div className="card h-40 animate-pulse" />}>
          <PlayoffsTab matches={data.matches} />
        </Suspense>
      )}
      {currentTab === 'Estadísticas'  && stats && <StatsLeadersTab stats={stats} />}
    </div>
  );
}
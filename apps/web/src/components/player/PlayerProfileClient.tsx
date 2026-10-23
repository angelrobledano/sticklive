'use client';

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import type { PlayerDetail, PlayerCompStats, PlayerSeasonTotals } from '@/lib/api/client';
import { PlayerAvatar } from '@/components/shared/PlayerAvatar';
import { toTitleCase } from '@/lib/names';
import { useT } from '@/lib/i18n';
import { ShareSheet } from '@/components/shared/ShareSheet';
import { CountryFlag } from '@/components/shared/CountryFlag';
import { FavoriteStar } from '@/components/shared/FavoriteStar';
import { ManageNotificationsButton } from '@/components/shared/ManageNotificationsButton';

// ─── Trayectoria / carrera (#217) ─────────────────────────────────────────────
//
// `GET /players/:id` devuelve `career` con las temporadas agrupadas (equipos +
// totales). El tipo vive aquí porque el DTO compartido (`lib/api/types.ts`) aún
// no lo incluye; el campo es opcional para no romper respuestas antiguas.

export interface PlayerCareerTeam {
  competitionId: string;
  competitionName: string;
  competitionShort: string | null;
  teamId: string;
  teamName: string;
  teamShortName: string | null;
  teamLogoUrl: string | null;
  jerseyNumber: number | null;
  pj: number;
  goals: number;
  blueCards: number;
  redCards: number;
  penaltiesTotal: number;
  penaltiesScored: number;
}

export interface PlayerCareerSeason {
  seasonId: string;
  seasonName: string;
  isCurrent: boolean;
  startDate: string | null;
  competitionId: string;
  competitionName: string;
  competitionShort: string | null;
  totals: PlayerSeasonTotals;
  teams: PlayerCareerTeam[];
}

export interface PlayerCareer {
  seasons: PlayerCareerSeason[];
  totals: PlayerSeasonTotals;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ─── Cabecera del jugador ─────────────────────────────────────────────────────

function PlayerHeader({ data }: { data: PlayerDetail }) {
  const { t, locale } = useT();
  const { player, currentTeam } = data;
  const age = calcAge(player.birthDate);
  // La fuente sólo distingue al portero (match_lineups.is_goalkeeper); no da la
  // posición de los jugadores de pista. Por eso el badge sólo aparece para
  // porteros — antes mapeaba DF/FW/PL sobre una columna que siempre era NULL.
  const isGK = player.isGoalkeeper;
  const posKey = isGK ? 'player.pos_gk' : null;

  return (
    <div className="card px-5 py-5 space-y-4">
      <div className="relative flex items-start gap-5">
        {/* Avatar — foto real de la ficha con fallback a silueta */}
        <div className="relative shrink-0">
          <PlayerAvatar
            photoUrl={player.photoUrl}
            name={`${player.firstName} ${player.lastName}`}
          />
          {currentTeam?.jerseyNumber != null && (
            <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-rink-passion flex items-center justify-center">
              <span className="text-[10px] font-extrabold text-white font-mono">{currentTeam.jerseyNumber}</span>
            </div>
          )}
        </div>

        {/* Datos: las acciones van en su propia fila, debajo. */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            {posKey && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                isGK
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  : 'bg-rink-passion/10 text-rink-passion'
              }`}>
                {t(posKey)}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50 leading-tight">
            {toTitleCase(`${player.firstName} ${player.lastName}`)}
          </h1>
          {player.birthDate && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <CountryFlag code={player.nationality} className="inline-block w-4 h-auto rounded-[2px] mr-1.5 align-[-1px]" />
              {fmtDate(player.birthDate, locale)}
              {age != null && <span className="ml-2 text-slate-500 dark:text-slate-400">({t('player.years_old', { n: age })})</span>}
            </p>
          )}
          {!player.birthDate && player.nationality && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <CountryFlag code={player.nationality} className="inline-block w-4 h-auto rounded-[2px] mr-1.5 align-[-1px]" />
              {player.nationality}
            </p>
          )}
        </div>
      </div>

      {/* Acciones: seguir (con su campana) y un único compartir. */}
      <div className="flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <FavoriteStar id={player.id} kind="player" name={toTitleCase(`${player.firstName} ${player.lastName}`)} variant="button" />
        <ManageNotificationsButton kind="player" id={player.id} name={toTitleCase(`${player.firstName} ${player.lastName}`)} />
        <ShareSheet
          kind="player" entityId={player.id} name={toTitleCase(`${player.firstName} ${player.lastName}`)}
          title={toTitleCase(`${player.firstName} ${player.lastName}`)}
          imagePath={`/players/${player.id}/share-image`} className="ml-auto"
        />
      </div>

      {/* Equipo actual */}
      {currentTeam && (
        <Link
          href={`/teams/${currentTeam.id}`}
          className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700">
            {currentTeam.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentTeam.logoUrl} alt={currentTeam.name} width={32} height={32} decoding="async" className="w-full h-full object-contain" />
            ) : (
              <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400 uppercase">
                {(currentTeam.shortName ?? currentTeam.name).slice(0, 2)}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('player.current_team')}</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{currentTeam.name}</p>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0">
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      )}
    </div>
  );
}

// ─── Grid de métricas clave ───────────────────────────────────────────────────

function StatCard({ label, value, accent = false }: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="card flex flex-col items-center py-4 px-2 gap-1">
      <span className={`font-mono text-2xl font-extrabold tabular-nums leading-none ${
        accent ? 'text-rink-passion' : 'text-slate-900 dark:text-slate-50'
      }`}>
        {value}
      </span>
      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-center">
        {label}
      </span>
    </div>
  );
}

function StatsGrid({ data }: { data: PlayerDetail }) {
  const { t } = useT();
  const s = data.seasonTotals;
  const hasAnyData = s.pj > 0 || s.goals > 0 || s.blueCards > 0 || s.redCards > 0;

  if (!hasAnyData) {
    return (
      <div className="card p-6 text-center opacity-60">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('player.no_season_stats')}</p>
      </div>
    );
  }

  const penStr = s.penaltiesTotal > 0 ? `${s.penaltiesScored}/${s.penaltiesTotal}` : '—';

  return (
    <div>
      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 px-1">
        {t('player.current_season')}
      </p>
      <div className="grid grid-cols-5 gap-2">
        <StatCard label={t('player.col_pj')} value={s.pj} />
        <StatCard label={t('player.col_g')}  value={s.goals} accent={s.goals > 0} />
        <StatCard label={t('player.col_as')} value={s.assists > 0 ? s.assists : '—'} />
        <StatCard label={t('player.col_az')} value={s.blueCards > 0 ? s.blueCards : '—'} />
        <StatCard label={t('player.col_rj')} value={s.redCards  > 0 ? s.redCards  : '—'} />
      </div>
      {s.penaltiesTotal > 0 && (
        <div className="mt-2 card py-3 px-4 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">{t('player.pen_scored_shot')}</span>
          <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-50 tabular-nums">{penStr}</span>
        </div>
      )}
    </div>
  );
}

// ─── Tabla de rendimiento por competición ─────────────────────────────────────

// #353: rejilla compartida por cabecera y filas. En móvil se ocultan las columnas
// placeholder (As y FD, siempre "—" por actas pendientes) para que el nombre de
// la competición siga siendo legible a 320 px; desde sm se muestran las 7.
const COMP_TABLE_GRID =
  'grid grid-cols-[minmax(0,1fr)_repeat(5,32px)] ' +
  'sm:grid-cols-[minmax(0,1fr)_repeat(7,32px)] gap-x-1';
const MOBILE_HIDDEN_COLS = new Set([2, 5]); // As, FD

function CompStatsTable({ rows }: { rows: PlayerCompStats[] }) {
  const { t } = useT();

  if (rows.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('player.no_comp_records')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('player.comp_records_hint')}</p>
      </div>
    );
  }

  const cols = [
    t('player.col_pj'), t('player.col_g'), t('player.col_as'),
    t('player.col_az'), t('player.col_rj'), t('player.col_fd'), t('player.col_pe'),
  ];

  return (
    <div className="card overflow-hidden">
      {/* Cabecera */}
      <div className={`${COMP_TABLE_GRID} px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800`}>
        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('player.competition')}</span>
        {cols.map((h, i) => (
          <span key={h} className={`text-[10px] font-bold text-center uppercase tracking-wider ${
            i >= 5
              ? 'text-slate-300 dark:text-slate-600'
              : 'text-slate-500 dark:text-slate-400'
          } ${MOBILE_HIDDEN_COLS.has(i) ? 'hidden sm:block' : ''}`}>
            {h}
          </span>
        ))}
      </div>

      {/* Filas */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {rows.map((r) => {
          const penStr = r.penaltiesTotal > 0
            ? `${r.penaltiesScored}/${r.penaltiesTotal}`
            : '—';

          return (
            <div
              key={r.competitionId}
              className={`${COMP_TABLE_GRID} px-3 py-3 items-center`}
            >
              {/* Competición */}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate leading-snug">
                  {r.competitionShort ?? r.competitionName}
                </p>
                {r.competitionShort && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{r.competitionName}</p>
                )}
              </div>

              {/* PJ */}
              <span className="font-mono text-xs text-center tabular-nums text-slate-700 dark:text-slate-300">{r.pj}</span>

              {/* G */}
              <span className={`font-mono text-xs text-center tabular-nums font-bold ${
                r.goals > 0 ? 'text-rink-passion' : 'text-slate-500 dark:text-slate-400'
              }`}>
                {r.goals > 0 ? r.goals : '—'}
              </span>

              {/* As — pendiente de acta (oculta en móvil, #353) */}
              <span className="hidden sm:block font-mono text-xs text-center tabular-nums text-slate-300 dark:text-slate-700">—</span>

              {/* Az */}
              <span className={`font-mono text-xs text-center tabular-nums font-semibold ${
                r.blueCards > 0 ? 'text-blue-500 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
              }`}>
                {r.blueCards > 0 ? r.blueCards : '—'}
              </span>

              {/* Rj */}
              <span className={`font-mono text-xs text-center tabular-nums font-semibold ${
                r.redCards > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
              }`}>
                {r.redCards > 0 ? r.redCards : '—'}
              </span>

              {/* FD — pendiente de actas (oculta en móvil, #353) */}
              <span className="hidden sm:block font-mono text-xs text-center tabular-nums text-slate-300 dark:text-slate-700">—</span>

              {/* PE */}
              <span className={`font-mono text-xs text-center tabular-nums ${
                r.penaltiesTotal > 0 ? 'text-slate-700 dark:text-slate-300 font-semibold' : 'text-slate-300 dark:text-slate-700'
              }`}>
                {penStr}
              </span>
            </div>
          );
        })}
      </div>

      {/* Nota sobre columnas pendientes */}
      <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          {t('player.pending_note')}
        </p>
      </div>
    </div>
  );
}

// ─── Trayectoria / carrera ────────────────────────────────────────────────────

function TeamCrest({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  return (
    <div className="w-6 h-6 rounded-full bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={name} width={24} height={24} loading="lazy" decoding="async" className="w-full h-full object-contain" />
      ) : (
        <span className="text-[7px] font-bold text-slate-500 dark:text-slate-400 uppercase">{name.slice(0, 2)}</span>
      )}
    </div>
  );
}

/**
 * Trayectoria del jugador agrupada por temporada. Enlaza cada equipo y cada
 * competición en HTML SSR (#339): son datos navegables que el crawler descubre
 * sin depender del sitemap.
 */
function CareerSection({ career }: { career: PlayerCareer }) {
  const { t } = useT();
  if (career.seasons.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 px-1">
        {t('player.career')}
      </p>
      <div className="card overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/60">
        {career.seasons.map((season) => (
          <div key={season.seasonId} className="px-3 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{season.seasonName}</span>
              {season.isCurrent && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rink-passion/10 text-rink-passion">
                  {t('player.career_current')}
                </span>
              )}
            </div>

            <Link
              href={`/competitions/${season.competitionId}?season=${season.seasonId}`}
              className="inline-block max-w-full truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:text-rink-passion dark:hover:text-rink-passion"
            >
              {season.competitionShort ?? season.competitionName}
            </Link>

            <div className="space-y-1">
              {season.teams.map((team) => (
                <Link
                  key={team.teamId}
                  href={`/teams/${team.teamId}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <TeamCrest logoUrl={team.teamLogoUrl} name={team.teamName} />
                  <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {team.teamName}
                  </span>
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {team.pj} {t('player.col_pj')}
                  </span>
                  <span className={`font-mono text-xs tabular-nums font-bold ${
                    team.goals > 0 ? 'text-rink-passion' : 'text-slate-300 dark:text-slate-700'
                  }`}>
                    {team.goals} {t('player.col_g')}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            {t('player.career_totals')}
          </span>
          <span className="font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums">
            {career.totals.pj} {t('player.col_pj')} · {career.totals.goals} {t('player.col_g')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Vista completa ───────────────────────────────────────────────────────────

export function PlayerProfileClient({ data }: { data: PlayerDetail & { career?: PlayerCareer | null } }) {
  const { t } = useT();

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-5">
      {/* Volver */}
      <Link
        href={data.currentTeam ? `/teams/${data.currentTeam.id}` : '/'}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
          <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {data.currentTeam ? data.currentTeam.shortName ?? data.currentTeam.name : t('navigation.back')}
      </Link>

      {/* Cabecera */}
      <PlayerHeader data={data} />

      {/* Grid de métricas */}
      <StatsGrid data={data} />

      {/* Tabla por competición */}
      {data.statsByCompetition.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 px-1">
            {t('player.breakdown')}
          </p>
          <CompStatsTable rows={data.statsByCompetition} />
        </div>
      )}

      {/* Trayectoria (#217): equipos por temporada + totales de carrera */}
      {data.career && <CareerSection career={data.career} />}
    </div>
  );
}

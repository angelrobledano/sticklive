'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TeamDetail, TeamMatchSummary, SquadPlayer } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { PlayerAvatar } from '@/components/shared/PlayerAvatar';
import { playerDisplayName, toTitleCase, clubName } from '@/lib/names';
import { FavoriteStar } from '@/components/shared/FavoriteStar';
import { ManageNotificationsButton } from '@/components/shared/ManageNotificationsButton';
import { ShareButton } from '@/components/shared/ShareButton';
import { useT } from '@/lib/i18n';
import { APP_TZ } from '@/lib/match-time';


// ─── Helpers ───────────────────────────────────────────────────────────

// La zona de la competición del partido (columna 042); cae a Europe/Madrid. Un
// equipo puede jugar en varias competiciones, así que la TZ es por partido.
function formatTime(iso: string | null, locale = 'es', tz?: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', timeZone: tz || APP_TZ,
  });
}

function formatMatchDate(iso: string | null, locale = 'es', tz?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale, {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: tz || APP_TZ,
  });
}

// ─── Cabecera del club ──────────────────────────────────────────────────

function FormBadge({ result }: { result: string }) {
  const { t } = useT();
  const map: Record<string, { bg: string; label: string }> = {
    W: { bg: 'bg-emerald-500', label: t('team.form_w') },
    D: { bg: 'bg-slate-400 dark:bg-slate-500', label: t('team.form_d') },
    L: { bg: 'bg-red-500', label: t('team.form_l') },
  };
  const { bg, label } = map[result] ?? { bg: 'bg-slate-200 dark:bg-slate-700', label: '?' };
  return (
    <div className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center shrink-0`}>
      <span className="text-white text-xs font-bold">{label}</span>
    </div>
  );
}

function TeamHeader({ data }: { data: TeamDetail }) {
  const { team, standing } = data;
  const { t } = useT();
  const form = standing?.form?.slice(-5) ?? [];

  return (
    <div className="card px-5 py-5 space-y-4">
      {/* Escudo + nombre */}
      <div className="flex items-center gap-4">
        <TeamShield teamId={team.id} teamName={team.name} size={80} rounded="rounded-2xl" className="p-1" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 leading-tight">
            {/* Fase 0.3: preferimos el nombre canónico del club cuando existe;
                si no (club_id NULL en prod hasta el backfill 0.2), fallback al
                team. Pasa por clubName() igual, así no hay regresión visual. */}
            {clubName(team.club?.canonicalName ?? team.name)}
          </h1>
          {team.city && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{team.city}</p>
          )}
          {standing && (
            <Link
              href={`/competitions/${standing.seasonId}`}
              className="inline-block mt-1 text-xs font-medium text-rink-passion hover:underline"
            >
              {standing.competitionShort ?? standing.competitionName}
            </Link>
          )}
        </div>

        {/* Compartir + Seguir/Siguiendo */}
        <div className="flex items-center gap-1 shrink-0 self-start">
          <ShareButton kind="team" title={clubName(team.name)} />
          <FavoriteStar
            id={team.id}
            kind="team"
            name={team.shortName ?? team.name}
            variant="button"
          />
          <ManageNotificationsButton kind="team" id={team.id} name={team.shortName ?? team.name} />
        </div>
      </div>

      {/* Racha de últimos resultados */}
      {form.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-600 font-semibold mb-2">
            {t('team.last_results')}
          </p>
          <div className="flex gap-2">
            {form.map((r, i) => <FormBadge key={i} result={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab A: Resumen ──────────────────────────────────────────────────

function MiniMatchCard({ match, teamId }: { match: TeamMatchSummary; teamId: string }) {
  const { t, locale } = useT();
  const isHome = match.homeTeam.id === teamId;
  const opp  = isHome ? match.awayTeam  : match.homeTeam;
  const isFinished = match.status === 'finished';
  const isLive     = match.status === 'live';
  const showScore  = isFinished || isLive;

  const myScore  = isHome ? match.score.home : match.score.away;
  const oppScore = isHome ? match.score.away : match.score.home;
  const won  = showScore && myScore !== null && oppScore !== null && myScore > oppScore;
  const drew = showScore && myScore !== null && oppScore !== null && myScore === oppScore;

  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl transition-colors"
    >
      {/* Resultado badge */}
      <div className={`w-1.5 self-stretch rounded-full shrink-0 ${
        !showScore ? 'bg-slate-200 dark:bg-slate-700' :
        won  ? 'bg-emerald-500' :
        drew ? 'bg-slate-400' : 'bg-red-500'
      }`} />

      {/* Equipo rival */}
      <TeamShield teamId={opp.id} teamName={opp.name} size={28} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
          {isHome ? 'vs' : '@'} {opp.shortName ?? opp.name}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {showScore ? (isLive ? t('playoffs.live') : formatMatchDate(match.scheduledAt ?? match.finishedAt, locale, match.competitionTimezone)) : formatMatchDate(match.scheduledAt, locale, match.competitionTimezone)}
        </p>
      </div>

      {/* Marcador / hora */}
      <div className="text-right shrink-0">
        {showScore ? (
          <span className="font-score text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
            {myScore ?? 0} – {oppScore ?? 0}
          </span>
        ) : (
          <span className="font-score text-sm font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
            {formatTime(match.scheduledAt, locale, match.competitionTimezone)}
          </span>
        )}
      </div>
    </Link>
  );
}

function SummaryTab({ data }: { data: TeamDetail }) {
  const { t } = useT();
  const { standing, matches, team } = data;

  const nextMatch = matches.find(
    (m) => m.status === 'scheduled' || m.status === 'live'
  );
  const lastFinished = matches
    .filter((m) => m.status === 'finished')
    .at(-1);

  return (
    <div className="space-y-4">
      {/* Standing card */}
      {standing ? (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {standing.competitionName}
            </h3>
            <Link
              href={`/competitions/${standing.seasonId}`}
              className="text-xs font-medium text-rink-passion hover:underline"
            >
              {t('team.view_full_table')} →
            </Link>
          </div>
          <div className="flex items-center gap-6">
            {/* Posición */}
            <div className="text-center">
              <p className="text-3xl font-extrabold text-slate-900 dark:text-slate-50 leading-none">
                {standing.position ?? '—'}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide mt-1">{t('team.position')}</p>
            </div>
            <div className="w-px self-stretch bg-slate-100 dark:bg-slate-800" />
            {/* Puntos */}
            <div className="text-center">
              <p className="text-3xl font-extrabold text-rink-passion leading-none">{standing.points}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide mt-1">{t('team.points')}</p>
            </div>
            <div className="w-px self-stretch bg-slate-100 dark:bg-slate-800" />
            {/* PJ / W / D / L */}
            <div className="flex gap-4 flex-1 justify-end">
              {([
                [t('standings.cols.played'), standing.played],
                [t('standings.cols.won'), standing.won],
                [t('standings.cols.drawn'), standing.drawn],
                [t('standings.cols.lost'), standing.lost],
              ] as [string, number][]).map(([label, val]) => (
                <div key={label} className="text-center">
                  <p className="text-base font-bold text-slate-800 dark:text-slate-200 leading-none">{val}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide mt-1">{label}</p>
                </div>
              ))}
            </div>
          </div>
          {/* Goles */}
          <div className="flex gap-6 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 text-sm text-slate-500 dark:text-slate-400">
            <span>{t('standings.cols.gf')}: <strong className="text-slate-700 dark:text-slate-300">{standing.goalsFor}</strong></span>
            <span>{t('standings.cols.ga')}: <strong className="text-slate-700 dark:text-slate-300">{standing.goalsAgainst}</strong></span>
            <span>{t('standings.cols.gd')}: <strong className={standing.goalDiff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>
              {standing.goalDiff >= 0 ? '+' : ''}{standing.goalDiff}
            </strong></span>
          </div>
        </div>
      ) : (
        <div className="card p-5 opacity-60 text-center">
          <p className="text-sm text-slate-400 dark:text-slate-600">{t('standings.no_data')}</p>
        </div>
      )}

      {/* Próximo partido */}
      {nextMatch && (
        <div className="card overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              {nextMatch.status === 'live' ? `🟢 ${t('team.now')}` : t('team.next_match')}
            </p>
          </div>
          <MiniMatchCard match={nextMatch} teamId={team.id} />
        </div>
      )}

      {/* Último resultado */}
      {lastFinished && (
        <div className="card overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('team.last_result')}</p>
          </div>
          <MiniMatchCard match={lastFinished} teamId={team.id} />
        </div>
      )}
    </div>
  );
}

// ─── Tab B: Calendario ───────────────────────────────────────────────

function CalendarTab({ data }: { data: TeamDetail }) {
  const { t, locale } = useT();
  const { matches, team } = data;

  if (matches.length === 0) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-400 dark:text-slate-600">{t('team.no_season_matches')}</p>
      </div>
    );
  }

  // Agrupar por mes. El encabezado de mes se ancla en Madrid a propósito: el mes
  // no cambia por 1 h de zona y así el agrupado es estable entre competiciones.
  const groups = new Map<string, TeamMatchSummary[]>();
  for (const m of matches) {
    const date = new Date(m.scheduledAt ?? m.finishedAt ?? '');
    const key = isNaN(date.getTime()) ? t('team.no_date') :
      date.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([month, group]) => (
        <div key={month} className="card overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest capitalize">
              {month}
            </p>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {group.map((m) => (
              <MiniMatchCard key={m.id} match={m} teamId={team.id} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tab C: Plantilla ───────────────────────────────────────────────

/** Clave i18n de la posición según el flag de portero (traducir con t()). */
function positionKey(isGK: boolean): string {
  return isGK ? 'team.gk_pos' : 'team.player_pos';
}

function PlayerRow({ player }: { player: SquadPlayer }) {
  const { t } = useT();
  const gk = player.isGoalkeeper;
  const hasStats = player.goals > 0 || player.blueCards > 0 || player.redCards > 0;

  return (
    <Link
      href={`/players/${player.playerId}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group"
    >
      {/* Número */}
      <span className="w-6 text-center text-xs font-mono text-slate-400 dark:text-slate-600 shrink-0">
        {player.jerseyNumber ?? '—'}
      </span>

      {/* Avatar — foto real con fallback a silueta */}
      <PlayerAvatar
        photoUrl={player.photoUrl}
        name={`${player.firstName} ${player.lastName}`}
        className="w-8 h-8 rounded-full shrink-0"
      />

      {/* Nombre + posición */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 group-hover:text-rink-passion transition-colors truncate"
           title={toTitleCase(`${player.firstName} ${player.lastName}`)}>
          {playerDisplayName(player.firstName, player.lastName)}
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{t(positionKey(player.isGoalkeeper))}</p>
      </div>

      {/* Badge portero */}
      {gk && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shrink-0">
          PO
        </span>
      )}

      {/* Stats */}
      {hasStats && (
        <div className="flex gap-3 shrink-0">
          {player.goals > 0 && (
            <div className="text-center">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">{player.goals}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-600">{t('player.col_g')}</p>
            </div>
          )}
          {player.blueCards > 0 && (
            <div className="text-center">
              <p className="text-xs font-bold text-blue-600 dark:text-blue-400 tabular-nums">{player.blueCards}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-600">{t('player.col_az')}</p>
            </div>
          )}
          {player.redCards > 0 && (
            <div className="text-center">
              <p className="text-xs font-bold text-red-600 dark:text-red-400 tabular-nums">{player.redCards}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-600">{t('player.col_rj')}</p>
            </div>
          )}
        </div>
      )}

      {/* Flecha */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-slate-300 dark:text-slate-700 shrink-0">
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

function SquadTab({ data }: { data: TeamDetail }) {
  const { squad } = data;
  const { t } = useT();

  if (squad.length === 0) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-400 dark:text-slate-600">{t('team.stats_empty')}</p>
      </div>
    );
  }

  const goalkeepers = squad.filter((p) => p.isGoalkeeper);
  const outfield    = squad.filter((p) => !p.isGoalkeeper);

  return (
    <div className="space-y-4">
      {goalkeepers.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 pt-3 pb-2">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('team.gk_pos')}</p>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {goalkeepers.map((p) => <PlayerRow key={p.playerId} player={p} />)}
          </div>
        </div>
      )}

      {outfield.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 pt-3 pb-2">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('team.players')}</p>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {outfield.map((p) => <PlayerRow key={p.playerId} player={p} />)}
          </div>
        </div>
      )}

      {/* Cuerpo técnico — del último acta procesada */}
      <StaffSection staff={data.staff} />
    </div>
  );
}

// ─── Cuerpo técnico ────────────────────────────────────────────────

const STAFF_ROLE_LABELS: Record<string, string> = {
  E:  'team.coach',
  E1: 'team.coach',
  E2: 'team.coach2',
  A:  'team.assistant',
  D:  'team.delegate',
};

function staffDisplayName(raw: string): string {
  // "ARES LOZANO RICARDO" → "Ricardo Ares"
  const parts = raw.trim().split(/\s+/);
  const title = (s: string) => s.toLowerCase().replace(/(^|\s|-)\p{L}/gu, (m) => m.toUpperCase());
  if (parts.length === 1) return title(raw);
  return title(`${parts[parts.length - 1]} ${parts[0]}`);
}

function StaffSection({ staff }: { staff: TeamDetail['staff'] }) {
  const { t } = useT();
  if (!staff || staff.length === 0) return null;
  return (
    <div className="card overflow-hidden mt-4">
      <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('team.staff')}
        </span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {staff.map((s) => (
          <div key={`${s.role}-${s.name}`} className="flex items-center gap-3 px-4 py-2.5">
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                   className="w-4 h-4 text-slate-400 dark:text-slate-600">
                <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            </div>
            <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
              {staffDisplayName(s.name)}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {STAFF_ROLE_LABELS[s.role] ? t(STAFF_ROLE_LABELS[s.role]!) : s.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab D: Estadísticas del equipo ──────────────────────────────────

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-center">
      <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50 leading-tight">{value}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide leading-tight mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

function TeamStatsTab({ data }: { data: TeamDetail }) {
  const s = data.stats;
  const { t } = useT();
  if (!s || s.played === 0) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-400 dark:text-slate-600">
          {t('team.stats_empty')}
        </p>
      </div>
    );
  }

  const fmtPct = (p: { total: number; scored: number; pct: number | null }) =>
    p.total > 0 ? `${p.scored}/${p.total} · ${p.pct}%` : '—';

  return (
    <div className="space-y-4">
      {/* Balance */}
      <div className="card p-4 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('team.balance')}
        </p>
        <div className="grid grid-cols-4 gap-2">
          <StatTile label={t('team.played')} value={s.played} />
          <StatTile label={t('team.won')} value={s.won} />
          <StatTile label={t('team.drawn')} value={s.drawn} />
          <StatTile label={t('team.lost')} value={s.lost} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label={t('team.goals_for')} value={s.goalsFor} />
          <StatTile label={t('team.goals_against')} value={s.goalsAgainst} />
          <StatTile label={t('hockey_stats.assists')} value={s.assists} />
        </div>
      </div>

      {/* Disciplina */}
      <div className="card p-4 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('team.discipline')}
        </p>
        <div className="grid grid-cols-4 gap-2">
          <StatTile label={t('hockey_stats.team_fouls')} value={s.teamFouls} />
          <StatTile label={t('hockey_stats.blue_cards')} value={s.blueCards} />
          <StatTile label={t('hockey_stats.red_cards')} value={s.redCards} />
          <StatTile label={t('hockey_stats.time_outs')} value={s.timeouts} />
        </div>
      </div>

      {/* Bola parada */}
      <div className="card p-4 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('team.set_pieces')}
        </p>
        <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
          <span className="text-sm text-slate-700 dark:text-slate-300">{t('team.direct_fouls')}</span>
          <span className={`text-sm font-bold tabular-nums ${
            (s.directFouls.pct ?? 0) >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'
          }`}>
            {fmtPct(s.directFouls)}
          </span>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm text-slate-700 dark:text-slate-300">{t('team.penalties')}</span>
          <span className={`text-sm font-bold tabular-nums ${
            (s.penalties.pct ?? 0) >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'
          }`}>
            {fmtPct(s.penalties)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────

const TABS = ['Resumen', 'Calendario', 'Plantilla', 'Estadísticas'] as const;
type Tab = typeof TABS[number];
const TAB_KEYS: Record<Tab, string> = {
  'Resumen':      'match_tabs.summary',
  'Calendario':   'team.calendar',
  'Plantilla':    'team.squad',
  'Estadísticas': 'match_tabs.stats',
};

export function TeamCenterClient({ data }: { data: TeamDetail }) {
  const [activeTab, setActiveTab] = useState<Tab>('Resumen');
  const { t } = useT();

  return (
    <div className="space-y-4">
      <TeamHeader data={data} />

      {/* Pestañas */}
      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === tab
                ? 'border-rink-passion text-rink-passion'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(TAB_KEYS[tab])}
          </button>
        ))}
      </div>

      {activeTab === 'Resumen'      && <SummaryTab    data={data} />}
      {activeTab === 'Calendario'   && <CalendarTab   data={data} />}
      {activeTab === 'Plantilla'    && <SquadTab      data={data} />}
      {activeTab === 'Estadísticas' && <TeamStatsTab  data={data} />}
    </div>
  );
}

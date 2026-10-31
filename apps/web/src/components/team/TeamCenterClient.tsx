'use client';

import { useViewerTz } from '@/hooks/useViewerTz';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useRouter } from 'next/navigation';
import type { TeamDetail, TeamMatchSummary, TeamSeason } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName } from '@/lib/names';
import { FavoriteStar } from '@/components/shared/FavoriteStar';
import { ManageNotificationsButton } from '@/components/shared/ManageNotificationsButton';
import { ShareSheet } from '@/components/shared/ShareSheet';
import { TeamCalendar } from '@/components/team/TeamCalendar';
import { TeamStatsStory } from '@/components/team/TeamStatsStory';
import { SquadTable } from '@/components/team/SquadTable';
import { useLocale, useT } from '@/lib/i18n';
import { withLocaleHref } from '@/lib/locale-links';
import { APP_TZ, isTimeTbd, timeTbdLabel } from '@/lib/match-time';
import { isKnockoutSeason, buildKnockoutSummary, knockoutPhaseLabel } from '@/lib/knockout';
import { KnockoutSeasonSummary } from './KnockoutSeasonSummary';
import { tt } from '@/components/search/translate';
import { competitionPath } from '@/lib/competition-path';
import { clubTeamLabel, groupClubSections } from '@/lib/club-sections';
import type { Locale } from '@/lib/locales';

// ─── Sección de club (#196/#197) ───────────────────────────────────────
// La API `team-detail` ya devuelve los campos de sección (club × género ×
// categoría × filial) y las otras secciones del club. El DTO base
// (`@/lib/api/types`) aún no los declara; se amplían aquí en vez de tocar un
// fichero compartido fuera de este lote. Todos los campos son opcionales, así
// que un `TeamDetail` "antiguo" sigue siendo asignable.
export interface TeamSectionFields {
  gender?: string | null;
  ageCategory?: string | null;
  squadLevel?: number | null;
  teamType?: string | null;
  sectionSuffix?: string;
}

export interface ClubTeamSummary extends TeamSectionFields {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  /** API ≥ 2026-10-30: sección y competición actual de cada equipo del club. */
  section?: 'senior' | 'senior_female' | 'base' | 'veterans';
  competition?: { id: string; slug: string | null; name: string } | null;
}

export type TeamDetailView = TeamDetail & {
  team: TeamDetail['team'] & TeamSectionFields;
  clubTeams?: ClubTeamSummary[];
};

// ─── Helpers ───────────────────────────────────────────────────────────

/** Categorías con etiqueta propia en `age_categories.*` (migración 017). */
const KNOWN_AGE_CATEGORIES = new Set([
  'senior', 'juvenil', 'junior', 'infantil', 'alevin', 'benjamin', 'prebenjamin', 'veteranos', 'base',
]);

/**
 * #196: letra de filial ('B','C'…) para el badge; '' para el primer equipo.
 * Espeja `squadLevelLetter` de `apps/api/src/lib/team-section.ts` (la web no
 * puede importar del workspace de la API).
 */
function squadLevelLetter(level: number | null | undefined): string {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.trunc(level) : 1;
  if (n < 2) return '';
  return String.fromCharCode(64 + Math.min(n, 26));
}

/** Categoría de edad visible: 'sub19' → 'Sub-19'; conocidas → etiqueta i18n. */
function ageCategoryLabel(raw: string | null | undefined, t: (key: string) => string): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, '');
  const sub = /^(?:sub|u)-?(\d{1,2})$/.exec(key);
  if (sub) return `Sub-${sub[1]}`;
  return KNOWN_AGE_CATEGORIES.has(key) ? t(`age_categories.${key}`) : null;
}

/**
 * #196: etiqueta legible de la sección (género · categoría · filial) para
 * desambiguar dos fichas del mismo club. Pura: recibe `t` para poder testearla
 * sin proveedor i18n. Devuelve '' si no hay nada que mostrar.
 */
export function sectionBadgeText(
  team: { gender?: string | null; ageCategory?: string | null; squadLevel?: number | null },
  t: (key: string) => string,
): string {
  const parts: string[] = [];
  if (team.gender === 'female') parts.push(t('common.female'));
  else if (team.gender === 'male') parts.push(t('common.male'));
  const age = ageCategoryLabel(team.ageCategory, t);
  if (age) parts.push(age);
  const letter = squadLevelLetter(team.squadLevel);
  if (letter) parts.push(`${t('team.filial')} ${letter}`);
  return parts.join(' · ');
}

/**
 * Etiqueta de una opción del selector de temporada: "Competición · 2025/26"
 * (+ "· Actual" si es la vigente). Pura: recibe `t` para testearla sin i18n.
 */
export function seasonOptionLabel(s: TeamSeason, t: (key: string) => string): string {
  const comp = s.competitionShort ?? s.competitionName;
  return `${comp} · ${s.name}${s.isCurrent ? ` · ${t('common.current')}` : ''}`;
}

// La zona de la competición del partido (columna 042); cae a Europe/Madrid. Un
// equipo puede jugar en varias competiciones, así que la TZ es por partido.
function formatTime(iso: string | null, locale = 'es', tz?: string | null): string {
  if (!iso) return '--:--';
  if (isTimeTbd(iso)) return timeTbdLabel(locale);
  // Ciclo horario forzado a 23 (0-23): con locale 'en' el defecto es 12h AM/PM,
  // impropio de un producto europeo (#413). Válido en todos los locales.
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz || APP_TZ,
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

function TeamHeader({ data }: { data: TeamDetailView }) {
  const { team, standing } = data;
  const { t } = useT();
  const router = useRouter();
  const locale = useLocale();
  const seasons = data.seasons ?? [];
  const form = standing?.form?.slice(-5) ?? [];
  // #196: dos secciones del mismo club comparten nombre canónico; el badge las
  // distingue (p. ej. "Femenino · Senior", "Masculino · Senior · Filial B").
  const section = sectionBadgeText(team, t);

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
            {clubName(team.name)}
          </h1>
          {section && (
            <span className="inline-block mt-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {section}
            </span>
          )}
          {team.city && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{team.city}</p>
          )}
          {standing && (
            <Link
              href={competitionPath(standing.competitionId, standing.competitionSlug, standing.seasonId)}
              className="inline-block mt-1 text-xs font-medium text-rink-passion hover:underline"
            >
              {standing.competitionShort ?? standing.competitionName}
            </Link>
          )}

          {/* Selector de temporada: acota la ficha (clasificación, partidos,
              plantilla y stats) a la temporada elegida. Solo si hay más de una.
              Navega a `?season=` → el servidor re-renderiza con esa temporada. */}
          {seasons.length > 1 && (
            <select
              value={data.selectedSeasonId ?? ''}
              onChange={(e) => {
                // Preserva `?tab=` (y otros): cambiar de temporada no debe
                // devolver al usuario a la pestaña Resumen.
                const params = new URLSearchParams(window.location.search);
                params.set('season', e.target.value);
                router.push(withLocaleHref(`/teams/${team.id}?${params.toString()}`, locale));
              }}
              className="block max-w-full mt-1 text-xs font-light text-slate-500 dark:text-slate-400
                         bg-transparent border-0 rounded-md px-1 py-0 pr-6 cursor-pointer appearance-auto
                         hover:text-slate-600 dark:hover:text-slate-300
                         focus:outline-none focus:ring-1 focus:ring-rink-passion dark:focus:ring-rink-accent"
              aria-label={tt(t, 'team.season', 'Temporada')}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>{seasonOptionLabel(s, t)}</option>
              ))}
            </select>
          )}
        </div>

      </div>

      {/* Acciones: seguir (con su campana) y un único compartir. Antes eran
          cuatro iconos sueltos montados sobre el nombre. */}
      <div className="flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <FavoriteStar id={team.id} kind="team" name={team.shortName ?? team.name} variant="button" />
        <ManageNotificationsButton kind="team" id={team.id} name={team.shortName ?? team.name} />
        <ShareSheet
          kind="team" entityId={team.id} name={clubName(team.name)} title={clubName(team.name)}
          imagePath={`/teams/${team.id}/share-image`} className="ml-auto"
        />
      </div>

      {/* Racha de últimos resultados */}
      {form.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-semibold mb-2">
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

// ─── Club: otras secciones + búsqueda de equipos (#197) ───────────────

/** Equipos del club visibles antes de «Ver todos»: lo justo para orientarse. */
const CLUB_TEAMS_PREVIEW = 6;

function ClubSection({ data }: { data: TeamDetailView }) {
  const { t, locale } = useT();
  const { clubTeams = [] } = data;
  const [expanded, setExpanded] = useState(false);
  // Agrupados por sección y nombrados por categoría («Alevín B · Aleví Plata»),
  // en rejilla compacta: un club con 18 equipos no debe empujar la ficha
  // hacia abajo. Recogido, solo los primeros; el resto con «Ver todos».
  const groups = useMemo(() => groupClubSections(clubTeams), [clubTeams]);
  if (clubTeams.length === 0) return null;

  const collapsible = clubTeams.length > CLUB_TEAMS_PREVIEW;
  let budget = expanded || !collapsible ? Infinity : CLUB_TEAMS_PREVIEW;
  const shown = groups
    .map((g) => {
      const teams = g.teams.slice(0, Math.max(0, budget));
      budget -= teams.length;
      return { ...g, teams };
    })
    .filter((g) => g.teams.length > 0);

  return (
    <div className="card overflow-hidden px-4 pb-3">
      <div className="flex items-baseline justify-between gap-3 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('team.other_teams')} <span className="tabular-nums">· {clubTeams.length}</span>
        </p>
        {data.team.club?.slug && (
          <Link href={`/clubs/${data.team.club.slug}`} className="shrink-0 text-xs font-semibold text-rink-passion hover:underline">
            {t('team.view_club')} →
          </Link>
        )}
      </div>
      {shown.map(({ section, teams }) => (
        <div key={section} className="pt-2">
          <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {tt(t, `club.section_${section}`, section)}
          </p>
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {teams.map((ct) => (
              <li key={ct.id}>
                <Link href={`/teams/${ct.id}`}
                      className="group block rounded-lg border border-slate-200 px-2.5 py-1.5 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60">
                  <span className="block truncate text-[13px] font-semibold text-slate-800 group-hover:text-rink-passion dark:text-slate-200">
                    {clubTeamLabel(ct, locale as Locale)}
                  </span>
                  {ct.competition && (
                    <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {clubName(ct.competition.name)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {collapsible && (
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
                className="mt-2.5 min-h-[36px] w-full rounded-lg text-xs font-semibold text-rink-passion hover:bg-slate-50 dark:text-rink-accent dark:hover:bg-slate-800/60">
          {expanded
            ? tt(t, 'team.club_teams_less', 'Ver menos')
            : tt(t, 'team.club_teams_all', 'Ver los {n} equipos', { n: clubTeams.length })}
        </button>
      )}
    </div>
  );
}

// ─── Tab A: Resumen ──────────────────────────────────────────────────

function MiniMatchCard({ match, teamId, roundLabel }: { match: TeamMatchSummary; teamId: string; roundLabel?: string | null }) {
  const { t, locale } = useT();
  const viewerTz = useViewerTz();
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
          {/* En eliminatorias, la ronda da el contexto que la jornada da en liga */}
          {roundLabel && <span className="font-semibold">{roundLabel} · </span>}
          {showScore ? (isLive ? t('playoffs.live') : formatMatchDate(match.scheduledAt ?? match.finishedAt, locale, viewerTz)) : formatMatchDate(match.scheduledAt, locale, viewerTz)}
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
            {formatTime(match.scheduledAt, locale, viewerTz)}
          </span>
        )}
      </div>
    </Link>
  );
}

function SummaryTab({ data }: { data: TeamDetail }) {
  const { t } = useT();
  const { standing, matches, team } = data;

  // El formato de la competición decide el componente: una eliminatoria
  // (Supercopa, Copa, playoffs) no tiene clasificación — mostrar "Sin datos
  // de clasificación" parecía que faltaban datos. Síntesis de eliminatoria.
  // La derivación de fases usa el CUADRO COMPLETO de la temporada
  // (`knockoutMatches`, lo manda el API en eliminatorias): con sólo los
  // partidos del equipo, su semifinal perdida sería indistinguible de una final.
  const koSeason = isKnockoutSeason(data.season, standing, matches);
  const koSummary = useMemo(
    () => (koSeason ? buildKnockoutSummary(team.id, data.knockoutMatches ?? matches) : null),
    [koSeason, team.id, data.knockoutMatches, matches],
  );

  if (koSeason) {
    // El resumen ya contiene TODOS los partidos del equipo en la competición:
    // los bloques de próximo/último serían duplicado.
    return (
      <KnockoutSeasonSummary
        data={data}
        summary={koSummary}
        renderMatch={(m) => <MiniMatchCard match={m} teamId={team.id} />}
      />
    );
  }

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
              href={competitionPath(standing.competitionId, standing.competitionSlug, standing.seasonId)}
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
            <span>{t('standings.cols.gd')}: <strong className={standing.goalDiff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {standing.goalDiff >= 0 ? '+' : ''}{standing.goalDiff}
            </strong></span>
          </div>
        </div>
      ) : (
        <div className="card p-5 opacity-60 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('standings.no_data')}</p>
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
  const { t } = useT();
  const { matches, team } = data;

  // En eliminatorias, cada partido se etiqueta con su ronda (semis/final…):
  // es el contexto que las jornadas dan en una liga. La misma derivación
  // conservadora del resumen: sin estructura fiable, sin etiquetas.
  const koSeason = isKnockoutSeason(data.season, data.standing, matches);
  const koSummary = useMemo(
    () => (koSeason ? buildKnockoutSummary(team.id, data.knockoutMatches ?? matches) : null),
    [koSeason, team.id, data.knockoutMatches, matches],
  );

  if (matches.length === 0) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('team.no_season_matches')}</p>
      </div>
    );
  }

  return (
    <TeamCalendar
      matches={matches}
      teamId={team.id}
      roundLabelFor={koSummary
        ? (m) => (koSummary.phaseByMatch.get(m.id) ? knockoutPhaseLabel(koSummary.phaseByMatch.get(m.id)!, t) : null)
        : undefined}
    />
  );
}

// ─── Tab C: Plantilla ───────────────────────────────────────────────


function SquadTab({ data }: { data: TeamDetail }) {
  const { squad } = data;
  const { t } = useT();

  if (squad.length === 0) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('team.stats_empty')}</p>
      </div>
    );
  }

  const goalkeepers = squad.filter((p) => p.isGoalkeeper);
  const outfield    = squad.filter((p) => !p.isGoalkeeper);

  return (
    <div className="space-y-4">
      {outfield.length > 0 && <SquadTable players={outfield} title={t('team.players')} />}
      {goalkeepers.length > 0 && <SquadTable players={goalkeepers} title={t('team.gk_pos')} />}

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
                   className="w-4 h-4 text-slate-500 dark:text-slate-400">
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

function TeamStatsTab({ data }: { data: TeamDetail }) {
  const s = data.stats;
  const { t } = useT();
  if (!s || s.played === 0) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('team.stats_empty')}
        </p>
      </div>
    );
  }

  return <TeamStatsStory stats={s} matches={data.matches} teamId={data.team.id} />;
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

/** #352: slugs estables del tab en la URL (?tab=). No dependen del idioma. */
const TAB_SLUG: Record<Tab, string> = {
  'Resumen': 'summary', 'Calendario': 'calendar', 'Plantilla': 'squad', 'Estadísticas': 'stats',
};

/**
 * #352: tab que pide la URL, o `null` si el parámetro falta, no es un slug
 * válido o apunta a una pestaña no visible. Función pura, testeable sin navegador.
 */
export function teamTabFromParam(param: string | null, visible: readonly Tab[] = TABS): Tab | null {
  if (!param) return null;
  const tab = (Object.keys(TAB_SLUG) as Tab[]).find((k) => TAB_SLUG[k] === param);
  return tab && visible.includes(tab) ? tab : null;
}

export function TeamCenterClient({ data }: { data: TeamDetailView }) {
  const [activeTab, setActiveTab] = useState<Tab>('Resumen');
  const { t } = useT();

  // #352: el tab activo viaja en la URL (`?tab=`). Se lee al montar y al usar
  // atrás/adelante; al cambiar se reescribe con `history.replaceState` (sin
  // navegación de Next) para no re-renderizar el árbol servidor.
  const selectTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', TAB_SLUG[tab]);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const applyFromUrl = () => {
      const param = new URLSearchParams(window.location.search).get('tab');
      const tab = teamTabFromParam(param);
      if (tab) setActiveTab(tab);
    };
    applyFromUrl();
    window.addEventListener('popstate', applyFromUrl);
    return () => window.removeEventListener('popstate', applyFromUrl);
  }, []);

  // Los cuatro paneles viven siempre en el DOM (SEO: Googlebot no pulsa
  // pestañas). Se memoizan por `data`: cambiar de pestaña no vuelve a calcular
  // el calendario, la plantilla ni las estadísticas.
  const summaryTab    = useMemo(() => <SummaryTab    data={data} />, [data]);
  const calendarTab   = useMemo(() => <CalendarTab   data={data} />, [data]);
  const squadTab      = useMemo(() => <SquadTab      data={data} />, [data]);
  const teamStatsTab  = useMemo(() => <TeamStatsTab  data={data} />, [data]);

  return (
    <div className="space-y-4">
      <TeamHeader data={data} />

      <ClubSection data={data} />

      {/* Pestañas */}
      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-800 overflow-x-auto scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => selectTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab
                ? 'border-rink-passion text-rink-passion active:bg-rink-passion/5'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 active:bg-slate-50 dark:active:bg-slate-800/60 active:text-slate-900 dark:active:text-slate-100'
            }`}
          >
            {t(TAB_KEYS[tab])}
          </button>
        ))}
      </div>

      {/* SEO (GSC 16-oct-2026): los CUATRO paneles van SIEMPRE en el DOM.
          Googlebot no pulsa pestañas: con el montaje condicional
          (`activeTab === 'X' && <Tab/>`) solo existía el panel activo y las
          fichas de equipo quedaban en ~134 palabras, sin plantilla (12
          jugadores), ni calendario (20 partidos), ni estadísticas — datos que
          ya vienen en las props. Los inactivos se ocultan con `hidden`, que los
          saca del pintado y del árbol de accesibilidad sin desmontarlos. */}
      <div hidden={activeTab !== 'Resumen'}>      {summaryTab}</div>
      <div hidden={activeTab !== 'Calendario'}>   {calendarTab}</div>
      <div hidden={activeTab !== 'Plantilla'}>    {squadTab}</div>
      <div hidden={activeTab !== 'Estadísticas'}> {teamStatsTab}</div>
    </div>
  );
}

import type { MatchDetailRaw } from './api/types';

const APP_TZ = 'Europe/Madrid';
const FOUL_THRESHOLDS = [10, 15, 20, 25, 30];

export type FoulBonusState = 'normal' | 'warning' | 'bonus';

/**
 * En hockey sobre patines:
 * - A la 10ª falta de equipo (y cada 5 adicionales: 15, 20, 25...), se concede falta directa al rival.
 * - A falta de 1 (9, 14, 19, 24...), el equipo está en riesgo inminente de falta directa ('warning').
 * - A partir de la 10ª falta, entra en ciclo de bonus ('bonus').
 */
export function foulBonusState(fouls: number): FoulBonusState {
  if (fouls < 9) return 'normal';
  if (FOUL_THRESHOLDS.some((th) => th - 1 === fouls)) return 'warning';
  if (fouls >= 10) return 'bonus';
  return 'normal';
}

export const TABS = ['Resumen', 'Alineaciones', 'Estadísticas'] as const;
export type Tab = (typeof TABS)[number];

export function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function playerFullName(p: { firstName: string; lastName: string } | null): string {
  if (!p) return '';
  const surname = p.lastName.trim().split(/\s+/)[0] ?? '';
  return toTitleCase(`${p.firstName} ${surname}`.trim());
}

export function displayLineupName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 1) return toTitleCase(parts[0]!);
  const first = parts[parts.length - 1]!;
  const surname = parts[0]!;
  return toTitleCase(`${first} ${surname}`);
}

export function eventSurname(p: { firstName: string; lastName: string }): string {
  const last = (p.lastName || p.firstName).trim().split(/\s+/)[0] ?? '';
  return toTitleCase(last);
}

export function fmtEventClock(ev: { clock?: string | null; minute: number | null }): string {
  if (ev.clock) return ev.clock;
  if (ev.minute == null) return '–:–';
  const remaining = Math.max(0, 25 - ev.minute);
  return `${String(remaining).padStart(2, '0')}:00`;
}

export function formatTime(iso: string | null, tz?: string | null, locale = 'es'): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz || APP_TZ,
  });
}

export function formatDate(iso: string | null, tz?: string | null, locale = 'es'): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: tz || APP_TZ,
  });
}

type WinType = 'regular' | 'overtime' | 'penalties' | null | undefined | string;

export function finalLabelKey(winType: WinType): string {
  if (winType === 'overtime') return 'match_states.final_overtime';
  if (winType === 'penalties') return 'match_states.final_penalties';
  return 'match_states.final';
}

export function penaltyText(
  penalties?: { home: number | null; away: number | null } | null
): string | null {
  if (!penalties || penalties.home == null || penalties.away == null) return null;
  return `${penalties.home} - ${penalties.away}`;
}

export interface AccumulatedFoulEvent {
  id: string;
  eventType: 'accumulated_foul';
  minute: number | null;
  period: number | null;
  clock?: string | null;
  teamId: string;
  isHomeTeam: boolean;
  foulNumber: number;
  detail: null;
  player: null;
}

export interface PeriodDividerEvent {
  id: string;
  eventType: 'period_divider';
  period: number;
  minute: null;
  teamId: null;
  isHomeTeam: boolean;
  detail: null;
  player: null;
}

export const TIMELINE_PREVIEW = 60;

export function timelineWindow<T>(
  events: readonly T[],
  showAll: boolean,
  limit: number = TIMELINE_PREVIEW
): { visible: T[]; hiddenCount: number } {
  const visible = showAll ? events.slice() : events.slice(0, limit);
  return { visible, hiddenCount: events.length - visible.length };
}

export type TimelineEvent =
  | MatchDetailRaw['events'][number]
  | AccumulatedFoulEvent
  | PeriodDividerEvent;

export function injectPeriodDividers(events: TimelineEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  let currentPeriod: number | null = null;
  for (const ev of events) {
    if (ev.period !== null && ev.period !== undefined && ev.period !== currentPeriod) {
      currentPeriod = ev.period;
      result.push({
        id: `pd-${currentPeriod}`,
        eventType: 'period_divider',
        period: currentPeriod,
        minute: null,
        teamId: null,
        isHomeTeam: true,
        detail: null,
        player: null,
      });
    }
    result.push(ev);
  }
  return result;
}

export function injectAccumulatedFouls(
  events: MatchDetailRaw['events'],
  homeTeamId: string
): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  let homeFouls = 0;
  let awayFouls = 0;

  const hasRealFouls = events.some((e) => e.eventType === 'foul');
  const countableType = hasRealFouls ? 'foul' : 'blue_card';

  for (const ev of events) {
    result.push(ev);
    if (ev.eventType === countableType) {
      if (ev.teamId === homeTeamId) {
        homeFouls++;
        if (FOUL_THRESHOLDS.includes(homeFouls)) {
          result.push({
            id: `vf-home-${homeFouls}`,
            eventType: 'accumulated_foul',
            minute: ev.minute,
            period: ev.period,
            clock: ev.clock ?? null,
            teamId: homeTeamId,
            isHomeTeam: true,
            foulNumber: homeFouls,
            detail: null,
            player: null,
          });
        }
      } else if (ev.teamId !== null) {
        awayFouls++;
        if (FOUL_THRESHOLDS.includes(awayFouls)) {
          result.push({
            id: `vf-away-${awayFouls}`,
            eventType: 'accumulated_foul',
            minute: ev.minute,
            period: ev.period,
            clock: ev.clock ?? null,
            teamId: ev.teamId,
            isHomeTeam: false,
            foulNumber: awayFouls,
            detail: null,
            player: null,
          });
        }
      }
    }
  }
  return result;
}

export function clockRemainingSeconds(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const m = /^(\d{1,3}):(\d{2})$/.exec(clock.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function compareTimelineEvents(
  a: Pick<MatchDetailRaw['events'][number], 'period' | 'minute' | 'clock'>,
  b: Pick<MatchDetailRaw['events'][number], 'period' | 'minute' | 'clock'>
): number {
  const pa = a.period ?? 0;
  const pb = b.period ?? 0;
  if (pa !== pb) return pa - pb;

  const ca = clockRemainingSeconds(a.clock);
  const cb = clockRemainingSeconds(b.clock);
  if (ca != null && cb != null && ca !== cb) {
    return cb - ca; // a mayor restante, ocurrió antes
  }

  const ma = a.minute ?? 0;
  const mb = b.minute ?? 0;
  return ma - mb;
}

export function calcEfficiency(scored: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((scored / total) * 100);
}

export interface RinkPlayer {
  jerseyNumber: number | null;
  playerName: string;
  playerId?: string | null;
  isGoalkeeper: boolean;
  isCaptain: boolean;
  isStarter?: boolean;
  photoUrl?: string | null;
}

export interface PlacedRinkPlayer {
  p: RinkPlayer;
  x: number;
  y: number;
  isAway: boolean;
}

/**
 * Posiciones tácticas reglamentarias del hockey sobre patines en media pista (0 a 100).
 * Formación estándar 2-2: dos defensas cerca del área y dos delanteros adelantados.
 */
export function halfPositions(fieldCount: number): { x: number; y: number }[] {
  switch (fieldCount) {
    case 4:
      return [
        { x: 42, y: 28 },
        { x: 42, y: 72 },
        { x: 74, y: 34 },
        { x: 74, y: 66 },
      ];
    case 3:
      return [
        { x: 42, y: 50 },
        { x: 72, y: 28 },
        { x: 72, y: 72 },
      ];
    case 2:
      return [
        { x: 55, y: 32 },
        { x: 55, y: 68 },
      ];
    case 1:
      return [{ x: 55, y: 50 }];
    default:
      return [];
  }
}

/**
 * Posiciona al quinteto inicial (portero + 4 jugadores de campo) en coordenadas absolutas de la pista (0% a 100%).
 * Local ocupa la mitad izquierda (x de 0 a 50%).
 * Visitante ocupa la mitad derecha espejada (x de 50 a 100%).
 */
export function placeRinkPlayers(players: RinkPlayer[], isAway: boolean): PlacedRinkPlayer[] {
  const gk = players.find((p) => p.isGoalkeeper) ?? null;
  const field = players.filter((p) => p !== gk);
  const spots = halfPositions(Math.min(field.length, 4));
  const out: PlacedRinkPlayer[] = [];

  if (gk) {
    const gx = 22; // dentro del área de portería pero separado de la línea de fondo
    out.push({
      p: gk,
      x: isAway ? 100 - gx / 2 : gx / 2,
      y: 50,
      isAway,
    });
  }

  field.slice(0, 4).forEach((p, i) => {
    const s = spots[i]!;
    out.push({
      p,
      x: isAway ? 100 - s.x / 2 : s.x / 2,
      y: s.y,
      isAway,
    });
  });

  return out;
}

export function visibleTabsFor(data: MatchDetailRaw): Tab[] {
  const isStarted = data.match.status === 'live' || data.match.status === 'finished';
  const hasLineups =
    (data.lineups?.home?.length ?? 0) > 0 || (data.lineups?.away?.length ?? 0) > 0;
  const hasStats =
    isStarted &&
    ((data.stats.homeGoals ?? 0) > 0 ||
      (data.stats.awayGoals ?? 0) > 0 ||
      data.stats.homeFouls > 0 ||
      data.stats.awayFouls > 0 ||
      (data.stats.homeBlueCards ?? 0) > 0 ||
      (data.stats.awayBlueCards ?? 0) > 0 ||
      data.events.length > 0);

  return TABS.filter((tab) => {
    if (tab === 'Alineaciones') return hasLineups;
    if (tab === 'Estadísticas') return hasStats;
    return true;
  });
}

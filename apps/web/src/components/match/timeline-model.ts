/**
 * Modelo del timeline de eventos del partido. Lógica pura (sin React):
 * intercala eventos "virtuales" — avisos de falta acumulada (10ª/15ª…) y
 * divisores de periodo — con los `MatchEvent` reales para el render cronológico.
 */
import type { MatchEvent } from '@/lib/api/client';

// Umbrales de falta directa por acumulación (hockey).
const FOUL_THRESHOLDS = [10, 15, 20, 25, 30];

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

export type TimelineEvent = MatchEvent | AccumulatedFoulEvent | PeriodDividerEvent;

/**
 * Inserta un divisor visual al inicio de cada periodo para que se vea
 * de un vistazo en qué parte ocurre cada evento.
 */
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

export function injectAccumulatedFouls(events: MatchEvent[], homeTeamId: string): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  let homeFouls = 0;
  let awayFouls = 0;

  // Base del conteo: eventos 'foul' reales (ficha) si existen;
  // fallback legacy a tarjetas azules para partidos scrapeados antes.
  const hasRealFouls = events.some((e) => e.eventType === 'foul');
  const countableType = hasRealFouls ? 'foul' : 'blue_card';

  for (const ev of events) {
    // Las faltas individuales SÍ se pintan (de forma compacta, con su autor)
    // y además generan las marcas de acumulación 10ª/15ª... (falta directa).
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

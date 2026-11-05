import { matchDisplayState } from '@sports/shared-types';
import { isTimeTbd } from '@sports/core/match-time';
import { finalLabelKey, penaltyText } from '@/src/lib/match-helpers';
import type { MatchScore } from '@sports/core/api';

/**
 * Qué pinta el centro de la fila de la home (paridad con
 * apps/web/src/components/home/MatchRow.tsx). Función pura.
 */
export type RowCenter =
  | { kind: 'live'; halftime: boolean }
  | { kind: 'finished'; finalKey: string; penalties: string | null }
  | { kind: 'postponed' }
  | { kind: 'cancelled' }
  | { kind: 'scheduled'; hint: 'match_states.awaiting_start' | 'match_states.no_result' | null; tbd: boolean };

interface RowMatch {
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  isHalftime?: boolean;
  winType?: 'regular' | 'overtime' | 'penalties' | null;
  penalties?: MatchScore | null;
}

const LIVE = new Set(['live', 'halftime', 'overtime', 'penalty_shootout']);

export function rowCenter(m: RowMatch, nowMs: number): RowCenter {
  if (LIVE.has(m.status)) return { kind: 'live', halftime: m.status === 'halftime' || m.isHalftime === true };
  if (m.status === 'finished') {
    return { kind: 'finished', finalKey: finalLabelKey(m.winType), penalties: penaltyText(m.penalties) };
  }
  if (m.status === 'postponed') return { kind: 'postponed' };
  if (m.status === 'cancelled') return { kind: 'cancelled' };
  const display = matchDisplayState(m.status, m.scheduledAt ?? m.startedAt, nowMs);
  return {
    kind: 'scheduled',
    hint: display === 'awaiting_start' ? 'match_states.awaiting_start' : display === 'overdue' ? 'match_states.no_result' : null,
    tbd: !m.startedAt && isTimeTbd(m.scheduledAt),
  };
}

/** Retransmisión: hay enlace y el partido no está aplazado ni cancelado. */
export function hasWatchLink(m: { status: string; videoUrl?: string | null }): boolean {
  return !!m.videoUrl && m.status !== 'cancelled' && m.status !== 'postponed';
}

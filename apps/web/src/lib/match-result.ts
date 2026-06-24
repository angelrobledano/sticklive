/**
 * Presentación consistente del resultado cuando hay prórroga o penaltis.
 * Una sola fuente de verdad para listas, ficha, resúmenes y OG.
 */
import type { MatchScore } from '@/lib/api/client';

type WinType = 'regular' | 'overtime' | 'penalties' | null | undefined;

/** Clave i18n de la etiqueta de final según el tipo de victoria. */
export function finalLabelKey(winType: WinType): string {
  if (winType === 'overtime') return 'match_states.final_overtime';
  if (winType === 'penalties') return 'match_states.final_penalties';
  return 'match_states.final';
}

/** Sufijo compacto para listas: "(pró.)" / "(0-2 pen.)" / "". */
export function resultShortSuffix(winType: WinType, penalties?: MatchScore | null): string {
  if (winType === 'penalties' && penalties && penalties.home != null && penalties.away != null) {
    return `(${penalties.home}-${penalties.away} pen.)`;
  }
  if (winType === 'overtime') return '(pró.)';
  return '';
}

/** Marcador de la tanda como "0 - 2", o null si no hubo penaltis. */
export function penaltyText(penalties?: MatchScore | null): string | null {
  if (!penalties || penalties.home == null || penalties.away == null) return null;
  return `${penalties.home} - ${penalties.away}`;
}

'use client';

import { useViewerTz } from '@/hooks/useViewerTz';
import { fmtDate, fmtTime } from './format';

/**
 * Fecha y hora en la zona de quien mira, como el cuadro y el calendario. El
 * resumen de la competición es de servidor y pintaba la hora de la sede
 * (Elite Cup: 18:00 Lisboa frente a 19:00 en el cuadro).
 */
export function ViewerDateTime({ iso, locale }: { iso: string; locale: string }) {
  const tz = useViewerTz();
  return (
    <>
      <span className="capitalize">{fmtDate(iso, tz, locale)}</span>
      {' · '}
      <span className="font-score tabular-nums">{fmtTime(iso, tz, locale)}</span>
    </>
  );
}

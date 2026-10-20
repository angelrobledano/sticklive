'use client';

import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import type { Match } from '@/lib/api/client';
import { getCurrentMatchesFresh } from '@/lib/api/client';
import { mergeMatchList } from '@/lib/live-merge';

/** Cada cuánto se sondea la API mientras hay actividad en vivo. */
const POLL_INTERVAL_MS = 25_000;
/** Ventana alrededor del saque en la que un 'scheduled' ya merece sondeo. */
const PRE_KICKOFF_MS = 30 * 60 * 1_000;  // 30 min antes
const POST_KICKOFF_MS = 3 * 60 * 60 * 1_000; // hasta 3 h después (por si la fuente tarda)

/** ¿Hay algún partido en juego o a punto de empezar? Solo entonces sondeamos. */
function hasLiveActivity(matches: Match[]): boolean {
  const now = Date.now();
  for (const m of matches) {
    if (m.status === 'live') return true;
    if (m.status === 'scheduled' && m.scheduledAt) {
      const t = new Date(m.scheduledAt).getTime();
      if (!Number.isNaN(t) && t - PRE_KICKOFF_MS <= now && now <= t + POST_KICKOFF_MS) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Mantiene la lista de partidos en sincronía con el resultado real.
 *
 * La home se renderiza en el servidor (revalidate:60) y no tiene vida propia: un
 * usuario que se queda mirando no dispara nuevas requests, así que el marcador se
 * congela mientras el detalle (SSE) sí se actualiza. Este hook cierra ese hueco:
 * cuando hay partidos en juego (o a punto de empezar) sondea /current sin caché
 * cada POLL_INTERVAL_MS y devuelve la lista fresca. Se pausa con la pestaña oculta
 * y refresca al volver, para no gastar batería/datos de fondo.
 *
 * Devuelve la MISMA referencia del prop hasta que llega una actualización, de modo
 * que no rompe la memoización aguas abajo cuando no hay nada en vivo.
 */
export interface LiveScoresState {
  matches: Match[];
  /** true si el último sondeo falló: el marcador puede estar congelado. */
  degraded: boolean;
}

export function useLiveScores(initial: Match[]): LiveScoresState {
  const [matches, setMatches] = useState<Match[]>(initial);
  const [degraded, setDegraded] = useState(false);

  // Resincroniza si cambia el prop del servidor (navegación, revalidate).
  useEffect(() => { setMatches(initial); }, [initial]);

  // Mantiene la última lista en un ref para que el efecto de polling no se
  // recree en cada actualización de marcador (solo depende de "¿hay actividad?").
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  const active = hasLiveActivity(matches);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const fresh = await getCurrentMatchesFresh();
        if (!cancelled) {
          // Conserva la identidad de los partidos sin cambios (#perf): evita
          // re-renderizar toda la jornada cada 25 s y, si nada cambió, ni
          // siquiera actualiza el estado.
          setMatches((prev) => mergeMatchList(prev, fresh));
          setDegraded(false);
        }
      } catch (err) {
        // Mantén el estado actual; reintentamos en el próximo tick. #244: los
        // fallos del polling en vivo ya no se descartan en silencio.
        if (!cancelled) {
          setDegraded(true);
          Sentry.captureException(err, { tags: { scope: 'live-scores-poll' } });
        }
      }
    };

    // Cierra el hueco de la caché del SSR cuanto antes.
    void refresh();

    const interval = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Solo nos importa el flag de actividad: el contenido vive en matchesRef.
  }, [active]);

  return { matches, degraded };
}

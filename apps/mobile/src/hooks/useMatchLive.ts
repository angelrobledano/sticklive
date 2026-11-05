import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import EventSource from 'react-native-sse';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL, apiFetch } from '@/src/lib/api/client';
import type { MatchDetailRaw } from '@sports/core/api';
import { qk } from '@/src/hooks/queries';
import {
  applyStreamPatch,
  backoffDelay,
  type MatchState,
  type StreamPatch,
} from '@/src/lib/match-stream';

const POLL_MS = 15_000;
const MAX_SSE_FAILURES = 3;

/**
 * Protocolo SSE REAL de `GET /matches/:id/stream`, verificado por lectura de
 * código (el plan asumía un delta `{ match, newEvents }` que NO existe):
 *
 * - Nombres de evento: el primer fan-out de datos llega como `event: snapshot`
 *   y los siguientes como `event: update` (`eventForKind`,
 *   apps/api/src/lib/sse-hub.ts:121-128). Ambos llevan el MISMO payload: el
 *   MatchDto COMPLETO + `updatedAt` (el hub re-serializa el snapshot entero,
 *   sse-hub.ts:97; snapshot construido en match-stream.ts:91-144 del API).
 *   Por eso el reducer reemplaza el DTO en bloque (ver match-stream.ts).
 * - Otros eventos: `finished` → `{ matchId, finishedAt }` y el servidor cierra
 *   (match-stream.ts:277-280); `error` → `{ error, message }` (p. ej. partido
 *   inexistente, :250) y el servidor cierra; `timeout` →
 *   `{"reason":"max_duration"}` y el servidor cierra (:374); `keepalive` →
 *   vacío (:386); `stale` → `{ stale, updatedAt }` cuando el poll del hub
 *   falla (#284, :244) y `{ stale: false, updatedAt }` al recuperar (:256).
 *   El móvil ignora keepalive; de `stale` sólo el aviso true marca desfase
 *   (la recuperación va seguida del fanout con el DTO completo, y cualquier
 *   snapshot/update limpia el desfase en el reducer); finished/error/timeout
 *   se gestionan abajo.
 * - Autenticación: el endpoint es PÚBLICO (limita conexiones por IP,
 *   match-stream.ts:325-337; no hay middleware de sesión en la ruta). El
 *   header Authorization se envía sólo si hay token; hoy es inofensivo.
 * - Reconexión: el servidor anuncia `retry:` (:370) y react-native-sse
 *   re-conecta solo tras un cierre limpio del servidor, pero NO tras un fallo
 *   de red (onerror no re-programa). El backoff lo lleva este hook
 *   (backoffDelay) y cierra la instancia antes de reconectar.
 * - Cierre DIFERIDO: en la lib, `_pollAgain` se programa DESPUÉS de despachar
 *   el evento y sin re-comprobar el estado cerrado (src/EventSource.js,
 *   ramas readystatechange); cerrar dentro del listener dejaría un timer que
 *   reconecta una instancia "cerrada". Con setTimeout(0) el close() cae
 *   después de esa programación y la limpia.
 */

type StreamEventName = 'snapshot' | 'update' | 'finished' | 'timeout' | 'stale';

const INITIAL: MatchState = { detail: null, connected: false, transport: 'sse', stale: false, staleAt: null };

/** Cierra el EventSource en el siguiente tick (ver comentario de arriba). */
function closeDeferred(es: EventSource<StreamEventName>): void {
  setTimeout(() => es.close(), 0);
}

/**
 * Directo de la ficha: SSE → snapshot/update con el DTO completo. Si el SSE
 * falla MAX_SSE_FAILURES veces seguidas, degrada a poll cada 15s mientras la
 * pantalla está enfocada. Al desenfocar se cierra todo (nada escucha en
 * segundo plano, spec §4). La sesión llega en M3: `token` es opcional.
 */
export function useMatchLive(matchId: string, token: string | null | undefined) {
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(
    (s: MatchState, p: StreamPatch) => applyStreamPatch(s, p),
    INITIAL,
  );
  const failures = useRef(0);
  const esRef = useRef<EventSource<StreamEventName> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(true);
  // Las reconexiones (timeout del servidor / error de conexión) pasan por este
  // ref: `connect` no puede autorreferenciarse dentro de su useCallback (lint
  // react-hooks/immutability) y el ref apunta SIEMPRE a la última versión.
  const connectRef = useRef<() => void>(() => {});

  const stopAll = useCallback(() => {
    const es = esRef.current;
    esRef.current = null;
    if (es) closeDeferred(es);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
    backoffTimerRef.current = null;
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    dispatch({ kind: 'transport', transport: 'poll' });
    const poll = async () => {
      try {
        // El mismo DTO completo que el snapshot SSE (buildMatchDetail es el
        // mapper compartido de REST y SSE). Un fallo aquí no es silencioso en
        // producto: la primera carga fallida la pinta el ErrorState de la
        // query (app/match/[id].tsx); los siguientes polls reintentan solos.
        const detail = await apiFetch<MatchDetailRaw>(`/matches/${matchId}`, { token: token ?? undefined });
        dispatch({ kind: 'snapshot', detail });
      } catch {
        // El poll reintenta en el siguiente tick; ver comentario de arriba.
      }
    };
    void poll();
    pollRef.current = setInterval(() => void poll(), POLL_MS);
  }, [matchId, token]);

  const connect = useCallback(() => {
    stopAll();
    // Todo intento de conexión es SSE: restaura el transporte si venimos de
    // una degradación a poll (p. ej. al re-enfocar la pantalla), y no-op en el
    // camino normal. El reducer conserva `detail` con este patch.
    dispatch({ kind: 'transport', transport: 'sse' });
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // react-native-sse exige URL absoluta (no es un polyfill de EventSource
    // estándar: usa XHR por debajo).
    const es = new EventSource<StreamEventName>(`${API_URL}/matches/${matchId}/stream`, { headers });

    const onData = (patchDetail: MatchDetailRaw) => {
      failures.current = 0;
      // El stream comparte caché con useMatchDetail: la ficha se pinta igual
      // venga del REST (frío) o del SSE (caliente).
      qc.setQueryData(qk.match(matchId), patchDetail);
      dispatch({ kind: 'snapshot', detail: patchDetail });
    };

    es.addEventListener('snapshot', (ev) => {
      try {
        const detail = JSON.parse(ev.data as string) as MatchDetailRaw;
        if (detail) onData(detail);
      } catch {
        // Payload malformado: no tumbar la pantalla; el siguiente update corrige.
      }
    });
    es.addEventListener('update', (ev) => {
      try {
        const detail = JSON.parse(ev.data as string) as MatchDetailRaw;
        if (detail) onData(detail);
      } catch {
        // Ídem.
      }
    });
    // Congelación de datos (#284): el hub avisa `stale` cuando su poll falla.
    // Sin reconexión ni cambio de transporte: el aviso sólo marca el estado
    // que la ficha pinta como "posible desfase". El `stale: false` de
    // recuperación se ignora: si llega sin fanout (recuperación sin cambios
    // de datos), el flag persiste hasta el próximo snapshot/update o
    // re-enfoque.
    es.addEventListener('stale', (ev) => {
      try {
        const p = JSON.parse(ev.data as string) as { stale: boolean };
        if (p.stale) dispatch({ kind: 'stale', staleAt: Date.now() });
      } catch {
        // Payload malformado: no tumbar la pantalla.
      }
    });
    // Reciclaje normal del servidor (2h): reconectar inmediatamente no cuenta
    // como fallo. El cierre es diferido para matar el reconector interno.
    es.addEventListener('timeout', () => {
      closeDeferred(es);
      if (esRef.current === es) esRef.current = null;
      if (focused.current) connectRef.current();
    });
    // Fin de partido: el servidor para el hub y cierra. Sin reconexión.
    es.addEventListener('finished', () => {
      closeDeferred(es);
      if (esRef.current === es) esRef.current = null;
    });
    es.addEventListener('error', (ev) => {
      // Un `event: error` del SERVIDOR llega a este mismo listener con `data`
      // (los errores de conexión traen message/xhrStatus y sin data; el d.ts
      // de la lib no declara esa variante). P. ej. partido inexistente:
      // reintentar no arregla nada, se corta del todo.
      const serverError = (ev as { data?: string | null }).data != null;
      closeDeferred(es);
      if (esRef.current === es) esRef.current = null;
      dispatch({ kind: 'disconnected' });
      if (serverError || !focused.current) return;
      failures.current += 1;
      if (failures.current >= MAX_SSE_FAILURES) {
        startPolling();
      } else {
        backoffTimerRef.current = setTimeout(() => {
          backoffTimerRef.current = null;
          if (focused.current) connectRef.current();
        }, backoffDelay(failures.current));
      }
    });

    esRef.current = es;
  }, [matchId, token, qc, startPolling, stopAll]);

  // Post-render: las reconexiones de los listeners siempre invocan la
  // `connect` vigente (con el matchId/token del último render).
  useEffect(() => {
    connectRef.current = connect;
  });

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      connect();
      return () => {
        focused.current = false;
        stopAll();
      };
    }, [connect, stopAll]),
  );

  return {
    ...state,
    reconnect: connect,
  };
}

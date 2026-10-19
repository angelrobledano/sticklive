'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useT } from '@/lib/i18n';
import { track, matchAnalyticsDecision, type LiveStreamStatus } from '@/lib/analytics';
import type { MatchDetail } from '@/lib/api/client';
import { MatchHeader } from './MatchHeader';
import { TimelineTab } from './TimelineTab';
import { LineupsTab } from './LineupsTab';
import { StatsTab } from './StatsTab';
import { AdBanner } from '@/components/shared/AdBanner';
import { recordRecentMatch } from '@/lib/recents';
import { tt } from '@/components/search/translate';
import {
  freshnessState,
  isNewerSnapshot,
  reconnectDelayMs,
  shouldPollFallback,
  shouldRecreateEventSource,
  FALLBACK_POLL_MS,
  FRESHNESS_CHECK_MS,
} from './timeline-model';

// ─── Componente principal ───

const TABS = ['Resumen', 'Alineaciones', 'Estadísticas'] as const;
type Tab = typeof TABS[number];
const TAB_KEYS: Record<Tab, string> = {
  'Resumen':      'match_tabs.summary',
  'Alineaciones': 'match_tabs.lineups',
  'Estadísticas': 'match_tabs.stats',
};

/** #352: slugs estables del tab en la URL (?tab=). No dependen del idioma. */
const TAB_SLUG: Record<Tab, string> = {
  'Resumen': 'summary', 'Alineaciones': 'lineups', 'Estadísticas': 'stats',
};

/**
 * #352: tab que pide la URL, o `null` si el parámetro falta, no es un slug
 * válido o apunta a una pestaña que no está visible en este partido (nunca
 * mostramos una pestaña vacía). Función pura, testeable sin navegador.
 */
export function matchTabFromParam(param: string | null, visible: readonly Tab[]): Tab | null {
  if (!param) return null;
  const tab = (Object.keys(TAB_SLUG) as Tab[]).find((k) => TAB_SLUG[k] === param);
  return tab && visible.includes(tab) ? tab : null;
}

/**
 * #358: navegación del patrón ARIA tabs (roving tabindex). Devuelve el índice
 * destino para flechas/Home/End, o el mismo si la tecla no aplica. Función pura
 * para fijar el comportamiento sin navegador.
 */
export function nextTabIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown': return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':   return (current - 1 + count) % count;
    case 'Home':      return 0;
    case 'End':       return count - 1;
    default:          return current;
  }
}

/**
 * Calcula qué tabs deben mostrarse en función de los datos disponibles.
 * Principio: el usuario nunca debe ver una pestaña vacía.
 *   - Resumen:      siempre visible.
 *   - Alineaciones: solo si hay al menos un jugador en algún equipo.
 *   - Estadísticas: solo si el partido ha empezado y hay algo que mostrar
 *                   (marcador, faltas o eventos).
 */
function visibleTabsFor(data: MatchDetail): Tab[] {
  const isStarted = data.match.status === 'live' || data.match.status === 'finished';
  const hasLineups = (data.lineups?.home?.length ?? 0) > 0 || (data.lineups?.away?.length ?? 0) > 0;
  const hasStats = isStarted && (
    (data.stats.homeGoals ?? 0) > 0 || (data.stats.awayGoals ?? 0) > 0 ||
    data.stats.homeFouls > 0 || data.stats.awayFouls > 0 ||
    (data.stats.homeBlueCards ?? 0) > 0 || (data.stats.awayBlueCards ?? 0) > 0 ||
    data.events.length > 0
  );
  return TABS.filter((tab) => {
    if (tab === 'Alineaciones') return hasLineups;
    if (tab === 'Estadísticas') return hasStats;
    return true;
  });
}

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

// ── Decisión de refresco de un partido 'scheduled' (#366) ────────────────────
/** Margen antes del inicio en el que adelantamos un fetch inmediato. */
export const REFETCH_LEAD_MS = 5 * 60_000;
/** Solo programamos un refresco si el inicio cae dentro de esta ventana. */
export const REFETCH_HORIZON_MS = 6 * 3_600_000;
/** Margen tras el inicio en el que reintentamos (el scraper puede tardar). */
export const REFETCH_GRACE_MS = 60_000;
/**
 * Margen tras el final en el que reconsultamos una vez para recoger posibles
 * correcciones oficiales del acta, que el hub ya no streamea (#376).
 */
export const FINISHED_REFETCH_MS = 60_000;

export interface ScheduledRefetchPlan {
  /** Fetch inmediato al montar: inicio inminente o ya pasado. */
  refetchNow: boolean;
  /** Retardo del temporizador, o `null` si no procede programar ninguno. */
  timeoutMs: number | null;
}

/**
 * Función pura (testeable sin navegador) que decide cuándo refrescar la ficha
 * de un partido programado. Evita el re-fetch incondicional al abrir partidos
 * lejanos (#366): solo se consulta enseguida si el inicio es inminente o ya
 * pasó, y solo se programa un temporizador si el inicio está dentro del horizonte.
 */
export function planScheduledRefetch(
  startIso: string | null | undefined,
  nowMs: number,
): ScheduledRefetchPlan {
  if (!startIso) return { refetchNow: false, timeoutMs: null };
  const delay = new Date(startIso).getTime() - nowMs;
  return {
    refetchNow: delay <= REFETCH_LEAD_MS,
    timeoutMs: delay <= 0 || delay > REFETCH_HORIZON_MS ? null : delay + REFETCH_GRACE_MS,
  };
}

export function MatchCenterClient({ data: initialData, preview }: { data: MatchDetail; preview?: ReactNode }) {
  const { t } = useT();
  const [activeTab,  setActiveTab]  = useState<Tab>('Resumen');
  // Estado local que empieza con los datos SSR y se actualiza en caliente via SSE
  const [liveData,   setLiveData]   = useState<MatchDetail>(initialData);
  const [sseStatus,  setSseStatus]  = useState<'idle' | 'connecting' | 'live' | 'finished' | 'error'>('idle');
  // Contador de reconexión: al incrementarse, el efecto de SSE se vuelve a
  // ejecutar y abre un EventSource nuevo. Lo usa el corte por duración máxima
  // del servidor (`event: timeout`), que NO es un final de partido.
  const [sseEpoch,   setSseEpoch]   = useState(0);
  // #284: instante de la última actualización de datos y aviso de poll caído
  // del hub. Alimentan el indicador de frescura de la cabecera.
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [serverStale,  setServerStale]  = useState(false);
  // #369/#376: instante del último snapshot SSE aplicado (anti-stale) y estado
  // del polling REST de respaldo cuando el SSE no cubre el directo.
  const sseUpdatedAtRef = useRef<{ matchId: string; at: number } | null>(null);
  const [fallbackActive, setFallbackActive] = useState(false);

  const isLive = liveData.match.status === 'live';

  // ── Analítica: vista por partido y transición a vivo (#241) ─────────────────
  // `match_view` se emite al montar y en CADA transición real de estado (no en
  // cada poll), de modo que `status` refleja el directo y no el snapshot SSR.
  // `live_match_followed` (NSM) se emite en la primera llegada a `live`, ya sea
  // al montar en vivo o al pasar de scheduled → live (abrir antes del saque).
  const lastStatusRef = useRef<string | null>(null);
  const followedRef = useRef(false);
  const analyticsMatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    const { id, status, seasonId } = liveData.match;
    if (analyticsMatchIdRef.current !== id) {
      analyticsMatchIdRef.current = id;
      lastStatusRef.current = null;
      followedRef.current = false;
    }
    const prev = lastStatusRef.current;
    const decision = matchAnalyticsDecision(prev, status);
    if (!decision.emitView) return;
    lastStatusRef.current = status;
    track('match_view', {
      match_id: id,
      status,
      ...(prev ? { previous_status: prev } : {}),
    });
    if (decision.emitLiveFollowed && !followedRef.current) {
      followedRef.current = true;
      let source = 'open';
      try { if (new URLSearchParams(window.location.search).get('src') === 'push') source = 'push'; } catch { /* noop */ }
      track('live_match_followed', {
        match_id: id,
        season_id: seasonId,
        source,
      });
    }
    // Dependemos de los campos concretos, no del objeto `match` completo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveData.match.id, liveData.match.status, liveData.match.seasonId]);

  // ── "Vistos recientemente" (#270) ───────────────────────────────────────────
  // Al abrir la ficha guardamos el partido en localStorage (una vez por id,
  // aunque el SSE lo reemplace). Permite volver a él sin depender del
  // historial del navegador.
  useEffect(() => {
    const m = liveData.match;
    const home = m.homeTeam;
    const away = m.awayTeam;
    if (!home || !away) return;
    recordRecentMatch({
      id: m.id,
      homeTeamId: home.id,
      awayTeamId: away.id,
      homeName: home.shortName ?? home.name,
      awayName: away.shortName ?? away.name,
      competitionId: m.competitionId ?? null,
      competitionName: m.competitionName ?? null,
      viewedAt: Date.now(),
    });
    // Solo al cambiar de partido: no queremos reescribir en cada update en vivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveData.match.id]);

  // ── Dwell del directo (#241) ────────────────────────────────────────────────
  // Segundos con la pestaña VISIBLE mientras el partido está en vivo. Se emite
  // una sola vez al salir (unmount/pagehide) para no inflar la NSM ni duplicar.
  useEffect(() => {
    if (!isLive) return;
    const matchId = liveData.match.id;
    let visibleMs = 0;
    let visibleSince: number | null = document.visibilityState === 'visible' ? Date.now() : null;
    let sent = false;

    const pause = () => {
      if (visibleSince != null) { visibleMs += Date.now() - visibleSince; visibleSince = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pause();
      else if (visibleSince == null) visibleSince = Date.now();
    };
    const flush = () => {
      if (sent) return;
      sent = true;
      pause();
      // Evita ruido de estancias por debajo de 1 s.
      if (visibleMs >= 1_000) {
        track('live_match_dwell', { match_id: matchId, seconds_watched: Math.round(visibleMs / 1000) });
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [isLive, liveData.match.id]);

  // ── Analítica del stream de directo (#244) ──────────────────────────────────
  // `live_stream_status_changed` registra connecting/live/error/timeout/finished,
  // deduplicando estados consecutivos iguales (EventSource reintenta y onerror
  // puede dispararse varias veces).
  const lastStreamRef = useRef<LiveStreamStatus | null>(null);
  const streamMatchIdRef = useRef<string | null>(null);
  const reportStream = useCallback((status: LiveStreamStatus) => {
    const id = liveData.match.id;
    if (streamMatchIdRef.current !== id) {
      streamMatchIdRef.current = id;
      lastStreamRef.current = null;
    }
    if (lastStreamRef.current === status) return;
    lastStreamRef.current = status;
    track('live_stream_status_changed', { match_id: id, status });
  }, [liveData.match.id]);

  // ── Conexión SSE ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLive) {
      setSseStatus('idle');
      return;
    }

    setSseStatus('connecting');
    reportStream('connecting');
    const matchId = liveData.match.id;
    const url = `${API_URL}/matches/${matchId}/stream`;
    const es = new EventSource(url);
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    // #371: errores consecutivos desde la última vez que el stream dio datos.
    let consecutiveErrors = 0;

    const handleData = (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as MatchDetail & { updatedAt?: string };
        // El servidor manda `updatedAt` (instante de captura del snapshot). Si
        // falta, caemos a la hora de recepción (#284).
        const serverAt = parsed.updatedAt ? new Date(parsed.updatedAt).getTime() : NaN;
        const hasServerAt = Number.isFinite(serverAt);
        const incomingMs = hasServerAt ? serverAt : Date.now();
        // #369/#376: anti-stale. Si llega un snapshot MÁS ANTIGUO que el último
        // aplicado (polls concurrentes fuera de orden), se descarta en vez de
        // pintar datos viejos como actuales.
        const prev = sseUpdatedAtRef.current;
        if (hasServerAt && prev && prev.matchId === matchId && !isNewerSnapshot(prev.at, incomingMs)) {
          return;
        }
        if (hasServerAt) sseUpdatedAtRef.current = { matchId, at: incomingMs };
        consecutiveErrors = 0; // el stream está entregando: resetea el backoff
        setLiveData(parsed);
        setLastUpdateAt(incomingMs);
        setServerStale(false);
      } catch {
        // JSON malformado del stream (#244): breadcrumb para no inundar Sentry.
        Sentry.addBreadcrumb({
          category: 'live-sse', level: 'warning',
          message: 'Payload SSE no parseable', data: { matchId },
        });
      }
    };

    es.addEventListener('snapshot', (e) => {
      setSseStatus('live');
      reportStream('live');
      handleData((e as MessageEvent<string>).data);
    });

    es.addEventListener('update', (e) => {
      handleData((e as MessageEvent<string>).data);
    });

    es.addEventListener('finished', () => {
      setSseStatus('finished');
      reportStream('finished');
      es.close();
    });

    // El servidor corta la conexión al alcanzar su duración máxima. NO es el
    // final del partido: un hockey dura bastante más que esa ventana, así que
    // hay que volver a conectar o el usuario se queda en el polling de
    // fallback (30 s) justo en el tramo decisivo.
    es.addEventListener('timeout', () => {
      es.close();
      setSseStatus('connecting');
      reportStream('timeout');
      reconnectTimer = setTimeout(() => setSseEpoch((n) => n + 1), 1_000);
    });

    es.addEventListener('keepalive', () => { /* noop — mantiene la conexión */ });

    // #284: el hub avisa cuando su poll falla (o se recupera). No es un cambio
    // de datos, así que no reemplaza `liveData`; sólo marca el estado.
    es.addEventListener('stale', (e) => {
      try {
        const parsed = JSON.parse((e as MessageEvent<string>).data) as { stale?: boolean };
        setServerStale(parsed.stale !== false);
      } catch {
        setServerStale(true);
      }
    });

    es.onerror = () => {
      consecutiveErrors += 1;
      setSseStatus('error');
      reportStream('error');
      // #244: EventSource reintenta solo; breadcrumb (no exception) para no
      // inundar Sentry con fallos de red transitorios.
      Sentry.addBreadcrumb({
        category: 'live-sse', level: 'warning',
        message: 'Error de conexión SSE', data: { matchId },
      });
      // #371: el auto-reintento del navegador NO cubre un HTTP ≠ 200 (el 503 del
      // limitador deja el ES `CLOSED` y muerto). Recreamos el EventSource cuando
      // está cerrado o tras N errores consecutivos, con backoff+jitter para no
      // reconectar todo el parque a la vez.
      if (shouldRecreateEventSource(es.readyState, consecutiveErrors) && !reconnectTimer) {
        es.close();
        reconnectTimer = setTimeout(() => setSseEpoch((n) => n + 1), reconnectDelayMs(consecutiveErrors));
      }
    };

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es.close();
      setSseStatus('idle');
    };
  }, [liveData.match.id, isLive, sseEpoch, reportStream]);

  // ── Polling REST de respaldo ────────────────────────────────────────────────
  // (cubre browsers sin SSE, cuando SSE falla y, desde #369, cuando el hub está
  // ciego aunque el transporte siga "live")
  const refreshData = useCallback(async () => {
    try {
      // #376: sin `no-store`, el respaldo podía servirse de la caché HTTP del
      // navegador (hasta 30 s de antigüedad) justo cuando más frescura hace falta.
      const res = await fetch(`${API_URL}/matches/${liveData.match.id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const parsed = (await res.json()) as MatchDetail;
      setLiveData(parsed);
      setLastUpdateAt(Date.now());
    } catch (err) {
      // #244: fallo del fetch de respaldo; se reintenta, pero lo reportamos para
      // medir la calidad del directo (antes se descartaba en silencio).
      Sentry.captureException(err, {
        tags: { scope: 'match-poll' },
        extra: { matchId: liveData.match.id },
      });
    }
  }, [liveData.match.id]);

  // #369: ¿el respaldo debe estar activo? Aunque el SSE siga "live", si el hub
  // avisó de un poll caído o los datos envejecen, activamos el polling para no
  // quedarnos congelados. Se reevalúa periódicamente contra el reloj real.
  useEffect(() => {
    if (!isLive) { setFallbackActive(false); return; }
    const evaluate = () => {
      const fresh = lastUpdateAt == null
        ? null
        : freshnessState(lastUpdateAt, Date.now(), serverStale);
      setFallbackActive(shouldPollFallback(sseStatus, serverStale, fresh));
    };
    evaluate();
    const id = setInterval(evaluate, FRESHNESS_CHECK_MS);
    return () => clearInterval(id);
  }, [isLive, sseStatus, serverStale, lastUpdateAt]);

  useEffect(() => {
    if (!isLive || !fallbackActive) return;
    const interval = setInterval(refreshData, FALLBACK_POLL_MS);
    return () => clearInterval(interval);
  }, [isLive, fallbackActive, refreshData]);

  // ── Refresco al volver a la pestaña (#284) ─────────────────────────────────
  // Los navegadores estrangulan timers y SSE en segundo plano. Al volver,
  // pedimos el detalle sin caché y reconectamos el SSE para no quedarnos con un
  // marcador viejo pintado como actual.
  useEffect(() => {
    if (!isLive) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshData();
      setSseEpoch((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isLive, refreshData]);

  // ── Correcciones post-finished (#376) ──────────────────────────────────────
  // El hub deja de emitir tras `finished`; una corrección oficial del acta
  // posterior sólo se veía al recargar. Reconsultamos una vez pasado un margen
  // y al recuperar el foco de la pestaña.
  useEffect(() => {
    if (liveData.match.status !== 'finished') return;
    const refetchOnVisible = () => {
      if (document.visibilityState === 'visible') void refreshData();
    };
    const timer = setTimeout(() => void refreshData(), FINISHED_REFETCH_MS);
    document.addEventListener('visibilitychange', refetchOnVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refetchOnVisible);
    };
  }, [liveData.match.status, refreshData]);

  // ── Refresco al pasar la hora de inicio de un partido 'scheduled' ──────────
  // Cubre el hueco hasta que el scraper marque el partido como live y el
  // bloque SSE de arriba tome el relevo.
  useEffect(() => {
    if (isLive) return;
    const plan = planScheduledRefetch(
      liveData.match.scheduledAt ?? liveData.match.startedAt,
      Date.now(),
    );
    // Cubre un RSC cacheado justo antes del saque (#187) solo si el inicio es
    // inminente o ya pasó; para partidos lejanos no hacemos un fetch
    // incondicional al abrir la ficha (#366).
    if (plan.refetchNow) void refreshData();
    if (plan.timeoutMs === null) return;
    const timer = setTimeout(refreshData, plan.timeoutMs);
    return () => clearTimeout(timer);
  }, [isLive, liveData.match.scheduledAt, liveData.match.startedAt, refreshData]);

  const data = liveData; // alias para no cambiar el resto del JSX

  // Tabs visibles según datos disponibles — nunca mostrar una pestaña vacía
  const visibleTabs = visibleTabsFor(data);
  // Si la tab activa quedó oculta (ej: alineaciones desaparecieron en live), volver a Resumen
  const safeActiveTab: Tab = visibleTabs.includes(activeTab) ? activeTab : 'Resumen';

  // #352: el tab activo viaja en la URL (`?tab=`). Se lee al montar y al usar
  // atrás/adelante; al cambiar de pestaña se reescribe con `history.replaceState`
  // (sin navegación de Next) para no re-renderizar el árbol servidor ni perder
  // el estado en vivo del partido. La navegación por teclado ARIA (#358) sigue igual.
  const visibleTabsRef = useRef<Tab[]>(visibleTabs);
  visibleTabsRef.current = visibleTabs;

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
      const tab = matchTabFromParam(param, visibleTabsRef.current);
      if (tab) setActiveTab(tab);
    };
    applyFromUrl();
    window.addEventListener('popstate', applyFromUrl);
    return () => window.removeEventListener('popstate', applyFromUrl);
  }, []);

  // #358: patrón ARIA tabs con foco móvil (roving tabindex) y navegación por flechas.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const i = visibleTabs.indexOf(safeActiveTab);
    const next = nextTabIndex(i, e.key, visibleTabs.length);
    if (next < 0 || next === i) return;
    e.preventDefault();
    selectTab(visibleTabs[next]!);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="space-y-4">
      {/* Cabecera del partido */}
      <MatchHeader data={data} sseStatus={sseStatus} lastUpdateAt={lastUpdateAt} serverStale={serverStale} />

      {/* Previa: justo debajo del marcador y antes de las pestañas */}
      {preview}

      {/* Pestañas — solo las que tienen datos (#358: patrón ARIA tabs) */}
      <div
        role="tablist"
        aria-label={tt(t, 'a11y.match_tabs', 'Secciones del partido')}
        onKeyDown={onTabKeyDown}
        className="flex gap-0 border-b border-slate-200 dark:border-slate-800 overflow-x-auto scrollbar-none"
      >
        {visibleTabs.map((tab, i) => (
          <button
            key={tab}
            ref={(el) => { tabRefs.current[i] = el; }}
            role="tab"
            id={`match-tab-${i}`}
            aria-selected={safeActiveTab === tab}
            aria-controls={`match-panel-${i}`}
            tabIndex={safeActiveTab === tab ? 0 : -1}
            onClick={() => selectTab(tab)}
            className={`px-4 py-2.5 text-sm border-b -mb-px transition-colors whitespace-nowrap shrink-0 ${
              safeActiveTab === tab
                ? 'border-rink-passion text-rink-passion font-semibold active:bg-rink-passion/5'
                : 'border-transparent font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 active:bg-slate-50 dark:active:bg-slate-800/60 active:text-slate-900 dark:active:text-slate-100'
            }`}
          >
            {t(TAB_KEYS[tab])}
          </button>
        ))}
      </div>

      {/* Contenido. SEO (GSC 16-oct-2026): TODOS los paneles van en el DOM y los
          inactivos se ocultan con `hidden` (además, es el patrón ARIA correcto
          de pestañas). Montarlos condicionalmente dejaba alineaciones y
          estadísticas fuera del HTML, y Googlebot no pulsa pestañas. El
          anuncio sí queda condicional: no queremos anuncios ocultos. */}
      {visibleTabs.map((tab, i) => (
        <div
          key={tab}
          role="tabpanel"
          id={`match-panel-${i}`}
          aria-labelledby={`match-tab-${i}`}
          hidden={safeActiveTab !== tab}
        >
          {tab === 'Resumen' && (
            <>
              <TimelineTab data={data} />
              {/* Anuncio al FINAL del resumen (no en medio del marcador/timeline) */}
              {safeActiveTab === 'Resumen' && <AdBanner zone="match-summary" className="mt-4" />}
            </>
          )}
          {tab === 'Alineaciones'  && <LineupsTab data={data} />}
          {tab === 'Estadísticas'  && <StatsTab   data={data} />}
        </div>
      ))}
    </div>
  );
}

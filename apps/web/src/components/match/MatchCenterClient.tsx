'use client';

import { useState, useEffect, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import type { MatchDetail } from '@/lib/api/client';
import { MatchHeader } from './MatchHeader';
import { TimelineTab } from './TimelineTab';
import { LineupsTab } from './LineupsTab';
import { StatsTab } from './StatsTab';

// ─── Componente principal ───

const TABS = ['Resumen', 'Alineaciones', 'Estadísticas'] as const;
type Tab = typeof TABS[number];
const TAB_KEYS: Record<Tab, string> = {
  'Resumen':      'match_tabs.summary',
  'Alineaciones': 'match_tabs.lineups',
  'Estadísticas': 'match_tabs.stats',
};

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

export function MatchCenterClient({ data: initialData }: { data: MatchDetail }) {
  const { t } = useT();
  const [activeTab,  setActiveTab]  = useState<Tab>('Resumen');
  // Estado local que empieza con los datos SSR y se actualiza en caliente via SSE
  const [liveData,   setLiveData]   = useState<MatchDetail>(initialData);
  const [sseStatus,  setSseStatus]  = useState<'idle' | 'connecting' | 'live' | 'finished' | 'error'>('idle');
  // Contador de reconexión: al incrementarse, el efecto de SSE se vuelve a
  // ejecutar y abre un EventSource nuevo. Lo usa el corte por duración máxima
  // del servidor (`event: timeout`), que NO es un final de partido.
  const [sseEpoch,   setSseEpoch]   = useState(0);

  const isLive = liveData.match.status === 'live';

  // ── Analítica: una vista por partido y montaje ─────────────────────────────
  useEffect(() => {
    track('match_view', {
      match_id: initialData.match.id,
      status: initialData.match.status,
    });
    // NSM: seguimiento de directo. Cuenta abrir/llegar (push) a una ficha en vivo.
    if (initialData.match.status === 'live') {
      let source = 'open';
      try { if (new URLSearchParams(window.location.search).get('src') === 'push') source = 'push'; } catch { /* noop */ }
      track('live_match_followed', {
        match_id: initialData.match.id,
        season_id: initialData.match.seasonId,
        source,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData.match.id]);

  // ── Conexión SSE ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLive) {
      setSseStatus('idle');
      return;
    }

    setSseStatus('connecting');
    const url = `${API_URL}/matches/${liveData.match.id}/stream`;
    const es = new EventSource(url);
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const handleData = (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as MatchDetail;
        setLiveData(parsed);
      } catch { /* JSON malformado — ignorar */ }
    };

    es.addEventListener('snapshot', (e) => {
      setSseStatus('live');
      handleData((e as MessageEvent<string>).data);
    });

    es.addEventListener('update', (e) => {
      handleData((e as MessageEvent<string>).data);
    });

    es.addEventListener('finished', () => {
      setSseStatus('finished');
      es.close();
    });

    // El servidor corta la conexión al alcanzar su duración máxima. NO es el
    // final del partido: un hockey dura bastante más que esa ventana, así que
    // hay que volver a conectar o el usuario se queda en el polling de
    // fallback (30 s) justo en el tramo decisivo.
    es.addEventListener('timeout', () => {
      es.close();
      setSseStatus('connecting');
      reconnectTimer = setTimeout(() => setSseEpoch((n) => n + 1), 1_000);
    });

    es.addEventListener('keepalive', () => { /* noop — mantiene la conexión */ });

    es.onerror = () => {
      setSseStatus('error');
      // EventSource auto-reintenta — no cerramos aquí
    };

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es.close();
      setSseStatus('idle');
    };
  }, [liveData.match.id, isLive, sseEpoch]);

  // ── Polling de fallback cada 30s para partidos live sin SSE ────────────────
  // (cubre browsers que no soportan EventSource o cuando SSE falla)
  const refreshData = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/matches/${liveData.match.id}`);
      if (!res.ok) return;
      const parsed = (await res.json()) as MatchDetail;
      setLiveData(parsed);
    } catch { /* sin red — siguiente intento */ }
  }, [liveData.match.id]);

  useEffect(() => {
    if (!isLive || sseStatus === 'live') return; // SSE ya cubre — no duplicar
    const interval = setInterval(refreshData, 30_000);
    return () => clearInterval(interval);
  }, [isLive, sseStatus, refreshData]);

  // ── Refresco al pasar la hora de inicio de un partido 'scheduled' ──────────
  // Cubre el hueco hasta que el scraper marque el partido como live y el
  // bloque SSE de arriba tome el relevo.
  useEffect(() => {
    if (isLive) return;
    // Cubre un RSC cacheado justo antes del saque (#187): si esta ficha se sirvió
    // en los ~20 s previos (revalidate:20) y se abre ya pasada la hora, el
    // temporizador de abajo no se programa (delay <= 0) y para 'scheduled' no hay
    // polling de respaldo. Un fetch inmediato (sin caché, contra la API) trae el
    // estado efectivo real y pinta EN DIRECTO sin recargar.
    void refreshData();
    const startIso = liveData.match.scheduledAt ?? liveData.match.startedAt;
    if (!startIso) return;
    const delay = new Date(startIso).getTime() - Date.now();
    if (delay <= 0 || delay > 6 * 3_600_000) return;
    const timer = setTimeout(refreshData, delay + 60_000);
    return () => clearTimeout(timer);
  }, [isLive, liveData.match.scheduledAt, liveData.match.startedAt, refreshData]);

  const data = liveData; // alias para no cambiar el resto del JSX

  // Tabs visibles según datos disponibles — nunca mostrar una pestaña vacía
  const visibleTabs = visibleTabsFor(data);
  // Si la tab activa quedó oculta (ej: alineaciones desaparecieron en live), volver a Resumen
  const safeActiveTab: Tab = visibleTabs.includes(activeTab) ? activeTab : 'Resumen';

  return (
    <div className="space-y-4">
      {/* Cabecera del partido */}
      <MatchHeader data={data} sseStatus={sseStatus} />

      {/* Pestañas — solo las que tienen datos */}
      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-800">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm border-b -mb-px transition-colors whitespace-nowrap ${
              safeActiveTab === tab
                ? 'border-rink-passion text-rink-passion font-semibold'
                : 'border-transparent font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(TAB_KEYS[tab])}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {safeActiveTab === 'Resumen'      && <TimelineTab   data={data} />}
      {safeActiveTab === 'Alineaciones' && <LineupsTab    data={data} />}
      {safeActiveTab === 'Estadísticas' && <StatsTab      data={data} />}
    </div>
  );
}

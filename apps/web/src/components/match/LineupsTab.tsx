'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useParams } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import type { MatchDetail } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { PlayerAvatar } from '@/components/shared/PlayerAvatar';
import { displayLineupName, toTitleCase } from './format';
import { BallIcon } from './icons';
import { tt } from '@/components/search/translate';

// Badges normalizados: misma altura y padding, tipografía legible (11px)
// y contraste accesible — 5i en acento sólido, C ámbar sólido, P gris neutro.
const BADGE_BASE = 'inline-flex items-center justify-center h-5 min-w-[22px] px-1.5 rounded text-[11px] font-bold leading-none';
const BADGE_STYLES = {
  '5i': 'bg-rink-passion text-white',
  'C':  'bg-slate-700 text-white',
  'P':  'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
} as const;

// ─── Pista con los cinco iniciales ───

interface RinkPlayer {
  jerseyNumber: number | null;
  playerName: string;
  playerId?: string | null;
  isGoalkeeper: boolean;
  isCaptain: boolean;
  photoUrl?: string | null;
}

/**
 * Posiciones del 5 inicial en media pista HORIZONTAL.
 * x: 0 = portería propia, 100 = línea central. y: 0-100 vertical.
 * Formación 2-2: defensas cerca del área, delanteros hacia el centro.
 */
function halfPositions(fieldCount: number): Array<{ x: number; y: number }> {
  switch (fieldCount) {
    case 4: return [{ x: 42, y: 28 }, { x: 42, y: 72 }, { x: 74, y: 34 }, { x: 74, y: 66 }];
    case 3: return [{ x: 42, y: 50 }, { x: 72, y: 28 }, { x: 72, y: 72 }];
    case 2: return [{ x: 55, y: 32 }, { x: 55, y: 68 }];
    case 1: return [{ x: 55, y: 50 }];
    default: return [];
  }
}

const RINK_API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

function RinkChip({ p, accent }: { p: RinkPlayer; accent: boolean }) {
  const { t } = useT();
  const surname = displayLineupName(p.playerName).split(' ').slice(-1)[0] ?? '';
  const chip = (
    <div className="relative flex flex-col items-center -translate-x-1/2 -translate-y-1/2">
      <span className={`relative w-10 h-10 rounded-full overflow-visible shadow-md ring-2 ${
        accent ? 'ring-rink-passion' : 'ring-white dark:ring-slate-200'
      }`}>
        {/* Foto del jugador vía proxy de la API; si no hay playerId, caemos a la
            URL directa del CDN. (La imagen compartible se renderiza aparte en el
            servidor: /matches/{id}/lineup-image.) */}
        <PlayerAvatar
          photoUrl={p.playerId ? `${RINK_API_URL}/players/${p.playerId}/photo` : (p.photoUrl ?? null)}
          name={p.playerName}
          className="w-10 h-10 rounded-full bg-white dark:bg-slate-300"
        />
        {/* Dorsal en mini-badge, color del equipo */}
        <span className={`absolute -bottom-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full
                          flex items-center justify-center font-score text-[10px] font-bold ${
          accent ? 'bg-rink-passion text-white' : 'bg-white text-slate-800 border border-slate-300'
        }`}>
          {p.jerseyNumber ?? '–'}
        </span>
        {p.isCaptain && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-slate-700 text-white
                           text-[9px] font-bold flex items-center justify-center">
            {tt(t, 'match_detail.badge_captain', 'C')}
          </span>
        )}
      </span>
      <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 max-w-[80px] truncate
                       whitespace-nowrap rounded px-1 py-px text-[10px] font-semibold leading-tight
                       text-white bg-slate-900/65">
        {surname}
      </span>
    </div>
  );
  return p.playerId
    ? <Link href={`/players/${p.playerId}`} className="absolute hover:scale-110 transition-transform"
            style={{ left: 0, top: 0 }} aria-label={p.playerName}>{chip}</Link>
    : <div className="absolute" style={{ left: 0, top: 0 }}>{chip}</div>;
}

function StartingFiveRink({ home, away, homeName, awayName, matchId }: {
  home: RinkPlayer[];
  away: RinkPlayer[];
  homeName: string;
  awayName: string;
  matchId: string;
}) {
  const { t } = useT();
  const params = useParams();
  const locale = (Array.isArray(params?.['locale']) ? params['locale'][0] : params?.['locale']) ?? 'es';
  const rinkRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  // Imagen pre-descargada. Clave para iOS Safari/WebKit: navigator.share() debe
  // invocarse DENTRO del gesto del usuario; si hacemos trabajo async (segundos)
  // antes de compartir, iOS pierde el gesto y share() no resuelve (spinner colgado).
  const fileRef = useRef<File | null>(null);

  // La imagen se RENDERIZA EN EL SERVIDOR (next/og), no con html2canvas: este se
  // colgaba en iOS rasterizando el DOM. Aquí solo descargamos ese PNG ya hecho.
  const imageUrl = `/${locale}/matches/${matchId}/lineup-image`;

  /** Descarga el PNG del servidor y lo cachea como File para compartir. */
  const fetchShareFile = useCallback(async (): Promise<File | null> => {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) return null;
      const blob = await res.blob();
      const file = new File([blob], 'stick-live-alineacion.png', { type: 'image/png' });
      fileRef.current = file;
      return file;
    } catch {
      return null;
    }
  }, [imageUrl]);

  // Pre-descargamos al montar para que al pulsar compartir el File ya esté listo
  // y share() se llame de forma síncrona dentro del gesto (único camino fiable en iOS).
  useEffect(() => {
    fileRef.current = null;
    if (!matchId) return;
    let cancelled = false;
    void fetchShareFile().then(() => { if (cancelled) fileRef.current = null; });
    return () => { cancelled = true; };
  }, [matchId, fetchShareFile]);

  /** Comparte la alineación como imagen (abre/descarga como fallback). */
  const shareLineup = async () => {
    if (sharing) return;
    // Camino rápido: imagen ya lista → share() síncrono dentro del gesto (iOS OK).
    const cached = fileRef.current;
    if (cached && navigator.canShare?.({ files: [cached] })) {
      track('lineup_shared', { match_id: matchId, outcome: 'shared' });
      navigator.share({ files: [cached], title: 'Stick Live' }).catch(() => {});
      return;
    }
    // Aún no lista (red lenta): la descargamos ahora. Watchdog anti-spinner colgado.
    setSharing(true);
    const watchdog = setTimeout(() => setSharing(false), 12000);
    try {
      const file = await fetchShareFile();
      if (!file) {
        // Último recurso: abrir la imagen en una pestaña para guardarla a mano.
        track('lineup_shared', { match_id: matchId, outcome: 'download' });
        window.open(imageUrl, '_blank');
        return;
      }
      if (navigator.canShare?.({ files: [file] })) {
        track('lineup_shared', { match_id: matchId, outcome: 'shared' });
        navigator.share({ files: [file], title: 'Stick Live' }).catch(() => {});
      } else {
        track('lineup_shared', { match_id: matchId, outcome: 'download' });
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch { track('lineup_shared', { match_id: matchId, outcome: 'failed' }); } finally {
      clearTimeout(watchdog);
      setSharing(false);
    }
  };

  if (home.length === 0 && away.length === 0) return null;

  /** Coordenadas absolutas (%) para un equipo en su mitad (local izquierda) */
  const place = (players: RinkPlayer[], isAway: boolean) => {
    const gk = players.find((p) => p.isGoalkeeper) ?? null;
    const field = players.filter((p) => p !== gk);
    const spots = halfPositions(Math.min(field.length, 4));
    const out: Array<{ p: RinkPlayer; x: number; y: number }> = [];
    if (gk) out.push({ p: gk, x: 22, y: 50 }); // dentro del área pero separado del borde
    field.slice(0, 4).forEach((p, i) => {
      const s = spots[i]!;
      out.push({ p, x: s.x, y: s.y });
    });
    // Media pista propia: x de equipo (0-100) → x global (0-50); visitante espejado
    return out.map(({ p, x, y }) => ({
      p,
      x: isAway ? 100 - x / 2 : x / 2,
      y,
    }));
  };

  const positioned = [
    ...place(away, true).map((e) => ({ ...e, accent: false })),
    ...place(home, false).map((e) => ({ ...e, accent: true })),
  ];

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('match_detail.starter')}
        </span>
        <span className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rink-passion inline-block" />{homeName}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-white border border-slate-300 inline-block" />{awayName}
          </span>
          {/* Compartir la alineación como imagen */}
          <button
            onClick={shareLineup}
            disabled={sharing}
            aria-label={t('match_detail.share_lineup')}
            className="w-8 h-8 -my-1.5 rounded-full flex items-center justify-center
                       text-slate-500 dark:text-slate-400 hover:text-rink-passion hover:bg-slate-100 dark:hover:bg-slate-800
                       transition-colors disabled:opacity-40"
          >
            {sharing ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-[16px] h-[16px]">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
            )}
          </button>
        </span>
      </div>

      {/* Pista horizontal según plano reglamentario: rectángulo con esquinas
          redondeadas, línea central + círculo, áreas rectangulares con
          semicírculo en la línea de gol y puntos de penalti/FD. */}
      <div ref={rinkRef} className="relative mx-auto w-full max-w-[560px] aspect-[2/1] px-2 pb-3">
        <div className="absolute inset-x-2 inset-y-0 rounded-2xl overflow-hidden
                        bg-gradient-to-br from-sky-700 to-sky-800 dark:from-slate-700 dark:to-slate-800
                        border-[3px] border-sky-900/50 dark:border-slate-900/70">
          {/* Línea central + círculo con punto */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/50" />
          <div className="absolute left-1/2 top-1/2 w-[18%] aspect-square -translate-x-1/2 -translate-y-1/2
                          rounded-full border border-white/50" />
          <div className="absolute left-1/2 top-1/2 w-1 h-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />

          {/* Área izquierda: rectángulo + semicírculo sobre la línea de gol */}
          <div className="absolute left-[6%] top-1/2 -translate-y-1/2 w-[14%] h-[46%]
                          border border-white/45" />
          <div className="absolute left-[6%] top-1/2 w-[5%] aspect-square -translate-x-1/2 -translate-y-1/2
                          rounded-full border border-white/45" />
          {/* Puntos de penalti/FD izquierda */}
          <div className="absolute left-[22.5%] top-1/2 w-1 h-1 -translate-y-1/2 rounded-full bg-white/70" />
          <div className="absolute left-[27%]   top-1/2 w-1 h-1 -translate-y-1/2 rounded-full bg-white/70" />

          {/* Área derecha (espejo) */}
          <div className="absolute right-[6%] top-1/2 -translate-y-1/2 w-[14%] h-[46%]
                          border border-white/45" />
          <div className="absolute right-[6%] top-1/2 w-[5%] aspect-square translate-x-1/2 -translate-y-1/2
                          rounded-full border border-white/45" />
          <div className="absolute right-[22.5%] top-1/2 w-1 h-1 -translate-y-1/2 rounded-full bg-white/70" />
          <div className="absolute right-[27%]   top-1/2 w-1 h-1 -translate-y-1/2 rounded-full bg-white/70" />

          {/* Porterías — sobre la línea de gol, dentro de la pista */}
          <div className="absolute left-[6%]  top-1/2 -translate-y-1/2 -translate-x-full w-[1.2%] h-[16%] bg-white/70 rounded-l" />
          <div className="absolute right-[6%] top-1/2 -translate-y-1/2 translate-x-full w-[1.2%] h-[16%] bg-white/70 rounded-r" />
        </div>

        {/* Jugadores */}
        {positioned.map(({ p, x, y, accent }, i) => (
          <div key={`${p.playerName}-${i}`} className="absolute"
               style={{ left: `${x}%`, top: `${y}%` }}>
            <RinkChip p={p} accent={accent} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineupsTab({ data }: { data: MatchDetail }) {
  const { t } = useT();
  const teams = [
    { team: data.match.homeTeam!, label: t('match_detail.local'),   players: data.lineups?.home ?? [] },
    { team: data.match.awayTeam!, label: t('match_detail.visitor'), players: data.lineups?.away ?? [] },
  ];

  const starters = (side: 'home' | 'away') =>
    (data.lineups?.[side] ?? []).filter((p) => p.isStarter);

  return (
    <div className="space-y-4">
      {/* Cinco inicial sobre la pista — visitante arriba, local abajo */}
      <StartingFiveRink
        home={starters('home')}
        away={starters('away')}
        homeName={data.match.homeTeam?.shortName ?? data.match.homeTeam?.name ?? ''}
        awayName={data.match.awayTeam?.shortName ?? data.match.awayTeam?.name ?? ''}
        matchId={data.match.id}
      />
      {/* Solo renderizar la tarjeta del equipo si tiene jugadores */}
      {teams.filter(({ players }) => players.length > 0).map(({ team, label, players }) => (
        <div key={team.id} className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <TeamShield teamId={team.id} teamName={team.name} size={24} />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{team.name}</h3>
            <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</span>
          </div>

          {/* Leyenda de badges */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            {[
              { code: '5i', badge: tt(t, 'match_detail.badge_starter', '5i'),     label: t('match_detail.starter'),    color: BADGE_STYLES['5i'] },
              { code: 'C',  badge: tt(t, 'match_detail.badge_captain', 'C'),      label: t('match_detail.captain'),    color: BADGE_STYLES['C'] },
              { code: 'P',  badge: tt(t, 'match_detail.badge_goalkeeper', 'P'),   label: t('match_detail.goalkeeper'), color: BADGE_STYLES['P'] },
            ].map(({ code, badge, label: bl, color }) => (
              <div key={code} className="flex items-center gap-1">
                <span className={`${BADGE_BASE} ${color}`}>{badge}</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{bl}</span>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <BallIcon size={9} />
              <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('hockey_stats.goals')}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px]">🅰</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('hockey_stats.assists')}</span>
            </div>
          </div>

          {(
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {players.map((p) => (
                <div key={`${p.jerseyNumber}-${p.playerName}`} className="flex items-center gap-3 py-2">
                  <span className="w-7 text-center font-score text-sm font-bold text-slate-500 dark:text-slate-400">
                    {p.jerseyNumber ?? '–'}
                  </span>
                  {p.playerId ? (
                    <Link
                      href={`/players/${p.playerId}`}
                      title={toTitleCase(p.playerName)}
                      className="text-sm text-slate-800 dark:text-slate-200 truncate hover:text-rink-passion hover:underline"
                    >
                      {displayLineupName(p.playerName)}
                    </Link>
                  ) : (
                    <span className="text-sm text-slate-800 dark:text-slate-200 truncate" title={toTitleCase(p.playerName)}>
                      {displayLineupName(p.playerName)}
                    </span>
                  )}
                  <span className="flex items-center gap-1 ml-auto shrink-0">
                    {p.goals > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        <BallIcon size={8} /> {p.goals}
                      </span>
                    )}
                    {(p.assists ?? 0) > 0 && (
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        🅰 {p.assists}
                      </span>
                    )}
                    {p.isStarter && <span className={`${BADGE_BASE} ${BADGE_STYLES['5i']}`}>{tt(t, 'match_detail.badge_starter', '5i')}</span>}
                    {p.isCaptain && <span className={`${BADGE_BASE} ${BADGE_STYLES['C']}`}>{tt(t, 'match_detail.badge_captain', 'C')}</span>}
                    {p.isGoalkeeper && <span className={`${BADGE_BASE} ${BADGE_STYLES['P']}`}>{tt(t, 'match_detail.badge_goalkeeper', 'P')}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

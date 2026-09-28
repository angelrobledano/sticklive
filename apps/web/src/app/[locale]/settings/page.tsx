'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useFavorites, getFavNames } from '@/hooks/useFavorites';
import { useT } from '@/lib/i18n';
import { usePremium } from '@/context/PremiumContext';
import { clubName } from '@/lib/names';
import { InstallApp } from '@/components/shared/InstallApp';
import {
  notificationPermission, isIOS, isStandalone, vapidMissing,
} from '@/lib/push';
import {
  SEASON_ID, API_URL, PREMIUM_ENABLED,
  type TeamInfo,
} from './config';
import { SettingRow, SettingsBlock, PremiumActiveBadge } from './ui';
import { useDeviceId, useDarkMode, useNotifConfig } from './hooks';
import { PremiumBanner } from './PremiumBanner';
import { LanguageCard, AccountCard, FavoriteRow, SubHeader } from './cards';
import { NotificationStatus } from './NotificationStatus';


// ─── Fila de navegación (título + chevron) ────────────────────────────────────

function NavRow({ label, href, count }: { label: string; href: string; count?: number }) {
  return (
    <Link href={href} className="flex items-center gap-3 py-3.5 group">
      <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{count}</span>
      )}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
           className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 group-hover:text-rink-passion transition-colors">
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t } = useT();
  const { isDark,    toggle: toggleDark, mounted: themeMounted }   = useDarkMode();
  const { favorites, toggle: toggleFav, isFavorite, leagues, toggleLeague, players, togglePlayer, mounted: favMounted } = useFavorites();
  const { config,    set: setNotif, update: updateNotif, mounted: notifMounted } = useNotifConfig();
  const { isPremium, mounted: premiumMounted }                     = usePremium();
  const deviceId = useDeviceId();

  // ¿Está el push bloqueado en este dispositivo? (permiso denegado, sin soporte,
  // iPhone sin instalar o sin clave VAPID) → atenuamos las secciones de abajo.
  const [notifBlocked, setNotifBlocked] = useState(false);
  useEffect(() => {
    const check = () => {
      const perm = notificationPermission();
      setNotifBlocked(vapidMissing() || perm === 'unsupported' || perm === 'denied' || (isIOS() && !isStandalone()));
    };
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  // Lista de equipos de la OK Liga
  const [teams, setTeams]           = useState<TeamInfo[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  // Competiciones (para resolver nombres de las ligas seguidas)
  const [comps, setComps] = useState<Array<{ id: string; name: string; shortName: string | null }>>([]);

  useEffect(() => {
    fetch(`${API_URL}/competitions`)
      .then((r) => r.json())
      .then((d: { competitions?: Array<{ id: string; name: string; shortName: string | null }> }) =>
        setComps(d.competitions ?? []))
      .catch(() => { /* sin ligas */ });
  }, []);

  const myTeams   = teams.filter((tm) => isFavorite(tm.id));
  const myLeagues = comps.filter((cp) => leagues.includes(cp.id));
  // Jugadores seguidos: el nombre se guardó al seguirlos (sin N fetches)
  const favNames  = typeof window !== 'undefined' ? getFavNames() : {};
  const myPlayers = players.map((id) => ({ id, name: favNames[id] ?? '—' }));

  useEffect(() => {
    const loadTeams = async () => {
      // Temporada ACTUAL real desde /competitions (fuente de verdad); el env solo
      // como último recurso. Evita depender de un id horneado en build que puede
      // estar vacío u obsoleto tras un reseed.
      const compsData = await fetch(`${API_URL}/competitions`).then((r) => r.json()).catch(() => null);
      const list = (compsData?.competitions ?? []) as Array<{ season?: { id: string; isCurrent?: boolean; teamCount?: number } | null }>;
      const withSeason = list.filter((c) => c.season?.id);
      const current = withSeason.filter((c) => c.season?.isCurrent);
      const pool = current.length ? current : withSeason;
      pool.sort((a, b) => (b.season?.teamCount ?? 0) - (a.season?.teamCount ?? 0));
      const seasonId = pool[0]?.season?.id || SEASON_ID;
      if (!seasonId) { setLoadingTeams(false); return; }
      try {
        const data = await fetch(`${API_URL}/seasons/${seasonId}/standings`).then((r) => r.json()) as {
          standings: Array<{
            team_id?: string; teamId?: string;
            team_name?: string; teamName?: string;
            team_short_name?: string; teamShortName?: string;
            team_logo_url?: string; teamLogoUrl?: string;
          }>;
        };
        const list: TeamInfo[] = (data.standings ?? []).map((s) => ({
          id:        s.team_id    ?? s.teamId    ?? '',
          name:      s.team_name  ?? s.teamName  ?? '',
          shortName: s.team_short_name ?? s.teamShortName ?? null,
          logoUrl:   s.team_logo_url   ?? s.teamLogoUrl   ?? null,
        }));
        setTeams(list);
      } catch { /* sin equipos */ }
      finally { setLoadingTeams(false); }
    };
    void loadTeams();
  }, []);

  const allMounted = themeMounted && favMounted && notifMounted && premiumMounted;

  if (!allMounted) {
    return (
      <div className="px-4 py-8 max-w-2xl mx-auto space-y-6 animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="card h-24" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-6">
      {/* Cabecera */}
      <div className="space-y-1 pt-2">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">{t('settings.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* ── Banner Premium (oculto mientras la app sea gratis) ─────────────── */}
      {PREMIUM_ENABLED && (
        isPremium ? <PremiumActiveBadge /> : <PremiumBanner deviceId={deviceId} />
      )}

      {/* ── Bloque A: Estilo de la pista ─────────────────────────────────── */}
      <SettingsBlock
        title={t('settings.style_section')}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
          </svg>
        }
      >
        <SettingRow
          label={t('settings.dark_mode')}
          description={t('settings.dark_mode_desc')}
          checked={isDark}
          onChange={toggleDark}
        />
      </SettingsBlock>

      {/* ── Tarjeta de cuenta (autenticación progresiva) ───────────────────── */}
      <AccountCard />

      {/* ── Instalar como app (PWA) — se oculta si ya está instalada ───────── */}
      <InstallApp />

      {/* ── Idioma ─────────────────────────────────────────────────────────── */}
      <LanguageCard />

      {/* ── Acceso a gestión en bloque de favoritos ────────────────────────── */}
      <Link href="/favorites" className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow block">
        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-rink-passion">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('favorites.manage_favs')}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('settings.manage_desc')}</p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-slate-300 shrink-0">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" />
        </svg>
      </Link>

      {/* ── Bloque B: Mis equipos (solo los que sigo) ──────────────────────── */}
      <SettingsBlock
        title={t('settings.my_teams')}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        }
      >
        {loadingTeams ? (
          <div className="py-6 flex justify-center" aria-busy="true">
            <div className="w-5 h-5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" aria-hidden="true" />
          </div>
        ) : myTeams.length === 0 ? (
          <div className="py-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('favorites.onboarding_body')}
            </p>
          </div>
        ) : (
          <>
            {myTeams.map((team) => (
              <FavoriteRow
                key={team.id}
                href={`/teams/${team.id}`}
                name={clubName(team.name)}
                fallback={(team.shortName ?? team.name).slice(0, 2)}
                logoSrc={`/escudos/${team.id}.png`}
                onRemove={() => toggleFav(team.id)}
              />
            ))}
            <div className="py-2.5">
              <p className="text-[11px] text-slate-300 dark:text-slate-700">
                {t('settings.fav_note', { n: myTeams.length })}
              </p>
            </div>
          </>
        )}
      </SettingsBlock>

      {/* ── Bloque B2: Mis ligas (solo las que sigo) ───────────────────────── */}
      {myLeagues.length > 0 && (
        <SettingsBlock
          title={t('settings.my_leagues')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M8 3h8v10a4 4 0 0 1-8 0V3Z" /><path d="M12 17v4M8 21h8" />
            </svg>
          }
        >
          {myLeagues.map((comp) => (
            <FavoriteRow
              key={comp.id}
              href={`/competitions/${comp.id}`}
              name={clubName(comp.name)}
              fallback={(comp.shortName ?? comp.name).slice(0, 2)}
              onRemove={() => toggleLeague(comp.id)}
            />
          ))}
        </SettingsBlock>
      )}

      {/* ── Bloque B3: Mis jugadores (solo los que sigo) ───────────────────── */}
      {myPlayers.length > 0 && (
        <SettingsBlock
          title={t('settings.my_players')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          }
        >
          {myPlayers.map((p) => (
            <FavoriteRow
              key={p.id}
              href={`/players/${p.id}`}
              name={p.name}
              fallback={p.name.slice(0, 2)}
              onRemove={() => togglePlayer(p.id)}
            />
          ))}
        </SettingsBlock>
      )}

      {/* ── Bloque C: Notificaciones ───────────────────────────────────────── */}
      <SettingsBlock
        title={t('settings.notif_title')}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        }
      >
        {/* Banner superior: permiso/estado + activar + prueba (avisa de errores) */}
        <NotificationStatus deviceId={deviceId} />

        {/* Switch maestro — control absoluto del sistema */}
        <SettingRow
          label={t('settings.master')}
          description={t('settings.master_desc')}
          checked={config.master}
          onChange={() => setNotif('master')}
        />

        {/* Secciones — atenuadas si el maestro está apagado o el push bloqueado */}
        <div className={(!config.master || notifBlocked) ? 'opacity-40 pointer-events-none select-none' : ''}>

          {/* Sección 1: Alertas de la jornada (inicio + resumen, toggle único) */}
          <SubHeader label={t('settings.sec_jornada')} />
          <SettingRow
            label={t('settings.jornada_alerts')}
            description={t('settings.jornada_alerts_desc')}
            checked={config.globalJornadaStart || config.globalJornadaEnd}
            onChange={() => {
              const on = !(config.globalJornadaStart || config.globalJornadaEnd);
              updateNotif({ globalJornadaStart: on, globalJornadaEnd: on });
            }}
          />

          {/* Sección 2: Notificaciones de mis favoritos (navegación por entidad) */}
          <SubHeader label={t('settings.sec_favs')} />
          <NavRow label={t('settings.notif_nav_competitions')} href="/settings/notifications/competitions" count={leagues.length} />
          <NavRow label={t('settings.notif_nav_teams')}        href="/settings/notifications/teams"        count={favorites.length} />
          <NavRow label={t('settings.notif_nav_players')}      href="/settings/notifications/players"      count={players.length} />

          {/* Sección 3: Descanso */}
          <SubHeader label={t('settings.sec_rest')} />
          <SettingRow
            label={t('settings.quiet')}
            description={t('settings.quiet_desc')}
            checked={config.quietNight}
            onChange={() => setNotif('quietNight')}
          />

        </div>{/* fin de secciones atenuables */}

      </SettingsBlock>

      {/* Pie */}
      <div className="text-center pb-4 space-y-1">
        <p className="text-[11px] text-slate-300 dark:text-slate-700">{t('settings.footer')}</p>
        <Link href="/privacy" className="inline-block text-[11px] text-slate-400 dark:text-slate-600 underline hover:text-rink-passion">
          {t('settings.privacy_link')}
        </Link>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { notFound, useParams } from 'next/navigation';
import Link from 'next/link';
import { useFavorites, getFavNames } from '@/hooks/useFavorites';
import { getPreset, setPreset, isPresetEnabled, presetFromToggle, type NotifKind } from '@/lib/notif-prefs';
import { syncPushConfig } from '@/lib/push';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName } from '@/lib/names';
import { useT } from '@/lib/i18n';
import { BackLink } from '@/components/shared/BackLink';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

interface CompItem {
  id: string; name: string; shortName: string | null;
  season?: { id: string; isCurrent?: boolean; teamCount?: number } | null;
}
function pickSeasonId(comps: CompItem[]): string | null {
  const withSeason = comps.filter((c) => c.season?.id);
  const current = withSeason.filter((c) => c.season?.isCurrent);
  const pool = current.length ? current : withSeason;
  pool.sort((a, b) => (b.season?.teamCount ?? 0) - (a.season?.teamCount ?? 0));
  return pool[0]?.season?.id ?? null;
}

// URL (plural) → tipo interno
const KIND_BY_SLUG: Record<string, NotifKind> = {
  teams: 'team', competitions: 'league', players: 'player',
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative w-12 h-7 rounded-full shrink-0 transition-all duration-200 ease-out cursor-pointer
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion/60 ${
        checked
          ? 'bg-gradient-to-r from-rink-passion to-red-600 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]'
          : 'bg-slate-200 dark:bg-slate-700/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]
                    transition-transform duration-200 ease-out ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

interface Entry { id: string; name: string; short: string | null }

export default function NotificationEntityPage() {
  const params = useParams<{ kind: string }>();
  const { t } = useT();
  const { favorites, leagues, players, mounted } = useFavorites();
  const [names, setNames] = useState<Record<string, { name: string; short: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [, force] = useState(0);

  // kind inválido (p. ej. /settings/notifications/basura): 404 en vez de una
  // página 200 con el h1 vacío (#365).
  const kind = KIND_BY_SLUG[params.kind ?? ''] ?? null;

  const ids = useMemo(() => {
    if (kind === 'team')   return favorites;
    if (kind === 'league') return leagues;
    if (kind === 'player') return players;
    return [];
  }, [kind, favorites, leagues, players]);

  useEffect(() => {
    if (!kind) { setLoading(false); return; }
    let alive = true;
    const run = async () => {
      if (kind === 'player') {
        const favNames = getFavNames();
        if (alive) setNames(Object.fromEntries(Object.entries(favNames).map(([id, n]) => [id, { name: n, short: null }])));
        setLoading(false);
        return;
      }
      const comps = await fetch(`${API_URL}/competitions`).then((r) => r.json()).catch(() => null);
      const compList = (comps?.competitions ?? []) as CompItem[];
      if (kind === 'league') {
        if (alive) setNames(Object.fromEntries(compList.map((c) => [c.id, { name: c.name, short: c.shortName }])));
        setLoading(false);
        return;
      }
      // team → resolver desde la clasificación de la temporada actual
      const seasonId = pickSeasonId(compList);
      const map: Record<string, { name: string; short: string | null }> = {};
      if (seasonId) {
        const st = await fetch(`${API_URL}/seasons/${seasonId}/standings`).then((r) => r.json()).catch(() => null);
        for (const s of (st?.standings ?? []) as Array<Record<string, string | null>>) {
          const id = (s['team_id'] ?? s['teamId']) as string | null;
          if (id) map[id] = { name: (s['team_name'] ?? s['teamName'] ?? '') as string, short: (s['team_short_name'] ?? s['teamShortName'] ?? null) as string | null };
        }
      }
      if (alive) setNames(map);
      setLoading(false);
    };
    void run();
    return () => { alive = false; };
  }, [kind]);

  // Todos los hooks ya se han llamado: ahora sí podemos cortar con un 404.
  if (!kind) notFound();

  const title =
    kind === 'team'   ? t('settings.notif_nav_teams') :
    kind === 'league' ? t('settings.notif_nav_competitions') :
    kind === 'player' ? t('settings.notif_nav_players') : '';

  const entries: Entry[] = ids.map((id) => ({
    id,
    name: names[id]?.name ?? '—',
    short: names[id]?.short ?? null,
  }));

  const toggle = (id: string) => {
    // #266: escribimos el preset explícito (complete/silent), no solo la lista
    // antigua. Si había un preset explícito, este gana sobre 'silent', así que
    // setNotifEnabled(false) no llegaba a silenciar. setPreset mantiene ambos
    // stores coherentes y el emisor segmenta por preset.
    const next = presetFromToggle(!isPresetEnabled(getPreset(kind!, id)));
    setPreset(kind!, id, next);
    void syncPushConfig(); // refleja en el servidor (fav_teams) al instante
    force((v) => v + 1);
  };

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4 pb-24">
      <BackLink href="/settings" />

      <div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
          {t('settings.notif_entity_help')}
        </p>
      </div>

      {!mounted || loading ? (
        <div className="py-10 flex justify-center" aria-busy="true">
          <div className="w-5 h-5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" aria-hidden="true" />
        </div>
      ) : entries.length === 0 ? (
        <div className="card p-6 text-center space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.notif_entity_empty')}</p>
          <Link href="/favorites" className="inline-block text-xs font-semibold text-rink-passion hover:underline">
            {t('favorites.manage_favs')}
          </Link>
        </div>
      ) : (
        <section className="card overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/60">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-3">
              {kind === 'team' ? (
                <TeamShield teamId={e.id} teamName={e.short ?? e.name} size={28} />
              ) : (
                <div className="w-7 h-7 rounded-full bg-rink-passion/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-black text-rink-passion">{(e.short ?? e.name).slice(0, 2).toUpperCase()}</span>
                </div>
              )}
              <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                {clubName(e.name)}
              </span>
              <Toggle
                checked={isPresetEnabled(getPreset(kind!, e.id))}
                onChange={() => toggle(e.id)}
                label={clubName(e.name)}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

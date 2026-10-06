'use client';

/**
 * Curación de la calidad de datos (#067): marca competiciones y temporadas
 * como 'ok' (visibles) o 'en_revision' (ocultas para el usuario).
 */

import { useCallback, useEffect, useState } from 'react';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

interface CompRow {
  id: string;
  name: string;
  slug: string;
  data_quality: string;
  archived_at: string | null;
  season_count: string;
  visible_season_count: string;
}

interface SeasonRow {
  id: string;
  name: string;
  slug: string;
  is_current: boolean;
  data_quality: string;
  match_count: string;
}

function QualityButton({
  value, busy, onSet,
}: { value: string; busy: boolean; onSet: (q: 'ok' | 'en_revision') => void }) {
  const hidden = value !== 'ok';
  return (
    <button
      disabled={busy}
      onClick={() => onSet(hidden ? 'ok' : 'en_revision')}
      className={`text-[11px] font-semibold px-2 min-h-[32px] rounded-lg disabled:opacity-40 ${
        hidden
          ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300'
          : 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400'
      }`}
    >
      {hidden ? 'Oculta · clic para mostrar' : 'Visible · clic para ocultar'}
    </button>
  );
}

export function AdminCompetitions({ token, onError }: { token: string; onError: (m: string) => void }) {
  const [comps, setComps] = useState<CompRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<Record<string, SeasonRow[]>>({});
  const [q, setQ] = useState('');

  const loadComps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/competitions/quality`, {
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setComps((await res.json() as { competitions: CompRow[] }).competitions);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [token, onError]);

  const loadSeasons = useCallback(async (compId: string) => {
    try {
      const res = await fetch(`${API_URL}/admin/competitions/${compId}/seasons/quality`, {
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const body = await res.json() as { seasons: SeasonRow[] };
      setSeasons((s) => ({ ...s, [compId]: body.seasons }));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    }
  }, [token, onError]);

  useEffect(() => { void loadComps(); }, [loadComps]);

  const patch = useCallback(async (path: string, dataQuality: 'ok' | 'en_revision', id: string, after: () => Promise<void>) => {
    setBusy(id);
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ dataQuality }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await after();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, onError]);

  const toggleOpen = useCallback(async (id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
    if (!seasons[id]) await loadSeasons(id);
  }, [seasons, loadSeasons]);

  const filtered = comps.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar competición…"
        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                   bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                   focus:outline-none focus:ring-2 focus:ring-rink-passion"
      />
      {loading && <p className="text-sm text-slate-400">Cargando…</p>}

      <div className="card divide-y divide-slate-100 dark:divide-slate-800/60">
        {filtered.map((c) => (
          <div key={c.id}>
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => void toggleOpen(c.id)}
                className="flex-1 text-left min-w-0"
              >
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{c.name}</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  {c.slug}
                  {c.archived_at ? ' · archivada' : ''}
                  {` · ${Number(c.visible_season_count)}/${Number(c.season_count)} temporadas visibles`}
                </p>
              </button>
              <QualityButton
                value={c.data_quality}
                busy={busy === c.id}
                onSet={(quality) => void patch(`/admin/competitions/${c.id}/quality`, quality, c.id, loadComps)}
              />
            </div>

            {openId === c.id && (
              <div className="px-4 pb-3 space-y-2">
                {(seasons[c.id] ?? []).map((s) => (
                  <div key={s.id} className="flex items-center gap-3 pl-4">
                    <p className="flex-1 min-w-0 text-xs text-slate-600 dark:text-slate-300 truncate">
                      {s.name}{s.is_current ? ' (actual)' : ''} · {Number(s.match_count)} partidos
                    </p>
                    <QualityButton
                      value={s.data_quality}
                      busy={busy === s.id}
                      onSet={(quality) => void patch(
                        `/admin/seasons/${s.id}/quality`, quality, s.id,
                        async () => { await loadSeasons(c.id); await loadComps(); },
                      )}
                    />
                  </div>
                ))}
                {(seasons[c.id] ?? []).length === 0 && (
                  <p className="text-xs text-slate-400 pl-4">Sin temporadas</p>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Sin competiciones</p>
        )}
      </div>
    </div>
  );
}

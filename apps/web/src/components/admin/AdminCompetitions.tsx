'use client';

/**
 * Curación de la calidad de datos (#067): marca competiciones y temporadas
 * como 'ok' (visibles) o 'en_revision' (ocultas para el usuario).
 * También el orden (migración 089): nivel deportivo (tier) y posición en
 * Destacadas (featured_rank). La web lo recoge en ≤5 min (ISR).
 */

import { useCallback, useEffect, useState } from 'react';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

interface CompRow {
  id: string;
  name: string;
  slug: string;
  data_quality: string;
  archived_at: string | null;
  organizer: string;
  country: string;
  age_category: string;
  tier: number | null;
  featured_rank: number | null;
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
      className={`text-[11px] font-semibold px-2 min-h-[44px] rounded-lg disabled:opacity-40 ${
        hidden
          ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300'
          : 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400'
      }`}
    >
      {hidden ? 'Oculta · clic para mostrar' : 'Visible · clic para ocultar'}
    </button>
  );
}

/** Campo numérico que guarda al salir (o Enter). Vacío = quitar. */
function RankInput({
  label, value, max, busy, onSave,
}: { label: string; value: number | null; max: number; busy: boolean; onSave: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);
  const commit = () => {
    const v = draft.trim() === '' ? null : Number(draft);
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > max)) { setDraft(value == null ? '' : String(value)); return; }
    if (v !== value) onSave(v);
  };
  return (
    <label className="flex flex-col items-center text-[10px] text-slate-500 dark:text-slate-400">
      {label}
      <input
        inputMode="numeric"
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="—"
        aria-label={label}
        className="w-12 min-h-[36px] text-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900
                   text-sm text-slate-800 dark:text-slate-200 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-rink-passion"
      />
    </label>
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

  const saveRanking = useCallback(async (id: string, body: { tier?: number | null; featuredRank?: number | null }) => {
    setBusy(id);
    try {
      const res = await fetch(`${API_URL}/admin/competitions/${id}/ranking`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const out = await res.json() as { competition: { tier: number | null; featuredRank: number | null } };
      setComps((list) => list.map((c) => c.id === id
        ? { ...c, tier: out.competition.tier, featured_rank: out.competition.featuredRank } : c));
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

  const [onlyFeatured, setOnlyFeatured] = useState(false);
  const filtered = comps
    .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.organizer.toLowerCase() === q.toLowerCase())
    .filter((c) => !onlyFeatured || c.featured_rank != null)
    .sort((a, b) => onlyFeatured ? (a.featured_rank ?? 0) - (b.featured_rank ?? 0) : 0);

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar competición…"
        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                   bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                   focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent"
      />
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={onlyFeatured} onChange={(e) => setOnlyFeatured(e.target.checked)} />
        Solo destacadas (ordenadas). «Nivel» 1 = máxima categoría; «Destacada» = posición en la pestaña Destacadas. Vacío = quitar.
      </label>
      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Cargando…</p>}

      <div className="card divide-y divide-slate-100 dark:divide-slate-800/60">
        {filtered.map((c) => (
          <div key={c.id}>
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => void toggleOpen(c.id)}
                className="flex-1 text-left min-w-0"
              >
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{c.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {c.organizer} · {c.country} · {c.age_category} · {c.slug}
                  {c.archived_at ? ' · archivada' : ''}
                  {` · ${Number(c.visible_season_count)}/${Number(c.season_count)} temporadas visibles`}
                </p>
              </button>
              <RankInput label="Nivel" value={c.tier} max={9} busy={busy === c.id}
                onSave={(v) => void saveRanking(c.id, { tier: v })} />
              <RankInput label="Destacada" value={c.featured_rank} max={999} busy={busy === c.id}
                onSave={(v) => void saveRanking(c.id, { featuredRank: v })} />
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
                  <p className="text-xs text-slate-500 dark:text-slate-400 pl-4">Sin temporadas</p>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Sin competiciones</p>
        )}
      </div>
    </div>
  );
}

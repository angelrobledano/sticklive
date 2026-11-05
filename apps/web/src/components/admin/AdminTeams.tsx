'use client';

/**
 * Curación de nombres de equipo (F3-2).
 *
 * La fuente publica casi todo en mayúsculas y con siglas con puntos. Aquí se
 * revisa el nombre crudo, se sugiere una normalización (`clubName`) y se guarda
 * un `display_name` que manda en toda la web. Vaciar el campo restaura el
 * nombre de la fuente.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { clubName } from '@sports/core/names';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

interface TeamRow {
  id: string;
  name: string;
  displayName: string | null;
  shortName: string | null;
  gender: string | null;
  ageCategory: string | null;
  squadLevel: number | null;
  teamType: string;
  clubName: string | null;
  clubSlug: string | null;
}

function squadLetter(level: number | null): string {
  if (!level || level < 2) return '';
  return String.fromCharCode(64 + Math.min(level, 26));
}

function sectionText(team: TeamRow): string {
  return [
    team.teamType === 'national' ? 'Selección' : 'Club',
    team.gender ?? null,
    team.ageCategory ?? null,
    squadLetter(team.squadLevel) ? `Filial ${squadLetter(team.squadLevel)}` : null,
  ].filter(Boolean).join(' · ');
}

export function AdminTeams({ token, onError }: { token: string; onError: (m: string) => void }) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [query, setQuery] = useState('');
  const [orphans, setOrphans] = useState(false);
  const [noSection, setNoSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState<Record<string, { gender: string; ageCategory: string; squadLevel: number }>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const requestId = useRef(0);

  const load = useCallback(async (q: string, onlyOrphans: boolean, onlyNoSection: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/teams?q=${encodeURIComponent(q)}${onlyOrphans ? '&orphans=1' : ''}${onlyNoSection ? '&nosection=1' : ''}`, {
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const body = await res.json() as { teams: TeamRow[] };
      if (id !== requestId.current) return; // respuesta antigua: ya hay otra búsqueda
      setTeams(body.teams);
      setDrafts(Object.fromEntries(body.teams.map((t) => [t.id, t.displayName ?? ''])));
    } catch (err) {
      if (id === requestId.current) onError(err instanceof Error ? err.message : 'Error');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [token, onError]);

  useEffect(() => {
    const id = setTimeout(() => { void load(query, orphans, noSection); }, 250);
    return () => clearTimeout(id);
  }, [query, orphans, noSection, load]);

  const save = useCallback(async (team: TeamRow, value: string | null) => {
    setBusy(team.id);
    try {
      const res = await fetch(`${API_URL}/admin/teams/${team.id}/display-name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ displayName: value }),
      });
      const body = await res.json() as { team?: { displayName: string | null }; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      const saved = body.team?.displayName ?? null;
      setTeams((current) => current.map((t) => (t.id === team.id ? { ...t, displayName: saved } : t)));
      setDrafts((current) => ({ ...current, [team.id]: saved ?? '' }));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, onError]);

  // Sección: género, categoría y plantilla (para equipos creados sin contexto).
  const saveSection = useCallback(async (team: TeamRow) => {
    const d = sectionDraft[team.id];
    if (!d) return;
    setBusy(team.id);
    try {
      const res = await fetch(`${API_URL}/admin/teams/${team.id}/section`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ gender: d.gender || null, ageCategory: d.ageCategory || null, squadLevel: d.squadLevel }),
      });
      const body = await res.json() as { gender?: string | null; ageCategory?: string | null; squadLevel?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      setTeams((current) => current
        .map((t) => (t.id === team.id ? { ...t, gender: body.gender ?? null, ageCategory: body.ageCategory ?? null, squadLevel: body.squadLevel ?? 1 } : t))
        .filter((t) => !noSection || !t.gender || !t.ageCategory));
      setSectionDraft((current) => { const next = { ...current }; delete next[team.id]; return next; });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, onError, sectionDraft, noSection]);

  // Club: cuelga el equipo de un club sin fusionarlo (plantillas B/C, huérfanos).
  const setClub = useCallback(async (team: TeamRow) => {
    const value = window.prompt(
      `Club de «${team.name}».\n\nSlug del club (p. ej. hc-alpicat). Vacío = quitarle el club.`,
      team.clubSlug ?? '',
    );
    if (value === null) return;
    setBusy(team.id);
    try {
      const res = await fetch(`${API_URL}/admin/teams/${team.id}/club`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ club: value.trim() || null }),
      });
      const body = await res.json() as { club?: { name: string; slug: string } | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      const club = body.club ?? null;
      setTeams((current) => current
        .map((t) => (t.id === team.id ? { ...t, clubName: club?.name ?? null, clubSlug: club?.slug ?? null } : t))
        .filter((t) => !orphans || !t.clubName));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, onError, orphans]);

  // Fusión: el equipo de la fila desaparece dentro del que se indique. Primero
  // en seco para enseñar qué se mueve; la API se niega si son de secciones
  // distintas o si se han enfrentado.
  const merge = useCallback(async (team: TeamRow) => {
    const into = window.prompt(`Fusionar «${team.name}» en otro equipo.\n\nId del equipo que se QUEDA (cópialo de su fila):`, '');
    if (!into?.trim()) return;
    setBusy(team.id);
    try {
      const call = async (dryRun: boolean) => {
        const res = await fetch(`${API_URL}/admin/teams/${team.id}/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
          body: JSON.stringify({ into: into.trim(), dryRun }),
        });
        const body = await res.json() as { keep?: { name: string }; moved?: Record<string, number>; error?: string };
        if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
        return body;
      };
      const preview = await call(true);
      const moved = Object.entries(preview.moved ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(', ');
      if (!window.confirm(`«${team.name}» pasará a «${preview.keep?.name}» y su URL redirigirá.\n\nSe mueve: ${moved || 'nada'}\n\nNo se puede deshacer desde aquí. ¿Seguir?`)) return;
      await call(false);
      setTeams((current) => current.filter((t) => t.id !== team.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, onError]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar equipo por nombre o nombre curado…"
        aria-label="Buscar equipo"
        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                   bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                   focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent"
      />

      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} />
        Solo equipos sin club
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={noSection} onChange={(e) => setNoSection(e.target.checked)} />
        Solo equipos sin género o categoría
      </label>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        El nombre curado manda en toda la web y en el SEO. Vacío = nombre de la fuente.
      </p>

      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Cargando…</p>}

      <div className="space-y-2">
        {teams.map((team) => {
          const draft = drafts[team.id] ?? '';
          const changed = draft !== (team.displayName ?? '');
          return (
            <div key={team.id} className="card p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {clubName(team.name)}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">
                    {team.name}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 select-all truncate">
                    {team.id}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {sectionText(team)}
                    {team.clubName ? ` · ${team.clubName}` : ''}
                  </p>
                </div>
                {team.displayName && (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    curado
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDrafts((current) => ({ ...current, [team.id]: e.target.value }))}
                  placeholder="Nombre de presentación (vacío = fuente)"
                  aria-label={`Nombre de presentación de ${team.name}`}
                  maxLength={120}
                  className="flex-1 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                             bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                             focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDrafts((current) => ({ ...current, [team.id]: clubName(team.name) }))}
                    className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300
                               bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    Sugerir
                  </button>
                  <button
                    type="button"
                    disabled={busy === team.id || !changed}
                    onClick={() => void save(team, draft.trim() || null)}
                    className="min-h-[44px] px-4 rounded-xl text-xs font-semibold text-white
                               bg-rink-passion hover:bg-rink-passion-light disabled:opacity-40"
                  >
                    {busy === team.id ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button
                    type="button"
                    disabled={busy === team.id || !team.displayName}
                    onClick={() => void save(team, null)}
                    className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400
                               hover:text-red-500 disabled:opacity-40"
                  >
                    Restablecer
                  </button>
                  <button
                    type="button"
                    disabled={busy === team.id}
                    onClick={() => void merge(team)}
                    className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400
                               hover:text-blue-600 disabled:opacity-40"
                  >
                    Fusionar en…
                  </button>
                  <button
                    type="button"
                    disabled={busy === team.id}
                    onClick={() => void setClub(team)}
                    className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400
                               hover:text-blue-600 disabled:opacity-40"
                  >
                    Club…
                  </button>
                  <button
                    type="button"
                    disabled={busy === team.id}
                    onClick={() => setSectionDraft((current) => ({
                      ...current,
                      [team.id]: { gender: team.gender ?? '', ageCategory: team.ageCategory ?? '', squadLevel: team.squadLevel ?? 1 },
                    }))}
                    className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400
                               hover:text-blue-600 disabled:opacity-40"
                  >
                    Sección…
                  </button>
                </div>
              </div>
              {sectionDraft[team.id] && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Género de ${team.name}`}
                    value={sectionDraft[team.id]!.gender}
                    onChange={(e) => setSectionDraft((c) => ({ ...c, [team.id]: { ...c[team.id]!, gender: e.target.value } }))}
                    className="min-h-[40px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    <option value="">Género ?</option>
                    <option value="male">Masculino</option>
                    <option value="female">Femenino</option>
                    <option value="mixed">Mixto</option>
                  </select>
                  <select
                    aria-label={`Categoría de ${team.name}`}
                    value={sectionDraft[team.id]!.ageCategory}
                    onChange={(e) => setSectionDraft((c) => ({ ...c, [team.id]: { ...c[team.id]!, ageCategory: e.target.value } }))}
                    className="min-h-[40px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    <option value="">Categoría ?</option>
                    {['senior', 'sub23', 'junior', 'juvenil', 'sub17', 'infantil', 'sub15', 'alevin', 'benjamin', 'prebenjamin', 'veteranos', 'base']
                      .map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <select
                    aria-label={`Plantilla de ${team.name}`}
                    value={sectionDraft[team.id]!.squadLevel}
                    onChange={(e) => setSectionDraft((c) => ({ ...c, [team.id]: { ...c[team.id]!, squadLevel: Number(e.target.value) } }))}
                    className="min-h-[40px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    {'ABCDEFGH'.split('').map((l, i) => <option key={l} value={i + 1}>Plantilla {l}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={busy === team.id}
                    onClick={() => void saveSection(team)}
                    className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-white bg-rink-passion disabled:opacity-40"
                  >
                    Guardar sección
                  </button>
                  <button
                    type="button"
                    onClick={() => setSectionDraft((c) => { const n = { ...c }; delete n[team.id]; return n; })}
                    className="min-h-[40px] px-2 text-xs text-slate-500"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {!loading && teams.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Sin equipos para esa búsqueda.
          </p>
        )}
      </div>
    </div>
  );
}

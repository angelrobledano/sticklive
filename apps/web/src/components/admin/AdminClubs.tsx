'use client';

/**
 * Curación de clubes (Plan B1): nombre canónico, slug y ciudad de la ficha
 * pública /clubs/<slug>. El nombre canónico es el H1 y el title de la ficha,
 * así que va sin patrocinador ("HC Palau", no "Generali HC Palau"). Cambiar el
 * slug deja el anterior redirigiendo (308) al nuevo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { clubName } from '@/lib/names';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

interface ClubRow {
  id: string;
  slug: string;
  canonicalName: string;
  city: string | null;
  teams: number;
  active: boolean;
  teamNames: string[];
  suggestedSlug: string;
}

interface Draft { name: string; slug: string; city: string }

function slugify(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function draftOf(c: ClubRow): Draft {
  return { name: c.canonicalName, slug: c.slug, city: c.city ?? '' };
}

const INPUT = `min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
  bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
  focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent`;

export function AdminClubs({ token, onError }: { token: string; onError: (m: string) => void }) {
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const requestId = useRef(0);

  const load = useCallback(async (q: string) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/clubs?q=${encodeURIComponent(q)}`, {
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const body = await res.json() as { clubs: ClubRow[] };
      if (id !== requestId.current) return;
      setClubs(body.clubs);
      setDrafts(Object.fromEntries(body.clubs.map((c) => [c.id, draftOf(c)])));
    } catch (err) {
      if (id === requestId.current) onError(err instanceof Error ? err.message : 'Error');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [token, onError]);

  useEffect(() => {
    const id = setTimeout(() => { void load(query); }, 250);
    return () => clearTimeout(id);
  }, [query, load]);

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));

  const save = useCallback(async (club: ClubRow, draft: Draft) => {
    const body: Record<string, unknown> = {};
    if (draft.name.trim() !== club.canonicalName) body['canonicalName'] = draft.name;
    if (draft.slug.trim() !== club.slug) body['slug'] = draft.slug;
    if (draft.city.trim() !== (club.city ?? '')) body['city'] = draft.city.trim() || null;
    if (Object.keys(body).length === 0) return;
    if (body['slug'] && !window.confirm(
      `La URL pasará de /clubs/${club.slug} a /clubs/${draft.slug.trim()}. La antigua redirigirá a la nueva. ¿Seguir?`,
    )) return;

    setBusy(club.id);
    try {
      const res = await fetch(`${API_URL}/admin/clubs/${club.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { club?: { slug: string; canonicalName: string; city: string | null }; error?: string };
      if (res.status === 409) throw new Error(`El slug "${draft.slug}" ya lo usa otro club`);
      if (!res.ok || !json.club) throw new Error(json.error ?? `Error ${res.status}`);
      const saved = { ...club, ...json.club };
      setClubs((current) => current.map((c) => (c.id === club.id ? saved : c)));
      setDrafts((current) => ({ ...current, [club.id]: draftOf(saved) }));
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
        placeholder="Buscar club por nombre, slug o equipo…"
        aria-label="Buscar club"
        className={`w-full ${INPUT}`}
      />

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Nombre sin patrocinador: es el título de la ficha del club y lo que lee Google. Arriba, los clubes con
        equipos en la temporada en curso (los que se publican). Cambiar el slug cambia la URL; la antigua redirige.
      </p>

      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Cargando…</p>}

      <div className="space-y-2">
        {clubs.map((club) => {
          const draft = drafts[club.id] ?? draftOf(club);
          const changed = draft.name.trim() !== club.canonicalName
            || draft.slug.trim() !== club.slug
            || draft.city.trim() !== (club.city ?? '');
          return (
            <div key={club.id} className="card p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{club.canonicalName}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {club.teams} equipos · {club.teamNames.map(clubName).join(' · ')}
                  </p>
                  <Link href={`/clubs/${club.slug}`} className="text-[10px] font-mono text-rink-passion hover:underline">
                    /clubs/{club.slug}
                  </Link>
                </div>
                {club.active && (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    publicada
                  </span>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft(club.id, { name: e.target.value })}
                  aria-label={`Nombre de ${club.canonicalName}`}
                  placeholder="Nombre canónico"
                  maxLength={120}
                  className={INPUT}
                />
                <input
                  value={draft.slug}
                  onChange={(e) => setDraft(club.id, { slug: e.target.value.toLowerCase() })}
                  aria-label={`Slug de ${club.canonicalName}`}
                  placeholder="slug-del-club"
                  maxLength={120}
                  className={`${INPUT} font-mono`}
                />
                <input
                  value={draft.city}
                  onChange={(e) => setDraft(club.id, { city: e.target.value })}
                  aria-label={`Ciudad de ${club.canonicalName}`}
                  placeholder="Ciudad"
                  maxLength={80}
                  className={INPUT}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const name = clubName(draft.name);
                    setDraft(club.id, { name, slug: slugify(name) });
                  }}
                  className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300
                             bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  Sugerir
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(club.id, { slug: slugify(draft.name) })}
                  className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300
                             bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  Slug desde el nombre
                </button>
                <button
                  type="button"
                  disabled={busy === club.id || !changed}
                  onClick={() => void save(club, draft)}
                  className="min-h-[44px] px-4 rounded-xl text-xs font-semibold text-white
                             bg-rink-passion hover:bg-rink-passion-light disabled:opacity-40"
                >
                  {busy === club.id ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  disabled={busy === club.id || !changed}
                  onClick={() => setDrafts((current) => ({ ...current, [club.id]: draftOf(club) }))}
                  className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400
                             hover:text-red-500 disabled:opacity-40"
                >
                  Deshacer
                </button>
              </div>
            </div>
          );
        })}
        {!loading && clubs.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Sin clubes para esa búsqueda.</p>
        )}
      </div>
    </div>
  );
}

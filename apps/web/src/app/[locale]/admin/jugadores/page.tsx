'use client';

/**
 * Panel B1 — revisión de candidatos a misma persona entre federaciones.
 *
 * Tras separar las refs por portal (A1), un mismo jugador puede tener una ficha
 * por federación (Martí Serra Molist: RFEP, FECAPA y World Skate). La API
 * propone parejas con el mismo nombre en portales distintos; aquí una persona
 * decide. Unir conserva la ficha más antigua, mueve plantillas, alineaciones,
 * eventos y favoritos, y la otra redirige (308). Separar prohíbe el par para
 * siempre. Mismo token y sessionStorage que /admin y /admin/resolucion.
 */
import { useCallback, useEffect, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { portalLabels, seasonConflicts, type ReviewTeam } from '@/lib/player-link-review';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const TOKEN_KEY = 'sticklive_admin_token';
const TEAMS_SHOWN = 6;

interface Side {
  id: string;
  name: string;
  photoUrl: string | null;
  refs: string[];
  teams: ReviewTeam[];
}

interface Candidate {
  id: string;
  score: number;
  evidence: { sharedClub?: boolean };
  a: Side;
  b: Side;
}

interface ListData { count: number; items: Candidate[] }

function SideCard({ side, label }: { side: Side; label: string }) {
  const extra = side.teams.length - TEAMS_SHOWN;
  return (
    <div className="flex-1 min-w-0 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</p>
      <div className="flex items-center gap-3">
        {side.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={side.photoUrl} alt="" width={48} height={48}
               className="w-12 h-12 rounded-full object-cover bg-slate-100 dark:bg-slate-800 shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <Link href={`/players/${side.id}`} target="_blank"
                className="font-bold text-slate-900 dark:text-slate-50 hover:underline break-words">
            {side.name}
          </Link>
          <div className="flex flex-wrap gap-1 mt-1">
            {portalLabels(side.refs).map((p, i) => (
              <span key={side.refs[i]} title={side.refs[i]}
                    className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
      {side.teams.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Sin plantillas registradas.</p>
      ) : (
        <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
          {side.teams.slice(0, TEAMS_SHOWN).map((t) => (
            <li key={`${t.season}|${t.competition}|${t.team}`}>
              <span className="tabular-nums text-slate-500 dark:text-slate-400">{t.season}</span>{' '}
              <span className="font-semibold">{t.team}</span>{' '}
              <span className="text-slate-500 dark:text-slate-400">· {t.competition}</span>
            </li>
          ))}
          {extra > 0 && <li className="text-slate-500 dark:text-slate-400">y {extra} más</li>}
        </ul>
      )}
    </div>
  );
}

export default function JugadoresPage() {
  const [token, setToken]       = useState('');
  const [input, setInput]       = useState('');
  const [data, setData]         = useState<ListData | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [busy, setBusy]         = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TOKEN_KEY);
      if (saved) setToken(saved);
    } catch { /* noop */ }
  }, []);

  const load = useCallback(async (tk: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/player-links?status=pending`, { headers: { 'X-Admin-Token': tk } });
      if (res.status === 401) throw new Error('Token incorrecto');
      if (res.status === 503) throw new Error('ADMIN_TOKEN no configurado en la API');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setData(await res.json() as ListData);
      try { sessionStorage.setItem(TOKEN_KEY, tk); } catch { /* noop */ }
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Error');
      try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
      setToken('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token && !data && !loading) void load(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const act = useCallback(async (id: string, action: 'accept' | 'reject') => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/admin/player-links/${id}/${action}`, {
        method: 'POST', headers: { 'X-Admin-Token': token },
      });
      if (res.status === 409) throw new Error('Este par está marcado como personas distintas: no se puede unir.');
      if (res.status === 404) throw new Error('El candidato ya no está pendiente (¿lo resolvió otra persona?).');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setNotice(action === 'accept' ? 'Fichas unidas.' : 'Marcadas como personas distintas.');
      setConfirming(null);
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, load]);

  const generate = useCallback(async () => {
    setBusy('generate');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/admin/player-links/generate`, { method: 'POST', headers: { 'X-Admin-Token': token } });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const { created } = await res.json() as { created: number };
      setNotice(created === 0 ? 'No hay candidatos nuevos.' : `${created} candidatos nuevos.`);
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, load]);

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6">
        <form
          onSubmit={(e) => { e.preventDefault(); if (input.trim()) { setToken(input.trim()); void load(input.trim()); } }}
          className="card p-6 w-full max-w-sm space-y-4"
        >
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">Jugadores entre federaciones</h1>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Token de administrador"
            autoFocus
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                       bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                       focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={loading || !input.trim()} className="btn-primary w-full min-h-[44px] disabled:opacity-50">
            {loading ? 'Comprobando…' : 'Entrar'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">
          Jugadores entre federaciones <span className="text-slate-500 dark:text-slate-400 font-bold">({data.count})</span>
        </h1>
        <button
          onClick={() => { setData(null); setToken(''); try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ } }}
          className="text-xs text-slate-500 dark:text-slate-400 hover:text-red-500 min-h-[44px] px-2 shrink-0"
        >
          Cerrar sesión admin
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Fichas con el mismo nombre en federaciones distintas. Unir conserva la ficha más antigua, le pasa
        plantillas, partidos y favoritos, y la otra redirige. Separar evita que el par vuelva a proponerse.
        Ante la duda, abre las dos fichas.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void generate()} disabled={busy !== null}
                className="btn-primary min-h-[44px] px-3 text-xs disabled:opacity-40">
          {busy === 'generate' ? 'Buscando…' : 'Buscar candidatos nuevos'}
        </button>
        <Link href="/admin/resolucion" className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-rink-passion min-h-[44px] inline-flex items-center px-2">
          Cola de equipos →
        </Link>
      </div>

      <div role="status" aria-live="polite" className="text-xs">
        {notice && <p className="text-emerald-700 dark:text-emerald-400">{notice}</p>}
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {data.items.map((c) => {
        const conflicts = seasonConflicts(c.a, c.b);
        const isBusy = busy === c.id;
        return (
          <div key={c.id} className="card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                c.score >= 0.95
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                {c.score >= 0.95 ? 'Comparten club' : 'Solo nombre'} · {Math.round(c.score * 100)}%
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <SideCard side={c.a} label="Ficha A" />
              <SideCard side={c.b} label="Ficha B" />
            </div>

            {conflicts.length > 0 && (
              <div role="alert" className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-300">
                <p className="font-bold">Probablemente son dos personas:</p>
                <ul className="mt-1 space-y-0.5">
                  {conflicts.map((k) => (
                    <li key={`${k.season}|${k.competition}`}>
                      {k.season} · {k.competition}: {k.teamA} y {k.teamB} a la vez
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {confirming === c.id ? (
                <>
                  <button onClick={() => void act(c.id, 'accept')} disabled={isBusy}
                          className="btn-primary min-h-[44px] px-3 text-xs disabled:opacity-40">
                    {isBusy ? 'Uniendo…' : 'Confirmar: unir fichas'}
                  </button>
                  <button onClick={() => setConfirming(null)} disabled={isBusy}
                          className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-2 min-h-[44px]">
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setConfirming(c.id)} disabled={busy !== null}
                          className="text-xs font-semibold px-3 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700
                                     text-slate-700 dark:text-slate-300 hover:border-rink-passion hover:text-rink-passion disabled:opacity-40">
                    Son la misma persona
                  </button>
                  <button onClick={() => void act(c.id, 'reject')} disabled={busy !== null}
                          className="text-xs font-semibold px-3 min-h-[44px] rounded-xl text-slate-500 dark:text-slate-400 hover:text-red-500 disabled:opacity-40">
                    {isBusy ? 'Guardando…' : 'Son personas distintas'}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {data.items.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No hay candidatos pendientes. Pulsa «Buscar candidatos nuevos» tras cargar actas de otra federación.
        </div>
      )}
    </div>
  );
}

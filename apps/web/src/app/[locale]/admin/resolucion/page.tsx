'use client';

/**
 * Panel HITL — cola de resolución de entidades (Fase 2b).
 *
 * Mismo token compartido que /admin (ADMIN_TOKEN de la API), guardado en
 * sessionStorage. No está enlazado desde la app ni se indexa. Cada resolución
 * escribe un alias humano en la API, así ese nombre se resuelve solo la próxima
 * vez y desaparece de la cola.
 */
import { useCallback, useEffect, useState } from 'react';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const TOKEN_KEY = 'sticklive_admin_token';

interface Candidate {
  teamId: string;
  name: string;
  score: number;
}

interface QueueItem {
  id: string;
  rawText: string;
  normalized: string;
  sourceRef: string | null;
  occurrences: number;
  candidates: Candidate[];
}

interface QueueData {
  status: string;
  count: number;
  items: QueueItem[];
}

interface Stats {
  queue: { pending: number; resolved: number; rejected: number; pendingOccurrences: number };
  aliases: { deterministic: number; fuzzy: number; human: number; total: number };
}

export default function ResolucionPage() {
  const [token, setToken]     = useState('');
  const [input, setInput]     = useState('');
  const [data, setData]       = useState<QueueData | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState<string | null>(null);
  const [manual, setManual]   = useState<Record<string, string>>({});
  const [stats, setStats]     = useState<Stats | null>(null);

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
      const res = await fetch(`${API_URL}/admin/resolution-queue?status=pending&limit=200`, {
        headers: { 'X-Admin-Token': tk },
      });
      if (res.status === 401) throw new Error('Token incorrecto');
      if (res.status === 503) throw new Error('ADMIN_TOKEN no configurado en la API');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setData(await res.json() as QueueData);
      const sres = await fetch(`${API_URL}/admin/resolution-queue/stats`, { headers: { 'X-Admin-Token': tk } });
      if (sres.ok) setStats(await sres.json() as Stats);
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

  const resolve = useCallback(async (id: string, teamId: string) => {
    if (!teamId.trim()) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/resolution-queue/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ teamId: teamId.trim() }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, load]);

  const reject = useCallback(async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/resolution-queue/${id}/reject`, {
        method: 'POST',
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, load]);

  // Pantalla de token
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6">
        <form
          onSubmit={(e) => { e.preventDefault(); if (input.trim()) { setToken(input.trim()); void load(input.trim()); } }}
          className="card p-6 w-full max-w-sm space-y-4"
        >
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">Cola de resolución</h1>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Token de administrador"
            autoFocus
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                       bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                       focus:outline-none focus:ring-2 focus:ring-rink-passion"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button type="submit" disabled={loading || !input.trim()} className="btn-primary w-full min-h-[44px] disabled:opacity-50">
            {loading ? 'Comprobando…' : 'Entrar'}
          </button>
        </form>
      </div>
    );
  }

  // Panel
  return (
    <div className="px-4 py-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">
          Cola de resolución <span className="text-slate-400 font-bold">({data.count})</span>
        </h1>
        <button
          onClick={() => { setData(null); setToken(''); try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ } }}
          className="text-xs text-slate-400 hover:text-red-500 min-h-[44px] px-2"
        >
          Cerrar sesión admin
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Refs que el ETL no resolvió, por impacto. Asignar escribe un alias: ese nombre se resuelve solo a partir de ahora.
      </p>

      {stats && (
        <div className="grid grid-cols-4 gap-2">
          {([
            ['Pendientes',  stats.queue.pending],
            ['Ocurrencias', stats.queue.pendingOccurrences],
            ['Resueltos',   stats.queue.resolved],
            ['Aprendidos',  stats.aliases.human + stats.aliases.fuzzy],
          ] as [string, number][]).map(([label, value]) => (
            <div key={label} className="card px-3 py-2 text-center">
              <p className="text-xl font-extrabold text-slate-900 dark:text-slate-50 tabular-nums">{value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</p>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {data.items.map((it) => (
        <div key={it.id} className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-slate-900 dark:text-slate-50 truncate">{it.rawText}</p>
              <p className="text-[11px] font-mono text-slate-400 dark:text-slate-600 truncate">
                {it.normalized}{it.sourceRef ? ` · ${it.sourceRef}` : ''}
              </p>
            </div>
            <span className="shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider
                             bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              ×{it.occurrences}
            </span>
          </div>

          {it.candidates.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {it.candidates.map((cnd) => (
                <button
                  key={cnd.teamId}
                  onClick={() => resolve(it.id, cnd.teamId)}
                  disabled={busy === it.id}
                  className="text-xs font-semibold px-3 min-h-[36px] rounded-xl border border-slate-200 dark:border-slate-700
                             text-slate-700 dark:text-slate-300 hover:border-rink-passion hover:text-rink-passion disabled:opacity-40"
                >
                  {cnd.name} <span className="text-slate-400 tabular-nums">{Math.round(cnd.score * 100)}%</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Sin candidatos automáticos.</p>
          )}

          <div className="flex items-center gap-2">
            <input
              value={manual[it.id] ?? ''}
              onChange={(e) => setManual((m) => ({ ...m, [it.id]: e.target.value }))}
              placeholder="team_id (UUID) manual"
              className="flex-1 min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                         bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200
                         focus:outline-none focus:ring-2 focus:ring-rink-passion"
            />
            <button
              onClick={() => resolve(it.id, manual[it.id] ?? '')}
              disabled={busy === it.id || !(manual[it.id] ?? '').trim()}
              className="btn-primary min-h-[36px] px-3 text-xs disabled:opacity-40"
            >
              Asignar
            </button>
            <button
              onClick={() => reject(it.id)}
              disabled={busy === it.id}
              className="text-xs font-semibold text-slate-400 hover:text-red-500 px-2 min-h-[36px] disabled:opacity-40"
            >
              Descartar
            </button>
          </div>
        </div>
      ))}

      {data.items.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate-400 dark:text-slate-600">
          Cola vacía. Nada pendiente de resolver.
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * Panel de administración — nivel 1.
 *
 * Protección por token compartido (ADMIN_TOKEN de la API): se pide una vez
 * y se guarda en sessionStorage (se borra al cerrar la pestaña). No está
 * enlazado desde ninguna parte de la app ni se indexa.
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminCompetitions } from '@/components/admin/AdminCompetitions';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const TOKEN_KEY = 'sticklive_admin_token';

interface AdminUser {
  id: string;
  email: string | null;
  deviceId: string;
  status: 'active' | 'disabled';
  isPremium: boolean;
  premiumUntil: string | null;
  createdAt: string;
  hasSession: boolean;
  favorites: number;
}

interface AdminData {
  total: number;
  withEmail: number;
  premium: number;
  disabled: number;
  users: AdminUser[];
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-4 py-3 text-center">
      <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-50 tabular-nums">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

export default function AdminPage() {
  const [token, setToken]   = useState('');
  const [input, setInput]   = useState('');
  const [data, setData]     = useState<AdminData | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]     = useState<string | null>(null); // id de usuario en mutación
  const [tab, setTab]       = useState<'users' | 'competitions'>('users');

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
      const res = await fetch(`${API_URL}/admin/users`, {
        headers: { 'X-Admin-Token': tk },
      });
      if (res.status === 401) throw new Error('Token incorrecto');
      if (res.status === 503) throw new Error('ADMIN_TOKEN no configurado en la API');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setData(await res.json() as AdminData);
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

  const setStatus = useCallback(async (id: string, status: 'active' | 'disabled') => {
    setBusy(id);
    try {
      const res = await fetch(`${API_URL}/admin/users/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, load]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm('¿Borrar definitivamente este usuario y sus favoritos?')) return;
    setBusy(id);
    try {
      const res = await fetch(`${API_URL}/admin/users/${id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': token },
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, load]);

  // ── Pantalla de token ──────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6">
        <form
          onSubmit={(e) => { e.preventDefault(); if (input.trim()) { setToken(input.trim()); void load(input.trim()); } }}
          className="card p-6 w-full max-w-sm space-y-4"
        >
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">Administración</h1>
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

  // ── Panel ──────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 py-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">
          {tab === 'users' ? 'Usuarios' : 'Competiciones'}
        </h1>
        <button
          onClick={() => { setData(null); setToken(''); try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ } }}
          className="text-xs text-slate-400 hover:text-red-500 min-h-[44px] px-2"
        >
          Cerrar sesión admin
        </button>
      </div>

      <div className="flex gap-1">
        {([['users', 'Usuarios'], ['competitions', 'Competiciones']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`text-xs font-semibold px-3 min-h-[36px] rounded-lg ${
              tab === key
                ? 'bg-rink-passion text-white'
                : 'text-slate-500 hover:text-rink-passion'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <>
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total"        value={data.total} />
        <KpiCard label="Con email"    value={data.withEmail} />
        <KpiCard label="Premium"      value={data.premium} />
        <KpiCard label="Desactivados" value={data.disabled} />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Tabla */}
      <div className="card overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800
                           text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <th className="text-left px-4 py-2.5">Usuario</th>
              <th className="text-center px-2 py-2.5">Favoritos</th>
              <th className="text-center px-2 py-2.5">Premium</th>
              <th className="text-center px-2 py-2.5">Estado</th>
              <th className="text-left px-2 py-2.5">Alta</th>
              <th className="text-right px-4 py-2.5">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {data.users.map((u) => (
              <tr key={u.id} className={u.status === 'disabled' ? 'opacity-50' : ''}>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[220px]">
                    {u.email ?? <span className="italic text-slate-400">anónimo</span>}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-600 truncate max-w-[220px]">{u.deviceId}</p>
                </td>
                <td className="text-center px-2 py-2.5 tabular-nums text-slate-600 dark:text-slate-400">{u.favorites}</td>
                <td className="text-center px-2 py-2.5">
                  {u.isPremium ? <span className="text-amber-500 font-bold">★</span> : <span className="text-slate-300 dark:text-slate-700">—</span>}
                </td>
                <td className="text-center px-2 py-2.5">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    u.status === 'active'
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-500'
                  }`}>
                    {u.status === 'active' ? 'Activo' : 'Bloqueado'}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(u.createdAt)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button
                    onClick={() => setStatus(u.id, u.status === 'active' ? 'disabled' : 'active')}
                    disabled={busy === u.id}
                    className="text-xs font-semibold text-slate-500 hover:text-rink-passion px-2 min-h-[36px] disabled:opacity-40"
                  >
                    {u.status === 'active' ? 'Bloquear' : 'Reactivar'}
                  </button>
                  <button
                    onClick={() => remove(u.id)}
                    disabled={busy === u.id}
                    className="text-xs font-semibold text-slate-400 hover:text-red-500 px-2 min-h-[36px] disabled:opacity-40"
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
            {data.users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">Sin usuarios todavía</td></tr>
            )}
          </tbody>
        </table>
      </div>
        </>
      )}

      {tab === 'competitions' && <AdminCompetitions token={token} onError={setError} />}
    </div>
  );
}

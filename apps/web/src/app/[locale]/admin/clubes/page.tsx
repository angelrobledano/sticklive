'use client';

/**
 * Panel A4 — clubes por escudo.
 *
 * El escudo de sidgad es el id de club: todos los equipos con el mismo fichero
 * (`logos_clubes/calafell.png`) son el mismo club aunque cambie el patrocinador.
 * El backfill `backfill-clubs-by-crest` los cuelga de un club. Aquí se revisa
 * cada grupo ANTES de lanzarlo con --write: qué equipos entran, de qué
 * temporadas, y qué clubes duplicados se fusionarían con --merge-clubs. Solo
 * lectura. Mismo token y sessionStorage que el resto del admin.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const TOKEN_KEY = 'sticklive_admin_token';

type Status = 'merge' | 'pending' | 'ok';

interface ReviewTeam {
  id: string; name: string; gender: string | null; ageCategory: string | null;
  clubId: string | null; clubName: string | null; matches: number;
  lastSeason: string | null; lastCompetition: string | null;
}
interface Group { key: string; portal: string; crestUrl: string; status: Status; clubs: { id: string; name: string }[]; teams: ReviewTeam[] }
interface Data { count: number; counts: Record<Status, number>; groups: Group[] }

const STATUS: Record<Status, { label: string; cls: string; help: string }> = {
  merge: {
    label: 'Clubes duplicados', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    help: 'Varios clubes con el mismo escudo. Se unirían en uno con --merge-clubs.',
  },
  pending: {
    label: 'Equipos sin club', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
    help: 'Los equipos sin club se colgarían del club del grupo con --write.',
  },
  ok: { label: 'Correcto', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', help: '' },
};

const PORTAL: Record<string, string> = {
  rfep: 'RFEP', fecapa: 'FECAPA', worldskate: 'World Skate', fmp: 'FMP', fap: 'FAP', fpcv: 'FPCV', fgp: 'FGP',
};

function section(t: ReviewTeam): string {
  return [t.gender === 'female' ? 'Fem.' : t.gender === 'male' ? 'Masc.' : null, t.ageCategory].filter(Boolean).join(' · ');
}

function GroupCard({ g }: { g: Group }) {
  const st = STATUS[g.status];
  return (
    <article className="card space-y-3 p-4">
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- escudo remoto de sidgad, solo admin */}
        <img src={g.crestUrl} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain p-1 ring-1 ring-slate-200 dark:ring-slate-700" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-slate-900 dark:text-slate-50">{g.clubs[0]?.name ?? g.teams[0]?.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono">{g.key}</span> · {PORTAL[g.portal] ?? g.portal} · {g.teams.length} equipos
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
      </header>
      {st.help && <p className="text-xs text-slate-500 dark:text-slate-400">{st.help}</p>}

      {g.status === 'merge' && (
        <p className="text-xs">
          <span className="font-semibold text-slate-700 dark:text-slate-200">Clubes: </span>
          {g.clubs.map((c, i) => <span key={c.id}>{i > 0 && ' · '}{c.name}</span>)}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <th className="py-1 pr-2 font-semibold">Equipo</th>
              <th className="py-1 pr-2 font-semibold">Última temporada</th>
              <th className="py-1 pr-2 text-right font-semibold">Partidos</th>
              <th className="py-1 font-semibold">Club actual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {g.teams.map((t) => (
              <tr key={t.id}>
                <td className="py-1.5 pr-2">
                  <Link href={`/teams/${t.id}`} target="_blank" className="font-semibold text-slate-800 hover:underline dark:text-slate-100">{t.name}</Link>
                  {section(t) && <span className="ml-1 text-slate-400">{section(t)}</span>}
                </td>
                <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">
                  {t.lastSeason
                    ? <>{t.lastSeason} <span className="text-slate-400">· {t.lastCompetition}</span></>
                    : <span className="text-slate-400">—</span>}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{t.matches}</td>
                <td className="py-1.5">
                  {t.clubName
                    ? <span className="text-slate-700 dark:text-slate-200">{t.clubName}</span>
                    : <span className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">sin club</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export default function AdminClubesPage() {
  const [token, setToken] = useState('');
  const [input, setInput] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'issues' | Status>('issues');
  const [q, setQ] = useState('');

  useEffect(() => {
    try { const saved = sessionStorage.getItem(TOKEN_KEY); if (saved) setToken(saved); } catch { /* noop */ }
  }, []);

  const load = useCallback(async (tk: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/club-crests`, { headers: { 'X-Admin-Token': tk } });
      if (res.status === 401) throw new Error('Token incorrecto');
      if (res.status === 503) throw new Error('ADMIN_TOKEN no configurado en la API');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setData(await res.json() as Data);
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

  const visible = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.groups.filter((g) =>
      (filter === 'issues' ? g.status !== 'ok' : g.status === filter)
      && (!needle || g.key.includes(needle) || g.teams.some((t) => t.name.toLowerCase().includes(needle))));
  }, [data, filter, q]);

  if (!data) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6">
        <form
          onSubmit={(e) => { e.preventDefault(); if (input.trim()) { setToken(input.trim()); void load(input.trim()); } }}
          className="card w-full max-w-sm space-y-4 p-6"
        >
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">Clubes por escudo</h1>
          <input
            type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Token de administrador" autoFocus
            className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-rink-passion dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-rink-accent"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={loading || !input.trim()} className="btn-primary min-h-[44px] w-full disabled:opacity-50">
            {loading ? 'Comprobando…' : 'Entrar'}
          </button>
        </form>
      </div>
    );
  }

  const chip = (key: 'issues' | Status, label: string, n: number) => (
    <button
      key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${
        filter === key
          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
          : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
      }`}
    >
      {label} <span className="tabular-nums opacity-70">{n}</span>
    </button>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">Clubes por escudo</h1>
        <button
          onClick={() => { setData(null); setToken(''); try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ } }}
          className="min-h-[44px] shrink-0 px-2 text-xs text-slate-500 hover:text-red-500 dark:text-slate-400"
        >
          Cerrar sesión admin
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Equipos agrupados por el fichero de su escudo, que en sidgad es el id del club. Revisa que cada grupo sea de
        verdad el mismo club (secciones masculina, femenina o de base son normales, un nombre que no encaja no lo es)
        y después lanza <code className="font-mono">backfill-clubs-by-crest.js --write</code>, y{' '}
        <code className="font-mono">--merge-clubs</code> para los duplicados. Este panel no escribe nada.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {chip('issues', 'Por revisar', data.counts.merge + data.counts.pending)}
        {chip('merge', 'Clubes duplicados', data.counts.merge)}
        {chip('pending', 'Equipos sin club', data.counts.pending)}
        {chip('ok', 'Correctos', data.counts.ok)}
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar equipo o escudo"
          aria-label="Buscar equipo o escudo"
          className="min-h-[36px] min-w-[10rem] flex-1 rounded-full border border-slate-200 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {visible.length === 0
        ? <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">Nada que revisar con este filtro.</div>
        : visible.map((g) => <GroupCard key={g.key} g={g} />)}
    </div>
  );
}

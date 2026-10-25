'use client';

/**
 * Panel HITL — cola de equipos.
 *
 * Dos preguntas distintas, cada una con su tarjeta:
 *   · "¿Qué equipo es «X»?": la fuente escribió un nombre que el ETL no supo
 *     asignar. Elegir un equipo escribe un alias y ese nombre ya se resuelve
 *     solo. "No es ninguno" lo descarta.
 *   · "¿Son el mismo equipo?": dos equipos con nombre muy parecido. Aquí no se
 *     fusiona nada (es destructivo): si son secciones o nombres de patrocinador
 *     del mismo club, se agrupan en Clubes por escudo; si son distintos, se
 *     descarta y no vuelve a proponerse.
 * Mismo token y sessionStorage que el resto del admin.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const TOKEN_KEY = 'sticklive_admin_token';

interface Candidate { teamId: string; name: string; score: number }
interface QueueItem {
  id: string; rawText: string; normalized: string; sourceRef: string | null;
  occurrences: number; candidates: Candidate[]; kind: 'name' | 'duplicate';
  origin?: string | null; gender?: string | null; ageCategory?: string | null;
}
interface TeamBrief {
  id: string; name: string; logoUrl: string | null; gender: string | null; ageCategory: string | null;
  clubName: string | null; matches: number; lastSeason: string | null; lastCompetition: string | null;
}
interface QueueData { count: number; items: QueueItem[]; teams: Record<string, TeamBrief> }
interface Stats {
  queue: { pending: number; resolved: number; rejected: number; pendingOccurrences: number };
  aliases: { deterministic: number; fuzzy: number; human: number; total: number };
}
interface SearchTeam { id: string; name: string; logoUrl: string | null }

function section(t: TeamBrief | undefined): string {
  if (!t) return '';
  return [t.gender === 'female' ? 'Femenino' : t.gender === 'male' ? 'Masculino' : null, t.ageCategory].filter(Boolean).join(' · ');
}

function Crest({ url, size = 40 }: { url: string | null | undefined; size?: number }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- escudo remoto, solo admin
    <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-slate-200 dark:ring-slate-700" style={{ width: size, height: size }} />
  ) : (
    <span className="shrink-0 rounded-md bg-slate-100 dark:bg-slate-800" style={{ width: size, height: size }} aria-hidden="true" />
  );
}

/** Ficha de un equipo candidato: lo necesario para reconocerlo sin abrirlo. */
function TeamCard({ id, fallbackName, brief, children }: { id: string; fallbackName: string; brief?: TeamBrief; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <Crest url={brief?.logoUrl} />
      <div className="min-w-0 flex-1">
        <Link href={`/teams/${id}`} target="_blank" className="block truncate text-sm font-bold text-slate-900 hover:underline dark:text-slate-50">
          {brief?.name ?? fallbackName}
        </Link>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {[section(brief), brief?.lastSeason ? `${brief.lastSeason} · ${brief.lastCompetition}` : 'sin partidos', brief ? `${brief.matches} partidos` : null]
            .filter(Boolean).join(' · ')}
        </p>
        {brief?.clubName && <p className="truncate text-[11px] text-slate-400">Club: {brief.clubName}</p>}
      </div>
      {children}
    </div>
  );
}

/** Buscador de equipos por nombre (sustituye a pegar un UUID). */
function TeamSearch({ onPick, disabled }: { onPick: (id: string) => void; disabled: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchTeam[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`${API_URL}/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { teams: [] }))
        .then((d: { teams?: SearchTeam[] }) => setResults((d.teams ?? []).slice(0, 6)))
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);
  return (
    <div className="space-y-2">
      <input
        type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Otro equipo? Búscalo por nombre"
        aria-label="Buscar otro equipo"
        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-rink-passion dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      />
      {results.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
          {results.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2">
              <Crest url={t.logoUrl} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{t.name}</span>
              <button type="button" disabled={disabled} onClick={() => onPick(t.id)}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900">
                Es este
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ResolutionQueuePage() {
  const [token, setToken] = useState('');
  const [input, setInput] = useState('');
  const [data, setData] = useState<QueueData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'name' | 'duplicate'>('name');

  useEffect(() => {
    try { const saved = sessionStorage.getItem(TOKEN_KEY); if (saved) setToken(saved); } catch { /* noop */ }
  }, []);

  const load = useCallback(async (tk: string) => {
    setLoading(true);
    setError(null);
    try {
      const headers = { 'X-Admin-Token': tk };
      const [qRes, sRes] = await Promise.all([
        fetch(`${API_URL}/admin/resolution-queue?status=pending`, { headers }),
        fetch(`${API_URL}/admin/resolution-queue/stats`, { headers }),
      ]);
      if (qRes.status === 401) throw new Error('Token incorrecto');
      if (qRes.status === 503) throw new Error('ADMIN_TOKEN no configurado en la API');
      if (!qRes.ok) throw new Error(`Error ${qRes.status}`);
      const q = await qRes.json() as QueueData;
      setData({ ...q, teams: q.teams ?? {} });
      if (sRes.ok) setStats(await sRes.json() as Stats);
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

  const act = useCallback(async (id: string, action: 'resolve' | 'reject', teamId?: string, msg?: string) => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/admin/resolution-queue/${id}/${action}`, {
        method: 'POST',
        headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
        body: action === 'resolve' ? JSON.stringify({ teamId }) : undefined,
      });
      if (res.status === 404) throw new Error('Ya no está pendiente (¿lo resolvió otra persona?).');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setNotice(msg ?? 'Hecho.');
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, load]);

  const byKind = useMemo(() => ({
    name: data?.items.filter((i) => i.kind !== 'duplicate') ?? [],
    duplicate: data?.items.filter((i) => i.kind === 'duplicate') ?? [],
  }), [data]);

  if (!data) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6">
        <form
          onSubmit={(e) => { e.preventDefault(); if (input.trim()) { setToken(input.trim()); void load(input.trim()); } }}
          className="card w-full max-w-sm space-y-4 p-6"
        >
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">Cola de equipos</h1>
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

  const items = byKind[tab];

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">Cola de equipos</h1>
        <button
          onClick={() => { setData(null); setToken(''); try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ } }}
          className="min-h-[44px] shrink-0 px-2 text-xs text-slate-500 hover:text-red-500 dark:text-slate-400"
        >
          Cerrar sesión admin
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2" role="tablist">
        {([
          ['name', 'Nombres sin equipo', 'La fuente escribió un nombre que no sabemos a qué equipo corresponde.'],
          ['duplicate', 'Posibles duplicados', 'Dos equipos con nombres casi iguales. ¿Son el mismo?'],
        ] as const).map(([key, label, help]) => (
          <button
            key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              tab === key ? 'border-rink-passion bg-rink-passion/[0.06] dark:bg-rink-passion/15' : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-50">{label}</span>
              <span className="font-score text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{byKind[key].length}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{help}</p>
          </button>
        ))}
      </div>

      {stats && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Ya resueltos: {stats.queue.resolved} · descartados: {stats.queue.rejected} · nombres aprendidos: {stats.aliases.human + stats.aliases.fuzzy}
        </p>
      )}

      <div role="status" aria-live="polite" className="text-xs">
        {notice && <p className="text-emerald-700 dark:text-emerald-400">{notice}</p>}
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {items.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">Nada pendiente aquí.</div>
      )}

      {tab === 'name' && items.map((it) => (
        <article key={it.id} className="card space-y-3 p-4">
          <header>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              ¿Qué equipo es…? · visto {it.occurrences} {it.occurrences === 1 ? 'vez' : 'veces'}
            </p>
            <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-slate-50">«{it.rawText}»</p>
            {(it.origin || it.gender || it.ageCategory) && (
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Viene de: {[
                  it.origin ?? 'competición desconocida',
                  it.gender === 'female' ? 'Femenino' : it.gender === 'male' ? 'Masculino' : null,
                  it.ageCategory,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Elige el equipo y ese nombre se asignará solo a partir de ahora.
            </p>
          </header>
          {it.candidates.length > 0 ? (
            <div className="space-y-2">
              {it.candidates.map((cnd) => (
                <TeamCard key={cnd.teamId} id={cnd.teamId} fallbackName={cnd.name} brief={data.teams[cnd.teamId]}>
                  <button
                    type="button" disabled={busy === it.id}
                    onClick={() => void act(it.id, 'resolve', cnd.teamId, `«${it.rawText}» queda asignado a ${data.teams[cnd.teamId]?.name ?? cnd.name}.`)}
                    className="btn-primary min-h-[40px] shrink-0 px-3 text-xs disabled:opacity-40"
                  >
                    Es este
                  </button>
                </TeamCard>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">No hay candidatos parecidos: búscalo abajo.</p>
          )}
          <TeamSearch disabled={busy === it.id} onPick={(teamId) => void act(it.id, 'resolve', teamId, `«${it.rawText}» asignado.`)} />
          <button
            type="button" disabled={busy === it.id}
            onClick={() => void act(it.id, 'reject', undefined, `«${it.rawText}» descartado.`)}
            className="min-h-[40px] text-xs font-semibold text-slate-500 hover:text-red-500 disabled:opacity-40 dark:text-slate-400"
          >
            No es ninguno (descartar)
          </button>
        </article>
      ))}

      {tab === 'duplicate' && items.map((it) => {
        const [a, b] = it.candidates;
        return (
          <article key={it.id} className="card space-y-3 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              ¿Son el mismo equipo? · parecido {Math.round((a?.score ?? 0) * 100)} %
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {a && <TeamCard id={a.teamId} fallbackName={a.name} brief={data.teams[a.teamId]} />}
              {b && <TeamCard id={b.teamId} fallbackName={b.name} brief={data.teams[b.teamId]} />}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Si son secciones (masculino, femenino, filial) o nombres de patrocinador del mismo club, no se fusionan:
              se agrupan bajo su club en <Link href="/admin/clubes" className="font-semibold underline">Clubes por escudo</Link>.
              Si son equipos distintos, márcalo y no se volverá a proponer.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button" disabled={busy === it.id}
                onClick={() => void act(it.id, 'reject', undefined, 'Marcados como equipos distintos.')}
                className="btn-primary min-h-[40px] px-3 text-xs disabled:opacity-40"
              >
                Son equipos distintos
              </button>
              <Link href="/admin/clubes" className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                Son del mismo club → Clubes
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}

'use client';

/**
 * Federaciones (migración 089). Arriba, los organizers en uso que no tienen
 * federación: sus competiciones salen sin agrupar por federación hasta que se
 * dan de alta aquí. Debajo, el árbol con edición.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

type Level = 'world' | 'continental' | 'national' | 'regional';

interface FedRow {
  code: string;
  slug: string;
  name: string;
  short_name: string;
  level: Level;
  parent_code: string | null;
  country: string | null;
  region: string | null;
  website: string | null;
  display_order: number;
  competition_count: string;
}

interface Orphan { organizer: string; competition_count: string; countries: string[] }

interface Draft {
  code: string; slug: string; name: string; shortName: string; level: Level;
  parentCode: string; country: string; region: string; website: string; displayOrder: string;
}

const PARENT_LEVEL: Record<Level, Level | null> = { world: null, continental: 'world', national: 'continental', regional: 'national' };
const LEVEL_LABEL: Record<Level, string> = { world: 'Mundial', continental: 'Continental', national: 'Nacional', regional: 'Autonómica / regional' };

function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function emptyDraft(code = '', country = ''): Draft {
  return { code, slug: slugify(code), name: '', shortName: code, level: 'regional', parentCode: '', country, region: '', website: '', displayOrder: '200' };
}

function fromRow(f: FedRow): Draft {
  return {
    code: f.code, slug: f.slug, name: f.name, shortName: f.short_name, level: f.level,
    parentCode: f.parent_code ?? '', country: f.country ?? '', region: f.region ?? '',
    website: f.website ?? '', displayOrder: String(f.display_order),
  };
}

const input = 'w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-rink-passion';

export function AdminFederations({ token, onError }: { token: string; onError: (m: string) => void }) {
  const [feds, setFeds] = useState<FedRow[]>([]);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/admin/federations`, { headers: { 'X-Admin-Token': token } });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const body = await res.json() as { federations: FedRow[]; orphans: Orphan[] };
      setFeds(body.federations);
      setOrphans(body.orphans);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    }
  }, [token, onError]);

  useEffect(() => { void load(); }, [load]);

  const parents = useMemo(() => {
    const lvl = draft ? PARENT_LEVEL[draft.level] : null;
    return lvl ? feds.filter((f) => f.level === lvl) : [];
  }, [feds, draft]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`${API_URL}/admin/federations/${encodeURIComponent(draft.code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({
          slug: draft.slug, name: draft.name, shortName: draft.shortName, level: draft.level,
          parentCode: draft.parentCode || null, country: draft.country || null, region: draft.region || null,
          website: draft.website || null, displayOrder: draft.displayOrder === '' ? null : Number(draft.displayOrder),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setFormError(body.error ?? `Error ${res.status}`);
        return;
      }
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft((d) => (d ? { ...d, [k]: e.target.value } : d));

  return (
    <div className="space-y-4">
      {orphans.length > 0 && (
        <div className="card p-4 border-amber-200 dark:border-amber-900">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Organizers sin federación ({orphans.length})
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
            Sus competiciones no se agrupan por federación ni tienen hub. El código debe ser el texto exacto de «organizer».
          </p>
          {orphans.map((o) => (
            <div key={o.organizer} className="flex items-center gap-3 py-1">
              <p className="flex-1 text-sm text-slate-700 dark:text-slate-200 truncate">
                <code>{o.organizer}</code> · {Number(o.competition_count)} comp. · {o.countries.join(', ')}
              </p>
              <button
                onClick={() => { setIsNew(true); setFormError(null); setDraft(emptyDraft(o.organizer, o.countries.length === 1 ? (o.countries[0] ?? '') : '')); }}
                className="text-xs font-semibold text-rink-passion px-2 min-h-[44px]"
              >
                Dar de alta
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => { setIsNew(true); setFormError(null); setDraft(emptyDraft()); }}
          className="text-xs font-semibold bg-rink-passion text-white px-4 min-h-[40px] rounded-lg"
        >
          Nueva federación
        </button>
      </div>

      {draft && (
        <div className="card p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{isNew ? 'Alta de federación' : `Editar ${draft.code}`}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-[11px] text-slate-500">Código (= organizer)
              <input className={input} value={draft.code} disabled={!isNew}
                onChange={(e) => setDraft((d) => d ? { ...d, code: e.target.value, slug: isNew ? slugify(e.target.value) : d.slug, shortName: isNew ? e.target.value : d.shortName } : d)} />
            </label>
            <label className="text-[11px] text-slate-500">Slug (URL del hub)
              <input className={input} value={draft.slug} onChange={set('slug')} />
            </label>
            <label className="text-[11px] text-slate-500 sm:col-span-2">Nombre completo
              <input className={input} value={draft.name} onChange={set('name')} />
            </label>
            <label className="text-[11px] text-slate-500">Nombre corto
              <input className={input} value={draft.shortName} onChange={set('shortName')} />
            </label>
            <label className="text-[11px] text-slate-500">Nivel
              <select className={input} value={draft.level}
                onChange={(e) => setDraft((d) => d ? { ...d, level: e.target.value as Level, parentCode: '' } : d)}>
                {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
              </select>
            </label>
            {PARENT_LEVEL[draft.level] && (
              <label className="text-[11px] text-slate-500">Federación padre
                <select className={input} value={draft.parentCode} onChange={set('parentCode')}>
                  <option value="">— elegir —</option>
                  {parents.map((f) => <option key={f.code} value={f.code}>{f.short_name} · {f.name}</option>)}
                </select>
              </label>
            )}
            {(draft.level === 'national' || draft.level === 'regional') && (
              <label className="text-[11px] text-slate-500">País (ISO-2)
                <input className={input} value={draft.country} maxLength={2} onChange={(e) => setDraft((d) => d ? { ...d, country: e.target.value.toUpperCase() } : d)} />
              </label>
            )}
            {draft.level === 'regional' && (
              <label className="text-[11px] text-slate-500">Región
                <input className={input} value={draft.region} onChange={set('region')} />
              </label>
            )}
            <label className="text-[11px] text-slate-500">Web oficial
              <input className={input} value={draft.website} onChange={set('website')} placeholder="https://" />
            </label>
            <label className="text-[11px] text-slate-500">Orden (menor = antes)
              <input className={input} inputMode="numeric" value={draft.displayOrder} onChange={(e) => setDraft((d) => d ? { ...d, displayOrder: e.target.value.replace(/[^0-9]/g, '') } : d)} />
            </label>
          </div>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setDraft(null)} className="text-xs font-semibold text-slate-500 px-4 min-h-[40px]">Cancelar</button>
            <button onClick={() => void save()} disabled={saving}
              className="text-xs font-semibold bg-rink-passion text-white px-4 min-h-[40px] rounded-lg disabled:opacity-40">
              Guardar
            </button>
          </div>
        </div>
      )}

      <div className="card divide-y divide-slate-100 dark:divide-slate-800/60">
        {feds.map((f) => (
          <div key={f.code} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0" style={{ paddingLeft: `${['world', 'continental', 'national', 'regional'].indexOf(f.level) * 12}px` }}>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{f.short_name} · {f.name}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {LEVEL_LABEL[f.level]}{f.country ? ` · ${f.country}` : ''}{f.region ? ` · ${f.region}` : ''} · /{f.slug} · orden {f.display_order} · {Number(f.competition_count)} comp.
              </p>
            </div>
            <button
              onClick={() => { setIsNew(false); setFormError(null); setDraft(fromRow(f)); }}
              className="text-xs font-semibold text-slate-500 hover:text-rink-passion px-2 min-h-[44px]"
            >
              Editar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

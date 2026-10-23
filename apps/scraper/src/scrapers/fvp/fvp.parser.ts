/**
 * Parser puro de la API de DigitalSport (Federación Vasca): árbol de fases
 * (`/hierarchy/division/{id}/tree`) y clasificación
 * (`/hierarchy/fase/{id}/clasificacion`) a filas planas.
 *
 * Validación explícita: la API es JSON pero de un tercero. Si cambia la forma
 * (falta `jornadas`, un partido sin `participants`…) se lanza un error con el
 * dato que faltaba en vez de devolver vacío, para que el loader no borre nada.
 */

export interface FvpRow {
  matchId: string;
  faseId: string;
  faseNombre: string;
  faseFormato: string;
  jornadaNombre: string;
  jornadaOrden: number;
  /** YYYY-MM-DD (fecha local) o null. */
  date: string | null;
  /** HH:MM local o null (la mayoría de partidos de base no la publican). */
  time: string | null;
  estado: string;
  homeName: string | null;
  awayName: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
  homeLogo: string | null;
  awayLogo: string | null;
  homeClubId: string | null;
  awayClubId: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  venue: string | null;
  referees: string | null;
}

export interface FvpStandingRow {
  position: number;
  name: string;
  abbr: string | null;
  clubId: string | null;
  logoUrl: string | null;
  played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number; points: number;
  form: string[];
}

type Json = Record<string, unknown>;

function req<T>(o: Json, k: string, what: string): T {
  if (!(k in o) || o[k] === undefined) throw new Error(`FVP: falta "${k}" en ${what}`);
  return o[k] as T;
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `{"goles": 3, "penaltis": 0}` (string JSON) → 3. Vacío o roto → null. */
export function golesOf(resultados: unknown): number | null {
  if (typeof resultados !== 'string' || !resultados.trim()) return null;
  try {
    const g = (JSON.parse(resultados) as { goles?: unknown }).goles;
    return typeof g === 'number' && Number.isFinite(g) ? g : null;
  } catch {
    return null;
  }
}

/** `2026-10-03T00:00:00Z` → `2026-10-03`. La API guarda la fecha local a medianoche UTC. */
export function dateOf(iso: unknown): string | null {
  const m = typeof iso === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(iso) : null;
  return m ? m[1]! : null;
}

export function timeOf(h: unknown): string | null {
  const m = typeof h === 'string' ? /^(\d{1,2}):(\d{2})/.exec(h.trim()) : null;
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
}

export function parseFvpTree(tree: unknown): FvpRow[] {
  if (!Array.isArray(tree)) throw new Error('FVP: el árbol de la división no es una lista');
  const rows: FvpRow[] = [];
  for (const f of tree as Json[]) {
    const faseId = req<string>(f, 'id', 'fase');
    const jornadas = req<Json[]>(f, 'jornadas', `fase ${faseId}`);
    for (const j of jornadas) {
      const enf = req<Json[]>(j, 'enfrentamientos', `jornada ${String(j['nombre'])}`);
      for (const e of enf) {
        const id = req<string>(e, 'id', 'partido');
        const parts = req<Json[]>(e, 'participants', `partido ${id}`);
        // Orden 0 = local, 1 = visitante. Sin dos participantes, el cruce no está decidido.
        const sorted = [...parts].sort((a, b) => (num(a['orden']) ?? 0) - (num(b['orden']) ?? 0));
        const [h, a] = sorted;
        const refs = [str(e['arbitro1Nombre']), str(e['arbitro2Nombre'])].filter(Boolean);
        rows.push({
          matchId: id,
          faseId,
          faseNombre: str(f['nombre']) ?? '',
          faseFormato: str(f['formato']) ?? 'LEAGUE',
          jornadaNombre: str(j['nombre']) ?? '',
          jornadaOrden: num(j['orden']) ?? 0,
          date: dateOf(e['fechaInicio']) ?? dateOf(j['fechaInicio']),
          time: timeOf(e['hora']),
          estado: str(e['estado']) ?? '',
          homeName: h ? str(h['atletaNombre']) : null,
          awayName: a ? str(a['atletaNombre']) : null,
          homeAbbr: h ? str(h['atletaNombreAbrev']) : null,
          awayAbbr: a ? str(a['atletaNombreAbrev']) : null,
          homeLogo: h ? str(h['clubLogoUrl']) : null,
          awayLogo: a ? str(a['clubLogoUrl']) : null,
          homeClubId: h ? str(h['clubId']) : null,
          awayClubId: a ? str(a['clubId']) : null,
          homeGoals: h ? (golesOf(h['resultados']) ?? num(h['golesActa'])) : null,
          awayGoals: a ? (golesOf(a['resultados']) ?? num(a['golesActa'])) : null,
          venue: str(e['pista']),
          referees: refs.length ? refs.join(' / ') : null,
        });
      }
    }
  }
  return rows;
}

export function parseFvpStandings(rows: unknown): FvpStandingRow[] {
  if (!Array.isArray(rows)) throw new Error('FVP: la clasificación no es una lista');
  return (rows as Json[]).map((r) => {
    let form: string[] = [];
    try {
      const extra = typeof r['datosAdicionales'] === 'string' ? JSON.parse(r['datosAdicionales']) as { form?: unknown } : {};
      if (Array.isArray(extra.form)) form = extra.form.filter((x): x is string => typeof x === 'string');
    } catch { /* forma opcional */ }
    return {
      position: req<number>(r, 'puesto', 'fila de clasificación'),
      name: req<string>(r, 'equipoNombre', 'fila de clasificación').trim(),
      abbr: str(r['equipoNombreAbrev']),
      clubId: str(r['clubId']),
      logoUrl: str(r['clubLogoUrl']),
      played: num(r['pj']) ?? 0,
      won: num(r['pg']) ?? 0,
      drawn: num(r['pe']) ?? 0,
      lost: num(r['pp']) ?? 0,
      goalsFor: num(r['gf']) ?? 0,
      goalsAgainst: num(r['gc']) ?? 0,
      points: num(r['pts']) ?? 0,
      form,
    };
  });
}

/**
 * Estado de la API → estado de Stick Live. Solo con señal explícita: un valor
 * desconocido devuelve undefined (el loader conserva el que hubiera) y el
 * llamante lo manda a Sentry.
 */
export function statusOf(estado: string): 'scheduled' | 'finished' | 'live' | 'postponed' | 'cancelled' | undefined {
  switch (estado.toUpperCase()) {
    case 'SCHEDULED': case 'PROGRAMADO': case 'PENDIENTE': return 'scheduled';
    case 'FINISHED': case 'FINALIZADO': case 'CERRADO': return 'finished';
    case 'IN_PROGRESS': case 'LIVE': case 'EN_JUEGO': case 'EN_CURSO': return 'live';
    case 'POSTPONED': case 'APLAZADO': return 'postponed';
    case 'CANCELLED': case 'CANCELADO': case 'SUSPENDIDO': return 'cancelled';
    default: return undefined;
  }
}

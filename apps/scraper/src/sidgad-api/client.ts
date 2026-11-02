/**
 * Cliente de la API de sidgad (api.sidgad.com), con el acceso que nos dio la
 * RFEP (2/11/2026). Ver docs/sidgad-api.md.
 *
 * Uso ACOTADO por decisión de producto: hasta que la RFEP confirme por escrito
 * el uso y el ritmo, solo se permiten los recursos de `ALLOWED`. Cualquier otro
 * lanza error antes de salir a la red. El directo, el acta, el calendario y la
 * clasificación siguen por las páginas de siempre.
 *
 * Ritmo: una petición cada `SIDGAD_API_GAP_MS` (2 s por defecto). Un 401/403/
 * 429 o un «INVALID TOKEN» paran la tanda (SidgadApiBlocked): no se insiste.
 * El token va en el entorno (`SIDGAD_API_TOKEN`), nunca en el repo ni en logs.
 */
export const ALLOWED = new Set(['pistas', 'profile']);

export class SidgadApiBlocked extends Error {
  constructor(message: string) { super(message); this.name = 'SidgadApiBlocked'; }
}
export class SidgadApiNotFound extends Error {
  constructor(message: string) { super(message); this.name = 'SidgadApiNotFound'; }
}

export interface SidgadApiConfig {
  token: string;
  client: string;
  base: string;
  gapMs: number;
}

export function sidgadApiConfig(env: Record<string, string | undefined> = process.env): SidgadApiConfig | null {
  const token = env['SIDGAD_API_TOKEN']?.trim();
  if (!token) return null;
  return {
    token,
    client: env['SIDGAD_API_CLIENT']?.trim() || 'rfep',
    base: (env['SIDGAD_API_BASE']?.trim() || 'https://api.sidgad.com').replace(/\/$/, ''),
    gapMs: Number(env['SIDGAD_API_GAP_MS'] ?? 2000),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

export class SidgadApi {
  private nextAt = 0;
  constructor(
    private readonly cfg: SidgadApiConfig,
    private readonly doFetch: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  /** URL sin el token (para logs). */
  describe(recurso: string, params: Record<string, string> = {}): string {
    return `${this.cfg.base}/${this.cfg.client}/v1/hp/${recurso}/?${new URLSearchParams(params)}`;
  }

  async get<T>(recurso: string, params: Record<string, string> = {}): Promise<T> {
    if (!ALLOWED.has(recurso)) throw new Error(`Recurso de la API de sidgad no permitido: ${recurso}`);
    const delay = this.nextAt - this.now();
    if (delay > 0) await this.wait(delay);
    this.nextAt = Math.max(this.now(), this.nextAt) + this.cfg.gapMs;

    const qs = new URLSearchParams({ ...params, jwt: this.cfg.token });
    const res = await this.doFetch(`${this.cfg.base}/${this.cfg.client}/v1/hp/${recurso}/?${qs}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'StickLive/1.0 (+https://sticklive.eu)' },
    });
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      throw new SidgadApiBlocked(`HTTP ${res.status} en ${this.describe(recurso, params)}`);
    }
    if (res.status === 404) throw new SidgadApiNotFound(`HTTP 404 en ${this.describe(recurso, params)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${this.describe(recurso, params)}`);
    const data = (await res.json()) as unknown;
    if (data && !Array.isArray(data) && typeof (data as { status?: unknown }).status === 'string') {
      const status = (data as { status: string }).status;
      if (/TOKEN/i.test(status)) throw new SidgadApiBlocked(`${status} en ${this.describe(recurso, params)}`);
      throw new SidgadApiNotFound(`${status} en ${this.describe(recurso, params)}`);
    }
    return data as T;
  }
}

// ── Parsers puros ─────────────────────────────────────────

export interface ApiVenue {
  id: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  capacity: number | null;
  surface: string | null;
}

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  // La fuente rellena con «xxx» lo que no sabe.
  return t && !/^x+$/i.test(t) ? t : null;
};

export function parsePistas(data: unknown): ApiVenue[] {
  const list = (data as { pistas?: unknown[] } | null)?.pistas;
  if (!Array.isArray(list)) return [];
  const out: ApiVenue[] = [];
  for (const raw of list) {
    const p = raw as Record<string, unknown>;
    const id = clean(String(p['id_pista'] ?? ''));
    const name = clean(p['denominacion']);
    if (!id || !name) continue;
    const cap = Number(p['aforo']);
    const cp = clean(p['codigo_postal']);
    out.push({
      id,
      name,
      street: clean(p['direccion_pista']),
      postalCode: cp && /^\d{4,5}$/.test(cp) ? cp.padStart(5, '0') : null,
      capacity: Number.isFinite(cap) && cap > 0 ? cap : null,
      surface: clean(p['pavimento']),
    });
  }
  return out;
}

export interface ApiPlayerProfile {
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;   // YYYY-MM-DD
  nationality: string | null;
  photoUrl: string | null;
}

export function parseProfile(data: unknown): ApiPlayerProfile | null {
  const p = (data as { player?: Record<string, unknown> } | null)?.player;
  if (!p) return null;
  const born = clean(p['date_born']);
  const m = born ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(born) : null;
  const birthDate = m && Number(m[3]) > 1900 ? `${m[3]}-${m[2]}-${m[1]}` : null;
  const image = clean(p['image']);
  return {
    firstName: clean(p['name']),
    lastName: clean(p['surname']),
    birthDate,
    nationality: clean(p['nationality']),
    photoUrl: image && /^https:\/\//.test(image) && !/no_?foto|default|silueta/i.test(image) ? image : null,
  };
}

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();

/**
 * ¿La ficha es de nuestro jugador? Guarda contra ids cruzados: al menos un
 * apellido de la ficha tiene que estar en el nuestro.
 */
export function sameSurname(ours: string, theirs: string | null): boolean {
  if (!theirs) return false;
  const a = new Set(key(ours).split(' ').filter((w) => w.length >= 3));
  return key(theirs).split(' ').some((w) => w.length >= 3 && a.has(w));
}

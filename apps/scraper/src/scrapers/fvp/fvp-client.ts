/**
 * Cliente de la API pública de DigitalSport (fvpatinaje.eus). JSON sin
 * autenticación. GET con timeout, un reintento y pausa de cortesía.
 */
import { FVP_BASE_URL } from './fvp-structure.js';
import { FVP_ENTITY_ID } from './fvp-catalog.js';

const TIMEOUT_MS = Number(process.env['FVP_TIMEOUT_MS'] ?? 20_000);
const COURTESY_MS = Number(process.env['FVP_COURTESY_MS'] ?? 300);
const UA = 'Mozilla/5.0 (compatible; StickLiveBot/1.0; +https://sticklive.eu)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;

export async function fvpGet<T = unknown>(path: string): Promise<T> {
  const url = `${FVP_BASE_URL}/api${path}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const wait = lastAt + COURTESY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(2_000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const fvpPaths = {
  competitions: () => `/public/entity/${FVP_ENTITY_ID}/competitions`,
  divisions: (competicionId: string) => `/hierarchy/competicion/${competicionId}/divisiones`,
  tree: (divisionId: string) => `/hierarchy/division/${divisionId}/tree`,
  standings: (faseId: string) => `/hierarchy/fase/${faseId}/clasificacion`,
  match: (id: string) => `/public/partidos/${id}`,
  liveScores: () => `/public/partidos/marcadores?entidadId=${FVP_ENTITY_ID}&deporteCodigo=hp`,
};

/**
 * Cliente HTTP de hp.fpp.pt. GET simple (la web es HTML renderizado en
 * servidor), con timeout, un reintento y pausa de cortesía entre peticiones.
 *
 * Ojo: la cabecera declara `charset=gb18030`, pero el contenido es UTF-8
 * ("Pré Eliminatória", "Riba d' Ave"). Se decodifica como UTF-8.
 */
import { FPP_BASE_URL } from './fpp-structure.js';

const TIMEOUT_MS = Number(process.env['FPP_TIMEOUT_MS'] ?? 20_000);
const COURTESY_MS = Number(process.env['FPP_COURTESY_MS'] ?? 400);
const UA = 'Mozilla/5.0 (compatible; StickLiveBot/1.0; +https://sticklive.eu)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;

export async function fppGet(path: string): Promise<string> {
  const url = `${FPP_BASE_URL}${path}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const wait = lastAt + COURTESY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.toString('utf8');
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(2_000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const fppCalendarPath = (fppId: string) => `/Competicao/${fppId}`;
export const fppStandingsPath = (fppId: string) => `/Classificacao/${fppId}`;

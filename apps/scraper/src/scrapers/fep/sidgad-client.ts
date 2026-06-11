/**
 * Cliente HTTP para los endpoints PHP de sidgad.es
 *
 * Algunos endpoints (rfep_ls_1.php GET) funcionan sin sesión.
 * Los endpoints POST (cal, clasif, mc) requieren las cookies de sesión
 * que sidgad establece durante la primera visita al portal FEP.
 *
 * Estrategia: warm-up automático antes del primer POST —
 * hace un GET a rfep_ls_1.php, captura Set-Cookie, y reutiliza
 * esas cookies en todos los requests posteriores.
 *
 * Base URL: https://www.server2.sidgad.es/rfep/
 */
import { createLogger } from '@sports/logger';
import { sleep } from '../../core/browser.js';

const log = createLogger({ module: 'sidgad-client' });

// ── Portal sidgad parametrizable ─────────────────────────────────
// Las federaciones autonómicas usan el mismo proveedor con otro prefijo:
//   RFEP → /rfep/rfep_*.php   (por defecto)
//   FMP  → /fmp/fmp_*.php     (SIDGAD_PORTAL=fmp + SIDGAD_REFERER=https://www.hockeypatines.fmp.es/)
// Los scrapers siguen nombrando endpoints como rfep_*; aquí se reescribe
// el prefijo en un único punto.
const PORTAL = process.env['SIDGAD_PORTAL'] ?? 'rfep';
const BASE_URL = `https://www.server2.sidgad.es/${PORTAL}`;
const REFERER = process.env['SIDGAD_REFERER'] ?? 'https://www.hockeypatines.fep.es/';

/** rfep_cal_idc_X_1.php → {portal}_cal_idc_X_1.php */
function portalPath(path: string): string {
  return PORTAL === 'rfep' ? path : path.replace(/^rfep_/, `${PORTAL}_`);
}
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Referer: REFERER,
  Origin: REFERER.replace(/\/$/, ''),
  'Accept-Language': 'es-ES,es;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
  Accept: 'text/html,*/*;q=0.8',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-site': 'cross-site',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
};

// ── Gestión de sesión ────────────────────────────────────────────
/** Cookie string acumulado desde Set-Cookie de sidgad (e.g. "PHPSESSID=abc123") */
let _sessionCookie = '';
let _sessionInitialized = false;

/**
 * Inicializa la sesión con sidgad haciendo un GET a rfep_ls_1.php.
 * Captura cualquier Set-Cookie y lo reutiliza en requests posteriores.
 * Se llama automáticamente antes del primer POST.
 */
async function ensureSession(): Promise<void> {
  if (_sessionInitialized) return;
  _sessionInitialized = true; // marcar antes de esperar, para evitar race conditions

  try {
    log.debug('Iniciando sesión sidgad via rfep_ls_1.php...');
    const res = await fetch(`${BASE_URL}/${portalPath('rfep_ls_1.php')}`, {
      method: 'GET',
      headers: DEFAULT_HEADERS,
    });

    // Recoger Set-Cookie — Node 18+ expone headers como iterable
    const cookies: string[] = [];
    res.headers.forEach((value, name) => {
      if (name.toLowerCase() === 'set-cookie') {
        // Extraer solo el par nombre=valor (sin atributos como Path, Expires, etc.)
        const cookiePair = value.split(';')[0]?.trim();
        if (cookiePair) cookies.push(cookiePair);
      }
    });

    if (cookies.length > 0) {
      _sessionCookie = cookies.join('; ');
      log.debug({ cookies: cookies.length }, 'Cookies de sesión sidgad capturadas');
    } else {
      log.debug('sidgad no envió Set-Cookie — los POSTs se harán sin cookie de sesión');
    }
  } catch (err) {
    log.warn({ err }, 'Warm-up de sesión sidgad falló — continuando sin cookies');
  }
}

export interface SidgadRequestOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

/**
 * GET a un endpoint de sidgad.
 */
export async function sidgadGet(
  path: string,
  options: SidgadRequestOptions = {}
): Promise<string> {
  return sidgadRequest('GET', path, undefined, options);
}

/**
 * POST a un endpoint de sidgad con form-encoded body.
 * Inicializa la sesión automáticamente si aún no se ha hecho.
 */
export async function sidgadPost(
  path: string,
  params: Record<string, string>,
  options: SidgadRequestOptions = {}
): Promise<string> {
  await ensureSession();
  const body = new URLSearchParams(params).toString();
  return sidgadRequest('POST', path, body || undefined, options);
}

async function sidgadRequest(
  method: 'GET' | 'POST',
  path: string,
  body: string | undefined,
  options: SidgadRequestOptions
): Promise<string> {
  const { retries = 3, retryDelayMs = 2000, timeoutMs = 30000 } = options;
  const url = path.startsWith('http') ? path : `${BASE_URL}/${portalPath(path)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const headers: Record<string, string> = { ...DEFAULT_HEADERS };

      if (_sessionCookie) {
        headers['Cookie'] = _sessionCookie;
      }

      if (method === 'POST' && body) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} en ${url}`);
      }

      // Actualizar cookies si sidgad envía nuevas
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() === 'set-cookie') {
          const pair = value.split(';')[0]?.trim();
          if (pair && !_sessionCookie.includes(pair.split('=')[0]!)) {
            _sessionCookie = _sessionCookie ? `${_sessionCookie}; ${pair}` : pair;
          }
        }
      });

      const text = await response.text();
      log.debug({ url, method, size: text.length }, 'Respuesta sidgad');
      return text;
    } catch (err) {
      const isLast = attempt === retries;
      log.warn({ url, attempt, err }, `Error en request sidgad (intento ${attempt}/${retries})`);
      if (isLast) throw err;
      await sleep(retryDelayMs * attempt);
    }
  }

  throw new Error(`sidgadRequest: no debería llegar aquí (${url})`);
}

/** Forzar re-inicialización de sesión (útil tras errores de auth) */
export function resetSession(): void {
  _sessionCookie = '';
  _sessionInitialized = false;
  log.debug('Sesión sidgad reiniciada');
}

// ── Constantes de temporadas conocidas ──────────────────────────
/** temp_39 = 2025/26 (temporada actual a mayo 2026) */
export const CURRENT_TEMP = '39';
export const SIDGAD_CLIENTE = 'rfep';
export const SIDGAD_LANG = 'es';

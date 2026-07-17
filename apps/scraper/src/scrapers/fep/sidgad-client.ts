/**
 * Cliente HTTP para los endpoints PHP de sidgad.
 *
 * SIDGAD es la plataforma compartida por varias fuentes (FEP nacional,
 * federaciones autonómicas RFEP/FMP, World Skate Europe...). Todas exponen
 * la misma familia de endpoints `{portal}_*.php`; solo cambian el prefijo de
 * portal, el dominio base y el Referer.
 *
 * Diseño (arquitectura multi-fuente):
 *   - `SidgadClient` es una CLASE INSTANCIABLE: cada fuente construye la suya
 *     con su { baseUrl, portalPrefix, referer } y mantiene su propia sesión
 *     (cookies). Así FEP y World Skate conviven en el mismo proceso sin
 *     pisarse las cookies ni depender de variables de entorno globales.
 *   - Se conservan `sidgadGet` / `sidgadPost` / `resetSession` como wrappers
 *     sobre una instancia por defecto construida desde el entorno, para no
 *     romper los scrapers FEP existentes (regresión cero).
 *
 * Sesión: algunos endpoints (rfep_ls_1.php GET) funcionan sin sesión; los POST
 * (cal, clasif, mc) requieren las cookies que sidgad establece en la primera
 * visita. Estrategia: warm-up automático (GET a {portal}_ls_1.php) antes del
 * primer POST, capturando Set-Cookie y reutilizándolo.
 */
import { createLogger } from '@sports/logger';
import { sleep } from '../../core/browser.js';

const log = createLogger({ module: 'sidgad-client' });

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface SidgadRequestOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export interface SidgadClientConfig {
  /** Base de los endpoints PHP, ej: https://www.server2.sidgad.es/rfep */
  baseUrl: string;
  /** Prefijo de portal, ej: 'rfep' | 'worldskate' | 'fmp' */
  portalPrefix: string;
  /** Referer/Origin que espera sidgad, ej: https://www.hockeypatines.fep.es/ */
  referer: string;
}

/**
 * Cliente sidgad para UNA fuente. Mantiene su propia sesión (cookies).
 */
export class SidgadClient {
  private readonly baseUrl: string;
  private readonly portalPrefix: string;
  private readonly referer: string;
  private readonly headers: Record<string, string>;

  private sessionCookie = '';
  private sessionInitialized = false;

  constructor(config: SidgadClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.portalPrefix = config.portalPrefix;
    this.referer = config.referer;
    this.headers = {
      'User-Agent': USER_AGENT,
      Referer: this.referer,
      Origin: this.referer.replace(/\/$/, ''),
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
  }

  /** rfep_cal_idc_X_1.php → {portal}_cal_idc_X_1.php */
  private portalPath(path: string): string {
    return this.portalPrefix === 'rfep' ? path : path.replace(/^rfep_/, `${this.portalPrefix}_`);
  }

  /**
   * Inicializa la sesión haciendo un GET a {portal}_ls_1.php y capturando
   * cualquier Set-Cookie. Se llama automáticamente antes del primer POST.
   */
  private async ensureSession(): Promise<void> {
    if (this.sessionInitialized) return;
    this.sessionInitialized = true; // marcar antes de esperar (evita race)

    try {
      log.debug({ portal: this.portalPrefix }, 'Iniciando sesión sidgad via ls_1.php...');
      const res = await fetch(`${this.baseUrl}/${this.portalPath('rfep_ls_1.php')}`, {
        method: 'GET',
        headers: this.headers,
      });

      const cookies: string[] = [];
      res.headers.forEach((value, name) => {
        if (name.toLowerCase() === 'set-cookie') {
          const cookiePair = value.split(';')[0]?.trim();
          if (cookiePair) cookies.push(cookiePair);
        }
      });

      if (cookies.length > 0) {
        this.sessionCookie = cookies.join('; ');
        log.debug({ cookies: cookies.length }, 'Cookies de sesión sidgad capturadas');
      } else {
        log.debug('sidgad no envió Set-Cookie — los POSTs se harán sin cookie de sesión');
      }
    } catch (err) {
      log.warn({ err }, 'Warm-up de sesión sidgad falló — continuando sin cookies');
    }
  }

  async get(path: string, options: SidgadRequestOptions = {}): Promise<string> {
    return this.request('GET', path, undefined, options);
  }

  async post(
    path: string,
    params: Record<string, string>,
    options: SidgadRequestOptions = {}
  ): Promise<string> {
    await this.ensureSession();
    const body = new URLSearchParams(params).toString();
    return this.request('POST', path, body || undefined, options);
  }

  /** Fuerza re-inicialización de sesión (útil tras errores de auth). */
  reset(): void {
    this.sessionCookie = '';
    this.sessionInitialized = false;
    log.debug({ portal: this.portalPrefix }, 'Sesión sidgad reiniciada');
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: string | undefined,
    options: SidgadRequestOptions
  ): Promise<string> {
    const { retries = 3, retryDelayMs = 2000, timeoutMs = 30000 } = options;
    const url = path.startsWith('http') ? path : `${this.baseUrl}/${this.portalPath(path)}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const headers: Record<string, string> = { ...this.headers };

        if (this.sessionCookie) {
          headers['Cookie'] = this.sessionCookie;
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
          // 404 = recurso inexistente (acta sin publicar, endpoint que no aplica).
          // Reintentar no lo arregla: fallo inmediato.
          if (response.status === 404) {
            const err = new Error(`HTTP 404 en ${url}`);
            log.debug({ url }, 'Recurso inexistente (404) — sin reintentos');
            throw Object.assign(err, { noRetry: true });
          }
          throw new Error(`HTTP ${response.status} en ${url}`);
        }

        // Actualizar cookies si sidgad envía nuevas
        response.headers.forEach((value, name) => {
          if (name.toLowerCase() === 'set-cookie') {
            const pair = value.split(';')[0]?.trim();
            if (pair && !this.sessionCookie.includes(pair.split('=')[0]!)) {
              this.sessionCookie = this.sessionCookie ? `${this.sessionCookie}; ${pair}` : pair;
            }
          }
        });

        const text = await response.text();
        log.debug({ url, method, size: text.length }, 'Respuesta sidgad');
        return text;
      } catch (err) {
        const isLast = attempt === retries || (err as { noRetry?: boolean }).noRetry === true;
        if (!(err as { noRetry?: boolean }).noRetry) {
          log.warn({ url, attempt, err }, `Error en request sidgad (intento ${attempt}/${retries})`);
        }
        if (isLast) throw err;
        await sleep(retryDelayMs * attempt);
      }
    }

    throw new Error(`SidgadClient.request: no debería llegar aquí (${url})`);
  }
}

// ── Instancia por defecto (FEP) — compatibilidad hacia atrás ────────────────
// Los scrapers FEP existentes siguen usando sidgadGet/sidgadPost sin cambios.
// La config sale del entorno con los mismos valores por defecto de siempre.
let _defaultClient: SidgadClient | null = null;

function defaultClient(): SidgadClient {
  if (_defaultClient) return _defaultClient;
  const portalPrefix = process.env['SIDGAD_PORTAL'] ?? 'rfep';
  const baseUrl =
    process.env['SIDGAD_BASE_URL'] ?? `https://www.server2.sidgad.es/${portalPrefix}`;
  const referer = process.env['SIDGAD_REFERER'] ?? 'https://www.hockeypatines.fep.es/';
  _defaultClient = new SidgadClient({ baseUrl, portalPrefix, referer });
  return _defaultClient;
}

/** GET a un endpoint sidgad (instancia por defecto FEP). */
export async function sidgadGet(
  path: string,
  options: SidgadRequestOptions = {}
): Promise<string> {
  return defaultClient().get(path, options);
}

/** POST form-encoded a un endpoint sidgad (instancia por defecto FEP). */
export async function sidgadPost(
  path: string,
  params: Record<string, string>,
  options: SidgadRequestOptions = {}
): Promise<string> {
  return defaultClient().post(path, params, options);
}

/** Reinicia la sesión de la instancia por defecto. */
export function resetSession(): void {
  defaultClient().reset();
}

// ── Constantes de temporadas conocidas ──────────────────────────
/** temp_39 = 2025/26 (temporada actual a mayo 2026) */
export const CURRENT_TEMP = '39';
export const SIDGAD_CLIENTE = 'rfep';
export const SIDGAD_LANG = 'es';

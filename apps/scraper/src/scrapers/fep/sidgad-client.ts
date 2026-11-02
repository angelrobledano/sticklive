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
 *   - La SALIDA de red no la decide este cliente: la resuelve `egress/`, que
 *     permite elegir la conexión directa, un Worker de Cloudflare o una segunda
 *     IP de Hetzner sin tocar la lógica de extracción. Ver
 *     docs/egress-sidgad.md.
 *   - Se conservan `sidgadGet` / `sidgadPost` / `resetSession` como wrappers
 *     sobre una instancia por defecto construida desde el entorno, para no
 *     romper los scrapers FEP existentes (regresión cero).
 *
 * Sesión: algunos endpoints (rfep_ls_1.php GET) funcionan sin sesión; los POST
 * (cal, clasif, mc) requieren las cookies que sidgad establece en la primera
 * visita. Estrategia: warm-up automático (GET a {portal}_ls_1.php) antes del
 * primer POST, capturando Set-Cookie y reutilizándolo. El warm-up está
 * deduplicado: dos POST concurrentes comparten la misma promesa y no lanzan dos
 * sesiones.
 *
 * Reintentos y clasificación de errores: los aplica `egress/`. Un 403 no se
 * reintenta y NUNCA cambia de ruta; un 429 respeta Retry-After; los fallos de
 * DNS/red/timeout sí pueden probar otra ruta previamente autorizada.
 */
import { createLogger } from '@sports/logger';
import { getSidgadEgress, type SidgadEgress, type EgressResponse, SidgadEgressError } from '../../egress/index.js';

const log = createLogger({ module: 'sidgad-client' });

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface SidgadRequestOptions {
  /** Total de intentos (1 = sin reintentos). Por defecto, el de la config. */
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
  /** Inyectable en tests; por defecto, el router global de salida. */
  egress?: Pick<SidgadEgress, 'request'>;
}

/**
 * Cliente sidgad para UNA fuente. Mantiene su propia sesión (cookies).
 */
export class SidgadClient {
  private readonly baseUrl: string;
  private readonly portalPrefix: string;
  private readonly referer: string;
  private readonly headers: Record<string, string>;
  private readonly egress: Pick<SidgadEgress, 'request'>;

  private sessionCookie = '';
  private sessionInitialized = false;
  private sessionPromise: Promise<void> | null = null;
  /** Dedupe de peticiones idénticas en vuelo: evita duplicados y ráfagas. */
  private readonly inFlight = new Map<string, Promise<EgressResponse>>();

  constructor(config: SidgadClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.portalPrefix = config.portalPrefix;
    this.referer = config.referer;
    this.egress = config.egress ?? getSidgadEgress();
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
   *
   * La promesa se comparte entre llamadas concurrentes: antes se marcaba
   * `sessionInitialized = true` ANTES del await, así que dos POST simultáneos
   * podían salir sin cookie y lanzar dos warm-ups.
   */
  private async ensureSession(): Promise<void> {
    if (this.sessionInitialized) return;
    if (!this.sessionPromise) {
      this.sessionPromise = this.warmUpSession().finally(() => {
        this.sessionPromise = null;
      });
    }
    return this.sessionPromise;
  }

  private async warmUpSession(): Promise<void> {
    try {
      log.debug({ portal: this.portalPrefix }, 'Iniciando sesión sidgad via ls_1.php...');
      await this.request('GET', 'rfep_ls_1.php', undefined, { retries: 1 });

      if (this.sessionCookie) {
        const names = this.sessionCookie
          .split('; ')
          .map((pair) => pair.split('=')[0])
          .filter(Boolean);
        log.debug({ cookies: names.length }, 'Cookies de sesión sidgad capturadas');
      } else {
        log.debug('sidgad no envió Set-Cookie — los POSTs se harán sin cookie de sesión');
      }
    } catch (err) {
      log.warn({ err }, 'Warm-up de sesión sidgad falló — continuando sin cookies');
    } finally {
      this.sessionInitialized = true;
    }
  }

  async get(path: string, options: SidgadRequestOptions = {}): Promise<string> {
    const response = await this.request('GET', path, undefined, options);
    return response.body;
  }

  async post(
    path: string,
    params: Record<string, string>,
    options: SidgadRequestOptions = {}
  ): Promise<string> {
    await this.ensureSession();
    const body = new URLSearchParams(params).toString();
    const response = await this.request('POST', path, body || undefined, options);
    return response.body;
  }

  /** Fuerza re-inicialización de sesión (útil tras errores de auth). */
  reset(): void {
    this.sessionCookie = '';
    this.sessionInitialized = false;
    this.sessionPromise = null;
    log.debug({ portal: this.portalPrefix }, 'Sesión sidgad reiniciada');
  }

  /**
   * Petición lógica. Deduplica peticiones idénticas en vuelo dentro de esta
   * instancia: si dos partes del scraper piden el mismo endpoint a la vez, sale
   * UNA petición y ambas reciben la misma respuesta.
   */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: string | undefined,
    options: SidgadRequestOptions
  ): Promise<EgressResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}/${this.portalPath(path)}`;
    const endpointPath = path.startsWith('http') ? null : this.portalPath(path);
    const key = `${method} ${url} ${body ?? ''}`;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = this.execute(method, url, endpointPath, body, options)
      .then((response) => {
        this.applyCookies(response.setCookie);
        return response;
      })
      .catch((error: unknown) => {
        // Una respuesta de error también puede traer Set-Cookie (p. ej. una
        // sesión nueva antes de un 403). No perdemos la oportunidad de
        // renovarla, aunque el error se propague igual.
        if (error instanceof SidgadEgressError && error.setCookie) {
          this.applyCookies(error.setCookie);
        }
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  private async execute(
    method: 'GET' | 'POST',
    url: string,
    endpointPath: string | null,
    body: string | undefined,
    options: SidgadRequestOptions
  ): Promise<EgressResponse> {
    const response = await this.egress.request({
      method,
      url,
      portal: this.portalPrefix,
      endpointPath,
      headers: this.buildHeaders(method, body),
      ...(body !== undefined ? { body } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.retries !== undefined ? { retries: options.retries } : {}),
      ...(options.retryDelayMs !== undefined ? { retryBaseMs: options.retryDelayMs } : {}),
    });

    log.debug(
      {
        url,
        method,
        route: response.route,
        status: response.status,
        size: response.body.length,
        latencyMs: response.latencyMs,
      },
      'Respuesta sidgad'
    );

    return response;
  }

  private buildHeaders(method: 'GET' | 'POST', body: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers };
    if (this.sessionCookie) headers['Cookie'] = this.sessionCookie;
    if (method === 'POST' && body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    return headers;
  }

  /**
   * Actualiza la cookie de sesión por NOMBRE: si sidgad renueva PHPSESSID, el
   * valor viejo no se queda pegado. Nunca se loguean valores de cookies.
   */
  private applyCookies(setCookie: string[]): void {
    if (setCookie.length === 0) return;

    const byName = new Map<string, string>();
    for (const existing of this.sessionCookie.split('; ')) {
      if (!existing) continue;
      const eq = existing.indexOf('=');
      if (eq <= 0) continue;
      byName.set(existing.slice(0, eq), existing);
    }

    for (const raw of setCookie) {
      const pair = raw.split(';')[0]?.trim();
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      byName.set(pair.slice(0, eq), pair);
    }

    this.sessionCookie = [...byName.values()].join('; ');
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

/** Solo para tests: olvida la instancia por defecto. */
export function resetDefaultSidgadClientForTests(): void {
  _defaultClient = null;
}

// ── Constantes de temporadas conocidas ──────────────────────────
/** temp_39 = 2025/26 (temporada actual a mayo 2026) */
export const CURRENT_TEMP = '39';
export const SIDGAD_CLIENTE = 'rfep';
export const SIDGAD_LANG = 'es';

import { Hono } from 'hono';

/**
 * `GET /ads/config` — config remota de los formatos de anuncios de la app
 * móvil (Plan D). Sin BD: los valores vienen de env con defaults
 * conservadores. Es un endpoint PÚBLICO (la app lo consulta con o sin
 * sesión, antes de saber quién es el usuario).
 *
 * Fail-safe por diseño: TODO nace `enabled: false` y la activación es
 * explícita (env en `/opt/sticklive/.env.prod` + redeploy del API — la app
 * lee la config en runtime, sin rebuild). Un valor de env basura nunca se
 * interpreta: cae al default ("los malos datos son peores que no tener
 * datos"). Así, activar por error un formato con un typo NO ocurre: el typo
 * simplemente no activa nada.
 *
 * Formas de consumo (móvil): DTO espejo en
 * apps/mobile/src/lib/api/types.ts (`AdsConfig`); cualquier cambio de shape
 * aquí exige actualizar ese DTO (verificado por lectura de código).
 */

/** Habilitado sólo con '1' o 'true' EXACTOS: 'yes'/'on'/'TRUE' → false. */
function parseBool(raw: string | undefined): boolean {
  return raw === '1' || raw === 'true';
}

/** Entero positivo estricto; cualquier otra cosa (0, negativo, texto) → null. */
function parsePositiveIntOrNull(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return n > 0 ? n : null;
}

/** Entero positivo o fallback (nunca inventar: basura → default). */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  return parsePositiveIntOrNull(raw) ?? fallback;
}

export interface AdsConfig {
  appOpen: { enabled: boolean; minIntervalHours: number };
  interstitial: { enabled: boolean; minIntervalMinutes: number; maxPerHour: number };
  rewarded: { enabled: boolean; adfreeMinutes: number };
  nativeFeed: { enabled: boolean; everyNItems: number };
}

/** Pura e importable: el test y el handler la comparten. */
export function buildAdsConfig(env: Record<string, string | undefined>): AdsConfig {
  // nativeFeed: definir un EVERY válido ES su activación explícita ("su env");
  // ADS_NATIVE_FEED_ENABLED sirve además de interruptor convencional. Un EVERY
  // basura NO activa (fail-safe) y cae al default.
  const everyNItems = parsePositiveIntOrNull(env['ADS_NATIVE_FEED_EVERY']);
  return {
    appOpen: {
      enabled: parseBool(env['ADS_APP_OPEN_ENABLED']),
      minIntervalHours: parsePositiveInt(env['ADS_APP_OPEN_MIN_INTERVAL_HOURS'], 4),
    },
    interstitial: {
      enabled: parseBool(env['ADS_INTERSTITIAL_ENABLED']),
      minIntervalMinutes: parsePositiveInt(env['ADS_INTERSTITIAL_MIN_INTERVAL_MINUTES'], 20),
      maxPerHour: parsePositiveInt(env['ADS_INTERSTITIAL_MAX_PER_HOUR'], 2),
    },
    rewarded: {
      enabled: parseBool(env['ADS_REWARDED_ENABLED']),
      adfreeMinutes: parsePositiveInt(env['ADS_REWARDED_ADFREE_MINUTES'], 30),
    },
    nativeFeed: {
      enabled: parseBool(env['ADS_NATIVE_FEED_ENABLED']) || everyNItems !== null,
      everyNItems: everyNItems ?? 8,
    },
  };
}

/**
 * El presupuesto de pantalla completa (app open + interstitial) es UNO
 * compartido en la app (máx 2/hora, mínimo 20 min): los caps de ambos
 * formatos se publican aquí para que la app no los invente.
 */
export const adsConfigRouter = new Hono();

adsConfigRouter.get('/', (c) => {
  // Cabecera propia (read-cache no casa /ads/config): config estable entre
  // deploys, cacheable 5 min por navegador/CDN; cambios de activación tardan
  // ≤5 min en propagarse tras el redeploy.
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(buildAdsConfig(process.env));
});

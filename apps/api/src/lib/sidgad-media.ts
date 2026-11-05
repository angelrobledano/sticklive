/**
 * Ocultar escudos y fotos alojados en SIDGAD (`SIDGAD_MEDIA_HIDDEN=1`).
 *
 * Mientras no haya permiso de SIDGAD, ninguna imagen suya llega al cliente:
 * las URLs de sus hosts salen como null en el JSON de la API y los proxys de
 * escudo y foto responden 404, así web y app pintan su genérico. Las imágenes
 * de otras fuentes (FPP, FVP) no se tocan.
 */
const SIDGAD_HOST_RE = /(^|\.)sidgad\.(cloud|es|com)$|(^|\.)hockeypatines\.fep\.es$/i;

const IMAGE_KEYS = new Set(['logoUrl', 'logo_url', 'photoUrl', 'photo_url', 'crestUrl', 'crest_url']);

export function isSidgadMediaHidden(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env['SIDGAD_MEDIA_HIDDEN']?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function isSidgadUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return SIDGAD_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Copia del valor con las URLs de imagen de SIDGAD a null. Devuelve si cambió algo. */
export function stripSidgadImages(value: unknown): { value: unknown; changed: boolean } {
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (IMAGE_KEYS.has(k) && typeof child === 'string' && isSidgadUrl(child)) {
          out[k] = null;
          changed = true;
        } else {
          out[k] = walk(child);
        }
      }
      return out;
    }
    return v;
  };
  const result = walk(value);
  return { value: result, changed };
}

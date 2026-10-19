import { NextRequest, NextResponse } from 'next/server';
import { lowercaseUuidPath } from '@/lib/uuid-path';
import { FALLBACK_LOCALE } from '@/lib/locales';

/**
 * Middleware de localización.
 *
 * Toda ruta vive bajo /{locale}/... (es, en, pt, fr, it). Cualquier petición
 * sin prefijo se redirige al idioma del usuario:
 *   1. Cookie sticklive_locale (elección manual previa)
 *   2. Cabecera Accept-Language
 *   3. Fallback: es (mercado principal; Googlebot no envía Accept-Language)
 *
 * Redirección 307 (temporal): la URL sin prefijo no es canónica de ningún
 * idioma concreto, depende del visitante. Las URLs canónicas e indexables
 * son siempre las prefijadas (con hreflang declarado vía metadata).
 *
 * URL CON prefijo de otro idioma (enlace compartido, resultado de búsqueda):
 * se abre en el idioma de la persona (cookie o, si no eligió, el del
 * dispositivo), sin avisos. Nunca para bots ni previsualizadores de enlaces
 * (cada URL prefijada es la canónica de su idioma) ni para las peticiones
 * internas de navegación (RSC/prefetch). Si el dispositivo no está en un
 * idioma soportado, se respeta la URL.
 */

const LOCALES = ['es', 'en', 'pt', 'fr', 'it'] as const;
type Locale = (typeof LOCALES)[number];
const FALLBACK: Locale = FALLBACK_LOCALE;
const COOKIE = 'sticklive_locale';

function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

/** Idioma de la persona: elección manual (cookie) o el del dispositivo; null si ninguno es soportado. */
function preferredLocale(req: NextRequest): Locale | null {
  const cookie = req.cookies.get(COOKIE)?.value;
  if (isLocale(cookie)) return cookie;

  const accept = req.headers.get('accept-language') ?? '';
  for (const part of accept.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return null;
}

function detectLocale(req: NextRequest): Locale {
  return preferredLocale(req) ?? FALLBACK;
}

/** Rastreadores y previsualizadores de enlaces: ven la URL tal cual. */
const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|whatsapp|telegram|lighthouse|google-|-google|yandex|baidu|embedly|quora|ia_archiver/i;

/** ¿Es una carga de página de una persona (no bot, no RSC/prefetch)? */
function isHumanDocumentRequest(req: NextRequest): boolean {
  if (req.method !== 'GET') return false;
  if (req.headers.has('rsc') || req.headers.has('next-router-prefetch') || req.headers.get('purpose') === 'prefetch') return false;
  return !BOT_UA.test(req.headers.get('user-agent') ?? '');
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // F2-4: un UUID en mayúsculas es un duplicado auto-canónico. 301 a la ruta
  // en minúsculas; si además falta el idioma, se añade en el mismo salto.
  const normalized = lowercaseUuidPath(pathname);
  if (normalized !== pathname) {
    const url = req.nextUrl.clone();
    const normalizedFirst = normalized.split('/')[1];
    url.pathname = isLocale(normalizedFirst)
      ? normalized
      : `/${detectLocale(req)}${normalized === '/' ? '' : normalized}`;
    return NextResponse.redirect(url, 301);
  }

  const first = pathname.split('/')[1];

  if (isLocale(first)) {
    // Prefijo de otro idioma: se abre en el de la persona.
    const wanted = isHumanDocumentRequest(req) ? preferredLocale(req) : null;
    if (wanted && wanted !== first) {
      const url = req.nextUrl.clone();
      url.pathname = `/${wanted}${pathname.slice(first.length + 1)}`;
      const res = NextResponse.redirect(url, 307);
      // Depende del visitante: que ninguna caché la comparta.
      res.headers.set('Cache-Control', 'private, no-store');
      return res;
    }
    return NextResponse.next();
  }

  const locale = detectLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url, 307);
}

export const config = {
  // Excluir assets, ficheros estáticos y rutas internas de Next.
  // `monitoring` = tunnelRoute de Sentry (anti-adblock): no debe pasar por el
  // middleware de i18n o se redirigiría y se perderían los eventos.
  matcher: ['/((?!_next|api|monitoring|favicon.ico|icon.svg|.*\\..*).*)'],
};

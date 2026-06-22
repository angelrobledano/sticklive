import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware de localización.
 *
 * Toda ruta vive bajo /{locale}/... (es, en, pt, fr, it). Cualquier petición
 * sin prefijo se redirige al idioma del usuario:
 *   1. Cookie sticklive_locale (elección manual previa)
 *   2. Cabecera Accept-Language
 *   3. Fallback: en
 *
 * Redirección 307 (temporal): la URL sin prefijo no es canónica de ningún
 * idioma concreto, depende del visitante. Las URLs canónicas e indexables
 * son siempre las prefijadas (con hreflang declarado vía metadata).
 */

const LOCALES = ['es', 'en', 'pt', 'fr', 'it'] as const;
type Locale = (typeof LOCALES)[number];
const FALLBACK: Locale = 'en';
const COOKIE = 'sticklive_locale';

function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

function detectLocale(req: NextRequest): Locale {
  const cookie = req.cookies.get(COOKIE)?.value;
  if (isLocale(cookie)) return cookie;

  const accept = req.headers.get('accept-language') ?? '';
  for (const part of accept.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return FALLBACK;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split('/')[1];

  // Ya viene con prefijo de idioma válido → seguir
  if (isLocale(first)) return NextResponse.next();

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

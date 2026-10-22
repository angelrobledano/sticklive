import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { BRAND } from '@sports/brand';
import {
  FALLBACK_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
  type Locale,
} from '@/lib/locales';

/**
 * Web App Manifest — hace la app instalable (PWA) y es la base del
 * empaquetado Android/iOS con Capacitor.
 *
 * Es dinámico para fijar `lang` y traducir los atajos según el idioma del
 * visitante (cookie `sticklive_locale` > Accept-Language), igual que el
 * middleware (#363).
 */
const SHORTCUT_NAMES: Record<Locale, { favorites: string; competitions: string }> = {
  es: { favorites: 'Favoritos', competitions: 'Competiciones' },
  ca: { favorites: 'Favorits', competitions: 'Competicions' },
  en: { favorites: 'Favourites', competitions: 'Competitions' },
  pt: { favorites: 'Favoritos', competitions: 'Competições' },
  fr: { favorites: 'Favoris', competitions: 'Compétitions' },
  it: { favorites: 'Preferiti', competitions: 'Competizioni' },
};

function detectLocale(cookieHeader: string | null, accept: string | null): Locale {
  const fromCookie = cookieHeader
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  if (isSupportedLocale(fromCookie)) return fromCookie;

  for (const part of (accept ?? '').split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isSupportedLocale(code)) return code;
  }
  return FALLBACK_LOCALE;
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const h = await headers();
  const locale = detectLocale(h.get('cookie'), h.get('accept-language'));
  const names = SHORTCUT_NAMES[locale];

  return {
    name: 'Stick Live — Hockey patines en directo',
    short_name: 'Stick Live',
    description: 'Resultados, estadísticas y alineaciones de hockey patines en directo.',
    id: '/',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: BRAND.noche,
    // #363: el theme_color pasa a ser el granate de marca (barra de la app
    // instalada), en lugar del fondo claro.
    theme_color: BRAND.granate,
    lang: locale,
    categories: ['sports'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: names.favorites, url: '/favorites' },
      { name: names.competitions, url: '/competitions' },
    ],
  };
}

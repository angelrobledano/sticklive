import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — hace la app instalable (PWA) y es la base del
 * empaquetado Android/iOS con Capacitor.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Stick Live — Hockey patines en directo',
    short_name: 'Stick Live',
    description: 'Resultados, estadísticas y alineaciones de hockey patines en directo.',
    id: '/',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b1220',
    theme_color: '#9f1239',
    lang: 'es',
    categories: ['sports'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

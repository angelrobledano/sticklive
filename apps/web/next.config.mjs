import { withSentryConfig } from '@sentry/nextjs';

/**
 * Política de caché de HTML por ruta (#351). Pura y testeable.
 *
 * La ficha de competición se renderiza dinámica (lee `?season=`), así que Next
 * le pone `private, no-cache, no-store`. Su HTML, en cambio, es idéntico para
 * todos los usuarios (no hay personalización por cookie en el árbol), y sus
 * datos ya se revalidan cada 120-300 s vía `lib/api/client.ts`. Un `s-maxage`
 * corto + `stale-while-revalidate` permite servirlo en edge sin volver a
 * renderizar en origen. El listado, la home y el resto de rutas conservan su
 * estrategia por defecto (ISR de fetch o no-store para datos personalizados/en
 * vivo). Los partidos en directo del cliente siguen refrescándose por polling.
 */
export const COMPETITION_DETAIL_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=300';

export function htmlCacheControlForPath(pathname) {
  return /^\/(?:es|en|pt|fr|it)\/competitions\/[^/]+$/.test(pathname)
    ? COMPETITION_DETAIL_CACHE_CONTROL
    : null;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No revelar el framework en las respuestas (#307): quita `X-Powered-By`.
  poweredByHeader: false,
  // `@sports/shared-types` exporta TS fuente (`main: ./src/index.ts`); Next debe
  // transpilarlo al importarlo desde la web (#191, STALE_LIVE_HOURS).
  transpilePackages: ['@sports/shared-types'],
  env: {
    NEXT_PUBLIC_API_URL:   process.env.NEXT_PUBLIC_API_URL   ?? 'http://localhost:3000',
    NEXT_PUBLIC_SEASON_ID: process.env.NEXT_PUBLIC_SEASON_ID ?? 'e6ab9d19-cc4b-4095-a9ce-4407a4000737',
  },
  images: {
    remotePatterns: [
      // sidgad.cloud -- CDN real de logos de clubes y competiciones FEP
      { protocol: 'https', hostname: 'sidgad.cloud', pathname: '/**' },
      // server2.sidgad.es -- servidor PHP de sidgad (fallback)
      { protocol: 'https', hostname: 'www.server2.sidgad.es', pathname: '/**' },
      // hockeypatines.fep.es -- web oficial de la FEP
      { protocol: 'https', hostname: 'www.hockeypatines.fep.es', pathname: '/**' },
      { protocol: 'https', hostname: 'hockeypatines.fep.es', pathname: '/**' },
    ],
  },
  // Cache explícita de recursos estáticos que venían con max-age=0 (#366):
  // el manifest se revalida cada hora y la imagen OG es inmutable.
  async headers() {
    return [
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' }],
      },
      {
        source: '/og-image-v2.png',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // #351: ficha de competición pública y cacheable en edge. El patrón debe
        // seguir la misma regla que `htmlCacheControlForPath`.
        source: '/:locale(es|en|pt|fr|it)/competitions/:id',
        headers: [{ key: 'Cache-Control', value: COMPETITION_DETAIL_CACHE_CONTROL }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "stick-live",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});

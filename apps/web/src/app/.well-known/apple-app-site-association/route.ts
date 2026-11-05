import { NextResponse } from 'next/server';

// Rutas reales de la web (en plural, con o sin /<locale>) que abre la app
const WEB_PATHS = ['/matches/*', '/teams/*', '/players/*', '/competitions*', '/favorites', '/search*'];
const LEGACY_PATHS = ['/match/*', '/competition/*', '/team/*'];

/**
 * Apple App Site Association (AASA) para Universal Links de iOS.
 * Permite que enlaces de sticklive.eu (partidos, equipos, jugadores,
 * competiciones, favoritos, búsqueda y login)
 * se abran directamente en la app nativa de Stick Live en iPhone.
 */
export function GET() {
  const teamId = process.env.APPLE_TEAM_ID || 'TEAMID';
  const bundleId = 'eu.sticklive.app';
  const appId = `${teamId}.${bundleId}`;

  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appID: appId,
          paths: ['NOT /admin*', 'NOT /*/admin*', '/login*', ...WEB_PATHS, ...WEB_PATHS.map((p) => `/*${p}`), ...LEGACY_PATHS],
          // La primera regla que encaja gana: admin se excluye antes de todo
          components: [
            { '/': '/*/admin*', exclude: true, comment: 'Admin con locale, nunca en la app' },
            { '/': '/admin*', exclude: true, comment: 'Admin, nunca en la app' },
            {
              '/': '/login*',
              '?': { token: '?*' },
              comment: 'Magic link login token',
            },
            ...WEB_PATHS.flatMap((p) => [
              { '/': p, comment: 'Ruta web sin locale' },
              { '/': `/*${p}`, comment: 'Ruta web con locale' },
            ]),
            ...LEGACY_PATHS.map((p) => ({ '/': p, comment: 'Ruta heredada en singular' })),
          ],
        },
      ],
    },
    webcredentials: {
      apps: [appId],
    },
  };

  return NextResponse.json(aasa, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

import { NextResponse } from 'next/server';

/**
 * Apple App Site Association (AASA) para Universal Links de iOS.
 * Permite que enlaces de sticklive.eu (/login, /match, /competition, /team)
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
          paths: ['/login*', '/match/*', '/competition/*', '/team/*'],
          components: [
            {
              '/': '/login*',
              '?': { token: '?*' },
              comment: 'Magic link login token',
            },
            {
              '/': '/match/*',
              comment: 'Match details',
            },
            {
              '/': '/competition/*',
              comment: 'Competition overview',
            },
            {
              '/': '/team/*',
              comment: 'Team details',
            },
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

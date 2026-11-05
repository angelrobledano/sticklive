import { describe, expect, it } from 'vitest';
import { webPathToAppPath } from './deep-links';

const UUID = '3F2A9C1E-0B4D-4E8A-9C11-5D6E7F8A9B0C';

describe('webPathToAppPath', () => {
  it.each([
    // Raíz y locale
    ['/', '/'],
    ['', '/'],
    ['/es', '/'],
    ['/ca/', '/'],
    // Partidos, equipos, jugadores (plural web y singular heredado)
    ['/es/matches/abc', '/match/abc'],
    ['/matches/abc', '/match/abc'],
    ['/match/abc', '/match/abc'],
    ['/en/match/abc', '/match/abc'],
    ['/pt/teams/t1', '/team/t1'],
    ['/team/t1', '/team/t1'],
    ['/fr/players/p1', '/player/p1'],
    ['/player/p1', '/player/p1'],
    // UUID en mayúsculas se conserva tal cual
    [`/es/matches/${UUID}`, `/match/${UUID}`],
    // Barra final
    ['/es/matches/abc/', '/match/abc'],
    // Competiciones
    ['/es/competitions/ok-liga', '/competition/ok-liga'],
    ['/competition/ok-liga', '/competition/ok-liga'],
    ['/it/competitions/ok-liga?season=s1', '/competition/ok-liga?season=s1'],
    ['/es/competitions/ok-liga?season=s1&utm_source=wa', '/competition/ok-liga?season=s1'],
    ['/es/competitions', '/competitions'],
    ['/es/competitions/country/es', '/competitions'],
    ['/es/competitions/federation/rfep', '/competitions'],
    // Pestañas y ajustes
    ['/es/favorites', '/favorites'],
    ['/es/search', '/search'],
    ['/es/search?q=liceo', '/search?q=liceo'],
    ['/es/search?q=reus%20deportiu&x=1', '/search?q=reus+deportiu'],
    ['/es/settings', '/settings'],
    ['/es/settings/notifications', '/settings/notifications'],
    ['/es/settings/notifications/match', '/settings/notifications'],
    // Login conserva su query (magic link)
    ['/login?token=abc', '/login?token=abc'],
    ['/es/login?token=abc&next=x', '/login?token=abc&next=x'],
    // Pantallas aún inexistentes y desconocidas
    ['/es/clubs/c1', '/'],
    ['/es/seasons/s1', '/'],
    ['/es/admin/users', '/'],
    ['/es/legal/privacy', '/'],
    ['/es/premium/checkout', '/'],
    ['/es/matches', '/'],
    // URL absoluta y esquema propio
    ['https://sticklive.eu/es/matches/abc', '/match/abc'],
    ['https://www.sticklive.eu/es/teams/t1?ref=x', '/team/t1'],
    ['sticklive://match/abc', '/match/abc'],
    ['sticklive:///es/players/p1', '/player/p1'],
    // Rutas de la app pasan sin cambios
    ['/(tabs)/favorites', '/favorites'],
    ['/competitions', '/competitions'],
    ['/settings/premium', '/settings/premium'],
    ['/settings/ads-privacy', '/settings/ads-privacy'],
    ['/auth/callback?code=1', '/auth/callback?code=1'],
  ])('%s → %s', (input, expected) => {
    expect(webPathToAppPath(input)).toBe(expected);
  });
});

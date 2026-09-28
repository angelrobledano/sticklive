import { describe, it, expect } from 'vitest';
import { reconcileFavorites, type FavoritesSnapshot } from './useFavorites';

/**
 * #268: el des-seguir no se propagaba entre dispositivos. La reconciliación era
 * una unión aditiva con tombstones locales: el dispositivo B, que aún tenía el
 * favorito en su lista local, lo reinsertaba en la nube ("resucitaba").
 *
 * Decisión: en la PRIMERA sincronización (onboarding / primer login) se sube lo
 * local y se hace unión con la nube; a partir de ahí la NUBE es la fuente de
 * verdad y no se reinserta lo ausente, salvo los tombstones locales (bajas que
 * reintentamos borrar). Es PURA y por eso se puede fijar con tests.
 */

const snap = (teams: string[], leagues: string[] = [], players: string[] = []): FavoritesSnapshot =>
  ({ teams, leagues, players });

describe('reconcileFavorites — multi-dispositivo (#268)', () => {
  it('primer login: une local y nube', () => {
    const out = reconcileFavorites(
      snap(['A', 'B']),
      snap(['B', 'C']),
      snap([]),
      { firstLogin: true },
    );
    expect(out.next.teams).toEqual(['A', 'B', 'C']);
  });

  it('primer login respeta los tombstones locales (no resucitan)', () => {
    const out = reconcileFavorites(
      snap(['B']),
      snap(['A', 'B']),
      snap(['A']),
      { firstLogin: true },
    );
    expect(out.next.teams).toEqual(['B']);
    expect(out.removals.teams).toEqual(['A']); // se reintenta el DELETE en la nube
  });

  it('sincronización posterior: la nube manda y lo local ausente en la nube NO se reinserta', () => {
    // Dispositivo B conserva "A" en local, pero A ya lo dejó de seguir en otro
    // dispositivo (la nube no lo tiene): debe desaparecer, sin resucitar.
    const out = reconcileFavorites(
      snap(['A', 'B', 'C']),
      snap(['B', 'C']),
      snap([]),
      { firstLogin: false },
    );
    expect(out.next.teams).toEqual(['B', 'C']);
  });

  it('sincronización posterior aplica tombstones locales y reintenta el borrado', () => {
    const out = reconcileFavorites(
      snap(['B']),
      snap(['A', 'B']),
      snap(['A']),
      { firstLogin: false },
    );
    expect(out.next.teams).toEqual(['B']);
    expect(out.removals.teams).toEqual(['A']);
  });

  it('no reinserta altas locales hechas sin conexión en sincronizaciones posteriores (nube = verdad)', () => {
    // Contrapartida documentada: una alta offline que nunca se subió se pierde
    // en la reconciliación posterior. Es el precio de que la nube sea la verdad.
    const out = reconcileFavorites(
      snap(['A', 'offlineNew']),
      snap(['A']),
      snap([]),
      { firstLogin: false },
    );
    expect(out.next.teams).toEqual(['A']);
  });

  it('trata las tres colecciones (equipos, ligas, jugadores) por igual', () => {
    const out = reconcileFavorites(
      snap(['t1'], ['l1'], ['p1']),
      snap([], ['l1'], ['p1', 'p2']),
      snap(['t1']),
      { firstLogin: false },
    );
    expect(out.next).toEqual(snap([], ['l1'], ['p1', 'p2']));
    expect(out.removals).toEqual(snap([], [], []));
  });

  it('deduplica y conserva el orden de la unión', () => {
    const out = reconcileFavorites(
      snap(['A', 'A', 'B']),
      snap(['B', 'C']),
      snap([]),
      { firstLogin: true },
    );
    expect(out.next.teams).toEqual(['A', 'B', 'C']);
  });
});

import { describe, it, expect, vi } from 'vitest';

// El módulo del scraper llama a requireFepSourceId() al importarse.
vi.hoisted(() => {
  process.env['FEP_SOURCE_ID'] = '00000000-0000-0000-0000-000000000000';
});

import { inferStatus } from './fep-matches.scraper.js';

/**
 * Estado del feed de directo (rfep_mc_1.php): solo señales EXPLÍCITAS de la
 * fuente. Lo que no se puede leer no cambia el estado (undefined).
 */
describe('inferStatus (feed de directo FEP)', () => {
  it('la clase del bloque manda', () => {
    expect(inferStatus(['scorer_game', 'scorer_game_final'], '')).toBe('finished');
    expect(inferStatus(['scorer_game', 'scorer_game_pending'], '')).toBe('scheduled');
    expect(inferStatus(['scorer_game', 'scorer_game_playing'], '')).toBe('live');
  });

  it('sin clase, el texto del botón central: final, pendiente o periodo en juego', () => {
    expect(inferStatus(['scorer_game'], 'FINAL')).toBe('finished');
    expect(inferStatus(['scorer_game'], 'Finalizado')).toBe('finished');
    expect(inferStatus(['scorer_game'], 'PENDIENTE')).toBe('scheduled');
    expect(inferStatus(['scorer_game'], '2 PARTE')).toBe('live');
    expect(inferStatus(['scorer_game'], 'DESCANSO')).toBe('live');
    expect(inferStatus(['scorer_game'], 'PRÓRROGA')).toBe('live');
  });

  it('sin señal (ni clase ni texto reconocible) → undefined: no se inventa directo ni se "desprograma"', () => {
    // Antes: texto vacío ⇒ 'scheduled' (podía devolver a programado un partido en
    // juego) y marcador con dígitos ⇒ 'live' (podía reabrir uno terminado).
    expect(inferStatus(['scorer_game'], '')).toBeUndefined();
    expect(inferStatus(['scorer_game'], '19:30')).toBeUndefined();
  });
});

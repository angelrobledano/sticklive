import { describe, it, expect } from 'vitest';
import { buildMatchErrorMessage } from './match-error-message.js';

/**
 * #332 — el loader de partidos guardaba "N partidos fallaron" en
 * scrape_logs.error_message, perdiendo el detalle (qué partido y por qué) que
 * solo vivía en stdout. Estos tests fijan que el mensaje identifica el primer
 * fallo por su source_ref y cuenta el resto.
 */
describe('buildMatchErrorMessage', () => {
  it('sin fallos no genera mensaje', () => {
    expect(buildMatchErrorMessage([])).toBeUndefined();
  });

  it('con un fallo guarda el source_ref y el motivo', () => {
    const msg = buildMatchErrorMessage([
      { item: 'CLUB_A vs CLUB_B', sourceRef: 'fep_match_12345', error: 'No se encontró equipo' },
    ]);
    expect(msg).toBe('fep_match_12345: No se encontró equipo');
  });

  it('con varios fallos conserva el detalle del primero y cuenta el resto', () => {
    const msg = buildMatchErrorMessage([
      { item: 'A vs B', sourceRef: 'fep_match_1', error: 'timeout' },
      { item: 'C vs D', sourceRef: 'fep_match_2', error: 'uuid inválido' },
      { item: 'E vs F', sourceRef: 'fep_match_3', error: 'otra cosa' },
    ]);
    expect(msg).toBe('fep_match_1: timeout (+2 partidos más)');
  });

  it('si falta source_ref usa el item (equipos + fecha) como identificador', () => {
    const msg = buildMatchErrorMessage([
      { item: 'CLUB_A vs CLUB_B (2026-09-28)', error: 'transform falló' },
    ]);
    expect(msg).toBe('CLUB_A vs CLUB_B (2026-09-28): transform falló');
  });
});

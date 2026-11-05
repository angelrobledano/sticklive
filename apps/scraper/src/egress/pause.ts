/**
 * Pausa manual de TODA la salida a SIDGAD (`SIDGAD_PAUSED=1`).
 *
 * Interruptor de emergencia para cuando SIDGAD bloquea nuestras peticiones:
 * mientras esté activo no sale ni una petición a sidgad (RFEP, autonómicas,
 * FISR, World Skate). FPP y FVP no son SIDGAD y siguen funcionando.
 */
export function isSidgadPaused(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env['SIDGAD_PAUSED']?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

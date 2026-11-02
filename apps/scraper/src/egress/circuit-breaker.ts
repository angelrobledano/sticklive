/**
 * Circuit breaker por ruta + portal.
 *
 * Se abre tras N peticiones fallidas consecutivas de la MISMA ruta y portal.
 * Mientras está abierto se falla rápido (sin tocar la red) y, pasado el
 * enfriamiento, deja pasar UNA petición de prueba (half-open). Si esa prueba
 * funciona, vuelve a cerrado; si falla, se reabre.
 *
 * Es por proceso, como el resto de trackers del ETL: si el proceso reinicia,
 * el peor caso es una petición de más, nunca una tormenta de reintentos.
 */
import type { CircuitSnapshot } from './types.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now
  ) {
    if (threshold < 1) throw new Error('CircuitBreaker: threshold debe ser >= 1');
    if (cooldownMs < 0) throw new Error('CircuitBreaker: cooldownMs no puede ser negativo');
  }

  state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  /** ¿Se puede intentar una petición ahora? */
  allow(): boolean {
    if (this.openedAt === null) return true;

    if (this.now() - this.openedAt < this.cooldownMs) return false;

    // Half-open: una sola prueba en vuelo.
    if (this.halfOpenInFlight) return false;
    this.halfOpenInFlight = true;
    return true;
  }

  /** Registra éxito. Devuelve true si la ruta se RECUPERÓ (estaba abierta). */
  recordSuccess(): boolean {
    const wasOpen = this.openedAt !== null;
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
    return wasOpen;
  }

  /** Registra fallo. Devuelve true si el circuito ACABA de abrirse. */
  recordFailure(): boolean {
    // Fallo de la prueba half-open: reabrir con enfriamiento nuevo.
    if (this.openedAt !== null) {
      this.openedAt = this.now();
      this.halfOpenInFlight = false;
      return false;
    }

    this.failures++;
    if (this.failures >= this.threshold) {
      this.openedAt = this.now();
      return true;
    }
    return false;
  }

  snapshot(): CircuitSnapshot {
    const state = this.state();
    const cooldownRemainingMs =
      this.openedAt === null ? 0 : Math.max(0, this.cooldownMs - (this.now() - this.openedAt));
    return {
      state,
      failures: this.failures,
      openedAt: this.openedAt,
      cooldownRemainingMs,
    };
  }

  reset(): void {
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
  }
}

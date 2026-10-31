/**
 * Freno de peticiones a sidgad, por host (31/10/2026).
 *
 * sidgad bloqueó con HTTP 403 la IP del servidor en plena jornada: el directo
 * pedía el match center cada 45 s todo el día y una ficha por partido en juego,
 * con tres reintentos por fallo. Todos los portales (RFEP y autonómicas) están
 * en el mismo host, así que el freno es por host:
 *
 *   · 403/429 → nada de reintentos y pausa de 5 min, que se duplica con cada
 *     bloqueo seguido hasta 30 min. Insistir solo renueva el bloqueo.
 *   · Una respuesta buena borra la pausa.
 *   · Separación mínima entre peticiones al mismo host (sin ráfagas).
 *
 * Estado en memoria del proceso. Reloj inyectable para los tests.
 */
export const BLOCK_BASE_MS = 5 * 60_000;
export const BLOCK_MAX_MS = 30 * 60_000;
export const MIN_GAP_MS = 400;

interface HostState { strikes: number; blockedUntil: number; nextSlot: number }

export class SidgadGuard {
  private readonly hosts = new Map<string, HostState>();
  constructor(private readonly now: () => number = Date.now) {}

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) { s = { strikes: 0, blockedUntil: 0, nextSlot: 0 }; this.hosts.set(host, s); }
    return s;
  }

  /** Milisegundos de pausa que quedan (0 = se puede pedir). */
  remaining(host: string): number {
    return Math.max(0, this.state(host).blockedUntil - this.now());
  }

  /** Cuánto esperar antes de la siguiente petición al host, y reserva el hueco. */
  reserve(host: string): number {
    const s = this.state(host);
    const t = this.now();
    const at = Math.max(t, s.nextSlot);
    s.nextSlot = at + MIN_GAP_MS;
    return at - t;
  }

  /** El host respondió 403/429: pausa creciente. Devuelve la pausa aplicada. */
  blocked(host: string): number {
    const s = this.state(host);
    s.strikes += 1;
    const pause = Math.min(BLOCK_BASE_MS * 2 ** (s.strikes - 1), BLOCK_MAX_MS);
    s.blockedUntil = this.now() + pause;
    return pause;
  }

  ok(host: string): void {
    const s = this.state(host);
    s.strikes = 0;
    s.blockedUntil = 0;
  }
}

/** Instancia del proceso, compartida por todos los clientes sidgad. */
export const sidgadGuard = new SidgadGuard();

/** Error de «sidgad en pausa»: no se reintenta. */
export class SidgadBlockedError extends Error {
  readonly noRetry = true;
  constructor(readonly host: string, readonly remainingMs: number, readonly status?: number) {
    super(status
      ? `HTTP ${status} de ${host}: sidgad nos bloquea, pausa de ${Math.round(remainingMs / 60_000)} min`
      : `sidgad en pausa por bloqueo (${host}), quedan ${Math.round(remainingMs / 1000)} s`);
    this.name = 'SidgadBlockedError';
  }
}

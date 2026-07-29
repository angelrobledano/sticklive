/**
 * Escucha de notificaciones de Postgres (LISTEN/NOTIFY) sobre una conexión
 * DEDICADA, fuera del pool compartido.
 *
 * Por qué dedicada: `LISTEN` ocupa la conexión de forma permanente (espera
 * indefinida), así que no puede vivir en el pool (que tiene statement_timeout y
 * recicla conexiones). Se usa un `pg.Client` propio, sin timeouts de query, con
 * reconexión automática: si la conexión se cae, se reintenta y se re-emite el
 * LISTEN. Mientras esté caída, el consumidor debe tener su propia red de
 * seguridad (p. ej. un poll de respaldo lento).
 */
import pg from 'pg';
import { createLogger } from '@sports/logger';

const log = createLogger({ module: 'db:listen' });

/** Sólo permitimos nombres de canal simples (se interpola en LISTEN). */
const CHANNEL_RE = /^[a-z_][a-z0-9_]*$/;

export interface NotificationListener {
  /** Cierra la conexión y detiene la reconexión. */
  close(): Promise<void>;
}

/**
 * Abre un `LISTEN <channel>` dedicado y llama `onNotify(payload)` en cada aviso.
 * Reconecta con un retardo fijo si la conexión falla o se cierra.
 */
export function listenForNotifications(
  channel: string,
  onNotify: (payload: string) => void,
  opts: { reconnectMs?: number } = {},
): NotificationListener {
  if (!CHANNEL_RE.test(channel)) {
    throw new Error(`Nombre de canal LISTEN inválido: ${channel}`);
  }
  const reconnectMs = opts.reconnectMs ?? 2_000;

  let client: pg.Client | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    const stale = client;
    client = null;
    if (stale) {
      stale.removeAllListeners();
      void stale.end().catch(() => { /* ya rota */ });
    }
    reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, reconnectMs);
    reconnectTimer.unref?.();
  }

  async function connect(): Promise<void> {
    if (closed) return;
    const c = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
    client = c;
    c.on('notification', (msg) => {
      if (msg.channel === channel && msg.payload) {
        try { onNotify(msg.payload); } catch (err) { log.warn({ err, channel }, 'onNotify lanzó — se ignora'); }
      }
    });
    c.on('error', (err) => { log.warn({ err, channel }, 'listener error — reconectando'); scheduleReconnect(); });
    c.on('end', () => { if (!closed) scheduleReconnect(); });
    try {
      await c.connect();
      await c.query(`LISTEN "${channel}"`);
      log.info({ channel }, 'LISTEN activo');
    } catch (err) {
      log.warn({ err, channel }, 'no se pudo abrir el listener — reintento');
      scheduleReconnect();
    }
  }

  void connect();

  return {
    async close(): Promise<void> {
      closed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      const c = client;
      client = null;
      if (c) { c.removeAllListeners(); try { await c.end(); } catch { /* ya rota */ } }
    },
  };
}

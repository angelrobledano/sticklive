import { beforeEach, describe, expect, it, vi } from 'vitest';
import { main, reconcileSubscription, reconcileVoided } from './play-reconcile.js';

// play-reconcile importa @sports/db (db + listActiveAnnualPurchases + closeDb del
// entry standalone), @sports/logger (createLogger), @sentry/node y el cliente de
// Play (`../../api/src/lib/play.js`, mismo patrón cross-app que push-dispatcher).
// Los tests unitarios del ETL corren SIN base de datos ni red (CI `quality` no
// define DATABASE_URL ni credenciales de Google), así que se mockean los módulos
// completos — con handles en vi.hoisted para poder asertar las UPDATE (tablas,
// params y estado escrito) y los logs EXPLÍCITOS que exige el spec.
const dbQuery = vi.hoisted(() =>
  vi.fn(async (_sql?: string, _args?: unknown[]) => ({ rows: [] as unknown[] }))
);
const dbListActive = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const dbClose = vi.hoisted(() => vi.fn());
const logFns = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const sentryMock = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn(async () => true),
}));
const playMock = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  listVoidedPurchases: vi.fn(),
  getPlayCredentials: vi.fn(),
}));

vi.mock('./instrument.js', () => ({}));
vi.mock('@sentry/node', () => sentryMock);
vi.mock('@sports/db', () => ({
  db: { query: dbQuery },
  closeDb: dbClose,
  listActiveAnnualPurchases: dbListActive,
}));
vi.mock('@sports/logger', () => ({ createLogger: () => logFns }));
vi.mock('../../api/src/lib/play.js', () => playMock);

const CREDS_OK = {
  email: 'sa@sticklive.iam.gserviceaccount.com',
  privateKey: 'k',
} as const;

beforeEach(() => {
  dbQuery.mockReset();
  dbQuery.mockResolvedValue({ rows: [] });
  dbListActive.mockReset();
  dbListActive.mockResolvedValue([]);
  playMock.getSubscription.mockReset();
  playMock.listVoidedPurchases.mockReset();
  playMock.getPlayCredentials.mockReset();
  playMock.getPlayCredentials.mockReturnValue({ ...CREDS_OK });
  logFns.info.mockClear();
  logFns.warn.mockClear();
  logFns.error.mockClear();
});

describe('reconcileSubscription', () => {
  it('renovada: extiende premium_until (GREATEST) y deja state=active', async () => {
    const nueva = new Date('2030-06-01T00:00:00Z');
    dbQuery
      // UPDATE users ... RETURNING premium_until (la fecha ya extendida)
      .mockResolvedValueOnce({ rows: [{ premium_until: nueva }] })
      // UPDATE play_purchases a active
      .mockResolvedValueOnce({ rows: [] });
    playMock.getSubscription.mockResolvedValue({
      kind: 'subscription',
      valid: true,
      active: true,
      expiresAt: nueva,
    });

    const outcome = await reconcileSubscription('tok', 'u1');

    expect(outcome).toBe('extended');
    expect(dbQuery).toHaveBeenCalledTimes(2);
    // 1ª UPDATE: users con GREATEST (nunca acorta) y la nueva expiración.
    expect(dbQuery.mock.calls[0]![0]).toContain('UPDATE users');
    expect(dbQuery.mock.calls[0]![0]).toContain('GREATEST');
    expect(dbQuery.mock.calls[0]![1]).toEqual(['u1', nueva.toISOString()]);
    // 2ª UPDATE: play_purchases a active con la expiración de Google.
    expect(dbQuery.mock.calls[1]![0]).toContain('UPDATE play_purchases');
    expect(dbQuery.mock.calls[1]![0]).toContain("'active'");
    expect(dbQuery.mock.calls[1]![1]).toEqual(['tok', nueva.toISOString()]);
  });

  it('ya vigente en BD (expiración posterior a la de Google): unchanged', async () => {
    dbQuery.mockResolvedValueOnce({
      // premium_until ya es posterior: GREATEST lo conserva → sin cambio real.
      rows: [{ premium_until: new Date('2030-07-01T00:00:00Z') }],
    });
    playMock.getSubscription.mockResolvedValue({
      kind: 'subscription',
      valid: true,
      active: true,
      expiresAt: new Date('2030-06-01T00:00:00Z'),
    });

    const outcome = await reconcileSubscription('tok', 'u1');

    expect(outcome).toBe('unchanged');
  });

  it('expirada en Play: marca state=expired y NO toca users', async () => {
    playMock.getSubscription.mockResolvedValue({
      kind: 'subscription',
      valid: false,
      active: false,
      expiresAt: null,
    });

    const outcome = await reconcileSubscription('tok', 'u1');

    expect(outcome).toBe('expired');
    expect(dbQuery).toHaveBeenCalledTimes(1);
    expect(dbQuery.mock.calls[0]![0]).toContain('UPDATE play_purchases');
    expect(dbQuery.mock.calls[0]![0]).toContain("'expired'");
    expect(dbQuery.mock.calls[0]![0]).not.toContain('UPDATE users');
    // El spec exige log EXPLÍCITO de la expiración.
    expect(logFns.warn).toHaveBeenCalled();
  });

  it('Google caído (play_api_error): error explícito, sin tocar la BD', async () => {
    const err = new Error('play_api_error: google respondió 503');
    (err as { status?: number }).status = 503; // como PlayApiError
    playMock.getSubscription.mockRejectedValue(err);

    const outcome = await reconcileSubscription('tok', 'u1');

    expect(outcome).toBe('error');
    expect(dbQuery).not.toHaveBeenCalled();
    expect(logFns.error).toHaveBeenCalled();
  });
});

describe('reconcileVoided', () => {
  it('reembolso de lifetime: revoca la compra y quita premium_lifetime', async () => {
    playMock.listVoidedPurchases.mockResolvedValue([{ purchaseToken: 'tok-l' }]);
    dbQuery
      // UPDATE play_purchases ... RETURNING user_id, product_id
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1', product_id: 'premium_lifetime' }] })
      // UPDATE users (premium_lifetime = FALSE)
      .mockResolvedValueOnce({ rows: [] });

    const n = await reconcileVoided();

    expect(n).toBe(1);
    expect(dbQuery).toHaveBeenCalledTimes(2);
    expect(dbQuery.mock.calls[0]![0]).toContain("'revoked'");
    expect(dbQuery.mock.calls[0]![1]).toEqual(['tok-l']);
    expect(dbQuery.mock.calls[1]![0]).toContain('UPDATE users');
    expect(dbQuery.mock.calls[1]![0]).toContain('premium_lifetime = FALSE');
    expect(dbQuery.mock.calls[1]![1]).toEqual(['u1']);
    // Cada revocación queda en log EXPLÍCITO.
    expect(logFns.warn).toHaveBeenCalled();
  });

  it('reembolso de suscripción anual: solo state=revoked, users NO tocado', async () => {
    playMock.listVoidedPurchases.mockResolvedValue([{ purchaseToken: 'tok-a' }]);
    dbQuery.mockResolvedValueOnce({
      rows: [{ user_id: 'u2', product_id: 'premium_annual' }],
    });

    const n = await reconcileVoided();

    expect(n).toBe(1);
    expect(dbQuery).toHaveBeenCalledTimes(1);
    expect(dbQuery.mock.calls[0]![0]).not.toContain('UPDATE users');
  });

  it('reembolso ya revocado (RETURNING vacío): no cuenta ni toca users', async () => {
    playMock.listVoidedPurchases.mockResolvedValue([{ purchaseToken: 'tok-r' }]);
    dbQuery.mockResolvedValueOnce({ rows: [] }); // state ya era 'revoked'

    const n = await reconcileVoided();

    expect(n).toBe(0);
    expect(dbQuery).toHaveBeenCalledTimes(1);
    // Idempotencia: no repite el aviso de reembolso ya procesado.
    expect(logFns.warn).not.toHaveBeenCalled();
  });

  it('sin credenciales de Play: avisa y NO llama a Google', async () => {
    playMock.getPlayCredentials.mockReturnValue({ email: '', privateKey: '' });

    const n = await reconcileVoided();

    expect(n).toBe(0);
    expect(playMock.listVoidedPurchases).not.toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
    expect(logFns.warn).toHaveBeenCalled();
  });

  it('fallo listando voidedpurchases: log de error y devuelve lo acumulado', async () => {
    playMock.listVoidedPurchases.mockRejectedValue(new Error('play_api_error: timeout'));

    const n = await reconcileVoided();

    expect(n).toBe(0);
    expect(logFns.error).toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  });
});

describe('main', () => {
  it('resume los contadores y pone exitCode=1 si hubo errores (contrato del scheduler)', async () => {
    const expira = new Date('2030-06-01T00:00:00Z');
    dbListActive.mockResolvedValue([
      { purchase_token: 'tok-ok', user_id: 'u1', product_id: 'premium_annual', state: 'active' },
      { purchase_token: 'tok-ko', user_id: 'u2', product_id: 'premium_annual', state: 'active' },
    ]);
    playMock.getSubscription
      .mockResolvedValueOnce({ kind: 'subscription', valid: true, active: true, expiresAt: expira })
      .mockRejectedValueOnce(new Error('play_api_error: google respondió 500'));
    dbQuery
      .mockResolvedValueOnce({ rows: [{ premium_until: expira }] }) // users (tok-ok)
      .mockResolvedValueOnce({ rows: [] }); // play_purchases (tok-ok)
    playMock.listVoidedPurchases.mockResolvedValue([]);

    const prevExit = process.exitCode;
    process.exitCode = undefined;
    try {
      await main();
      expect(logFns.info).toHaveBeenLastCalledWith(
        { extended: 1, unchanged: 0, expired: 0, voided: 0, errors: 1 },
        expect.stringContaining('play-reconcile'),
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prevExit;
    }
  });
});

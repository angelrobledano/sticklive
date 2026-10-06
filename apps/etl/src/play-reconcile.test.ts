import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTransaction } from '@sports/db';
import { main, reconcileSubscription, reconcileVoided } from './play-reconcile.js';

// play-reconcile importa @sports/db (db + withTransaction + listActiveAnnualPurchases
// + closeDb del entry standalone), @sports/logger (createLogger), @sentry/node y el
// cliente de Play (`../../api/src/lib/play.js`, mismo patrón cross-app que
// push-dispatcher). Los tests unitarios del ETL corren SIN base de datos ni red (CI
// `quality` no define DATABASE_URL ni credenciales de Google), así que se mockean los
// módulos completos — con handles en vi.hoisted para poder asertar las UPDATE
// (tablas, params y estado escrito), las transacciones y los logs EXPLÍCITOS del spec.
const dbQuery = vi.hoisted(() =>
  vi.fn(async (_sql?: string, _args?: unknown[]) => ({ rows: [] as unknown[] }))
);
const txQuery = vi.hoisted(() =>
  vi.fn(async (_sql?: string, _args?: unknown[]) => ({ rows: [] as unknown[] }))
);
const dbListActive = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const dbClose = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
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
  withTransaction: withTransactionMock,
}));
vi.mock('@sports/logger', () => ({ createLogger: () => logFns }));
vi.mock('../../api/src/lib/play.js', () => playMock);

// Mismo patrón que payments-play.test.ts: withTransaction ejecuta el callback con
// un cliente cuya `query` es txQuery — así cada assert distingue la SQL de dentro
// de la transacción (users + play_purchases atómicos) de las queries sueltas.
type TxClient = Parameters<Parameters<typeof withTransaction>[0]>[0];

const CREDS_OK = {
  email: 'sa@sticklive.iam.gserviceaccount.com',
  privateKey: 'k',
} as const;

const activeSub = (expiresAt: Date) => ({
  kind: 'subscription' as const,
  valid: true,
  active: true,
  expiresAt,
});

/** 6 compras activas para el lote de main(). */
const mkPurchases = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    purchase_token: `tok${i}`,
    user_id: `u${i}`,
    product_id: 'premium_annual',
    state: 'active',
  }));

function withExitCode(fn: () => Promise<void>): Promise<void> {
  const prev = process.exitCode;
  process.exitCode = undefined;
  return fn().finally(() => {
    process.exitCode = prev;
  });
}

beforeEach(() => {
  dbQuery.mockReset();
  dbQuery.mockResolvedValue({ rows: [] });
  txQuery.mockReset();
  txQuery.mockResolvedValue({ rows: [] });
  dbListActive.mockReset();
  dbListActive.mockResolvedValue([]);
  withTransactionMock.mockReset();
  withTransactionMock.mockImplementation(async (fn: (c: TxClient) => Promise<unknown>) =>
    fn({ query: txQuery } as unknown as TxClient)
  );
  playMock.getSubscription.mockReset();
  playMock.listVoidedPurchases.mockReset();
  playMock.getPlayCredentials.mockReset();
  playMock.getPlayCredentials.mockReturnValue({ ...CREDS_OK });
  logFns.info.mockClear();
  logFns.warn.mockClear();
  logFns.error.mockClear();
  sentryMock.captureException.mockClear();
  sentryMock.captureMessage.mockClear();
});

describe('reconcileSubscription', () => {
  it('renovada: extended PRE-update y TX única con users (GREATEST) + play_purchases', async () => {
    const nueva = new Date('2030-06-01T00:00:00Z');
    dbQuery.mockResolvedValueOnce({
      // SELECT pre-update: la BD aún no llega a la expiración de Google.
      rows: [{ premium_until: new Date('2029-06-01T00:00:00Z') }],
    });
    playMock.getSubscription.mockResolvedValue(activeSub(nueva));

    const outcome = await reconcileSubscription('tokabc12345', 'u1');

    expect(outcome).toBe('extended');
    expect(dbQuery).toHaveBeenCalledTimes(1);
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(txQuery).toHaveBeenCalledTimes(2);
    // 1ª UPDATE de la TX: users con GREATEST (nunca acorta) y la nueva fecha.
    expect(txQuery.mock.calls[0]![0]).toContain('UPDATE users');
    expect(txQuery.mock.calls[0]![0]).toContain('GREATEST');
    expect(txQuery.mock.calls[0]![1]).toEqual(['u1', nueva.toISOString()]);
    // 2ª UPDATE de la TX: play_purchases a active con la expiración de Google.
    expect(txQuery.mock.calls[1]![0]).toContain('UPDATE play_purchases');
    expect(txQuery.mock.calls[1]![0]).toContain("'active'");
    expect(txQuery.mock.calls[1]![1]).toEqual(['tokabc12345', nueva.toISOString()]);
  });

  it('BD ya posterior a Google: unchanged AUNQUE la TX corra (métrica pre-update)', async () => {
    dbQuery.mockResolvedValueOnce({
      rows: [{ premium_until: new Date('2030-07-01T00:00:00Z') }],
    });
    playMock.getSubscription.mockResolvedValue(activeSub(new Date('2030-06-01T00:00:00Z')));

    const outcome = await reconcileSubscription('tokabc12345', 'u1');

    expect(outcome).toBe('unchanged');
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(txQuery).toHaveBeenCalledTimes(2); // users con GREATEST + play_purchases
  });

  it('tolerancia de 1 s: BD solo 500 ms por debajo de Google sigue siendo unchanged', async () => {
    const expira = new Date('2030-06-01T00:00:00Z');
    dbQuery.mockResolvedValueOnce({
      rows: [{ premium_until: new Date(expira.getTime() - 500) }],
    });
    playMock.getSubscription.mockResolvedValue(activeSub(expira));

    const outcome = await reconcileSubscription('tokabc12345', 'u1');

    expect(outcome).toBe('unchanged');
  });

  it('expirada en Play: marca state=expired y NO toca users', async () => {
    playMock.getSubscription.mockResolvedValue({
      kind: 'subscription',
      valid: false,
      active: false,
      expiresAt: null,
    });

    const outcome = await reconcileSubscription('tokabc12345', 'u1');

    expect(outcome).toBe('expired');
    expect(withTransactionMock).not.toHaveBeenCalled();
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

    const outcome = await reconcileSubscription('tokabc12345', 'u1');

    expect(outcome).toBe('error');
    expect(dbQuery).not.toHaveBeenCalled();
    expect(withTransactionMock).not.toHaveBeenCalled();
    // El log lleva el token TRUNCADO (M1), nunca completo.
    expect(logFns.error).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseToken: 'tokabc12' }),
      expect.anything(),
    );
  });
});

describe('reconcileVoided', () => {
  it('reembolso de lifetime: TX única revoca la compra y quita premium_lifetime', async () => {
    playMock.listVoidedPurchases.mockResolvedValue([{ purchaseToken: 'toklife1234567' }]);
    txQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1', product_id: 'premium_lifetime' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE users (premium_lifetime = FALSE)

    const res = await reconcileVoided();

    expect(res).toEqual({ revoked: 1, failed: false });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(txQuery).toHaveBeenCalledTimes(2);
    expect(txQuery.mock.calls[0]![0]).toContain("'revoked'");
    expect(txQuery.mock.calls[0]![1]).toEqual(['toklife1234567']);
    expect(txQuery.mock.calls[1]![0]).toContain('UPDATE users');
    expect(txQuery.mock.calls[1]![0]).toContain('premium_lifetime = FALSE');
    expect(txQuery.mock.calls[1]![1]).toEqual(['u1']);
    // Cada revocación queda en log EXPLÍCITO con el token TRUNCADO (M1).
    expect(logFns.warn).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseToken: 'toklife1' }),
      expect.anything(),
    );
    // Y salta a Sentry (I4): evento de dinero, 1 corrida/día.
    expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureMessage.mock.calls[0]![1]).toMatchObject({ level: 'warning' });
  });

  it('reembolso de suscripción anual: solo state=revoked, users NO tocado', async () => {
    playMock.listVoidedPurchases.mockResolvedValue([{ purchaseToken: 'tokannual1111' }]);
    txQuery.mockResolvedValueOnce({
      rows: [{ user_id: 'u2', product_id: 'premium_annual' }],
    });

    const res = await reconcileVoided();

    expect(res).toEqual({ revoked: 1, failed: false });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(txQuery).toHaveBeenCalledTimes(1);
    expect(txQuery.mock.calls[0]![0]).not.toContain('UPDATE users');
  });

  it('reembolso ya revocado (RETURNING vacío): no cuenta, no loguea, no toca users', async () => {
    playMock.listVoidedPurchases.mockResolvedValue([{ purchaseToken: 'tokdone111111' }]);
    txQuery.mockResolvedValueOnce({ rows: [] }); // state ya era 'revoked'

    const res = await reconcileVoided();

    expect(res).toEqual({ revoked: 0, failed: false });
    expect(txQuery).toHaveBeenCalledTimes(1);
    expect(logFns.warn).not.toHaveBeenCalled();
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
  });

  it('sin credenciales de Play: avisa y NO llama a Google', async () => {
    playMock.getPlayCredentials.mockReturnValue({ email: '', privateKey: '' });

    const res = await reconcileVoided();

    expect(res).toEqual({ revoked: 0, failed: false });
    expect(playMock.listVoidedPurchases).not.toHaveBeenCalled();
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(logFns.warn).toHaveBeenCalled();
  });

  it('fallo listando voidedpurchases: log de error y failed=true', async () => {
    playMock.listVoidedPurchases.mockRejectedValue(new Error('play_api_error: timeout'));

    const res = await reconcileVoided();

    expect(res).toEqual({ revoked: 0, failed: true });
    expect(logFns.error).toHaveBeenCalled();
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('BD cae en la 2ª UPDATE de una revocación: failed=true y el lote CONTINÚA', async () => {
    playMock.listVoidedPurchases.mockResolvedValue([
      { purchaseToken: 'tokfail11111' },
      { purchaseToken: 'tokok2222222' },
    ]);
    txQuery
      // tokfail11111: 1ª UPDATE ok (lifetime revocado)…
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1', product_id: 'premium_lifetime' }] })
      // …2ª UPDATE (quitar lifetime) revienta → rollback de la TX completa.
      .mockRejectedValueOnce(new Error('db caída a mitad'))
      // tokok2222222: el siguiente token SÍ se procesa.
      .mockResolvedValueOnce({ rows: [{ user_id: 'u2', product_id: 'premium_annual' }] });

    const res = await reconcileVoided();

    // El fallo cuenta (failed) pero no aborta el lote: el 2º token se revocó.
    expect(res).toEqual({ revoked: 1, failed: true });
    expect(withTransactionMock).toHaveBeenCalledTimes(2);
    expect(logFns.error).toHaveBeenCalled();
    expect(txQuery.mock.calls[2]![1]).toEqual(['tokok2222222']);
    // Solo el reembolso exitoso llega a Sentry/log de revocación.
    expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
  });
});

describe('main', () => {
  it('resume los contadores y pone exitCode=1 + Sentry si hubo errores', async () => {
    const expira = new Date('2030-06-01T00:00:00Z');
    dbListActive.mockResolvedValue(mkPurchases(2));
    playMock.getSubscription
      .mockResolvedValueOnce(activeSub(expira)) // tok0: renovada
      .mockRejectedValueOnce(new Error('play_api_error: google respondió 500')); // tok1
    dbQuery.mockResolvedValueOnce({
      rows: [{ premium_until: new Date('2029-06-01T00:00:00Z') }], // SELECT pre-update tok0
    });
    playMock.listVoidedPurchases.mockResolvedValue([]);

    await withExitCode(async () => {
      await main();
      expect(logFns.info).toHaveBeenLastCalledWith(
        { extended: 1, unchanged: 0, expired: 0, voided: 0, errors: 1 },
        expect.stringContaining('play-reconcile'),
      );
      expect(process.exitCode).toBe(1);
      expect(sentryMock.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('error'),
        { level: 'warning' },
      );
    });
  });

  it('SA rota (401) con 0 suscriptores: failed del listado también fuerza exitCode=1', async () => {
    dbListActive.mockResolvedValue([]);
    playMock.listVoidedPurchases.mockRejectedValue(
      new Error('play_api_error: google respondió 401'),
    );

    await withExitCode(async () => {
      await main();
      expect(logFns.info).toHaveBeenLastCalledWith(
        { extended: 0, unchanged: 0, expired: 0, voided: 0, errors: 1 },
        expect.anything(),
      );
      expect(process.exitCode).toBe(1);
      expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
    });
  });

  it('circuit-breaker: 5 fallos consecutivos abortan el lote y el 6º NO se intenta', async () => {
    dbListActive.mockResolvedValue(mkPurchases(6));
    playMock.getSubscription.mockRejectedValue(new Error('play_api_error: timeout'));
    playMock.listVoidedPurchases.mockResolvedValue([]);

    await withExitCode(async () => {
      await main();
      expect(playMock.getSubscription).toHaveBeenCalledTimes(5); // no el 6º
      expect(logFns.error).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveErrors: 5, remaining: 1 }),
        expect.stringContaining('abortando el lote'),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  it('un éxito entre fallos resetea el contador del circuit-breaker', async () => {
    const expira = new Date('2030-06-01T00:00:00Z');
    dbListActive.mockResolvedValue(mkPurchases(8));
    playMock.getSubscription
      .mockRejectedValueOnce(new Error('play_api_error: timeout')) // tok0: error
      .mockResolvedValueOnce(activeSub(expira)) // tok1: ok (resetea la racha)
      .mockRejectedValue(new Error('play_api_error: timeout')); // tok2..tok6: 5 seguidos
    playMock.listVoidedPurchases.mockResolvedValue([]);

    await withExitCode(async () => {
      await main();
      // tok0 + tok1 + tok2..tok6 = 7 llamadas; tok7 queda sin intentar.
      expect(playMock.getSubscription).toHaveBeenCalledTimes(7);
      // errors = 1 (tok0) + 5 consecutivos (tok2..tok6) que disparan el break.
      expect(logFns.info).toHaveBeenLastCalledWith(
        { extended: 1, unchanged: 0, expired: 0, voided: 0, errors: 6 },
        expect.anything(),
      );
      expect(process.exitCode).toBe(1);
    });
  });
});

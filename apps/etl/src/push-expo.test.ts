import { describe, expect, it, vi } from 'vitest';
import { chunkMessages, toExpoMessage } from './push-expo.js';

// push-expo importa @sports/db (loadNativeSubs/processReceipts): los tests
// unitarios del ETL corren SIN base de datos (CI `quality` no define
// DATABASE_URL), así que se mockea el módulo completo. Lo que se testea aquí
// son los builders PUROS del canal nativo; la I/O contra Expo Push es la parte
// que se verifica con token real (pendiente humano, ver plan Task 4.3).
vi.mock('@sports/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));

describe('toExpoMessage', () => {
  it('mapea el payload web al mensaje de Expo Push con canal y collapseId', () => {
    const msg = toExpoMessage(
      { id: 'tok-1', expo_push_token: 'ExponentPushToken[abc]' } as never,
      { title: 'GOL', body: 'A 1-0 B', tag: 'match:1', url: 'https://sticklive.eu/matches/1', type: 'goal' },
    );
    expect(msg).toMatchObject({
      to: 'ExponentPushToken[abc]',
      title: 'GOL',
      body: 'A 1-0 B',
      channelId: 'live',
      sound: 'default',
      collapseId: 'match:1',
      data: { type: 'goal', urlPath: '/matches/1' },
    });
  });

  it('una URL que no es ficha de partido cae a la ruta raíz ("/")', () => {
    const msg = toExpoMessage(
      { expo_push_token: 'ExponentPushToken[abc]' },
      { title: 'Jornada', body: '', tag: 'round:1', url: 'https://sticklive.eu/', type: 'jornada_start' },
    );
    expect(msg.data).toEqual({ type: 'jornada_start', urlPath: '/' });
  });
});

describe('chunkMessages', () => {
  it('trocea a 100 (límite del API de Expo)', () => {
    const msgs = Array.from({ length: 250 }, (_, i) => ({ to: `t${i}` }));
    expect(chunkMessages(msgs).map((c) => c.length)).toEqual([100, 100, 50]);
  });
});

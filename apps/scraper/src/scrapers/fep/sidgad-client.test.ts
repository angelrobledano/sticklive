import { describe, expect, it } from 'vitest';
import { SidgadClient } from './sidgad-client.js';
import { SidgadEgressError, type EgressRequest, type EgressResponse } from '../../egress/index.js';

function ok(body: string, setCookie: string[] = []): EgressResponse {
  return {
    status: 200,
    body,
    setCookie,
    retryAfter: null,
    route: 'direct',
    latencyMs: 1,
    url: 'https://www.server2.sidgad.es/rfep/rfep_ls_1.php',
  };
}

function makeClient(handler: (request: EgressRequest) => EgressResponse | Promise<EgressResponse>) {
  const calls: EgressRequest[] = [];
  const egress = {
    request: async (request: EgressRequest): Promise<EgressResponse> => {
      calls.push(request);
      return handler(request);
    },
  };
  const client = new SidgadClient({
    baseUrl: 'https://www.server2.sidgad.es/rfep',
    portalPrefix: 'rfep',
    referer: 'https://www.hockeypatines.fep.es/',
    egress,
  });
  return { client, calls };
}

describe('SidgadClient', () => {
  it('un GET devuelve el cuerpo y pasa la URL/portal correctos', async () => {
    const { client, calls } = makeClient(() => ok('hola'));
    await expect(client.get('rfep_ls_1.php')).resolves.toBe('hola');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      portal: 'rfep',
      endpointPath: 'rfep_ls_1.php',
      url: 'https://www.server2.sidgad.es/rfep/rfep_ls_1.php',
    });
  });

  it('dos POST concurrentes comparten UN solo warm-up de sesión', async () => {
    const { client, calls } = makeClient((request) => {
      if (request.method === 'GET') return ok('', ['PHPSESSID=abc']);
      return ok('post-ok');
    });

    const [a, b] = await Promise.all([
      client.post('rfep_cal_idc_3150_1.php', { idc: '3150' }),
      client.post('rfep_clasif_idc_3150_1.php', { idc: '3150' }),
    ]);

    expect(a).toBe('post-ok');
    expect(b).toBe('post-ok');
    const warmups = calls.filter((c) => c.method === 'GET');
    expect(warmups).toHaveLength(1);

    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(post.headers['Cookie']).toBe('PHPSESSID=abc');
    }
  });

  it('deduplica peticiones idénticas en vuelo', async () => {
    let release!: (value: EgressResponse) => void;
    const pending = new Promise<EgressResponse>((resolve) => {
      release = resolve;
    });
    const { client, calls } = makeClient(() => pending);

    const first = client.get('rfep_mc_1.php');
    const second = client.get('rfep_mc_1.php');
    expect(calls).toHaveLength(1);

    release(ok('mismo-cuerpo'));
    await expect(Promise.all([first, second])).resolves.toEqual(['mismo-cuerpo', 'mismo-cuerpo']);
    expect(calls).toHaveLength(1);
  });

  it('propaga el 403 sin reintentarlo en el cliente', async () => {
    const { client, calls } = makeClient(() => {
      throw new SidgadEgressError({
        kind: 'forbidden',
        message: 'HTTP 403',
        route: 'direct',
        portal: 'rfep',
        url: 'https://www.server2.sidgad.es/rfep/x.php',
        status: 403,
        retryable: false,
        failover: false,
      });
    });

    await expect(client.get('rfep_mc_1.php')).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
    });
    expect(calls).toHaveLength(1);
  });

  it('renueva la cookie por nombre en vez de quedarse con el valor viejo', async () => {
    let cookie = 'PHPSESSID=old';
    const { client, calls } = makeClient((request) => {
      if (request.method === 'GET' && request.endpointPath === 'rfep_ls_1.php') {
        return ok('', [`PHPSESSID=${cookie}`]);
      }
      if (request.endpointPath === 'rfep_mc_1.php') {
        cookie = 'new';
        return ok('', ['PHPSESSID=new']);
      }
      return ok('post');
    });

    // Primer POST: warm-up con la cookie vieja.
    await client.post('rfep_cal_idc_3150_1.php', {});
    // El match center la renueva.
    await client.get('rfep_mc_1.php');
    // Segundo POST: ya inicializado, debe mandar la nueva.
    await client.post('rfep_cal_idc_3150_1.php', {});

    const lastPost = calls.filter((c) => c.method === 'POST').at(-1)!;
    expect(lastPost.headers['Cookie']).toBe('PHPSESSID=new');
  });

  it('reset fuerza un warm-up nuevo', async () => {
    const { client, calls } = makeClient((request) =>
      request.method === 'GET' ? ok('', ['PHPSESSID=abc']) : ok('post')
    );

    await client.post('rfep_cal_idc_3150_1.php', {});
    client.reset();
    await client.post('rfep_cal_idc_3150_1.php', {});

    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('aplica cookies de una respuesta de error para la siguiente petición', async () => {
    let first = true;
    const { client, calls } = makeClient(() => {
      if (first) {
        first = false;
        throw new SidgadEgressError({
          kind: 'server',
          message: 'HTTP 500',
          route: 'direct',
          portal: 'rfep',
          url: 'https://www.server2.sidgad.es/rfep/x.php',
          status: 500,
          retryable: false,
          setCookie: ['PHPSESSID=renewed'],
        });
      }
      return ok('ok');
    });

    await expect(client.get('rfep_mc_1.php')).rejects.toBeDefined();
    await client.get('rfep_mc_1.php');
    expect(calls[1]!.headers['Cookie']).toBe('PHPSESSID=renewed');
  });

  it('no inventa endpointPath para URLs absolutas (el Worker las rechazará)', async () => {
    const { client, calls } = makeClient(() => ok('ok'));
    await client.get('https://otro.example/x.php');
    expect(calls[0]).toMatchObject({
      url: 'https://otro.example/x.php',
      endpointPath: null,
    });
  });
});

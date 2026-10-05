const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3000';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`api ${status}: ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface Options {
  token?: string | null;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

// Sin timeout por defecto: los retries los gestiona TanStack Query; reconsiderar
// AbortSignal.any si se observa algún colgado.
export async function apiFetch<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    // La cancelación del llamador no es un fallo de red: se propaga tal cual.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network');
  }

  if (!res.ok) {
    const envelope = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, typeof envelope.error === 'string' ? envelope.error : `http_${res.status}`);
  }
  return (await res.json()) as T;
}

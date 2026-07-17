/**
 * Núcleo del API client: fetch tipado contra apps/api (Hono) + helpers de error.
 * No exportar `apiFetch` a través del barrel `client.ts`: es de uso interno de la capa.
 */

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { next?: { revalidate?: number; tags?: string[] } }
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status} - ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * True solo si la API respondió 404 de verdad (recurso inexistente).
 * Un fallo de conexión o un 500 NO es un 404: las páginas deben mostrar
 * su error boundary (con reintento) en vez de "no encontrado" — si no,
 * cada reinicio de la API convertía páginas válidas en 404s intermitentes.
 */
export function isApiNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('API 404');
}

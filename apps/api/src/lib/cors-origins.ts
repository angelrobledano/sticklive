/**
 * Orígenes CORS permitidos (#307).
 *
 * `http://localhost:3001` (la web en dev) NO debe aceptarse en producción: el
 * navegador de un usuario real nunca usa ese origen, y permitirlo amplía la
 * superficie si algún día accediera a la API desde ahí. En no-producción se
 * añade para el desarrollo local.
 */
export function corsOrigins(opts: { nodeEnv?: string; webBaseUrl?: string }): string[] {
  const base = opts.webBaseUrl ?? 'http://localhost:3001';
  const origins = [base];
  if (opts.nodeEnv !== 'production' && !origins.includes('http://localhost:3001')) {
    origins.push('http://localhost:3001');
  }
  return origins;
}

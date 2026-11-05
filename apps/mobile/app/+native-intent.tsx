import { webPathToAppPath } from '@/src/lib/deep-links';

// Enlaces de sistema (universal links, app links y esquema propio): las URLs
// de la web se traducen a rutas de la app antes de navegar
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return webPathToAppPath(path);
  } catch {
    return '/';
  }
}

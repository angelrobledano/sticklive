import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { BottomNav } from './BottomNav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

/**
 * Auditoría UX 03/11/2026 (estructural 4): Ajustes era el 2,7 % de las páginas
 * vistas en 30 días (PostHog). La barra inferior queda en cuatro destinos y
 * Ajustes se abre desde la cabecera de Favoritos (y desde el Sidebar en escritorio).
 */
describe('BottomNav', () => {
  it('cuatro destinos, sin Ajustes', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}><BottomNav /></I18nProvider>,
    );
    for (const href of ['href="/es"', 'href="/es/competitions"', 'href="/es/search"', 'href="/es/favorites"']) {
      expect(html).toContain(href);
    }
    expect(html).not.toContain('href="/es/settings"');
  });
});

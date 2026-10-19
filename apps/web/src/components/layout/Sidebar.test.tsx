import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { Sidebar } from './Sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

describe('Sidebar', () => {
  it('el logo es un enlace a la home con nombre accesible', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
        <Sidebar />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="Stick Live"');
    expect(html).toContain('href="/es"');
    expect(html).toContain('/brand/lock-on-light.svg');
    expect(html).toContain('/brand/lock-on-dark.svg');
  });
});

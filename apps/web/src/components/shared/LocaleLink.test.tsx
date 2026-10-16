import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { LocaleLink } from './LocaleLink';

/**
 * SEO-01: el enlace interno debe llevar el idioma de la URL, no depender del
 * 307 del middleware (que para Googlebot acaba siempre en `/en`).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions',
}));

function render(href: unknown, locale: 'es' | 'en' = 'es') {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale} dict={{}} referenceDict={{}}>
      <LocaleLink href={href as never}>x</LocaleLink>
    </I18nProvider>,
  );
}

describe('LocaleLink', () => {
  it('antepone el idioma activo del contexto', () => {
    expect(render('/competitions/c1')).toContain('href="/es/competitions/c1"');
    expect(render('/competitions/c1', 'en')).toContain('href="/en/competitions/c1"');
  });

  it('la raíz queda como /es (sin doble barra)', () => {
    expect(render('/')).toContain('href="/es"');
  });

  it('no duplica el idioma si la ruta ya viene localizada', () => {
    expect(render('/en/teams/t1')).toContain('href="/en/teams/t1"');
  });

  it('deja las URLs absolutas como están', () => {
    expect(render('https://sticklive.eu/es')).toContain('href="https://sticklive.eu/es"');
  });

  it('prefija también un UrlObject', () => {
    expect(render({ pathname: '/competitions/c1' })).toContain('/es/competitions/c1');
  });
});

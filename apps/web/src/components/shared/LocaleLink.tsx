'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/i18n';
import { withLocaleHref } from '@/lib/locale-links';

/**
 * `next/link` con el idioma activo delante (SEO-01 de
 * `docs/AUDITORIA_SEO_2026-10-16.md`).
 *
 * Por qué: los `href` internos se emitían sin prefijo (`/competitions/{id}`) y
 * el middleware los redirige con 307. Googlebot no manda `Accept-Language`, así
 * que **todos** los enlaces internos acababan en `/en` (el idioma con menos
 * público real para este deporte), las versiones `es/pt/fr/it` se quedaban sin
 * enlaces directos y cada clic costaba dos peticiones de rastreo.
 *
 * El middleware sigue cubriendo las URLs sin prefijo que vengan de fuera
 * (compartidas, imagen de alineación, push): esto solo arregla los enlaces que
 * emitimos nosotros. El prefijado vive en `lib/locale-links` (puro y testeado);
 * aquí solo se lee el locale del contexto i18n.
 */
export function LocaleLink({ href, ...rest }: React.ComponentProps<typeof Link>) {
  const locale = useLocale();

  let target: React.ComponentProps<typeof Link>['href'] = href;
  if (typeof href === 'string') {
    target = withLocaleHref(href, locale);
  } else if (href && typeof href === 'object' && typeof href.pathname === 'string') {
    target = { ...href, pathname: withLocaleHref(href.pathname, locale) };
  }

  return <Link href={target} {...rest} />;
}

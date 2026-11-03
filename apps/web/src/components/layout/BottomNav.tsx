'use client';

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { NavigationProgress } from '@/components/layout/NavigationProgress';

const NAV_ITEMS = [
  {
    href: '/',
    labelKey: 'navigation.matches',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.5 : 1.8}
           stroke="currentColor" className="w-6 h-6">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
      </svg>
    ),
  },
  {
    href: '/competitions',
    labelKey: 'navigation.competitions',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.5 : 1.8}
           stroke="currentColor" className="w-6 h-6">
        <path d="M6 9H4a2 2 0 0 0-2 2v1a5 5 0 0 0 5 5h1" />
        <path d="M18 9h2a2 2 0 0 1 2 2v1a5 5 0 0 1-5 5h-1" />
        <path d="M8 21h8M12 17v4" />
        <path d="M8 3h8v10a4 4 0 0 1-8 0V3Z" />
      </svg>
    ),
  },
  {
    href: '/search',
    labelKey: 'navigation.search',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.5 : 1.8}
           stroke="currentColor" className="w-6 h-6">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/favorites',
    labelKey: 'navigation.favorites',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} strokeWidth={active ? 2 : 1.8}
           stroke="currentColor" className="w-6 h-6">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
              strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const { t } = useT();

  // El orden es una decisión de producto: Partidos y Competiciones primero
  // (el directo y el catálogo), después Buscar (descubrimiento) y Favoritos
  // (#414). Ajustes salió de la barra (auditoría UX 03/11/2026: 2,7 % de las
  // páginas vistas en 30 días): se abre desde la cabecera de Favoritos. El estado activo es por sección, no por coincidencia
  // exacta de ruta: dentro de una liga (/competitions/xyz), de un equipo o de
  // un jugador, la sección activa es Competiciones; los partidos cuelgan de
  // Partidos. La ruta llega prefijada por idioma (/es/...): lo quitamos antes
  // de comparar
  const path = pathname.replace(/^\/(es|en|pt|fr|it)(?=\/|$)/, '') || '/';
  const isActive = (href: string): boolean => {
    if (href === '/') return path === '/' || path.startsWith('/matches');
    if (href === '/competitions') {
      return ['/competitions', '/teams', '/players'].some((p) => path.startsWith(p));
    }
    return path.startsWith(href);
  };

  return (
    <>
      {/*
        #345: barra global de navegación pendiente (client-only, sin Suspense de
        ruta). Se monta aquí porque BottomNav es el único componente cliente que
        layout.tsx renderiza en TODAS las páginas. Ver NavigationProgress.
      */}
      <NavigationProgress />
      <nav aria-label={t('a11y.nav_primary')} className="fixed bottom-0 left-0 right-0 z-50 md:hidden
                      bg-white dark:bg-slate-900
                      border-t border-slate-200 dark:border-slate-800
                      pb-[env(safe-area-inset-bottom)]">
        <ul className="flex items-stretch h-16">
          {NAV_ITEMS.map(({ href, labelKey, icon }) => {
            const label = t(labelKey);
            const active = isActive(href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center justify-center h-full gap-0.5 text-xs
                              transition-colors duration-150
                              ${active
                                ? 'text-rink-passion dark:text-rink-accent'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 active:text-slate-800 dark:active:text-slate-200'
                              }`}
                >
                  {icon(active)}
                  <span className={`text-[11px] leading-none whitespace-nowrap ${active ? 'font-semibold' : 'font-normal'}`}>
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

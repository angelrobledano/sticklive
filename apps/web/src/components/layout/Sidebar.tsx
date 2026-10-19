'use client';

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';

export function Sidebar() {
  const { t } = useT();
  const pathname = usePathname();
  // Sección activa (misma lógica que BottomNav): la ruta llega prefijada por idioma.
  const path = pathname.replace(/^\/(es|en|pt|fr|it)(?=\/|$)/, '') || '/';
  const isActive = (href: string): boolean => {
    if (href === '/') return path === '/' || path.startsWith('/matches');
    if (href === '/competitions') return ['/competitions', '/teams', '/players'].some((p) => path.startsWith(p));
    return path.startsWith(href);
  };
  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0
                      min-h-screen bg-white dark:bg-slate-900
                      border-r border-slate-200 dark:border-slate-800
                      sticky top-0">
      {/* Logotipo de marca: lockup de la i (claro/oscuro). Enlaza a la home. */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-200 dark:border-slate-800">
        <Link
          href="/"
          aria-label="Stick Live"
          className="inline-flex items-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático de marca, sin optimización */}
          <img src="/brand/lock-on-light.svg" alt="" className="h-8 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element -- variante oscura del mismo lockup */}
          <img src="/brand/lock-on-dark.svg" alt="" aria-hidden="true" className="hidden h-8 w-auto dark:block" />
        </Link>
      </div>

      {/* Navegación */}
      <nav aria-label={t('a11y.nav_sections')} className="flex-1 px-3 py-4 space-y-1">
        {/* Mismo orden por importancia que la barra inferior móvil (#414) */}
        <SidebarLink href="/" label={t('navigation.matches')} active={isActive('/')}
          icon={<path d="M3 12h18M12 3v18" />} />
        <SidebarLink href="/competitions" label={t('navigation.competitions')} active={isActive('/competitions')}
          icon={<><path d="M8 3h8v10a4 4 0 0 1-8 0V3Z" /><path d="M12 17v4M8 21h8" /></>} />
        <SidebarLink href="/search" label={t('navigation.search')} active={isActive('/search')}
          icon={<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" /></>} />
        <SidebarLink href="/favorites" label={t('navigation.favorites')} active={isActive('/favorites')}
          icon={<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinejoin="round" />} />
        <SidebarLink href="/settings" label={t('navigation.settings')} active={isActive('/settings')}
          icon={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>} />
      </nav>
    </aside>
  );
}

function SidebarLink({ href, label, icon, active = false }: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Link href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
                 transition-colors duration-150 ${
        active
          ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-50'
      }`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
           className="w-5 h-5 shrink-0">
        {icon}
      </svg>
      {label}
    </Link>
  );
}

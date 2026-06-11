'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';

export function Sidebar() {
  const { t } = useT();
  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0
                      min-h-screen bg-white dark:bg-slate-900
                      border-r border-slate-200 dark:border-slate-800
                      sticky top-0">
      {/* Logo / marca — Stick (bold acento) + Live (regular neutro) */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-200 dark:border-slate-800">
        <span className="relative w-8 h-8 rounded-lg bg-rink-passion flex items-center justify-center">
          {/* Isotipo: stick estilizado + punto de directo */}
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.2} className="w-5 h-5">
            <path d="M7 3l7 12.5a3 3 0 0 1-2.6 4.5H8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400
                           ring-2 ring-white dark:ring-slate-900 animate-pulse" />
        </span>
        <span className="tracking-tight text-lg leading-none">
          <span className="font-bold text-rink-passion">Stick</span>
          <span className="font-normal text-slate-800 dark:text-slate-100"> Live</span>
        </span>
      </div>

      {/* Navegación */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <SidebarLink href="/" label={t('navigation.matches')}
          icon={<path d="M3 12h18M12 3v18" />} />
        <SidebarLink href="/competitions" label={t('navigation.competitions')}
          icon={<><path d="M8 3h8v10a4 4 0 0 1-8 0V3Z" /><path d="M12 17v4M8 21h8" /></>} />
        <SidebarLink href="/settings" label={t('navigation.settings')}
          icon={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>} />
      </nav>
    </aside>
  );
}

function SidebarLink({ href, label, icon }: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href}
      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
                 text-slate-600 dark:text-slate-400
                 hover:bg-slate-100 dark:hover:bg-slate-800
                 hover:text-slate-900 dark:hover:text-slate-50
                 transition-colors duration-150">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
           className="w-5 h-5 shrink-0">
        {icon}
      </svg>
      {label}
    </Link>
  );
}

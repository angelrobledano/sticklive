'use client';

import { usePathname } from 'next/navigation';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';

/**
 * Navegación común de la zona de administración. Antes cada panel era una URL
 * suelta (/admin/jugadores no se enlazaba desde /admin) y no se encontraba.
 */
const ITEMS = [
  { href: '/admin', label: 'Panel', match: /\/admin\/?$/ },
  { href: '/admin/resolucion', label: 'Cola de equipos', match: /\/admin\/resolucion/ },
  { href: '/admin/clubes', label: 'Clubes por escudo', match: /\/admin\/clubes/ },
  { href: '/admin/jugadores', label: 'Jugadores entre federaciones', match: /\/admin\/jugadores/ },
] as const;

export function AdminNav() {
  const path = usePathname() ?? '';
  return (
    <nav aria-label="Administración" className="mx-auto max-w-4xl px-4 pt-4">
      <ul className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {ITEMS.map((it) => {
          const active = it.match.test(path);
          return (
            <li key={it.href} className="shrink-0">
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-[44px] items-center border-b-2 px-3 text-sm font-semibold ${
                  active
                    ? 'border-rink-passion text-rink-passion dark:text-rose-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import type { BreadcrumbItem } from '@/lib/breadcrumbs';

/**
 * Migas de pan visibles (F5-6). Los enlaces pasan por `LocaleLink`, así que
 * conservan el idioma (F1-1). El último elemento es la página actual y no se
 * enlaza. El JSON-LD equivalente lo construye `breadcrumbJsonLd` en `lib/seo`.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.href} className="flex min-w-0 items-center gap-1">
              {index > 0 && <span aria-hidden="true" className="shrink-0 text-slate-300 dark:text-slate-600">›</span>}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-slate-700 dark:text-slate-200">
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="truncate hover:text-rink-passion">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

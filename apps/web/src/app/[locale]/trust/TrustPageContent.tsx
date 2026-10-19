import type { TrustPage } from './content';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';

const NAV: Record<string, { about: string; contact: string; legal: string; privacy: string }> = {
  es: { about: 'Sobre', contact: 'Contacto', legal: 'Aviso legal', privacy: 'Privacidad' },
  en: { about: 'About', contact: 'Contact', legal: 'Legal notice', privacy: 'Privacy' },
  pt: { about: 'Sobre', contact: 'Contacto', legal: 'Aviso legal', privacy: 'Privacidade' },
  fr: { about: 'À propos', contact: 'Contact', legal: 'Mentions légales', privacy: 'Confidentialité' },
  it: { about: 'Informazioni', contact: 'Contatti', legal: 'Note legali', privacy: 'Privacy' },
};

export function TrustPageContent({ page, locale, current }: {
  page: TrustPage;
  locale: string;
  current: 'about' | 'contact' | 'legal';
}) {
  const nav = NAV[locale] ?? NAV['en']!;
  return (
    <article className="px-4 py-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">{page.title}</h1>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-8">{page.updated}</p>

      <div className="space-y-6">
        {page.sections.map((s) => (
          <section key={s.h}>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1.5">{s.h}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{s.p}</p>
          </section>
        ))}
      </div>

      <nav aria-label={page.title} className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200 pt-4 text-xs dark:border-slate-700">
        {([
          ['about', nav.about],
          ['contact', nav.contact],
          ['legal', nav.legal],
          ['privacy', nav.privacy],
        ] as const).map(([key, label]) => (
          key === current ? null : (
            <Link key={key} href={`/${key}`} className="text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
              {label}
            </Link>
          )
        ))}
      </nav>
    </article>
  );
}

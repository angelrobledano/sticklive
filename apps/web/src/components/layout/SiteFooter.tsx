import { LocaleLink as Link } from '@/components/shared/LocaleLink';

const COPY: Record<string, { about: string; contact: string; legal: string; privacy: string }> = {
  es: { about: 'Sobre', contact: 'Contacto', legal: 'Aviso legal', privacy: 'Privacidad' },
  en: { about: 'About', contact: 'Contact', legal: 'Legal notice', privacy: 'Privacy' },
  pt: { about: 'Sobre', contact: 'Contacto', legal: 'Aviso legal', privacy: 'Privacidade' },
  fr: { about: 'À propos', contact: 'Contact', legal: 'Mentions légales', privacy: 'Confidentialité' },
  it: { about: 'Informazioni', contact: 'Contatti', legal: 'Note legali', privacy: 'Privacy' },
};

export function SiteFooter({ locale }: { locale: string }) {
  const c = COPY[locale] ?? COPY['en']!;
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-4 pb-20 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 md:pb-4">
      <nav aria-label="Stick Live" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 sm:justify-end">
        <Link href="/about" className="hover:text-slate-900 hover:underline dark:hover:text-slate-100">{c.about}</Link>
        <Link href="/contact" className="hover:text-slate-900 hover:underline dark:hover:text-slate-100">{c.contact}</Link>
        <Link href="/legal" className="hover:text-slate-900 hover:underline dark:hover:text-slate-100">{c.legal}</Link>
        <Link href="/privacy" className="hover:text-slate-900 hover:underline dark:hover:text-slate-100">{c.privacy}</Link>
      </nav>
    </footer>
  );
}

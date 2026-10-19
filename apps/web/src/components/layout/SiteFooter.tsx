import { LocaleLink as Link } from '@/components/shared/LocaleLink';

const COPY: Record<string, { about: string; contact: string; legal: string; privacy: string; data: string }> = {
  es: { about: 'Sobre', contact: 'Contacto', legal: 'Aviso legal', privacy: 'Privacidad', data: 'Datos: RFEP/sidgad y World Skate. Stick Live no es una web oficial.' },
  en: { about: 'About', contact: 'Contact', legal: 'Legal notice', privacy: 'Privacy', data: 'Data: RFEP/sidgad and World Skate. Stick Live is not an official website.' },
  pt: { about: 'Sobre', contact: 'Contacto', legal: 'Aviso legal', privacy: 'Privacidade', data: 'Dados: RFEP/sidgad e World Skate. O Stick Live não é um site oficial.' },
  fr: { about: 'À propos', contact: 'Contact', legal: 'Mentions légales', privacy: 'Confidentialité', data: 'Données : RFEP/sidgad et World Skate. Stick Live n’est pas un site officiel.' },
  it: { about: 'Informazioni', contact: 'Contatti', legal: 'Note legali', privacy: 'Privacy', data: 'Dati: RFEP/sidgad e World Skate. Stick Live non è un sito ufficiale.' },
};

export function SiteFooter({ locale }: { locale: string }) {
  const c = COPY[locale] ?? COPY['en']!;
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-5 pb-20 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 md:pb-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl leading-relaxed">{c.data}</p>
        <nav aria-label="Stick Live" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/about" className="hover:text-slate-900 hover:underline dark:hover:text-slate-100">{c.about}</Link>
          <Link href="/contact" className="hover:text-slate-900 hover:underline dark:hover:text-slate-100">{c.contact}</Link>
          <Link href="/legal" className="hover:text-slate-900 hover:underline dark:hover:text-slate-100">{c.legal}</Link>
          <Link href="/privacy" className="hover:text-slate-900 hover:underline dark:hover:text-slate-100">{c.privacy}</Link>
        </nav>
      </div>
    </footer>
  );
}

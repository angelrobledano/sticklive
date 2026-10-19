import type { Metadata } from 'next';
import { localeAlternates, socialMeta, isSupportedLocale } from '@/lib/seo';
import { privacyDict } from './content';

/**
 * Política de privacidad — honesta y en lenguaje llano.
 * ES nativo; EN de respaldo; FR traducido (19/10/2026). PT/IT siguen EN hasta
 * que haya traducción revisada.
 */

interface Props {
  params: Promise<{ locale: string }>;
}

const OG_TITLES: Record<string, string> = {
  es: 'Privacidad', en: 'Privacy', pt: 'Privacidade', fr: 'Confidentialité', it: 'Privacy',
};
const OG_DESCRIPTIONS: Record<string, string> = {
  es: 'Cómo tratamos tus datos en Stick Live.',
  en: 'How we handle your data on Stick Live.',
  pt: 'Como tratamos os teus dados no Stick Live.',
  fr: 'Comment nous traitons vos données sur Stick Live.',
  it: 'Come trattiamo i tuoi dati su Stick Live.',
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const label = OG_TITLES[locale] ?? OG_TITLES['en']!;
  const description = OG_DESCRIPTIONS[locale] ?? OG_DESCRIPTIONS['en']!;
  return {
    title: `${label} | Stick Live`,
    // F3-7: description propia; sin esto heredaba la de la home (SEO-05).
    description,
    alternates: localeAlternates(locale, '/privacy'),
    ...socialMeta({ locale, path: '/privacy', title: label, description }),
  };
}

export default async function PrivacyPage(props: Props) {
  const params = await props.params;
  const dict = privacyDict(params.locale);

  return (
    <div className="px-4 py-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">{dict.title}</h1>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-8">{dict.updated}</p>

      <div className="space-y-6">
        {dict.sections.map((s) => (
          <section key={s.h}>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1.5">{s.h}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{s.p}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

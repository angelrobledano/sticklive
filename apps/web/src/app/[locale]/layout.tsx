import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import '../globals.css';
import { BottomNav } from '@/components/layout/BottomNav';
import { PwaSetup } from '@/components/layout/PwaSetup';
import { AuthUpsell } from '@/components/shared/AuthUpsell';
import { I18nProvider } from '@/lib/i18n';
import { Sidebar } from '@/components/layout/Sidebar';
import { PremiumProvider } from '@/context/PremiumContext';
import { AnalyticsPageview } from '@/lib/analytics';
import { SUPPORTED_LOCALES, isSupportedLocale, type Locale } from '@/lib/locales';
import { localeAlternates, socialMeta, SITE_URL } from '@/lib/seo';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

interface Props {
  children: React.ReactNode;
  params: { locale: string };
}

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

/** Metadatos por idioma — título/descr. localizados + hreflang del home */
const SEO_TEXT: Record<Locale, { title: string; description: string }> = {
  es: {
    title: 'Stick Live — Resultados y estadísticas de hockey patines en directo',
    description: 'Resultados, estadísticas y alineaciones de hockey patines en directo. OK Liga, playoffs y mucho más, al segundo.',
  },
  en: {
    title: 'Stick Live — Live rink hockey scores & stats',
    description: 'Live rink hockey scores, stats and lineups. OK Liga, playoffs and much more, second by second.',
  },
  pt: {
    title: 'Stick Live — Resultados e estatísticas de hóquei em patins ao vivo',
    description: 'Resultados, estatísticas e onzes de hóquei em patins em direto. OK Liga, playoffs e muito mais, ao segundo.',
  },
  fr: {
    title: 'Stick Live — Scores et stats de rink hockey en direct',
    description: 'Scores, statistiques et compositions de rink hockey en direct. OK Liga, playoffs et bien plus, à la seconde.',
  },
  it: {
    title: 'Stick Live — Risultati e statistiche di hockey su pista in diretta',
    description: 'Risultati, statistiche e formazioni di hockey su pista in diretta. OK Liga, playoff e molto altro, al secondo.',
  },
};

/** Título OG corto (< 60 car., sin sufijo de marca para no cortarse). */
const OG_HOME_TITLE: Record<Locale, string> = {
  es: 'Hockey patines en directo, al segundo',
  en: 'Rink hockey live, second by second',
  pt: 'Hóquei em patins ao vivo, ao segundo',
  fr: 'Rink hockey en direct, à la seconde',
  it: 'Hockey su pista in diretta, al secondo',
};

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  const locale: Locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const { title, description } = SEO_TEXT[locale];
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    keywords: ['hockey patines', 'rink hockey', 'hóquei em patins', 'OK Liga', 'resultados en directo', 'live scores'],
    alternates: localeAlternates(locale, '/'),
    ...socialMeta({ locale, path: '/', title: OG_HOME_TITLE[locale], description }),
  };
}

// Next 14: viewport y themeColor van en su propio export (no en metadata)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)',  color: '#020617' },
  ],
};

export default function RootLayout({ children, params }: Props) {
  if (!isSupportedLocale(params.locale)) notFound();
  const locale: Locale = params.locale;

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      {/* Script inline: aplica .dark ANTES de hidratar para evitar flash */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('rink-theme');if(t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}` }} />
      </head>
      <body>
        {/* PremiumProvider cubre todo el árbol — permite mutación instantánea
            de <AdBanner> en caliente al volver de /premium/success */}
        <PremiumProvider>
          <I18nProvider initialLocale={locale}>
          <div className="flex min-h-screen">
            {/* Sidebar — solo visible en md+ */}
            <Sidebar />

            {/* Contenido principal */}
            <main className="flex-1 min-w-0
                             pb-20 md:pb-0
                             px-0 md:px-0">
              {children}
            </main>
          </div>

          {/* Bottom Nav — solo visible en móvil */}
          <BottomNav />

          {/* Sheet de conversión a cuenta (se dispara al 3er favorito anónimo) */}
          <AuthUpsell />

          {/* Registro del Service Worker + captura del prompt de instalación PWA */}
          <PwaSetup />

          {/* Pageviews de PostHog (no-op en desarrollo) */}
          <AnalyticsPageview />
          </I18nProvider>
        </PremiumProvider>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { localeAlternates, socialMeta, isSupportedLocale } from '@/lib/seo';

/**
 * Política de privacidad — honesta y en lenguaje llano.
 * ES nativo; resto de idiomas sirven la versión EN (suficiente legalmente
 * mientras el producto es pequeño; traducir cuando haya tracción local).
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
  return {
    title: locale === 'es' ? 'Privacidad | Stick Live' : 'Privacy | Stick Live',
    alternates: localeAlternates(locale, '/privacy'),
    ...socialMeta({
      locale,
      path: '/privacy',
      title: OG_TITLES[locale] ?? OG_TITLES['en']!,
      description: OG_DESCRIPTIONS[locale] ?? OG_DESCRIPTIONS['en']!,
    }),
  };
}

const ES = {
  title: 'Política de privacidad',
  updated: 'Última actualización: octubre de 2026',
  sections: [
    {
      h: 'Quiénes somos',
      p: 'Stick Live (sticklive.eu) es una plataforma de resultados y estadísticas de hockey sobre patines. Responsable: Ángel Robledano · robledano@gmail.com.',
    },
    {
      h: 'Qué datos tratamos',
      p: 'Si usas la app sin cuenta: un identificador anónimo de dispositivo, tus favoritos y preferencias (guardados en tu navegador) y, si activas las notificaciones, la suscripción push de tu navegador. Si creas cuenta: además, tu dirección de email. No pedimos nombre, teléfono ni ningún otro dato.',
    },
    {
      h: 'Para qué los usamos',
      p: 'Para que la app funcione: sincronizar tus favoritos entre dispositivos, enviarte el enlace de acceso por email y las alertas de partidos que tú actives. También medimos el uso de la app de forma agregada para mejorarla. En la versión gratuita mostramos anuncios que ayudan a financiar el servicio; las cuentas con suscripción premium no ven anuncios.',
    },
    {
      h: 'Con quién los compartimos',
      p: 'No vendemos tus datos. Usamos proveedores técnicos que tratan datos por encargo: Hetzner (alojamiento, Alemania), Brevo (envío de emails de acceso, UE) y PostHog (analítica de producto, servidores en la UE). Cuando mostramos anuncios, Google (AdSense) y sus socios publicitarios tratan datos de uso y del dispositivo para servir y medir los anuncios. Si inicias sesión con Google, Google nos comunica únicamente tu email.',
    },
    {
      h: 'Cuánto tiempo',
      p: 'Mientras tengas cuenta o suscripción push activa. Si tu suscripción push deja de ser válida, se elimina automáticamente. Puedes pedir el borrado de tu cuenta en cualquier momento.',
    },
    {
      h: 'Tus derechos',
      p: 'Acceso, rectificación, supresión, oposición y portabilidad (RGPD). Escríbenos a robledano@gmail.com y lo resolvemos. También puedes reclamar ante la AEPD (aepd.es).',
    },
    {
      h: 'Cookies y almacenamiento local',
      p: 'Guardamos en tu navegador tus preferencias (idioma, tema, favoritos, configuración de alertas) y una cookie técnica de idioma. La analítica de producto (PostHog, servidores en la UE) solo se activa si aceptas el aviso de cookies: hasta entonces no se carga ni guarda nada. Si aceptas, PostHog usa almacenamiento propio (cookies y localStorage de primera parte) y, si inicias sesión, vincula tu email a esa analítica para medir el uso de forma agregada. Puedes rechazarla y la app sigue funcionando igual.',
    },
    {
      h: 'Publicidad',
      p: 'Para financiar la versión gratuita mostramos anuncios con Google AdSense. Google y sus socios publicitarios pueden usar cookies e identificadores del dispositivo para mostrar y medir los anuncios. En el Espacio Económico Europeo, Reino Unido y Suiza te pedimos consentimiento antes de servir anuncios personalizados, mediante el aviso certificado de Google (IAB TCF): puedes aceptar, rechazar o gestionar las opciones. Si rechazas, podemos seguir mostrando anuncios no personalizados y la app funciona igual. Las cuentas con suscripción premium no ven anuncios.',
    },
  ],
};

const EN = {
  title: 'Privacy policy',
  updated: 'Last updated: October 2026',
  sections: [
    {
      h: 'Who we are',
      p: 'Stick Live (sticklive.eu) is a rink hockey live scores and stats platform. Controller: Ángel Robledano · robledano@gmail.com.',
    },
    {
      h: 'What data we process',
      p: 'Without an account: an anonymous device identifier, your favorites and preferences (stored in your browser) and, if you enable notifications, your browser push subscription. With an account: additionally, your email address. We never ask for your name, phone or anything else.',
    },
    {
      h: 'Why we use it',
      p: 'To make the app work: syncing your favorites across devices, sending your sign-in link by email, and delivering the match alerts you choose. We also measure app usage in aggregate to improve it. On the free version we show ads that help fund the service; accounts with a premium subscription see no ads.',
    },
    {
      h: 'Who we share it with',
      p: 'We do not sell your data. We use technical processors: Hetzner (hosting, Germany), Brevo (sign-in emails, EU) and PostHog (product analytics, EU servers). When we show ads, Google (AdSense) and its advertising partners process usage and device data to serve and measure ads. If you sign in with Google, Google shares only your email with us.',
    },
    {
      h: 'For how long',
      p: 'While you keep an account or an active push subscription. Dead push subscriptions are removed automatically. You can request account deletion at any time.',
    },
    {
      h: 'Your rights',
      p: 'Access, rectification, erasure, objection and portability (GDPR). Email robledano@gmail.com and we will sort it out. You may also complain to your local data protection authority.',
    },
    {
      h: 'Cookies and local storage',
      p: 'We store your preferences in your browser (language, theme, favorites, alert settings) plus a technical language cookie. Product analytics (PostHog, EU servers) only starts if you accept the cookie notice: until then it loads and stores nothing. If you accept, PostHog uses its own first-party storage (cookies and localStorage) and, when you sign in, links your email to that analytics to measure usage in aggregate. You can decline and the app keeps working the same.',
    },
    {
      h: 'Advertising',
      p: 'We show ads through Google AdSense to fund the free version. Google and its advertising partners may use cookies and device identifiers to serve and measure ads. In the European Economic Area, the United Kingdom and Switzerland we ask for your consent before serving personalised ads, through Google\'s certified notice (IAB TCF): you can accept, reject or manage the options. If you reject, we may still show non-personalised ads and the app keeps working the same. Accounts with a premium subscription see no ads.',
    },
  ],
};

export default async function PrivacyPage(props: Props) {
  const params = await props.params;
  const dict = params.locale === 'es' ? ES : EN;

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

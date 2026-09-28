import type { Metadata } from 'next';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';

/**
 * Política de privacidad — honesta y en lenguaje llano.
 * ES nativo; resto de idiomas sirven la versión EN (suficiente legalmente
 * mientras el producto es pequeño; traducir cuando haya tracción local).
 */

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return {
    title: locale === 'es' ? 'Privacidad | Stick Live' : 'Privacy | Stick Live',
    alternates: localeAlternates(locale, '/privacy'),
  };
}

const ES = {
  title: 'Política de privacidad',
  updated: 'Última actualización: septiembre de 2026',
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
      p: 'Para que la app funcione: sincronizar tus favoritos entre dispositivos, enviarte el enlace de acceso por email y las alertas de partidos que tú actives. También medimos el uso de la app de forma agregada para mejorarla.',
    },
    {
      h: 'Con quién los compartimos',
      p: 'Con nadie para fines comerciales. Usamos proveedores técnicos que tratan datos por encargo: Hetzner (alojamiento, Alemania), Brevo (envío de emails de acceso, UE) y PostHog (analítica de producto, servidores en la UE). Si inicias sesión con Google, Google nos comunica únicamente tu email.',
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
      p: 'No usamos cookies publicitarias. Guardamos en tu navegador tus preferencias (idioma, tema, favoritos, configuración de alertas) y una cookie técnica de idioma. La analítica de producto (PostHog, servidores en la UE) solo se activa si aceptas el aviso de cookies: hasta entonces no se carga ni guarda nada. Si aceptas, PostHog usa almacenamiento propio (cookies y localStorage de primera parte) y, si inicias sesión, vincula tu email a esa analítica para medir el uso de forma agregada. Puedes rechazarla y la app sigue funcionando igual.',
    },
  ],
};

const EN = {
  title: 'Privacy policy',
  updated: 'Last updated: September 2026',
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
      p: 'To make the app work: syncing your favorites across devices, sending your sign-in link by email, and delivering the match alerts you choose. We also measure app usage in aggregate to improve it.',
    },
    {
      h: 'Who we share it with',
      p: 'No one, for commercial purposes. We use technical processors: Hetzner (hosting, Germany), Brevo (sign-in emails, EU) and PostHog (product analytics, EU servers). If you sign in with Google, Google shares only your email with us.',
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
      p: 'No advertising cookies. We store your preferences in your browser (language, theme, favorites, alert settings) plus a technical language cookie. Product analytics (PostHog, EU servers) only starts if you accept the cookie notice: until then it loads and stores nothing. If you accept, PostHog uses its own first-party storage (cookies and localStorage) and, when you sign in, links your email to that analytics to measure usage in aggregate. You can decline and the app keeps working the same.',
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

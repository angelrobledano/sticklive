/**
 * Textos legales de privacidad. ES es la versión nativa; EN es la de respaldo;
 * FR se añadió el 19/10/2026 porque `/fr/privacy` servía inglés. PT/IT siguen
 * usando EN hasta que se traduzcan.
 */

export interface PrivacySection {
  h: string;
  p: string;
}

export interface PrivacyDict {
  title: string;
  updated: string;
  sections: PrivacySection[];
}

const ES: PrivacyDict = {
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

const EN: PrivacyDict = {
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

const FR: PrivacyDict = {
  title: 'Politique de confidentialité',
  updated: 'Dernière mise à jour : octobre 2026',
  sections: [
    {
      h: 'Qui sommes-nous',
      p: 'Stick Live (sticklive.eu) est une plateforme de résultats et de statistiques de hockey sur patins. Responsable du traitement : Ángel Robledano · robledano@gmail.com.',
    },
    {
      h: 'Quelles données nous traitons',
      p: 'Sans compte : un identifiant anonyme d\'appareil, vos favoris et préférences (stockés dans votre navigateur) et, si vous activez les notifications, l\'abonnement push de votre navigateur. Avec un compte : en plus, votre adresse e-mail. Nous ne demandons ni nom, ni téléphone, ni aucune autre donnée.',
    },
    {
      h: 'Pourquoi nous les utilisons',
      p: 'Pour faire fonctionner l\'app : synchroniser vos favoris entre appareils, vous envoyer le lien de connexion par e-mail et les alertes de match que vous activez. Nous mesurons aussi l\'usage de l\'app de manière agrégée pour l\'améliorer. Dans la version gratuite, nous affichons des publicités qui aident à financer le service ; les comptes avec abonnement Premium ne voient pas de publicités.',
    },
    {
      h: 'Avec qui nous les partageons',
      p: 'Nous ne vendons pas vos données. Nous utilisons des prestataires techniques qui traitent des données pour notre compte : Hetzner (hébergement, Allemagne), Brevo (e-mails de connexion, UE) et PostHog (analytique produit, serveurs dans l\'UE). Lorsque nous affichons des publicités, Google (AdSense) et ses partenaires publicitaires traitent des données d\'usage et d\'appareil pour diffuser et mesurer les publicités. Si vous vous connectez avec Google, Google nous communique uniquement votre adresse e-mail.',
    },
    {
      h: 'Pendant combien de temps',
      p: 'Tant que vous conservez un compte ou un abonnement push actif. Les abonnements push expirés sont supprimés automatiquement. Vous pouvez demander la suppression de votre compte à tout moment.',
    },
    {
      h: 'Vos droits',
      p: 'Accès, rectification, effacement, opposition et portabilité (RGPD). Écrivez-nous à robledano@gmail.com et nous réglerons cela. Vous pouvez également introduire une réclamation auprès de la CNIL (cnil.fr) ou de votre autorité locale de protection des données.',
    },
    {
      h: 'Cookies et stockage local',
      p: 'Nous stockons vos préférences dans votre navigateur (langue, thème, favoris, paramètres d\'alerte) ainsi qu\'un cookie technique de langue. L\'analytique produit (PostHog, serveurs dans l\'UE) ne démarre que si vous acceptez l\'avis relatif aux cookies : jusque-là, elle ne charge et ne stocke rien. Si vous acceptez, PostHog utilise son propre stockage first-party (cookies et localStorage) et, si vous vous connectez, associe votre adresse e-mail à cette analytique pour mesurer l\'usage de manière agrégée. Vous pouvez refuser et l\'app continue de fonctionner de la même manière.',
    },
    {
      h: 'Publicité',
      p: 'Pour financer la version gratuite, nous affichons des publicités via Google AdSense. Google et ses partenaires publicitaires peuvent utiliser des cookies et des identifiants d\'appareil pour diffuser et mesurer les publicités. Dans l\'Espace économique européen, au Royaume-Uni et en Suisse, nous vous demandons votre consentement avant de diffuser des publicités personnalisées, via l\'avis certifié de Google (IAB TCF) : vous pouvez accepter, refuser ou gérer les options. En cas de refus, nous pouvons continuer à afficher des publicités non personnalisées et l\'app fonctionne de la même manière. Les comptes avec abonnement Premium ne voient pas de publicités.',
    },
  ],
};

const DICTS: Record<string, PrivacyDict> = { es: ES, en: EN, fr: FR };

export function privacyDict(locale: string): PrivacyDict {
  return DICTS[locale] ?? EN;
}

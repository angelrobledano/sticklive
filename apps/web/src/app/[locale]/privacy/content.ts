/**
 * Textos legales de privacidad. ES es la versión nativa; EN es la de respaldo;
 * FR, PT e IT se añadieron el 19/10/2026 para que cada URL sirva su idioma.
 * Ante un locale desconocido se cae a EN.
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
      p: 'Guardamos en tu navegador tus preferencias (idioma, tema, favoritos, configuración de alertas) y una cookie técnica de idioma. La analítica de producto (PostHog, servidores en la UE) solo se activa si das tu consentimiento en el aviso de Google (el mismo que gobierna la publicidad): hasta entonces no se carga ni guarda nada. Si aceptas, PostHog usa almacenamiento propio (cookies y localStorage de primera parte) y, si inicias sesión, vincula tu email a esa analítica para medir el uso de forma agregada. Puedes rechazarla y la app sigue funcionando igual.',
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
      p: 'We store your preferences in your browser (language, theme, favorites, alert settings) plus a technical language cookie. Product analytics (PostHog, EU servers) only starts if you give consent in Google\'s notice (the same one that governs advertising): until then it loads and stores nothing. If you accept, PostHog uses its own first-party storage (cookies and localStorage) and, when you sign in, links your email to that analytics to measure usage in aggregate. You can decline and the app keeps working the same.',
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
      p: 'Nous stockons vos préférences dans votre navigateur (langue, thème, favoris, paramètres d\'alerte) ainsi qu\'un cookie technique de langue. L\'analytique produit (PostHog, serveurs dans l\'UE) ne démarre que si vous donnez votre consentement dans l\'avis de Google (le même que celui qui régit la publicité) : jusque-là, elle ne charge et ne stocke rien. Si vous acceptez, PostHog utilise son propre stockage first-party (cookies et localStorage) et, si vous vous connectez, associe votre adresse e-mail à cette analytique pour mesurer l\'usage de manière agrégée. Vous pouvez refuser et l\'app continue de fonctionner de la même manière.',
    },
    {
      h: 'Publicité',
      p: 'Pour financer la version gratuite, nous affichons des publicités via Google AdSense. Google et ses partenaires publicitaires peuvent utiliser des cookies et des identifiants d\'appareil pour diffuser et mesurer les publicités. Dans l\'Espace économique européen, au Royaume-Uni et en Suisse, nous vous demandons votre consentement avant de diffuser des publicités personnalisées, via l\'avis certifié de Google (IAB TCF) : vous pouvez accepter, refuser ou gérer les options. En cas de refus, nous pouvons continuer à afficher des publicités non personnalisées et l\'app fonctionne de la même manière. Les comptes avec abonnement Premium ne voient pas de publicités.',
    },
  ],
};

const PT: PrivacyDict = {
  title: 'Política de privacidade',
  updated: 'Última atualização: outubro de 2026',
  sections: [
    {
      h: 'Quem somos',
      p: 'A Stick Live (sticklive.eu) é uma plataforma de resultados e estatísticas de hóquei em patins. Responsável: Ángel Robledano · robledano@gmail.com.',
    },
    {
      h: 'Que dados tratamos',
      p: 'Sem conta: um identificador anónimo de dispositivo, os seus favoritos e preferências (guardados no navegador) e, se ativar as notificações, a subscrição push do navegador. Com conta: além disso, o seu endereço de e-mail. Não pedimos nome, telefone nem qualquer outro dado.',
    },
    {
      h: 'Para que os usamos',
      p: 'Para que a app funcione: sincronizar os favoritos entre dispositivos, enviar-lhe o link de acesso por e-mail e os alertas de jogos que ativar. Também medimos o uso da app de forma agregada para a melhorar. Na versão gratuita mostramos anúncios que ajudam a financiar o serviço; as contas com subscrição Premium não veem anúncios.',
    },
    {
      h: 'Com quem os partilhamos',
      p: 'Não vendemos os seus dados. Usamos prestadores técnicos que tratam dados por nossa conta: Hetzner (alojamento, Alemanha), Brevo (e-mails de acesso, UE) e PostHog (análise de produto, servidores na UE). Quando mostramos anúncios, a Google (AdSense) e os seus parceiros publicitários tratam dados de utilização e do dispositivo para apresentar e medir anúncios. Se iniciar sessão com a Google, a Google comunica-nos apenas o seu e-mail.',
    },
    {
      h: 'Durante quanto tempo',
      p: 'Enquanto tiver conta ou subscrição push ativa. As subscrições push inválidas são eliminadas automaticamente. Pode pedir a eliminação da conta a qualquer momento.',
    },
    {
      h: 'Os seus direitos',
      p: 'Acesso, retificação, apagamento, oposição e portabilidade (RGPD). Escreva-nos para robledano@gmail.com e resolvemos. Também pode reclamar junto da CNPD (cnpd.pt) ou da autoridade local de proteção de dados.',
    },
    {
      h: 'Cookies e armazenamento local',
      p: 'Guardamos no navegador as suas preferências (idioma, tema, favoritos, configuração de alertas) e um cookie técnico de idioma. A análise de produto (PostHog, servidores na UE) só começa se der o seu consentimento no aviso da Google (o mesmo que rege a publicidade): até lá, não carrega nem guarda nada. Se aceitar, a PostHog usa armazenamento próprio (cookies e localStorage de primeira parte) e, se iniciar sessão, associa o seu e-mail a essa análise para medir o uso de forma agregada. Pode recusar e a app continua a funcionar da mesma forma.',
    },
    {
      h: 'Publicidade',
      p: 'Para financiar a versão gratuita, mostramos anúncios através da Google AdSense. A Google e os seus parceiros publicitários podem usar cookies e identificadores do dispositivo para apresentar e medir anúncios. No Espaço Económico Europeu, no Reino Unido e na Suíça, pedimos o seu consentimento antes de apresentar anúncios personalizados, através do aviso certificado da Google (IAB TCF): pode aceitar, recusar ou gerir as opções. Se recusar, podemos continuar a mostrar anúncios não personalizados e a app funciona da mesma forma. As contas com subscrição Premium não veem anúncios.',
    },
  ],
};

const IT: PrivacyDict = {
  title: 'Informativa sulla privacy',
  updated: 'Ultimo aggiornamento: ottobre 2026',
  sections: [
    {
      h: 'Chi siamo',
      p: 'Stick Live (sticklive.eu) è una piattaforma di risultati e statistiche di hockey su pista. Titolare del trattamento: Ángel Robledano · robledano@gmail.com.',
    },
    {
      h: 'Quali dati trattiamo',
      p: 'Senza account: un identificatore anonimo del dispositivo, i tuoi preferiti e le preferenze (salvati nel browser) e, se attivi le notifiche, l\'iscrizione push del browser. Con un account: inoltre, il tuo indirizzo e-mail. Non chiediamo nome, telefono o altri dati.',
    },
    {
      h: 'Perché li usiamo',
      p: 'Per far funzionare l\'app: sincronizzare i preferiti tra dispositivi, inviarti il link di accesso via e-mail e gli avvisi delle partite che attivi. Misuriamo anche l\'uso dell\'app in forma aggregata per migliorarla. Nella versione gratuita mostriamo annunci che aiutano a finanziare il servizio; gli account con abbonamento Premium non vedono annunci.',
    },
    {
      h: 'Con chi li condividiamo',
      p: 'Non vendiamo i tuoi dati. Utilizziamo fornitori tecnici che trattano dati per nostro conto: Hetzner (hosting, Germania), Brevo (e-mail di accesso, UE) e PostHog (analytics di prodotto, server nell\'UE). Quando mostriamo annunci, Google (AdSense) e i suoi partner pubblicitari trattano dati di utilizzo e del dispositivo per erogare e misurare gli annunci. Se accedi con Google, Google ci comunica solo il tuo indirizzo e-mail.',
    },
    {
      h: 'Per quanto tempo',
      p: 'Finché mantieni un account o un\'iscrizione push attiva. Le iscrizioni push scadute vengono eliminate automaticamente. Puoi richiedere la cancellazione dell\'account in qualsiasi momento.',
    },
    {
      h: 'I tuoi diritti',
      p: 'Accesso, rettifica, cancellazione, opposizione e portabilità (GDPR). Scrivici a robledano@gmail.com e risolveremo. Puoi anche presentare reclamo al Garante per la protezione dei dati personali (garanteprivacy.it) o alla tua autorità locale.',
    },
    {
      h: 'Cookie e archiviazione locale',
      p: 'Salviamo nel browser le tue preferenze (lingua, tema, preferiti, impostazioni degli avvisi) e un cookie tecnico della lingua. L\'analytics di prodotto (PostHog, server nell\'UE) parte solo se dai il tuo consenso nell\'avviso di Google (lo stesso che governa la pubblicità): fino ad allora non carica né salva nulla. Se accetti, PostHog usa un proprio archivio first-party (cookie e localStorage) e, se accedi, collega il tuo indirizzo e-mail a tale analytics per misurare l\'uso in forma aggregata. Puoi rifiutare e l\'app continua a funzionare allo stesso modo.',
    },
    {
      h: 'Pubblicità',
      p: 'Per finanziare la versione gratuita mostriamo annunci tramite Google AdSense. Google e i suoi partner pubblicitari possono usare cookie e identificatori del dispositivo per erogare e misurare gli annunci. Nello Spazio economico europeo, nel Regno Unito e in Svizzera chiediamo il tuo consenso prima di erogare annunci personalizzati, tramite l\'avviso certificato di Google (IAB TCF): puoi accettare, rifiutare o gestire le opzioni. Se rifiuti, possiamo continuare a mostrare annunci non personalizzati e l\'app funziona allo stesso modo. Gli account con abbonamento Premium non vedono annunci.',
    },
  ],
};

const DICTS: Record<string, PrivacyDict> = { es: ES, en: EN, fr: FR, pt: PT, it: IT };

export function privacyDict(locale: string): PrivacyDict {
  return DICTS[locale] ?? EN;
}

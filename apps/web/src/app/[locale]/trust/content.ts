/**
 * Textos de confianza (F4-4): Sobre, contacto y aviso legal.
 *
 * Se mantienen separados de las páginas para que los cinco idiomas compartan
 * estructura y para no mezclar contenido legal con componentes.
 */

export interface TrustSection {
  h: string;
  p: string;
}

export interface TrustPage {
  title: string;
  description: string;
  updated: string;
  sections: TrustSection[];
}

export interface TrustDict {
  about: TrustPage;
  contact: TrustPage;
  legal: TrustPage;
}

const ES: TrustDict = {
  about: {
    title: 'Sobre Stick Live',
    description: 'Qué es Stick Live, de dónde salen los datos y cómo trabajamos.',
    updated: 'Actualizado: octubre de 2026',
    sections: [
      { h: 'Qué es', p: 'Stick Live (sticklive.eu) es una plataforma independiente de resultados, clasificaciones y estadísticas de hockey sobre patines. El objetivo es que un aficionado encuentre en segundos el resultado, la tabla o el dato que busca, también en competiciones pequeñas.' },
      { h: 'De dónde salen los datos', p: 'Los datos deportivos proceden de fuentes públicas de la Real Federación Española de Patinaje (RFEP/sidgad) y de World Skate. No somos una web oficial de ninguna federación ni de World Skate. Las marcas, escudos y nombres de clubes pertenecen a sus titulares y se usan con finalidad informativa.' },
      { h: 'Cómo se calculan las estadísticas', p: 'Las clasificaciones se publican tal como las ofrece la fuente, incluidas las sanciones de puntos. Las estadísticas propias (rachas, goles por parte, percentiles, crónicas) se calculan con los resultados y las actas disponibles. Si la cobertura de un acta no es suficiente, no publicamos el dato derivado.' },
      { h: 'Independencia y correcciones', p: 'Stick Live no vende datos personales ni cobra a clubes por aparecer. Si detectas un resultado, un nombre o una clasificación incorrectos, escríbenos y lo revisamos con la fuente. La prioridad es no publicar un dato falso.' },
    ],
  },
  contact: {
    title: 'Contacto',
    description: 'Cómo contactar con Stick Live para correcciones, prensa o privacidad.',
    updated: 'Actualizado: octubre de 2026',
    sections: [
      { h: 'Correo', p: 'Escribe a robledano@gmail.com. Es el canal para correcciones de datos, sugerencias, prensa y cuestiones de privacidad.' },
      { h: 'Correcciones de datos', p: 'Indica la URL, el dato que crees incorrecto y, si la tienes, la fuente que lo contradice. Revisamos primero la fuente original antes de cambiar una ficha.' },
      { h: 'Privacidad y derechos', p: 'Para acceso, rectificación, supresión, oposición o portabilidad de datos, escribe al mismo correo indicando el asunto “Privacidad”. También puedes consultar la política de privacidad.' },
      { h: 'Prensa y colaboraciones', p: 'Si necesitas contexto sobre datos, cobertura o una imagen, indícalo en el correo. No atendemos solicitudes de cambio de resultados sin una fuente verificable.' },
    ],
  },
  legal: {
    title: 'Aviso legal',
    description: 'Titular, condiciones de uso, fuentes, propiedad intelectual y responsabilidad de Stick Live.',
    updated: 'Actualizado: octubre de 2026',
    sections: [
      { h: 'Titular', p: 'Stick Live (sticklive.eu) es un proyecto informativo titularidad de Ángel Robledano. Contacto: robledano@gmail.com.' },
      { h: 'Objeto', p: 'El sitio ofrece información y estadísticas deportivas de hockey sobre patines. El acceso es gratuito; algunas funciones pueden requerir cuenta o suscripción.' },
      { h: 'Fuentes e independencia', p: 'Los datos deportivos se obtienen de fuentes públicas de la RFEP/sidgad y World Skate. Stick Live no está afiliada ni representa oficialmente a estas entidades. Las marcas, escudos y fotografías pertenecen a sus titulares.' },
      { h: 'Uso del sitio', p: 'No está permitido extraer de forma masiva el contenido, interferir en el servicio, intentar acceder a zonas privadas ni reutilizar la base de datos para un producto competidor sin autorización.' },
      { h: 'Propiedad intelectual', p: 'El diseño, el código y los textos propios de Stick Live están protegidos. Los datos deportivos, escudos y marcas de terceros conservan la titularidad de sus fuentes. La cita de un dato con enlace a esta web es bienvenida.' },
      { h: 'Responsabilidad', p: 'La información se ofrece con la diligencia razonable, pero puede contener errores o retrasos de la fuente. No garantizamos disponibilidad continua ni exactitud absoluta. Los enlaces externos se ofrecen como referencia y no implican respaldo.' },
      { h: 'Publicidad y privacidad', p: 'La versión gratuita puede mostrar publicidad de Google AdSense. El tratamiento de datos y cookies se explica en la política de privacidad. Las cuentas premium no ven anuncios.' },
      { h: 'Legislación', p: 'Este aviso se rige por la legislación española. Para cualquier controversia, las partes se someterán a los juzgados que correspondan conforme a la ley aplicable.' },
    ],
  },
};

const EN: TrustDict = {
  about: {
    title: 'About Stick Live',
    description: 'What Stick Live is, where the data comes from and how we work.',
    updated: 'Updated: October 2026',
    sections: [
      { h: 'What it is', p: 'Stick Live (sticklive.eu) is an independent rink hockey results, standings and stats platform. The goal is to let a fan find a score, table or fact in seconds, including in smaller competitions.' },
      { h: 'Where the data comes from', p: 'Sports data comes from public sources of the Spanish Roller Sports Federation (RFEP/sidgad) and World Skate. We are not an official website of any federation or of World Skate. Third-party brands, crests and club names belong to their owners and are used for information purposes.' },
      { h: 'How stats are calculated', p: 'Standings are published as supplied by the source, including point deductions. Our own stats (streaks, goals by half, percentiles, match reports) are calculated from available results and match sheets. If a match sheet is not complete enough, we do not publish the derived fact.' },
      { h: 'Independence and corrections', p: 'Stick Live does not sell personal data or charge clubs to appear. If you find a wrong score, name or standing, write to us and we will check it against the source. Our priority is not to publish false data.' },
    ],
  },
  contact: {
    title: 'Contact',
    description: 'How to contact Stick Live about corrections, press or privacy.',
    updated: 'Updated: October 2026',
    sections: [
      { h: 'Email', p: 'Write to robledano@gmail.com. This is the channel for data corrections, suggestions, press and privacy questions.' },
      { h: 'Data corrections', p: 'Include the URL, the data you believe is wrong and, if possible, the source that contradicts it. We check the original source before changing a page.' },
      { h: 'Privacy and rights', p: 'For access, rectification, erasure, objection or portability of data, email the same address with the subject “Privacy”. You can also read the privacy policy.' },
      { h: 'Press and partnerships', p: 'If you need context about data, coverage or an image, say so in your email. We do not change results without a verifiable source.' },
    ],
  },
  legal: {
    title: 'Legal notice',
    description: 'Owner, terms of use, sources, intellectual property and liability of Stick Live.',
    updated: 'Updated: October 2026',
    sections: [
      { h: 'Owner', p: 'Stick Live (sticklive.eu) is an information project owned by Ángel Robledano. Contact: robledano@gmail.com.' },
      { h: 'Purpose', p: 'The site provides rink hockey information and sports statistics. Access is free; some features may require an account or subscription.' },
      { h: 'Sources and independence', p: 'Sports data is obtained from public RFEP/sidgad and World Skate sources. Stick Live is not affiliated with or an official representative of these organisations. Third-party brands, crests and photographs belong to their owners.' },
      { h: 'Use of the site', p: 'Mass extraction of content, interference with the service, attempts to access private areas or reuse of the database for a competing product without permission are not allowed.' },
      { h: 'Intellectual property', p: 'Stick Live’s own design, code and texts are protected. Sports data, crests and third-party trademarks remain owned by their sources. Quoting a fact with a link to this site is welcome.' },
      { h: 'Liability', p: 'Information is provided with reasonable care but may contain errors or delays from the source. We do not guarantee continuous availability or absolute accuracy. External links are references and do not imply endorsement.' },
      { h: 'Advertising and privacy', p: 'The free version may show Google AdSense advertising. Data and cookie processing is explained in the privacy policy. Premium accounts see no ads.' },
      { h: 'Law', p: 'This notice is governed by Spanish law. Any dispute will be submitted to the courts applicable under the law.' },
    ],
  },
};

const PT: TrustDict = {
  about: {
    title: 'Sobre o Stick Live',
    description: 'O que é o Stick Live, de onde vêm os dados e como trabalhamos.',
    updated: 'Atualizado: outubro de 2026',
    sections: [
      { h: 'O que é', p: 'O Stick Live (sticklive.eu) é uma plataforma independente de resultados, classificações e estatísticas de hóquei em patins. O objetivo é encontrar um resultado, uma tabela ou um dado em segundos, também em competições pequenas.' },
      { h: 'De onde vêm os dados', p: 'Os dados desportivos vêm de fontes públicas da Real Federación Española de Patinaje (RFEP/sidgad) e da World Skate. Não somos um site oficial de nenhuma federação nem da World Skate. Marcas, emblemas e nomes de clubes pertencem aos seus titulares e são usados para informação.' },
      { h: 'Como calculamos as estatísticas', p: 'As classificações são publicadas tal como a fonte as fornece, incluindo penalizações de pontos. As estatísticas próprias (séries, golos por parte, percentis, crónicas) são calculadas com os resultados e as fichas disponíveis. Se a ficha não tiver cobertura suficiente, não publicamos o dado derivado.' },
      { h: 'Independência e correções', p: 'O Stick Live não vende dados pessoais nem cobra a clubes para aparecer. Se encontrar um resultado, nome ou classificação incorretos, escreva-nos e verificamos com a fonte. A prioridade é não publicar dados falsos.' },
    ],
  },
  contact: {
    title: 'Contacto',
    description: 'Como contactar o Stick Live para correções, imprensa ou privacidade.',
    updated: 'Atualizado: outubro de 2026',
    sections: [
      { h: 'Email', p: 'Escreva para robledano@gmail.com. É o canal para correções de dados, sugestões, imprensa e questões de privacidade.' },
      { h: 'Correções de dados', p: 'Indique o URL, o dado que considera incorreto e, se possível, a fonte que o contradiz. Verificamos a fonte original antes de alterar uma ficha.' },
      { h: 'Privacidade e direitos', p: 'Para acesso, retificação, apagamento, oposição ou portabilidade, escreva para o mesmo email com o assunto “Privacidade”. Pode também consultar a política de privacidade.' },
      { h: 'Imprensa e colaborações', p: 'Se precisar de contexto sobre dados, cobertura ou uma imagem, indique-o no email. Não alteramos resultados sem uma fonte verificável.' },
    ],
  },
  legal: {
    title: 'Aviso legal',
    description: 'Titular, condições de utilização, fontes, propriedade intelectual e responsabilidade do Stick Live.',
    updated: 'Atualizado: outubro de 2026',
    sections: [
      { h: 'Titular', p: 'O Stick Live (sticklive.eu) é um projeto informativo de Ángel Robledano. Contacto: robledano@gmail.com.' },
      { h: 'Objeto', p: 'O site disponibiliza informação e estatísticas de hóquei em patins. O acesso é gratuito; algumas funções podem exigir conta ou subscrição.' },
      { h: 'Fontes e independência', p: 'Os dados desportivos são obtidos de fontes públicas da RFEP/sidgad e da World Skate. O Stick Live não está afiliado nem representa oficialmente estas entidades. Marcas, emblemas e fotografias pertencem aos seus titulares.' },
      { h: 'Utilização do site', p: 'Não é permitida a extração massiva de conteúdo, a interferência no serviço, a tentativa de acesso a áreas privadas ou a reutilização da base de dados para um produto concorrente sem autorização.' },
      { h: 'Propriedade intelectual', p: 'O design, o código e os textos próprios do Stick Live estão protegidos. Os dados desportivos, emblemas e marcas de terceiros mantêm a titularidade das fontes. Citar um dado com ligação a este site é bem-vindo.' },
      { h: 'Responsabilidade', p: 'A informação é prestada com diligência razoável, mas pode conter erros ou atrasos da fonte. Não garantimos disponibilidade contínua nem exatidão absoluta. As ligações externas são referências e não implicam endorsement.' },
      { h: 'Publicidade e privacidade', p: 'A versão gratuita pode mostrar publicidade do Google AdSense. O tratamento de dados e cookies está explicado na política de privacidade. As contas premium não veem anúncios.' },
      { h: 'Legislação', p: 'Este aviso rege-se pela legislação espanhola. Qualquer litígio será submetido aos tribunais aplicáveis nos termos da lei.' },
    ],
  },
};

const FR: TrustDict = {
  about: {
    title: 'À propos de Stick Live',
    description: 'Ce qu’est Stick Live, d’où viennent les données et comment nous travaillons.',
    updated: 'Mis à jour : octobre 2026',
    sections: [
      { h: 'Qu’est-ce que c’est', p: 'Stick Live (sticklive.eu) est une plateforme indépendante de résultats, classements et statistiques de rink hockey. L’objectif est de trouver un score, un classement ou un fait en quelques secondes, y compris dans les petites compétitions.' },
      { h: 'D’où viennent les données', p: 'Les données sportives proviennent de sources publiques de la Fédération espagnole de patinage (RFEP/sidgad) et de World Skate. Nous ne sommes pas un site officiel d’une fédération ni de World Skate. Les marques, écussons et noms de clubs appartiennent à leurs titulaires et sont utilisés à titre informatif.' },
      { h: 'Comment les statistiques sont calculées', p: 'Les classements sont publiés tels que fournis par la source, y compris les pénalités de points. Nos statistiques (séries, buts par période, percentiles, récits) sont calculées à partir des résultats et feuilles de match disponibles. Si une feuille n’est pas assez complète, nous ne publions pas le fait dérivé.' },
      { h: 'Indépendance et corrections', p: 'Stick Live ne vend pas de données personnelles et ne facture pas les clubs pour apparaître. Si vous trouvez un score, un nom ou un classement incorrect, écrivez-nous et nous vérifierons avec la source. Notre priorité est de ne pas publier de fausses données.' },
    ],
  },
  contact: {
    title: 'Contact',
    description: 'Comment contacter Stick Live pour des corrections, la presse ou la confidentialité.',
    updated: 'Mis à jour : octobre 2026',
    sections: [
      { h: 'Email', p: 'Écrivez à robledano@gmail.com. C’est le canal pour les corrections de données, suggestions, presse et questions de confidentialité.' },
      { h: 'Corrections de données', p: 'Indiquez l’URL, la donnée que vous pensez incorrecte et, si possible, la source qui la contredit. Nous vérifions la source originale avant de modifier une fiche.' },
      { h: 'Confidentialité et droits', p: 'Pour l’accès, la rectification, l’effacement, l’opposition ou la portabilité, écrivez au même email avec l’objet « Confidentialité ». Vous pouvez aussi consulter la politique de confidentialité.' },
      { h: 'Presse et partenariats', p: 'Si vous avez besoin de contexte sur les données, la couverture ou une image, précisez-le dans l’email. Nous ne modifions pas les résultats sans source vérifiable.' },
    ],
  },
  legal: {
    title: 'Mentions légales',
    description: 'Titulaire, conditions d’utilisation, sources, propriété intellectuelle et responsabilité de Stick Live.',
    updated: 'Mis à jour : octobre 2026',
    sections: [
      { h: 'Titulaire', p: 'Stick Live (sticklive.eu) est un projet d’information appartenant à Ángel Robledano. Contact : robledano@gmail.com.' },
      { h: 'Objet', p: 'Le site fournit des informations et statistiques de rink hockey. L’accès est gratuit ; certaines fonctions peuvent nécessiter un compte ou un abonnement.' },
      { h: 'Sources et indépendance', p: 'Les données sportives proviennent de sources publiques RFEP/sidgad et World Skate. Stick Live n’est ni affilié ni représentant officiel de ces entités. Les marques, écussons et photographies appartiennent à leurs titulaires.' },
      { h: 'Utilisation du site', p: 'L’extraction massive de contenu, l’interférence avec le service, les tentatives d’accès aux zones privées et la réutilisation de la base pour un produit concurrent sans autorisation sont interdites.' },
      { h: 'Propriété intellectuelle', p: 'Le design, le code et les textes propres de Stick Live sont protégés. Les données sportives, écussons et marques de tiers restent la propriété de leurs sources. Citer un fait avec un lien vers ce site est bienvenu.' },
      { h: 'Responsabilité', p: 'Les informations sont fournies avec une diligence raisonnable mais peuvent contenir des erreurs ou des retards de la source. Nous ne garantissons pas une disponibilité continue ni une exactitude absolue. Les liens externes sont des références et n’impliquent aucun endossement.' },
      { h: 'Publicité et confidentialité', p: 'La version gratuite peut afficher de la publicité Google AdSense. Le traitement des données et des cookies est expliqué dans la politique de confidentialité. Les comptes premium ne voient pas de publicité.' },
      { h: 'Droit applicable', p: 'Les présentes mentions sont régies par le droit espagnol. Tout litige sera soumis aux tribunaux compétents selon la loi applicable.' },
    ],
  },
};

const IT: TrustDict = {
  about: {
    title: 'Informazioni su Stick Live',
    description: 'Che cos’è Stick Live, da dove arrivano i dati e come lavoriamo.',
    updated: 'Aggiornato: ottobre 2026',
    sections: [
      { h: 'Che cos’è', p: 'Stick Live (sticklive.eu) è una piattaforma indipendente di risultati, classifiche e statistiche di hockey su pista. L’obiettivo è trovare un risultato, una classifica o un dato in pochi secondi, anche nelle competizioni minori.' },
      { h: 'Da dove arrivano i dati', p: 'I dati sportivi provengono da fonti pubbliche della Federazione spagnola di pattinaggio (RFEP/sidgad) e di World Skate. Non siamo un sito ufficiale di alcuna federazione né di World Skate. Marchi, stemmi e nomi dei club appartengono ai rispettivi titolari e sono usati a scopo informativo.' },
      { h: 'Come calcoliamo le statistiche', p: 'Le classifiche sono pubblicate come fornite dalla fonte, comprese le penalizzazioni di punti. Le nostre statistiche (serie, gol per tempo, percentili, cronache) sono calcolate con i risultati e i referti disponibili. Se un referto non è abbastanza completo, non pubblichiamo il dato derivato.' },
      { h: 'Indipendenza e correzioni', p: 'Stick Live non vende dati personali e non chiede ai club di pagare per comparire. Se trovi un risultato, un nome o una classifica errati, scrivici e verificheremo con la fonte. La priorità è non pubblicare dati falsi.' },
    ],
  },
  contact: {
    title: 'Contatti',
    description: 'Come contattare Stick Live per correzioni, stampa o privacy.',
    updated: 'Aggiornato: ottobre 2026',
    sections: [
      { h: 'Email', p: 'Scrivi a robledano@gmail.com. È il canale per correzioni dei dati, suggerimenti, stampa e questioni sulla privacy.' },
      { h: 'Correzioni dei dati', p: 'Indica l’URL, il dato che ritieni errato e, se possibile, la fonte che lo contraddice. Verifichiamo la fonte originale prima di modificare una scheda.' },
      { h: 'Privacy e diritti', p: 'Per accesso, rettifica, cancellazione, opposizione o portabilità, scrivi alla stessa email con oggetto “Privacy”. Puoi anche consultare l’informativa sulla privacy.' },
      { h: 'Stampa e collaborazioni', p: 'Se ti serve contesto su dati, copertura o un’immagine, indicalo nell’email. Non modifichiamo i risultati senza una fonte verificabile.' },
    ],
  },
  legal: {
    title: 'Note legali',
    description: 'Titolare, condizioni d’uso, fonti, proprietà intellettuale e responsabilità di Stick Live.',
    updated: 'Aggiornato: ottobre 2026',
    sections: [
      { h: 'Titolare', p: 'Stick Live (sticklive.eu) è un progetto informativo di Ángel Robledano. Contatto: robledano@gmail.com.' },
      { h: 'Oggetto', p: 'Il sito offre informazioni e statistiche di hockey su pista. L’accesso è gratuito; alcune funzioni possono richiedere un account o un abbonamento.' },
      { h: 'Fonti e indipendenza', p: 'I dati sportivi sono ottenuti da fonti pubbliche RFEP/sidgad e World Skate. Stick Live non è affiliata né rappresenta ufficialmente queste entità. Marchi, stemmi e fotografie appartengono ai rispettivi titolari.' },
      { h: 'Uso del sito', p: 'Non sono consentiti estrazione massiva dei contenuti, interferenze con il servizio, tentativi di accesso ad aree private o riutilizzo del database per un prodotto concorrente senza autorizzazione.' },
      { h: 'Proprietà intellettuale', p: 'Design, codice e testi propri di Stick Live sono protetti. Dati sportivi, stemmi e marchi di terzi restano dei rispettivi titolari. Citare un dato con un link a questo sito è benvenuto.' },
      { h: 'Responsabilità', p: 'Le informazioni sono fornite con ragionevole diligenza ma possono contenere errori o ritardi della fonte. Non garantiamo disponibilità continua né accuratezza assoluta. I link esterni sono riferimenti e non implicano approvazione.' },
      { h: 'Pubblicità e privacy', p: 'La versione gratuita può mostrare pubblicità Google AdSense. Il trattamento di dati e cookie è spiegato nell’informativa sulla privacy. Gli account premium non vedono annunci.' },
      { h: 'Legge applicabile', p: 'Queste note sono regolate dalla legge spagnola. Qualsiasi controversia sarà sottoposta ai tribunali competenti secondo la legge applicabile.' },
    ],
  },
};

export function trustDict(locale: string): TrustDict {
  return ({ es: ES, en: EN, pt: PT, fr: FR, it: IT } as Record<string, TrustDict>)[locale] ?? EN;
}

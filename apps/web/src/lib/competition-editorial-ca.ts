import type { CompetitionEditorial } from './competition-editorial';

/**
 * Versió en català dels textos editorials de competició. Mateixes dades i
 * fonts que la versió en castellà (`competition-editorial.ts`): si canvia
 * un fet allà, s'ha de canviar aquí.
 */
const FEP_SUPERCOPAS =
  'https://fep.es/noticias/olot-acogera-las-supercopas-de-espana-de-hockey-patines-masculina-y-femenina-2026-16838-14.htm';

const SEGUIR = {
  heading: 'Què seguir aquesta temporada',
  body: ['La classificació, el calendari, els resultats en directe i els golejadors de la temporada en curs són a les pestanyes d’aquesta competició.'],
};

const OLOT = [
  'Pavelló Municipal d’Esports d’Olot, Olot (Girona).',
  'Olot ja va acollir la Supercopa Masculina 2022, l’Europeu Femení Sènior 2023 i els Europeus Sub-17 del 2024. És una de les seus habituals de l’hoquei patins estatal.',
];

export const COMPETITION_EDITORIAL_CA: Record<string, CompetitionEditorial> = {
  'supercopa-de-espana-masculina': {
    title: 'Supercopa d’Espanya Masculina 2026: seu, format i equips',
    intro:
      'La Supercopa obre la temporada 2026/27 a Olot. És el primer títol estatal del curs i reuneix el campió de l’OK Lliga Masculina, el campió de la Copa del Rei i els següents millors classificats de la lliga.',
    sections: [
      { heading: 'On es juga', body: OLOT },
      { heading: 'Format i calendari', body: ['Semifinals el dissabte 24 d’octubre i final el diumenge 25. Es decideix a partit únic: dues semifinals i una final.'] },
      {
        heading: 'Equips participants',
        body: ['Igualada Rigat HC (campió de l’OK Lliga Masculina), HC Liceo (campió de la Copa del Rei), Barça i Calafell La Menorquina.'],
        bullets: ['Igualada Rigat HC i HC Liceo són els caps de sèrie.', 'La resta de places surten de la classificació de l’OK Lliga Masculina.'],
      },
      { heading: 'Què seguir', body: ['El calendari, els resultats i la classificació són a les pestanyes d’aquesta competició. La final es juga el diumenge 25 d’octubre.'] },
    ],
    source: { label: 'RFEP', url: FEP_SUPERCOPAS },
  },

  'supercopa-de-espana-femenina': {
    title: 'Supercopa d’Espanya Femenina 2026: seu, format i equips',
    intro:
      'La Supercopa Femenina es disputa amb la masculina a Olot i obre la temporada 2026/27. Reuneix la campiona de l’OK Lliga Iberdrola i els millors equips de la lliga en el primer títol del curs.',
    sections: [
      { heading: 'On es juga', body: OLOT },
      { heading: 'Format i calendari', body: ['Semifinals el divendres 23 d’octubre i final el diumenge 25. Es decideix a partit únic: dues semifinals i una final.'] },
      {
        heading: 'Equips participants',
        body: ['CP Vila-sana Coop d’Ivars (campió de l’OK Lliga Iberdrola), CP Esneca Fraga, Telecable Hockey Club i Generali HC Palau.'],
        bullets: ['CP Vila-sana Coop d’Ivars i CP Esneca Fraga són els caps de sèrie.', 'Telecable i Palau es classifiquen per la seva posició a l’OK Lliga Iberdrola.'],
      },
      { heading: 'Què seguir', body: ['El calendari, els resultats i la classificació són a les pestanyes d’aquesta competició. La final es juga el diumenge 25 d’octubre.'] },
    ],
    source: { label: 'RFEP', url: FEP_SUPERCOPAS },
  },

  'ok-liga-masculina': {
    title: 'OK Lliga Masculina: història, format i palmarès',
    intro:
      'L’OK Lliga Masculina és la primera divisió de l’hoquei patins espanyol i una de les lligues més fortes del món. Es disputa des del 1969, primer com a División de Honor i des del 2003 amb el nom actual.',
    sections: [
      {
        heading: 'Com es juga',
        body: ['Catorze equips la temporada 2026/27, a doble volta. Victòria 3 punts, empat 1 i derrota 0. Els millors classificats passen al play-off pel títol i els tres últims (12è, 13è i 14è) baixen a l’OK Lliga Plata.'],
      },
      {
        heading: 'Campió 2025/26: l’Igualada, 29 anys després',
        body: [
          'L’Igualada Rigat HC va guanyar la lliga 2025/26 al cinquè partit de la final, al Palacio de los Deportes de Riazor: 2-2 després de la pròrroga i 0-2 per a l’Igualada a la tanda de penals. Va remuntar un 2-0 en contra a la sèrie contra l’HC Liceo, després d’eliminar el Barça a semifinals.',
          'Era el seu sisè títol de lliga i el primer des del 1997.',
        ],
      },
      {
        heading: 'Palmarès',
        body: ['El Barça domina l’historial amb 35 lligues, entre elles vuit seguides del 2013/14 al 2020/21. El segueixen l’HC Liceo (8), l’Igualada (6), el Reus Deportiu (5), el CP Voltregà (2) i el CE Noia (1).'],
        bullets: ['2025/26: Igualada Rigat HC', '2024/25: Barça', '2023/24: Barça', '2022/23: Barça', '2021/22: HC Liceo'],
      },
      SEGUIR,
    ],
    source: { label: 'Wikipedia (OK Liga) i Diario de Santiago', url: 'https://en.wikipedia.org/wiki/OK_Liga' },
  },

  'ok-liga-femenina': {
    title: 'OK Lliga Iberdrola (femenina): història, format i palmarès',
    intro:
      'L’OK Lliga Iberdrola és la primera divisió de l’hoquei patins femení a Espanya. Es juga en format de lliga des de la temporada 2008/09 i reuneix bona part de les millors jugadores del món.',
    sections: [
      { heading: 'Com es juga', body: ['Fase regular a doble volta (24 jornades el 2025/26) i play-off pel títol, amb la final al millor de tres partits.'] },
      {
        heading: 'Campió 2025/26: primer títol del CP Vila-sana',
        body: ['El CP Vila-sana Coop. d’Ivars va guanyar la final 2-0 al CP Esneca Fraga en una final inèdita, entre dos clubs que mai no havien guanyat la lliga. Havia acabat la fase regular en primera posició, amb 22 victòries i 2 derrotes, i va completar el doblet amb la Copa de la Reina.'],
      },
      {
        heading: 'Palmarès',
        body: ['A l’etapa de lliga, el CP Voltregà, el CP Palau de Plegamans i el club de Gijón (Telecable Hockey Club, abans Gijón Solimar) sumen cinc títols cadascun. Palau i Gijón van guanyar totes les lligues entre el 2020/21 i el 2024/25, fins que el CP Vila-sana va trencar la ratxa el 2025/26.'],
        bullets: ['2025/26: CP Vila-sana', '2024/25: Telecable Gijón', '2023/24: CP Palau de Plegamans', '2022/23: Telecable Gijón', '2021/22: CP Palau de Plegamans'],
      },
      { ...SEGUIR, body: ['La classificació, el calendari, els resultats en directe i les golejadores de la temporada en curs són a les pestanyes d’aquesta competició.'] },
    ],
    source: { label: 'Wikipedia (OK Liga Femenina) i Infobae', url: 'https://en.wikipedia.org/wiki/OK_Liga_Femenina' },
  },

  'campeonato-placard-portugal': {
    title: 'Campeonato Placard (1a Divisió de Portugal): història, format i palmarès',
    intro:
      'El Campeonato Placard és la primera divisió de l’hoquei patins portuguès, una de les tres grans lligues del món amb l’espanyola i la italiana. Es disputa des de la temporada 1938/39 i el primer campió va ser l’Sporting CP.',
    sections: [
      { heading: 'Com es juga', body: ['Fase regular a doble volta i play-off pel títol entre els millors classificats.'] },
      {
        heading: 'Campió 2025/26: el Benfica, invicte',
        body: [
          'L’SL Benfica va guanyar la lliga 2025/26 sense perdre cap partit: quatre empats a la fase regular i vuit victòries de vuit al play-off. Va tancar la final contra l’Sporting CP amb un 3-1 al tercer partit.',
          'És el seu títol número 25 i el primer en tres anys, després del bicampionat del FC Porto.',
        ],
        bullets: ['2025/26: SL Benfica', '2024/25: FC Porto', '2023/24: FC Porto'],
      },
      SEGUIR,
    ],
    source: { label: 'FPP (Federação de Patinagem de Portugal)', url: 'https://fpp.pt/benfica-e-campeao-nacional-de-hoquei-em-patins/' },
  },

  'campeonato-nacional-feminino-portugal': {
    title: 'Campionat Nacional Femení de Portugal: format i palmarès',
    intro:
      'El Campeonato Nacional Feminino és la primera divisió de l’hoquei patins femení a Portugal. L’última dècada l’ha dominat l’SL Benfica, un dels grans clubs de l’hoquei femení mundial.',
    sections: [
      { heading: 'Com es juga', body: ['Fase regular i play-off pel títol, amb la final a doble partit.'] },
      {
        heading: 'Campió 2025/26: el Benfica, una altra vegada',
        body: ['L’SL Benfica va guanyar els dos partits de la final contra l’ACD Gulpilhares (7-0 i 4-3). És el seu tretzè títol consecutiu: el 2024/25 ja havia guanyat el dotzè seguit, contra el Turquel.'],
        bullets: ['2025/26: SL Benfica', '2024/25: SL Benfica'],
      },
      { ...SEGUIR, body: ['La classificació, el calendari, els resultats en directe i les golejadores de la temporada en curs són a les pestanyes d’aquesta competició.'] },
    ],
    source: { label: 'Federação de Patinagem de Portugal', url: 'https://www.hoqueipatins.pt/feminino/benfica-campeao-nacional-feminino-30-jun-2026/' },
  },

  'campionato-serie-a1': {
    title: 'Serie A1 d’Itàlia: història, format i palmarès',
    intro:
      'La Serie A1 és la primera divisió de l’hoquei patins italià. El campionat estatal es juga des del 1922, quan es va disputar la primera edició a Milà, i el Novara és el club amb més títols de la història, amb 32 scudetti.',
    sections: [
      {
        heading: 'Com es juga',
        body: ['Catorze equips a doble volta. Els deu primers juguen el play-off per l’scudetto, amb semifinals i final al millor de cinc partits. Els quatre últims disputen un play-out i els dos pitjors baixen a la Serie A2.'],
      },
      {
        heading: 'Campió 2025/26: el Trissino',
        body: ['L’Hockey Trissino va guanyar la final 3-1 al Bassano i va tancar el títol al quart partit, a la pista del rival. És el cinquè scudetto de la seva història i el quart de les últimes cinc temporades.'],
        bullets: ['2025/26: Hockey Trissino', '2024/25: Hockey Trissino', '2023/24: Forte dei Marmi', '2022/23: Hockey Trissino', '2021/22: Hockey Trissino'],
      },
      SEGUIR,
    ],
    source: { label: 'Wikipedia (Serie A1) i OA Sport', url: 'https://it.wikipedia.org/wiki/Serie_A1_(hockey_su_pista)' },
  },

  'ok-liga-plata-norte': {
    "title": "OK Lliga Plata Nord: format, ascens i descens",
    "intro": "L’OK Lliga Plata és la segona categoria de l’hoquei patins masculí a Espanya. Va néixer el 1969/70 com a Primera División i porta el nom actual des del 2018/19. Es divideix en dos grups territorials, Nord i Sud, i aquest és el grup Nord.",
    "sections": [
      {
        "heading": "Com es juga",
        "body": [
          "Catorze equips a doble volta, 26 jornades. No hi ha fase final ni es proclama un campió de l’OK Lliga Plata: el que es juga és l’ascens."
        ]
      },
      {
        "heading": "Què hi ha en joc",
        "body": [
          "El primer del grup Nord puja directament a l’OK Lliga. El segon juga una eliminatòria a doble partit contra el segon del grup Sud, i el guanyador també puja. Els dos últims baixen a l’OK Lliga Bronze (o a la seva lliga autonòmica, en el cas dels clubs catalans)."
        ]
      },
      {
        "heading": "Què seguir aquesta temporada",
        "body": [
          "La classificació del grup, el calendari, els resultats en directe i els golejadors són a les pestanyes d’aquesta competició."
        ]
      }
    ],
    "source": {
      "label": "RFEP · Bases de competició 2026/27",
      "url": "https://fmp.es/wp-content/uploads/2026/08/Bases-temp-2026-27-ok.pdf"
    }
  },
  'ok-liga-plata-sur': {
    "title": "OK Lliga Plata Sud: format, ascens i descens",
    "intro": "L’OK Lliga Plata és la segona categoria de l’hoquei patins masculí a Espanya. Va néixer el 1969/70 com a Primera División i porta el nom actual des del 2018/19. Es divideix en dos grups territorials, Nord i Sud, i aquest és el grup Sud.",
    "sections": [
      {
        "heading": "Com es juga",
        "body": [
          "Catorze equips a doble volta, 26 jornades. No hi ha fase final ni es proclama un campió de l’OK Lliga Plata: el que es juga és l’ascens."
        ]
      },
      {
        "heading": "Què hi ha en joc",
        "body": [
          "El primer del grup Sud puja directament a l’OK Lliga. El segon juga una eliminatòria a doble partit contra el segon del grup Nord, i el guanyador també puja. Els dos últims baixen a l’OK Lliga Bronze (o a la seva lliga autonòmica, en el cas dels clubs catalans)."
        ]
      },
      {
        "heading": "Què seguir aquesta temporada",
        "body": [
          "La classificació del grup, el calendari, els resultats en directe i els golejadors són a les pestanyes d’aquesta competició."
        ]
      }
    ],
    "source": {
      "label": "RFEP · Bases de competició 2026/27",
      "url": "https://fmp.es/wp-content/uploads/2026/08/Bases-temp-2026-27-ok.pdf"
    }
  },
  'ok-liga-bronce-masculina-norte': {
    "title": "OK Lliga Bronze Masculina Nord: format i ascens",
    "intro": "L’OK Lliga Bronze és la tercera categoria estatal de l’hoquei patins masculí. La va crear la RFEP el 2018 i es juga en dos grups territorials, Nord i Sud. Aquest és el grup Nord.",
    "sections": [
      {
        "heading": "Com es juga",
        "body": [
          "Lliga regular a cada grup. L’objectiu és l’ascens a l’OK Lliga Plata."
        ]
      },
      {
        "heading": "Què hi ha en joc",
        "body": [
          "El millor equip del grup Nord puja directament a l’OK Lliga Plata. El segon juga una eliminatòria a doble partit contra el segon del grup Sud, i el guanyador també puja. A més, puja un equip designat per la Federació Catalana de Patinatge."
        ]
      },
      {
        "heading": "Què seguir aquesta temporada",
        "body": [
          "La classificació del grup, el calendari, els resultats en directe i els golejadors són a les pestanyes d’aquesta competició."
        ]
      }
    ],
    "source": {
      "label": "RFEP · Bases de competició 2026/27",
      "url": "https://fmp.es/wp-content/uploads/2026/08/Bases-temp-2026-27-ok.pdf"
    }
  },
  'ok-liga-bronce-masculina-sur': {
    "title": "OK Lliga Bronze Masculina Sud: format i ascens",
    "intro": "L’OK Lliga Bronze és la tercera categoria estatal de l’hoquei patins masculí. La va crear la RFEP el 2018 i es juga en dos grups territorials, Nord i Sud. Aquest és el grup Sud.",
    "sections": [
      {
        "heading": "Com es juga",
        "body": [
          "Lliga regular a cada grup. L’objectiu és l’ascens a l’OK Lliga Plata."
        ]
      },
      {
        "heading": "Què hi ha en joc",
        "body": [
          "El millor equip del grup Sud puja directament a l’OK Lliga Plata. El segon juga una eliminatòria a doble partit contra el segon del grup Nord, i el guanyador també puja. A més, puja un equip designat per la Federació Catalana de Patinatge."
        ]
      },
      {
        "heading": "Què seguir aquesta temporada",
        "body": [
          "La classificació del grup, el calendari, els resultats en directe i els golejadors són a les pestanyes d’aquesta competició."
        ]
      }
    ],
    "source": {
      "label": "RFEP · Bases de competició 2026/27",
      "url": "https://fmp.es/wp-content/uploads/2026/08/Bases-temp-2026-27-ok.pdf"
    }
  },
  'ok-liga-plata-femenina': {
    "title": "OK Lliga Plata Femenina: format i ascens a l’OK Lliga Iberdrola",
    "intro": "L’OK Lliga Plata Femenina és la segona categoria de l’hoquei patins femení a Espanya. La RFEP en va aprovar la creació el juliol del 2020 i la primera temporada va començar el març del 2021, amb set equips.",
    "sections": [
      {
        "heading": "Com es juga",
        "body": [
          "Lliga a doble volta, tots contra tots."
        ]
      },
      {
        "heading": "Què hi ha en joc",
        "body": [
          "La campiona i la subcampiona pugen a l’OK Lliga Iberdrola, juntament amb un equip designat per la Federació Catalana de Patinatge."
        ]
      },
      {
        "heading": "Què seguir aquesta temporada",
        "body": [
          "La classificació, el calendari, els resultats en directe i les golejadores són a les pestanyes d’aquesta competició."
        ]
      }
    ],
    "source": {
      "label": "RFEP · Bases de competició 2026/27",
      "url": "https://fmp.es/wp-content/uploads/2026/08/Bases-temp-2026-27-ok.pdf"
    }
  },
};

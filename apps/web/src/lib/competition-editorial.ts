/**
 * Contenido editorial al final de la ficha de una competición.
 *
 * Solo para competiciones con información propia verificada. El texto se
 * renderiza server-side al final de la página y no sustituye a los datos
 * dinámicos (clasificación, calendario, actas): los complementa.
 */
export interface EditorialSection {
  heading: string;
  body: string[];
  bullets?: string[];
}

export interface CompetitionEditorial {
  title: string;
  intro: string;
  sections: EditorialSection[];
  source?: { label: string; url: string };
}

type EditorialByLocale = Partial<Record<'es' | 'en', CompetitionEditorial>>;

const FEP_SUPERCOPAS =
  'https://fep.es/noticias/olot-acogera-las-supercopas-de-espana-de-hockey-patines-masculina-y-femenina-2026-16838-14.htm';

export const COMPETITION_EDITORIAL: Record<string, EditorialByLocale> = {
  'supercopa-de-espana-masculina': {
    es: {
      title: 'Supercopa de España Masculina 2026: sede, formato y equipos',
      intro:
        'La Supercopa abre la temporada 2026/27 en Olot. Es el primer título nacional del curso y reúne al campeón de la OK Liga Masculina, al campeón de la Copa de SM El Rey y a los siguientes mejores clasificados de la liga.',
      sections: [
        {
          heading: 'Dónde se juega',
          body: [
            'Pavelló Municipal d’Esports d’Olot, Olot (Girona).',
            'Olot ya acogió la Supercopa Masculina 2022, el Europeo Femenino Sénior 2023 y los Europeos Sub-17 de 2024. Es una de las sedes habituales del hockey patines nacional.',
          ],
        },
        {
          heading: 'Formato y calendario',
          body: [
            'Semifinales el sábado 24 de octubre y final el domingo 25. Se decide a partido único: dos semifinales y una final.',
          ],
        },
        {
          heading: 'Equipos participantes',
          body: [
            'Igualada Rigat HC (campeón de la OK Liga Masculina), HC Liceo (campeón de la Copa de SM El Rey), Barça y Calafell La Menorquina.',
          ],
          bullets: [
            'Igualada Rigat HC y HC Liceo parten como cabezas de serie.',
            'El resto de plazas salen de la clasificación de la OK Liga Masculina.',
          ],
        },
        {
          heading: 'Qué seguir',
          body: [
            'El calendario, los resultados y la clasificación están en las pestañas de esta competición. La final se juega el domingo 25 de octubre.',
          ],
        },
      ],
      source: { label: 'RFEP', url: FEP_SUPERCOPAS },
    },
    en: {
      title: '2026 Men’s Spanish Super Cup: venue, format and teams',
      intro:
        'The Super Cup opens the 2026/27 season in Olot. It is the first national title of the season and brings together the OK Liga Masculina champion, the Copa de SM El Rey winner and the next best teams in the league.',
      sections: [
        {
          heading: 'Where it is played',
          body: [
            'Pavelló Municipal d’Esports d’Olot, Olot (Girona).',
            'Olot has previously hosted the 2022 Men’s Super Cup, the 2023 Women’s Senior European Championship and the 2024 U17 European Championships.',
          ],
        },
        {
          heading: 'Format and schedule',
          body: ['Semi-finals on Saturday 24 October and the final on Sunday 25. Single-elimination: two semi-finals and one final.'],
        },
        {
          heading: 'Teams',
          body: [
            'Igualada Rigat HC (OK Liga Masculina champion), HC Liceo (Copa de SM El Rey winner), Barça and Calafell La Menorquina.',
          ],
          bullets: [
            'Igualada Rigat HC and HC Liceo are the top seeds.',
            'The remaining places come from the OK Liga Masculina standings.',
          ],
        },
        {
          heading: 'What to follow',
          body: ['Fixtures, results and standings are in this competition’s tabs. The final is played on Sunday 25 October.'],
        },
      ],
      source: { label: 'RFEP', url: FEP_SUPERCOPAS },
    },
  },

  'supercopa-de-espana-femenina': {
    es: {
      title: 'Supercopa de España Femenina 2026: sede, formato y equipos',
      intro:
        'La Supercopa Femenina se disputa junto a la masculina en Olot y abre la temporada 2026/27. Reúne a la campeona de la OK Liga Iberdrola y a los mejores equipos de la liga en el primer título del curso.',
      sections: [
        {
          heading: 'Dónde se juega',
          body: [
            'Pavelló Municipal d’Esports d’Olot, Olot (Girona).',
            'Olot ya acogió la Supercopa Masculina 2022, el Europeo Femenino Sénior 2023 y los Europeos Sub-17 de 2024. Es una de las sedes habituales del hockey patines nacional.',
          ],
        },
        {
          heading: 'Formato y calendario',
          body: [
            'Semifinales el viernes 23 de octubre y final el domingo 25. Se decide a partido único: dos semifinales y una final.',
          ],
        },
        {
          heading: 'Equipos participantes',
          body: [
            'CP Vila-sana Coop d’Ivars (campeón de la OK Liga Iberdrola), CP Esneca Fraga, Telecable Hockey Club y Generali HC Palau.',
          ],
          bullets: [
            'CP Vila-sana Coop d’Ivars y CP Esneca Fraga parten como cabezas de serie.',
            'Telecable y Palau se clasifican por su posición en la OK Liga Iberdrola.',
          ],
        },
        {
          heading: 'Qué seguir',
          body: [
            'El calendario, los resultados y la clasificación están en las pestañas de esta competición. La final se juega el domingo 25 de octubre.',
          ],
        },
      ],
      source: { label: 'RFEP', url: FEP_SUPERCOPAS },
    },
    en: {
      title: '2026 Women’s Spanish Super Cup: venue, format and teams',
      intro:
        'The Women’s Super Cup is played alongside the men’s tournament in Olot and opens the 2026/27 season. It brings together the OK Liga Iberdrola champion and the best teams in the league for the first title of the season.',
      sections: [
        {
          heading: 'Where it is played',
          body: [
            'Pavelló Municipal d’Esports d’Olot, Olot (Girona).',
            'Olot has previously hosted the 2022 Men’s Super Cup, the 2023 Women’s Senior European Championship and the 2024 U17 European Championships.',
          ],
        },
        {
          heading: 'Format and schedule',
          body: ['Semi-finals on Friday 23 October and the final on Sunday 25. Single-elimination: two semi-finals and one final.'],
        },
        {
          heading: 'Teams',
          body: [
            'CP Vila-sana Coop d’Ivars (OK Liga Iberdrola champion), CP Esneca Fraga, Telecable Hockey Club and Generali HC Palau.',
          ],
          bullets: [
            'CP Vila-sana Coop d’Ivars and CP Esneca Fraga are the top seeds.',
            'Telecable and Palau qualified through their OK Liga Iberdrola position.',
          ],
        },
        {
          heading: 'What to follow',
          body: ['Fixtures, results and standings are in this competition’s tabs. The final is played on Sunday 25 October.'],
        },
      ],
      source: { label: 'RFEP', url: FEP_SUPERCOPAS },
    },
  },

  // ── Ligas principales (contenido perenne: historia, palmarés, última edición) ──
  'ok-liga-masculina': {
    es: {
      title: 'OK Liga Masculina: historia, formato y palmarés',
      intro:
        'La OK Liga Masculina es la primera división del hockey patines español y una de las ligas más fuertes del mundo. Se disputa desde 1969, primero como División de Honor y desde 2003 con su nombre actual.',
      sections: [
        {
          heading: 'Cómo se juega',
          body: [
            'Dieciséis equipos se enfrentan a doble vuelta en una fase regular de 30 jornadas. Victoria 3 puntos, empate 1 y derrota 0. Los mejores clasificados pasan al play-off por el título y los últimos descienden a OK Liga Plata.',
          ],
        },
        {
          heading: 'Campeón 2025/26: el Igualada, 29 años después',
          body: [
            'El Igualada Rigat HC ganó la liga 2025/26 en el quinto partido de la final, en el Palacio de los Deportes de Riazor: 2-2 tras la prórroga y 0-2 para el Igualada en la tanda de penaltis. Remontó un 2-0 en contra en la serie ante el HC Liceo, después de eliminar al Barça en semifinales.',
            'Era su sexto título de liga y el primero desde 1997.',
          ],
        },
        {
          heading: 'Palmarés',
          body: [
            'El Barça domina el historial con 35 ligas, entre ellas ocho seguidas de 2013/14 a 2020/21. Le siguen el HC Liceo (8), el Igualada (6), el Reus Deportiu (5), el CP Voltregà (2) y el CE Noia (1).',
          ],
          bullets: [
            '2025/26: Igualada Rigat HC',
            '2024/25: Barça',
            '2023/24: Barça',
            '2022/23: Barça',
            '2021/22: HC Liceo',
          ],
        },
        {
          heading: 'Qué seguir esta temporada',
          body: [
            'La clasificación, el calendario, los resultados en directo y los goleadores de la temporada en curso están en las pestañas de esta competición.',
          ],
        },
      ],
      source: { label: 'Wikipedia (OK Liga) y Diario de Santiago', url: 'https://en.wikipedia.org/wiki/OK_Liga' },
    },
    en: {
      title: 'OK Liga Masculina: history, format and champions',
      intro:
        'The OK Liga Masculina is the top division of Spanish rink hockey and one of the strongest leagues in the world. It has been played since 1969, first as the División de Honor and under its current name since 2003.',
      sections: [
        {
          heading: 'Format',
          body: [
            'Sixteen teams play each other home and away over a 30-round regular season. A win is worth 3 points, a draw 1 and a defeat 0. The top teams go through to the title play-offs and the bottom teams are relegated to OK Liga Plata.',
          ],
        },
        {
          heading: '2025/26 champions: Igualada, 29 years later',
          body: [
            'Igualada Rigat HC won the 2025/26 title in game five of the final at the Palacio de los Deportes de Riazor: 2-2 after extra time and 0-2 to Igualada in the shoot-out. They came back from 2-0 down in the series against HC Liceo, after knocking out Barça in the semi-finals.',
            'It was their sixth league title and their first since 1997.',
          ],
        },
        {
          heading: 'Roll of honour',
          body: [
            'Barça lead the all-time list with 35 titles, including eight in a row from 2013/14 to 2020/21. They are followed by HC Liceo (8), Igualada (6), Reus Deportiu (5), CP Voltregà (2) and CE Noia (1).',
          ],
          bullets: [
            '2025/26: Igualada Rigat HC',
            '2024/25: Barça',
            '2023/24: Barça',
            '2022/23: Barça',
            '2021/22: HC Liceo',
          ],
        },
        {
          heading: 'What to follow this season',
          body: ['Standings, fixtures, live results and top scorers for the current season are in this competition’s tabs.'],
        },
      ],
      source: { label: 'Wikipedia (OK Liga) and Diario de Santiago', url: 'https://en.wikipedia.org/wiki/OK_Liga' },
    },
  },

  'ok-liga-femenina': {
    es: {
      title: 'OK Liga Iberdrola (femenina): historia, formato y palmarés',
      intro:
        'La OK Liga Iberdrola es la primera división del hockey patines femenino en España. Se juega en formato de liga desde la temporada 2008/09 y reúne a buena parte de las mejores jugadoras del mundo.',
      sections: [
        {
          heading: 'Cómo se juega',
          body: [
            'Fase regular a doble vuelta (24 jornadas en 2025/26) y play-off por el título, con la final al mejor de tres partidos.',
          ],
        },
        {
          heading: 'Campeón 2025/26: primer título del CP Vila-sana',
          body: [
            'El CP Vila-sana Coop. d’Ivars ganó la final 2-0 al CP Esneca Fraga en una final inédita, con dos clubes que nunca habían ganado la liga. Había terminado la fase regular en primera posición, con 22 victorias y 2 derrotas, y completó el doblete con la Copa de la Reina.',
          ],
        },
        {
          heading: 'Palmarés',
          body: [
            'En la etapa de liga, CP Voltregà, CP Palau de Plegamans y el club de Gijón (Telecable Hockey Club, antes Gijón Solimar) suman cinco títulos cada uno. Palau y Gijón ganaron todas las ligas entre 2020/21 y 2024/25, hasta que el CP Vila-sana rompió esa racha en 2025/26.',
          ],
          bullets: [
            '2025/26: CP Vila-sana',
            '2024/25: Telecable Gijón',
            '2023/24: CP Palau de Plegamans',
            '2022/23: Telecable Gijón',
            '2021/22: CP Palau de Plegamans',
          ],
        },
        {
          heading: 'Qué seguir esta temporada',
          body: [
            'La clasificación, el calendario, los resultados en directo y las goleadoras de la temporada en curso están en las pestañas de esta competición.',
          ],
        },
      ],
      source: { label: 'Wikipedia (OK Liga Femenina) e Infobae', url: 'https://en.wikipedia.org/wiki/OK_Liga_Femenina' },
    },
    en: {
      title: 'OK Liga Iberdrola (women): history, format and champions',
      intro:
        'The OK Liga Iberdrola is the top division of women’s rink hockey in Spain. It has been played as a league since 2008/09 and brings together many of the best players in the world.',
      sections: [
        {
          heading: 'Format',
          body: [
            'A home-and-away regular season (24 rounds in 2025/26) followed by title play-offs, with a best-of-three final.',
          ],
        },
        {
          heading: '2025/26 champions: a first title for CP Vila-sana',
          body: [
            'CP Vila-sana Coop. d’Ivars beat CP Esneca Fraga 2-0 in an unprecedented final between two clubs that had never won the league. They had topped the regular season with 22 wins and 2 defeats, and completed the double with the Copa de la Reina.',
          ],
        },
        {
          heading: 'Roll of honour',
          body: [
            'In the league era, CP Voltregà, CP Palau de Plegamans and the Gijón club (Telecable Hockey Club, formerly Gijón Solimar) have five titles each. Palau and Gijón won every title between 2020/21 and 2024/25, until CP Vila-sana broke the streak in 2025/26.',
          ],
          bullets: [
            '2025/26: CP Vila-sana',
            '2024/25: Telecable Gijón',
            '2023/24: CP Palau de Plegamans',
            '2022/23: Telecable Gijón',
            '2021/22: CP Palau de Plegamans',
          ],
        },
        {
          heading: 'What to follow this season',
          body: ['Standings, fixtures, live results and top scorers for the current season are in this competition’s tabs.'],
        },
      ],
      source: { label: 'Wikipedia (OK Liga Femenina) and Infobae', url: 'https://en.wikipedia.org/wiki/OK_Liga_Femenina' },
    },
  },
};

export function competitionEditorial(slug: string | null | undefined, locale: string): CompetitionEditorial | null {
  if (!slug) return null;
  const entry = COMPETITION_EDITORIAL[slug];
  if (!entry) return null;
  return entry[locale === 'en' ? 'en' : 'es'] ?? entry.es ?? null;
}

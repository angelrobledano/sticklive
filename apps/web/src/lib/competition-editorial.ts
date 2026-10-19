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
};

export function competitionEditorial(slug: string | null | undefined, locale: string): CompetitionEditorial | null {
  if (!slug) return null;
  const entry = COMPETITION_EDITORIAL[slug];
  if (!entry) return null;
  return entry[locale === 'en' ? 'en' : 'es'] ?? entry.es ?? null;
}

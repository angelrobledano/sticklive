/**
 * Historia y palmarés de los equipos de OK Liga Masculina 2026/27.
 *
 * Contenido **editorial**: se escribe una vez, se revisa y se guarda; no se
 * genera en cada petición. Sirve para dar a las fichas de equipo contenido
 * propio y verificable (ver `docs/AUDITORIA_SEO_2026-10-16.md`, §8).
 *
 * Reglas de este fichero:
 * - Solo hechos con fuente (Wikidata CC0, artículo de Wikipedia como hechos —
 *   nunca su texto — y webs oficiales de los clubes).
 * - Si un club no tiene títulos conocidos, `honours` va vacío: no se rellena.
 * - Los equipos se indexan por `teamId` porque el nombre de la competición
 *   incluye el patrocinador y cambia cada temporada.
 */

export interface TeamHistory {
  /** Historia del club, 2-3 frases. */
  history: string;
  /** Palmarés en líneas cortas. Vacío si el club no tiene títulos conocidos. */
  honours: string[];
  /** Fuentes consultadas para los datos de esta ficha. */
  sources: string[];
  /** Última revisión del texto (YYYY-MM-DD). */
  updatedAt: string;
}

const UPDATED = '2026-10-17';

const WIKIDATA = 'Wikidata';

export const TEAM_HISTORIES: Readonly<Record<string, TeamHistory>> = {
  // AMETLLER ORIGEN CP VILAFRANCA
  'd6c282b2-1da8-4f0d-a3c1-89ab096a2291': {
    history:
      'El Club Patí Vilafranca se fundó en 1970 en Vilafranca del Penedès (Alt Penedès) y compite en la OK Liga Masculina.',
    honours: [],
    sources: [`${WIKIDATA} Q10991231`, 'cpvilafranca.cat'],
    updatedAt: UPDATED,
  },

  // PONS LLEIDA
  '854b18b2-f311-47e4-9a62-88086427b101': {
    history:
      'El Club Esportiu Lleida Llista Blava se fundó en 1951 en Lleida. Su mayor reconocimiento ha llegado en el hockey europeo, con cuatro Copas CERS en la última década.',
    honours: ['4 Copas CERS: 2017-18, 2018-19, 2020-21 y 2025-26'],
    sources: [`${WIKIDATA} Q11051224`, 'Wikipedia (es): Club Esportiu Lleida Llista Blava'],
    updatedAt: UPDATED,
  },

  // CALAFELL LA MENORQUINA
  '18452f1b-b8d2-4eae-8f3c-b0df1e03e94b': {
    history:
      'El Club Patí Calafell se fundó en 1952 en Calafell (Baix Penedès) y disputa la OK Liga Masculina.',
    honours: [],
    sources: [`${WIKIDATA} Q14517078`, 'cpcalafell.cat'],
    updatedAt: UPDATED,
  },

  // SHUM FRIT RAVICH (Secció Hoquei Unió Maçanetenca)
  '6e1d84a4-57e0-4543-8ccb-c11832ba9df7': {
    history:
      'El hockey sobre patines llegó a Maçanet de la Selva en 1949, cuando la Societat Recreativa Unió Maçanetenca —fundada en 1915— inauguró la Pista Jardí. El SHUM ha disputado 18 temporadas en la OK Liga entre 1988/89 y 2015/16.',
    honours: [
      '18 temporadas en OK Liga (1988/89–2015/16)',
      '8 ascensos a OK Liga',
      '4 títulos de Primera División',
      '2 Copas del Príncipe',
      '2 Copas del Rey (cuartos de final en 2005/06 y 2011/12)',
      '1 participación en la Copa CERS (2012/13)',
    ],
    sources: ['shummassanet.com (Història y Palmarés)'],
    updatedAt: UPDATED,
  },

  // BARÇA
  'f67b2d80-127d-41cc-a7f8-f5b4dd821621': {
    history:
      'El FC Barcelona compite en la OK Liga Masculina con su sección de hoquei patines, una de las más laureadas del hockey sobre patines europeo.',
    honours: [],
    sources: ['fcbarcelona.es (sección de hoquei patines)'],
    updatedAt: UPDATED,
  },

  // IGUALADA RIGAT HC
  '2040ff0e-80e8-4bce-8105-528fa3c1216d': {
    history:
      'El Igualada Hoquei Club se fundó en 1950 en Igualada (Anoia) y fue uno de los grandes dominadores del hockey español y europeo de los años noventa; en 2026 volvió a ganar la OK Liga.',
    honours: [
      '6 OK Liga (última: 2025-26)',
      '2 Copas del Rey',
      '6 Copas de Europa',
      '2 Copas WS Europe',
      '3 Supercopas de Europa',
      '2 Copas Continentales',
      '4 Ligas Catalanas',
    ],
    sources: [`${WIKIDATA} Q3111432`, 'Wikipedia (es): Igualada Hoquei Club'],
    updatedAt: UPDATED,
  },

  // CH LLORET VILA ESPORTIVA
  '55fa8984-c1e9-43d6-995c-2d4acd057314': {
    history:
      'El Club Hoquei Lloret se fundó en 1969 en Lloret de Mar (La Selva) y juega en el Pavelló Municipal d’Esports. En 2026/27 compite en la OK Liga tras lograr el ascenso.',
    honours: [],
    sources: [`${WIKIDATA} Q12384800`, 'hoqueilloret.org'],
    updatedAt: UPDATED,
  },

  // REUS DEPORTIU BRASILIA
  '536b6256-6c34-47c5-814d-72aea7dbcecf': {
    history:
      'El Reus Deportiu se fundó en 1909 y es uno de los clubes históricos del hockey sobre patines español. Ganó su última OK Liga en 2010-11 y su última Copa del Rey en 2025.',
    honours: [
      '8 Ligas (5 de División de Honor/OK Liga: 1969-70, 1970-71, 1971-72, 1972-73 y 2010-11)',
      '8 Copas del Rey (última: 2025)',
      '3 Supercopas de España',
      '2 Copas de Europa',
    ],
    sources: [`${WIKIDATA} Q194884`, 'Wikipedia (es): Reus Deportiu'],
    updatedAt: UPDATED,
  },

  // CP VOLTREGA MOVENTO STERN
  'baa49b9a-2807-4d8f-965f-a6b0f4cb7f3e': {
    history:
      'El Club Patí Voltregà se fundó en 1955 en Sant Hipòlit de Voltregà (Osona). Es uno de los pocos clubes con títulos europeos tanto en categoría masculina como femenina.',
    honours: [
      'Masculino: 3 OK Liga, 5 Copas del Rey, 3 Copas de Europa y 2 Copas CERS',
      'Femenino: 6 Copas de Europa y 7 Ligas Catalanas',
    ],
    sources: [`${WIKIDATA} Q2979970`, 'Wikipedia (es): Club Patí Voltregà'],
    updatedAt: UPDATED,
  },

  // AITEX PAS ALCOI
  'f68a190b-8bd5-4b74-9726-6b6f85406942': {
    history:
      'El club se fundó en 1951 como Patín Club de Alcoy; en 1955 pasó a llamarse Patín Alcodiam Club y en abril de 1965, tras unirse al Atlético Salesiano, adoptó el nombre de Patín Alcodiam Salesiano. En 1960 fue subcampeón de España de Segunda División.',
    honours: ['Subcampeón de España de Segunda División (1960)'],
    sources: ['patinalcodiamsalesiano.com (El Club)'],
    updatedAt: UPDATED,
  },

  // CE NOIA FREIXENET
  '34a37372-b4e2-4f40-8b53-cf26d519e29b': {
    history:
      'El Club Esportiu Noia se fundó en 1951 en Sant Sadurní d’Anoia (Alt Penedès) y en 2026 celebró su 75.º aniversario.',
    honours: [],
    sources: ['cenoia.com (El Club)'],
    updatedAt: UPDATED,
  },

  // ADISS HOCKEY RIVAS
  '72171ec7-06e7-4f5b-b158-9436ebce98d8': {
    history:
      'El Hockey Rivas nació el 7 de febrero de 2001 en Rivas-Vaciamadrid y en 2026/27 compite en la OK Liga Masculina.',
    honours: [],
    sources: ['Comunicación del club (20.º aniversario, 7-feb-2001)'],
    updatedAt: UPDATED,
  },

  // CH CALDES RECAM LÀSER
  '95e1119d-0939-4c2b-a014-f7566e28d69a': {
    history:
      'El Club Hoquei Caldes se fundó en 1961 y juega en el Pavelló Torre Roja, en Caldes de Montbui (Vallès Oriental).',
    honours: [],
    sources: ['clubhoqueicaldes.com (Dades del Club)'],
    updatedAt: UPDATED,
  },

  // HOCKEY CLUB LICEO
  'ccc49524-8422-4e3e-883c-c0067cec913c': {
    history:
      'El Hockey Club Liceo se fundó en 1972 en A Coruña y es uno de los clubes más laureados del hockey sobre patines. Ganó su última OK Liga en 2021-22.',
    honours: ['8 OK Liga (última: 2021-22)', '11 Copas del Rey', '6 Copas de Europa'],
    sources: [`${WIKIDATA} Q3138995`, 'Wikipedia (es): Hockey Club Liceo'],
    updatedAt: UPDATED,
  },
};

/** Historia del equipo por `teamId`, o `null` si no hay texto para esa ficha. */
export function teamHistory(teamId: string): TeamHistory | null {
  return TEAM_HISTORIES[teamId] ?? null;
}

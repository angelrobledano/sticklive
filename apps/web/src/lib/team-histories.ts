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

const UPDATED = '2026-10-18';

const WIKIDATA = 'Wikidata';

export const TEAM_HISTORIES: Readonly<Record<string, TeamHistory>> = {
  // AMETLLER ORIGEN CP VILAFRANCA
  'd6c282b2-1da8-4f0d-a3c1-89ab096a2291': {
    history:
      'El Club Patí Vilafranca, fundado en 1970, es la referencia del hockey sobre patines en Vilafranca del Penedès (Alt Penedès) y compite en la OK Liga Masculina. El club ha crecido desde unos inicios humildes hasta consolidarse como una entidad deportiva de proyección en Cataluña.',
    honours: [],
    sources: [`${WIKIDATA} Q10991231`, 'cpvilafranca.cat (Historia del club)'],
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
      'El Club Patí Calafell se fundó en 1952 en Calafell (Baix Penedès) y disputa la OK Liga Masculina. En la última década ha ganado la World Skate Europe Cup y varias Ligas Catalanas.',
    honours: [
      '1 World Skate Europe Cup (2021-22)',
      '3 Ligas Catalanas (2022-23, 2024-25 y 2025-26)',
      '1 Liga Nacional Catalana (2008-09)',
      '1 Copa del Príncipe (2009-10)',
      '1 Liga de Primera División (2017-18)',
      '1 Copa SAR Princesa de Asturias (2017-18)',
    ],
    sources: [`${WIKIDATA} Q14517078`, 'Wikipedia (es): Club Patí Calafell'],
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
    honours: ['52 títulos internacionales, entre ellos 22 Copas de Europa y 7 Copas Intercontinentales'],
    sources: ['Wikipedia (es): Fútbol Club Barcelona (hockey sobre patines)', 'fcbarcelona.es (sección de hoquei patines)'],
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
      'El Club Esportiu Noia se fundó en 1951 en Sant Sadurní d’Anoia (Alt Penedès) y en 2026 celebró su 75.º aniversario. Su mejor época llegó a finales de los ochenta, con la Liga y la Copa de Europa.',
    honours: [
      '1 OK Liga (1987-88)',
      '1 Copa de Europa (1988-89)',
      '1 Recopa de Europa (1987-88)',
      '2 Copas Continentales (1988-89 y 2014-15)',
      '2 Copas de la CERS (1997-98 y 2013-14)',
      '2 Copas del Rey (1998 y 2008)',
      '2 Ligas Catalanas (1989-90 y 2023-24)',
      '1 Copa Federación (2001-02)',
    ],
    sources: ['Wikipedia (es): Club Esportiu Noia', 'cenoia.com (El Club)'],
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

  // ─── OK Liga Femenina 2026/27 ───────────────────────────────────────────────

  // CH MATARÓ
  '4db4f4ca-8ed5-42d6-90e8-86f0f23e1680': {
    history:
      'El Club Hoquei Mataró se fundó en 1951 en Mataró (Maresme) y en 2026/27 compite en la OK Liga Femenina.',
    honours: [
      '1 Copa de la CERS (2008-09)',
      '1 OK Liga Plata (2019-20)',
      '1 Copa del Generalísimo (1967)',
      '1 Liga Nacional (1967-68)',
      '1 Campeonato de Cataluña (1968-69)',
    ],
    sources: [`${WIKIDATA} Q11914262`, 'Wikipedia (es): Club Hoquei Mataró'],
    updatedAt: UPDATED,
  },

  // ORKLA BIGUES I RIELLS
  '682e11af-a000-45bf-952e-2655a0f95101': {
    history: 'El Club Hoquei Bigues i Riells (Vallès Oriental) compite en la OK Liga Femenina 2026/27.',
    honours: [],
    sources: ['Competición 2026/27'],
    updatedAt: UPDATED,
  },

  // CLUB PATIN ESNECA FRAGA
  '15cea8ef-243b-40f6-8b52-dcbdac6d22e4': {
    history:
      'El Club Patín Fraga se fundó en 2021 y se ha convertido en pocos años en uno de los referentes del hockey femenino: ganó la Champions League Women en 2024 y repitió en 2026.',
    honours: [
      '2 WSE Champions League Women (2024 y 2026)',
      '1 Supercopa de España femenina (2025)',
      '1 OK Liga Plata Femenina (2022)',
    ],
    sources: [`${WIKIDATA} Q112749867`, 'Wikipedia (es): Club Patín Fraga'],
    updatedAt: UPDATED,
  },

  // HC RAXOI
  '84bb0f3c-5af9-48ef-adfa-5eb79c3657bb': {
    history: 'El HC Raxoi, con sede en Santiago de Compostela, compite en la OK Liga Femenina 2026/27.',
    honours: [],
    sources: ['Competición 2026/27'],
    updatedAt: UPDATED,
  },

  // OXIGEN PHC SANT CUGAT
  'e7d5e3f2-4248-4f77-97bf-8311d91a3aa9': {
    history: 'El Patí Hoquei Club Sant Cugat (Vallès Occidental) compite en la OK Liga Femenina 2026/27.',
    honours: [],
    sources: [`${WIKIDATA} Q3353248`, 'Competición 2026/27'],
    updatedAt: UPDATED,
  },

  // LLEIDANET HC ALPICAT
  '0efd3269-740d-496c-a6a3-e422b6c4126d': {
    history:
      'El Hoquei Club Alpicat se fundó en 2004 en Alpicat (Segrià) y ha ido escalando categorías hasta la OK Liga Femenina.',
    honours: [
      '1 Copa Generalitat (2015-16)',
      '1 Liga Nacional Catalana y ascenso a Primera Nacional (2015-16)',
    ],
    sources: [`${WIKIDATA} Q56400557`, 'Wikipedia (es): Hoquei Club Alpicat'],
    updatedAt: UPDATED,
  },

  // GENERALI HC PALAU
  'ce57e2dd-45e7-4012-9b72-8989254881f7': {
    history:
      'El Hoquei Club Palau de Plegamans se fundó en 1975 en Palau-solità i Plegamans (Vallès Occidental) y es uno de los grandes del hockey femenino español, con cinco ligas y tres Copas de Europa.',
    honours: [
      '5 Ligas (2014-15, 2018-19, 2020-21, 2021-22 y 2023-24)',
      '1 Copa de la Reina (2024)',
      '3 Copas de Europa (2020-21, 2021-22 y 2024-25)',
      '1 Supercopa de España (2021-22)',
      '2 Lligues Nacionals Catalanes (2010-11 y 2023-24)',
    ],
    sources: [`${WIKIDATA} Q11926045`, 'Wikipedia (es): Hoquei Club Palau de Plegamans (femenino)'],
    updatedAt: UPDATED,
  },

  // BEMBIBRE HOCKEY CLUB
  '05c0c636-b089-4c08-9cb8-c5a564afc6c5': {
    history:
      'El Bembibre Hockey Club se fundó en 2022 en Bembibre (El Bierzo) y compite en la OK Liga Femenina 2026/27.',
    honours: [],
    sources: [`${WIKIDATA} Q122984652`, 'Wikipedia (es): Bembibre Hockey Club'],
    updatedAt: UPDATED,
  },

  // CATA CP VOLTREGA (equipo femenino del mismo club que la masculina)
  '04228c8f-2c8c-448c-905b-8a86331aaf62': {
    history:
      'El Club Patí Voltregà se fundó en 1955 en Sant Hipòlit de Voltregà (Osona). Su equipo femenino es una referencia europea: suma seis Copas de Europa.',
    honours: [
      'Femenino: 6 Copas de Europa y 7 Ligas Catalanas',
      'Masculino: 3 OK Liga, 5 Copas del Rey, 3 Copas de Europa y 2 Copas CERS',
    ],
    sources: [`${WIKIDATA} Q2979970`, 'Wikipedia (es): Club Patí Voltregà'],
    updatedAt: UPDATED,
  },

  // CP VILA-SANA COOP D'IVARS
  '0f6b9d7b-da34-4fa4-9f04-7ee2162600a3': {
    history:
      'El Club Patí Vila-sana se fundó en 2003 en Vila-sana (Pla d’Urgell) y compite en la OK Liga Femenina.',
    honours: [],
    sources: [`${WIKIDATA} Q109417535`, 'Competición 2026/27'],
    updatedAt: UPDATED,
  },

  // MARINEDA HOCKEY
  '17081947-d783-46a2-a1dc-81172cab3776': {
    history: 'El Marineda Hockey, con sede en A Coruña, compite en la OK Liga Femenina 2026/27.',
    honours: [],
    sources: ['Competición 2026/27'],
    updatedAt: UPDATED,
  },

  // CERDANYOLA CLUB D'HOQUEI
  '66eec095-0739-4c1e-99af-e690baf37865': {
    history:
      'El Cerdanyola Club d’Hoquei se fundó en 1936 en Cerdanyola del Vallès (Vallès Occidental) y es uno de los clubes con más historia del hockey catalán.',
    honours: [
      '1 Liga Primera Catalana (2012-13)',
      '1 Copa de la Lliga Primera Catalana (2013)',
      '1 Campeonato de Cataluña de 2.ª categoría (1937)',
      '1 Campeonato de Cataluña (1945)',
      '3 Copas de Cataluña (1979, 1980 y 1981)',
    ],
    sources: [`${WIKIDATA} Q5064041`, 'Wikipedia (es): CH Cerdanyola'],
    updatedAt: UPDATED,
  },

  // TELECABLE HOCKEY CLUB = CP Gijón Solimar
  'fc81ea84-d0df-4119-ac0d-6dbbc3574e04': {
    history:
      'El Club Patín Gijón Solimar se fundó en 1995 y compite como Telecable Hockey Club. Es uno de los clubes de referencia del hockey femenino español.',
    honours: [
      '4 OK Liga (2009, 2017, 2018 y 2023)',
      '5 Copas de la Reina (2012, 2013, 2016, 2019 y 2023)',
    ],
    sources: [`${WIKIDATA} Q4887440`, 'Wikipedia (es): Club Patín Gijón Solimar'],
    updatedAt: UPDATED,
  },

  // MARTINELIA MANLLEU
  'e786b5d7-2f86-41f7-bc5c-37c688119ee3': {
    history:
      'El Club Patí Manlleu se fundó en 1973 en Manlleu (Osona) y compite como Martinelia Manlleu. Su equipo femenino ganó la OK Liga en 2019/20.',
    honours: ['1 OK Liga Femenina (2019/20)', '3 Copas de la Reina (2015, 2021 y 2022)'],
    sources: [`${WIKIDATA} Q30640419`, 'Wikipedia (es): Club Patí Manlleu'],
    updatedAt: UPDATED,
  },
};

/** Historia del equipo por `teamId`, o `null` si no hay texto para esa ficha. */
export function teamHistory(teamId: string): TeamHistory | null {
  return TEAM_HISTORIES[teamId] ?? null;
}

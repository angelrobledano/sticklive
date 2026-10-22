/**
 * Catálogo de competiciones de la FPP (Portugal) que importa Stick Live.
 *
 * La FPP publica un id por FASE (y por zona): la 2ª Divisão son dos ids (Norte
 * y Sul), el playoff de la 1ª serán tres (1/4, 1/2, final), cada ronda de la
 * Taça otro. Aquí se agrupan en UNA competición de Stick Live con sus secciones:
 *
 *   · misma `phase` + distinto `group` → grupos de una fase (Norte/Sul…)
 *   · distinta `phase`                  → fases sucesivas (regular → playoff)
 *
 * Este fichero es la semilla: `seed-fpp.ts` lo vuelca a `competitions` +
 * `seasons` + `competition_sources.external_ids.fpp_sections`, y el runner lee
 * de la BD. Para añadir una fase nueva a mitad de temporada (p. ej. el playoff)
 * basta con añadir la sección aquí y re-ejecutar el seed (idempotente).
 */

export type FppGender = 'male' | 'female';

export interface FppSection {
  /** id de la FPP (/Competicao/{fppId}). */
  fppId: string;
  /** Clave estable de la fase dentro de la competición. */
  phase: string;
  /** Título de la fase como se mostrará ("Fase Regular", "Play-Off"…). */
  phaseTitle: string;
  /** Grupo/zona ("Norte", "Sul A"…) o null si la fase no tiene grupos. */
  group: string | null;
  /** Tiene clasificación (liga). Las eliminatorias no. */
  hasStandings: boolean;
}

export interface FppCompetition {
  /** Clave estable → competitions.source_ref = fpp_competition_{key}. */
  key: string;
  name: string;
  shortName: string;
  slug: string;
  gender: FppGender;
  /** competitions.age_category (CHECK de la 017 + 'sub23' de la 087). Igual que la del equipo. */
  competitionAge: 'senior' | 'sub23';
  /** competitions.category (texto libre) y teams.age_category. */
  teamAge: 'senior' | 'sub23';
  format: 'league' | 'bracket' | 'final_four';
  sections: FppSection[];
}

export const FPP_SEASON = {
  name: '2026/27',
  slug: '2026-27',
  start: '2026-09-01',
  end: '2027-06-30',
  /** Época de la FPP (hp.fpp.pt/epoca/{n}); solo trazabilidad. */
  epoca: '56',
} as const;

export const FPP_TIMEZONE = 'Europe/Lisbon';

const league = (fppId: string, group: string | null = null): FppSection => ({
  fppId, phase: 'regular', phaseTitle: 'Fase Regular', group, hasStandings: true,
});
const cup = (fppId: string, phase: string, phaseTitle: string): FppSection => ({
  fppId, phase, phaseTitle, group: null, hasStandings: false,
});

export const FPP_COMPETITIONS: FppCompetition[] = [
  {
    key: 'campeonato-placard', name: 'Campeonato Placard de Hóquei em Patins', shortName: 'Campeonato Placard',
    slug: 'campeonato-placard-portugal', gender: 'male', competitionAge: 'senior', teamAge: 'senior',
    format: 'league', sections: [league('493')],
  },
  {
    key: '2-divisao', name: 'Campeonato Nacional 2ª Divisão', shortName: '2ª Divisão PT',
    slug: '2-divisao-portugal', gender: 'male', competitionAge: 'senior', teamAge: 'senior',
    format: 'league', sections: [league('494', 'Norte'), league('495', 'Sul')],
  },
  {
    key: '3-divisao', name: 'Campeonato Nacional 3ª Divisão', shortName: '3ª Divisão PT',
    slug: '3-divisao-portugal', gender: 'male', competitionAge: 'senior', teamAge: 'senior',
    format: 'league',
    sections: [league('498', 'Norte A'), league('499', 'Norte B'), league('500', 'Sul A'), league('501', 'Sul B')],
  },
  {
    key: 'feminino', name: 'Campeonato Nacional Feminino', shortName: 'CN Feminino PT',
    slug: 'campeonato-nacional-feminino-portugal', gender: 'female', competitionAge: 'senior', teamAge: 'senior',
    format: 'league', sections: [league('502', 'Norte'), league('503', 'Centro'), league('504', 'Sul')],
  },
  {
    key: 'sub-23', name: 'Campeonato Nacional Sub-23', shortName: 'CN Sub-23 PT',
    slug: 'campeonato-nacional-sub-23-portugal', gender: 'male', competitionAge: 'sub23', teamAge: 'sub23',
    format: 'league', sections: [league('505', 'Norte'), league('506', 'Centro'), league('507', 'Sul')],
  },
  {
    key: 'supertaca', name: 'Supertaça António Livramento', shortName: 'Supertaça',
    slug: 'supertaca-portugal', gender: 'male', competitionAge: 'senior', teamAge: 'senior',
    format: 'bracket', sections: [cup('496', 'final', 'Final')],
  },
  {
    key: 'supertaca-feminina', name: 'Supertaça Feminina', shortName: 'Supertaça F',
    slug: 'supertaca-feminina-portugal', gender: 'female', competitionAge: 'senior', teamAge: 'senior',
    format: 'bracket', sections: [cup('497', 'final', 'Final')],
  },
  {
    key: 'taca-portugal', name: 'Taça de Portugal', shortName: 'Taça de Portugal',
    slug: 'taca-de-portugal', gender: 'male', competitionAge: 'senior', teamAge: 'senior',
    format: 'bracket', sections: [cup('508', 'pre-eliminatoria', 'Pré-Eliminatória')],
  },
  {
    key: 'elite-cup', name: 'Elite Cup Masculina', shortName: 'Elite Cup',
    slug: 'elite-cup-portugal', gender: 'male', competitionAge: 'senior', teamAge: 'senior',
    format: 'bracket', sections: [cup('509', 'elite-cup', 'Elite Cup')],
  },
  {
    key: 'elite-cup-feminina', name: 'Elite Cup Feminina', shortName: 'Elite Cup F',
    slug: 'elite-cup-feminina-portugal', gender: 'female', competitionAge: 'senior', teamAge: 'senior',
    format: 'bracket', sections: [cup('510', 'elite-cup', 'Elite Cup')],
  },
];

export function competitionSourceRef(key: string): string {
  return `fpp_competition_${key}`;
}

function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Ref de equipo FPP. La FPP no da un id de equipo estable en el calendario (el
 * /Equipa/{comp}/{id} es la inscripción en ESA competición y falta en los
 * cruces sin acta), así que la identidad es nombre + sección: el mismo "SL
 * Benfica" juega la 1ª masculina, la femenina y la Sub-23, y son tres equipos.
 * La sección en la ref la hace única GLOBALMENTE (el resolver la encuentra
 * también desde las copas, donde coinciden equipos de varias ligas).
 */
export function fppTeamRef(gender: FppGender, teamAge: string, name: string): string {
  return `fpp_${gender === 'female' ? 'f' : 'm'}_${teamAge}_${slugify(name)}`;
}

export function fppMatchRef(fppId: string, numero: string): string {
  return `fpp_match_${fppId}_${numero}`;
}

export function fppPhaseRef(compKey: string, phase: string): string {
  return `fpp_phase_${compKey}_${phase}`;
}

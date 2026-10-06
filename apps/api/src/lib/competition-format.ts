/**
 * Formato de una competición según `competition_sources.external_ids.format`
 * (#166): 'league' | 'bracket' | 'final_four'. `final_four` = torneo a 4
 * (Semifinal x2 → Final, partido único); `bracket` = cuadro de eliminatorias
 * (Copa del Rey, eliminatorias de Plata/Bronce). Cualquier valor desconocido
 * (NULL, vacío, formato futuro) cae a 'league'.
 *
 * Lo consumen season-overview y team-detail para que la web pueda decidir si
 * una competición tiene clasificación o es eliminatoria. Función pura.
 */
export type CompetitionFormat = 'league' | 'bracket' | 'final_four';

const KNOCKOUT_FORMATS = new Set(['bracket', 'final_four']);

export function normalizeCompetitionFormat(raw: string | null | undefined): CompetitionFormat {
  return raw === 'bracket' || raw === 'final_four' ? raw : 'league';
}

export function isKnockoutCompetitionFormat(raw: string | null | undefined): boolean {
  return KNOCKOUT_FORMATS.has(raw ?? '');
}

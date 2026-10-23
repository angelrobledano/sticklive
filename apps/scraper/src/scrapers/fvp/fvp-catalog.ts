/**
 * Catálogo de la Federación Vasca de Patinaje (fvpatinaje.eus, plataforma
 * DigitalSport). A diferencia de la FPP no hay lista fija: la API publica el
 * catálogo (`/public/entity/{entidad}/competitions`) y `seed-fvp.ts` lo vuelca
 * a la BD. Aquí está la parte PURA: de la fila de la API a la competición de
 * Stick Live (nombre, slug, sección, refs).
 *
 * Identidad del equipo: la API da `equipoId`, pero es la inscripción en ESA
 * competición (el C.P. Burgos tiene uno en la Liga Norte y otro en la Copa).
 * Como en la FPP, la identidad es nombre + ámbito: `fvp_{ámbito}_{slug}`. El
 * ámbito es la liga, y la copa usa el de su liga (misma categoría y género)
 * para que el equipo sea el mismo. Dos ligas de la misma categoría (Infantil
 * A y R) son ámbitos distintos: el URDANETA de una y el de la otra son dos
 * equipos del club.
 */

export const FVP_ENTITY_ID = '00000000-0000-4000-0000-000000000001';
export const FVP_TIMEZONE = 'Europe/Madrid';
export const FVP_SCRAPER_KEY = 'fvp_hockey';

export type FvpGender = 'male' | 'female' | 'mixed';
export type FvpAge =
  | 'senior' | 'sub23' | 'junior' | 'juvenil' | 'infantil' | 'alevin' | 'benjamin' | 'prebenjamin' | 'veteranos' | 'base';

/** Fila de `/public/entity/{entidad}/competitions` (solo lo que usamos). */
export interface FvpApiCompetition {
  id: string;
  nombre: string;
  deporteCodigo: string;
  temporada: string;
  estado: string;
  categoriaDisplay: string | null;
  generoDisplay: string | null;
  serieNombre?: string | null;
  tieneLogo?: boolean;
}

export interface FvpCompetition {
  /** id DigitalSport de la competición. */
  apiId: string;
  /** Clave estable → competitions.source_ref = fvp_competition_{key}. */
  key: string;
  name: string;
  shortName: string;
  slug: string;
  gender: FvpGender;
  age: FvpAge;
  /** Ámbito de los equipos (ver cabecera). */
  teamScope: string;
  isCup: boolean;
  /**
   * Copas: nombre en la copa → nombre en su liga, cuando la federación lo
   * escribe distinto ("R.S. TENIS" en la copa = "TENIS SANTANDER" en la liga).
   * Lo calcula seed-fvp.ts por el id de club.
   */
  nameAliases?: Record<string, string>;
  season: { code: string; name: string; slug: string; start: string; end: string };
}

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** `T2627` → 2026/27. Null si no es un código de temporada. */
export function seasonFromCode(code: string): FvpCompetition['season'] | null {
  const m = /^T(\d{2})(\d{2})$/.exec(code);
  if (!m) return null;
  const y = 2000 + Number(m[1]);
  if (Number(m[2]) !== (y + 1) % 100) return null;
  return { code, name: `${y}/${m[2]}`, slug: `${y}-${m[2]}`, start: `${y}-09-01`, end: `${y + 1}-06-30` };
}

export function genderOf(g: string | null | undefined): FvpGender {
  const u = (g ?? '').toUpperCase();
  if (u.startsWith('FEM')) return 'female';
  if (u.startsWith('MASC')) return 'male';
  return 'mixed';
}

/** "Senior Liga Norte", "Juvenil Federado", "Alevín Escolar", "Benjamín A"… → categoría. */
export function ageOf(categoria: string | null | undefined): FvpAge | null {
  const u = slugify(categoria ?? '');
  if (/sub-?23/.test(u)) return 'sub23';
  if (/^(senior|absolut)/.test(u)) return 'senior';
  if (/^junior/.test(u)) return 'junior';
  if (/^juvenil/.test(u)) return 'juvenil';
  if (/^infantil/.test(u)) return 'infantil';
  if (/^alevin/.test(u)) return 'alevin';
  if (/^prebenjamin/.test(u)) return 'prebenjamin';
  if (/^benjamin/.test(u)) return 'benjamin';
  if (/^veteran/.test(u)) return 'veteranos';
  return null;
}

const isCupName = (n: string) => /^(COPA|SUPERCOPA|TROFEO)\b/i.test(n.trim());

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|Y)\b/g, (w) => w.toLowerCase());
}

/**
 * Competiciones de hockey patines de una temporada → competiciones de Stick
 * Live. Descarta lo que no es HP, otra temporada, no publicado o sin categoría
 * reconocible (devuelto aparte para avisar, no en silencio).
 */
export function planFvpCatalog(
  rows: FvpApiCompetition[],
  seasonCode: string,
): { competitions: FvpCompetition[]; skipped: Array<{ nombre: string; motivo: string }> } {
  const season = seasonFromCode(seasonCode);
  if (!season) throw new Error(`Código de temporada no válido: ${seasonCode}`);
  const skipped: Array<{ nombre: string; motivo: string }> = [];
  const hp = rows.filter((r) => r.deporteCodigo?.toUpperCase() === 'HP' && r.temporada === seasonCode);

  const base = hp.flatMap((r) => {
    if (r.estado !== 'PUBLISHED') { skipped.push({ nombre: r.nombre, motivo: `estado ${r.estado}` }); return []; }
    const age = ageOf(r.categoriaDisplay);
    if (!age) { skipped.push({ nombre: r.nombre, motivo: `categoría desconocida "${r.categoriaDisplay}"` }); return []; }
    return [{ r, age, gender: genderOf(r.generoDisplay), isCup: isCupName(r.nombre) }];
  });

  const leagueScope = new Map<string, string>();
  for (const b of base) {
    if (b.isCup) continue;
    const k = `${slugify(b.r.categoriaDisplay ?? '')}|${b.gender}`;
    // Dos ligas de la misma categoría: la copa no sabría a cuál ir → sin ámbito compartido.
    leagueScope.set(k, leagueScope.has(k) ? '' : slugify(b.r.nombre));
  }

  const competitions = base.map(({ r, age, gender, isCup }) => {
    const nameSlug = slugify(r.nombre);
    const regional = /vasca|norte|euskadi/.test(nameSlug);
    const slug = `${nameSlug}${regional ? '' : '-euskadi'}`;
    const shared = isCup ? leagueScope.get(`${slugify(r.categoriaDisplay ?? '')}|${gender}`) : '';
    return {
      apiId: r.id,
      key: nameSlug,
      name: titleCase(r.nombre),
      shortName: titleCase(r.nombre).replace(/^Liga\s+/i, ''),
      slug,
      gender,
      age,
      teamScope: shared || nameSlug,
      isCup,
      season,
    };
  });
  return { competitions, skipped };
}

export function competitionSourceRef(key: string): string {
  return `fvp_competition_${key}`;
}

/**
 * La fuente escribe el mismo equipo con y sin puntos según la competición
 * ("SANTUTXU HT" en la liga, "SANTUTXU H.T." en la copa): se quitan antes del slug.
 */
export function fvpTeamRef(teamScope: string, name: string): string {
  return `fvp_${teamScope}_${slugify(name.replace(/\./g, ''))}`;
}

export function fvpMatchRef(enfrentamientoId: string): string {
  return `fvp_match_${enfrentamientoId}`;
}

export function fvpPhaseRef(faseId: string): string {
  return `fvp_phase_${faseId}`;
}

export const FVP_PLAYER_PREFIX = 'fvp_player_';
export const FVP_EVENT_PREFIX = 'fvp_event_';

/**
 * Alias de una copa respecto a su liga, por club: un equipo de la copa cuyo
 * nombre no existe en la liga se enlaza con el ÚNICO equipo de la liga de ese
 * club. Si el club tiene varios equipos en la liga (A y B), no se adivina.
 */
export function cupAliasesByClub(
  league: Array<{ name: string; clubId: string | null }>,
  cup: Array<{ name: string; clubId: string | null }>,
  teamScope: string,
): Record<string, string> {
  const leagueRefs = new Set(league.map((t) => fvpTeamRef(teamScope, t.name)));
  const byClub = new Map<string, string[]>();
  for (const t of league) if (t.clubId) byClub.set(t.clubId, [...(byClub.get(t.clubId) ?? []), t.name]);
  const out: Record<string, string> = {};
  for (const t of cup) {
    if (leagueRefs.has(fvpTeamRef(teamScope, t.name)) || !t.clubId) continue;
    const names = [...new Set(byClub.get(t.clubId) ?? [])];
    if (names.length === 1) out[t.name] = names[0]!;
  }
  return out;
}

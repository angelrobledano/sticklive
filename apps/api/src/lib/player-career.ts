/**
 * Carrera/trayectoria de un jugador (#217).
 *
 * Lógica PURA, sin I/O ni relojes: la ruta `GET /players/:id` (player-detail)
 * entrega las filas ya agregadas por (temporada, equipo) desde dos fuentes:
 *
 *   · `team_players` — pertenencia a plantilla (2025/26 en adelante).
 *   · `match_events` — eventos con `team_id` (histórico sin plantilla).
 *
 * La ruta excluye del segundo origen los pares (temporada, equipo) que ya
 * existen en el primero, de modo que cada par llega UNA sola vez. Aquí se
 * agrupa por temporada, se calculan totales de temporada y de carrera, y se
 * ordena de la campaña más reciente a la más antigua. Se testea aislada en
 * `player-career.test.ts`.
 */

/** Fila cruda agregada por (temporada, equipo). `COUNT()` llega como string (bigint). */
export interface CareerRow {
  season_id: string;
  season_name: string;
  season_start: string | Date | null;
  is_current: boolean;
  competition_id: string;
  /** Opcional para no romper consumidores antiguos (Plan A de URLs legibles). */
  competition_slug?: string | null;
  competition_name: string;
  competition_short: string | null;
  team_id: string;
  team_name: string;
  team_short_name: string | null;
  team_logo_url: string | null;
  jersey_number: number | null;
  pj: string | number;
  goals: string | number;
  blue_cards: string | number;
  red_cards: string | number;
  penalties_total: string | number;
  penalties_scored: string | number;
}

/** Métricas de un jugador en una temporada/equipo (o suma de ellas). */
export interface CareerStats {
  pj: number;
  goals: number;
  blueCards: number;
  redCards: number;
  penaltiesTotal: number;
  penaltiesScored: number;
}

/** Un equipo (en su competición) dentro de una temporada. */
export interface CareerTeamEntry extends CareerStats {
  competitionId: string;
  competitionName: string;
  competitionShort: string | null;
  teamId: string;
  teamName: string;
  teamShortName: string | null;
  teamLogoUrl: string | null;
  jerseyNumber: number | null;
}

/** Una campaña con sus equipos y sus totales. */
export interface CareerSeason {
  seasonId: string;
  seasonName: string;
  isCurrent: boolean;
  startDate: string | null;
  /** Competición de la temporada (una temporada pertenece a una sola competición). */
  competitionId: string;
  competitionSlug: string | null;
  competitionName: string;
  competitionShort: string | null;
  totals: CareerStats;
  teams: CareerTeamEntry[];
}

/** Carrera completa: campañas (más reciente primero) + totales globales. */
export interface PlayerCareer {
  seasons: CareerSeason[];
  totals: CareerStats;
}

function num(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function zeroStats(): CareerStats {
  return { pj: 0, goals: 0, blueCards: 0, redCards: 0, penaltiesTotal: 0, penaltiesScored: 0 };
}

/**
 * Fecha de inicio como `YYYY-MM-DD`.
 *
 * Postgres devuelve la columna `date` como Date (medianoche local) o string
 * según el driver; usar los componentes LOCALES evita desplazar el día por la
 * zona horaria.
 */
function ymd(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = value.trim();
  return s ? s.slice(0, 10) : null;
}

function addStats(target: CareerStats, stats: CareerStats): void {
  target.pj += stats.pj;
  target.goals += stats.goals;
  target.blueCards += stats.blueCards;
  target.redCards += stats.redCards;
  target.penaltiesTotal += stats.penaltiesTotal;
  target.penaltiesScored += stats.penaltiesScored;
}

/** Más reciente primero; la temporada activa siempre arriba. */
function compareSeasons(a: CareerSeason, b: CareerSeason): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  if (a.startDate && b.startDate && a.startDate !== b.startDate) {
    return a.startDate < b.startDate ? 1 : -1;
  }
  if (a.startDate && !b.startDate) return -1;
  if (!a.startDate && b.startDate) return 1;
  // Sin fecha fiable: comparar el nombre ("2025/26" > "2024/25") descendente.
  return b.seasonName.localeCompare(a.seasonName, 'es');
}

/** Agrupa las filas por temporada y equipo y calcula los totales. */
export function buildPlayerCareer(rows: CareerRow[]): PlayerCareer {
  const seasonMap = new Map<string, {
    seasonId: string;
    seasonName: string;
    isCurrent: boolean;
    startDate: string | null;
    competitionId: string;
    competitionSlug: string | null;
    competitionName: string;
    competitionShort: string | null;
    teams: Map<string, CareerTeamEntry>;
  }>();

  for (const r of rows) {
    let season = seasonMap.get(r.season_id);
    if (!season) {
      season = {
        seasonId: r.season_id,
        seasonName: r.season_name,
        isCurrent: r.is_current === true,
        startDate: ymd(r.season_start),
        competitionId: r.competition_id,
        competitionSlug: r.competition_slug ?? null,
        competitionName: r.competition_name,
        competitionShort: r.competition_short,
        teams: new Map(),
      };
      seasonMap.set(r.season_id, season);
    }
    // `is_current`/`start_date` pueden no venir en todas las filas de la campaña.
    if (r.is_current) season.isCurrent = true;
    if (!season.startDate) season.startDate = ymd(r.season_start);

    const existing = season.teams.get(r.team_id);
    if (existing) {
      addStats(existing, {
        pj: num(r.pj),
        goals: num(r.goals),
        blueCards: num(r.blue_cards),
        redCards: num(r.red_cards),
        penaltiesTotal: num(r.penalties_total),
        penaltiesScored: num(r.penalties_scored),
      });
      if (existing.jerseyNumber == null) existing.jerseyNumber = r.jersey_number;
    } else {
      season.teams.set(r.team_id, {
        competitionId: r.competition_id,
        competitionName: r.competition_name,
        competitionShort: r.competition_short,
        teamId: r.team_id,
        teamName: r.team_name,
        teamShortName: r.team_short_name,
        teamLogoUrl: r.team_logo_url,
        jerseyNumber: r.jersey_number,
        pj: num(r.pj),
        goals: num(r.goals),
        blueCards: num(r.blue_cards),
        redCards: num(r.red_cards),
        penaltiesTotal: num(r.penalties_total),
        penaltiesScored: num(r.penalties_scored),
      });
    }
  }

  const totals = zeroStats();
  const seasons: CareerSeason[] = [];

  for (const s of seasonMap.values()) {
    const teams = [...s.teams.values()].sort(
      (a, b) =>
        a.teamName.localeCompare(b.teamName, 'es') ||
        a.competitionName.localeCompare(b.competitionName, 'es'),
    );
    const seasonTotals = zeroStats();
    for (const t of teams) addStats(seasonTotals, t);
    addStats(totals, seasonTotals);

    seasons.push({
      seasonId: s.seasonId,
      seasonName: s.seasonName,
      isCurrent: s.isCurrent,
      startDate: s.startDate,
      competitionId: s.competitionId,
      competitionSlug: s.competitionSlug,
      competitionName: s.competitionName,
      competitionShort: s.competitionShort,
      totals: seasonTotals,
      teams,
    });
  }

  seasons.sort(compareSeasons);
  return { seasons, totals };
}

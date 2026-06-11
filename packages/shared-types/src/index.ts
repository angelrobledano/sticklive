// ============================================================
// Tipos compartidos entre scraper, ETL y API
// ============================================================

export type SportSlug = 'hockey-patines' | string;

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
export type Gender = 'male' | 'female' | 'mixed' | 'unknown';
export type RoundType = 'regular' | 'playoff' | 'cup' | 'friendly';
export type EventType = 'goal' | 'penalty' | 'blue_card' | 'red_card' | 'timeout' | 'period_end';
export type ScrapeStatus = 'success' | 'error' | 'skipped' | 'partial';

// ============================================================
// Entidades de dominio (lo que circula por el sistema)
// ============================================================

export interface DataSource {
  id: string;
  name: string;
  baseUrl: string;
  scraperKey: string;
}

export interface Sport {
  id: string;
  name: string;
  slug: SportSlug;
}

export interface Competition {
  id: string;
  sportId: string;
  name: string;
  shortName?: string;
  slug: string;
  gender?: Gender;
  category?: string;
  country: string;
}

export interface Season {
  id: string;
  competitionId: string;
  name: string;
  slug: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
}

export interface Team {
  id: string;
  sportId: string;
  name: string;
  shortName?: string;
  slug: string;
  city?: string;
  logoUrl?: string;
}

export interface Player {
  id: string;
  sportId: string;
  firstName: string;
  lastName: string;
  slug: string;
  birthDate?: string;
  nationality?: string;
  position?: string;
}

export interface Round {
  id: string;
  seasonId: string;
  number: number;
  name?: string;
  roundType: RoundType;
  startDate?: string;
  endDate?: string;
}

export interface Match {
  id: string;
  seasonId: string;
  roundId?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore?: number;
  awayScore?: number;
  status: MatchStatus;
  scheduledAt?: string;
  venueName?: string;
  venueCity?: string;
}

export interface Standing {
  id: string;
  seasonId: string;
  teamId: string;
  groupName?: string;
  position?: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form?: string[];
}

export interface MatchEvent {
  id: string;
  matchId: string;
  teamId?: string;
  playerId?: string;
  eventType: EventType;
  minute?: number;
  period?: number;
  detail?: string;
}

// ============================================================
// DTOs del scraper (datos crudos antes de normalizar)
// ============================================================

export interface ScrapedTrace {
  sourceId: string;
  sourceRef?: string;
  sourceUrl?: string;
  scrapedAt: Date;
}

export type ScrapedCompetition = Omit<Competition, 'id' | 'sportId'> & ScrapedTrace & {
  rawName: string;
};

export type ScrapedTeam = Omit<Team, 'id' | 'sportId'> & ScrapedTrace & {
  rawName: string;
};

export type ScrapedMatch = Omit<Match, 'id' | 'homeTeamId' | 'awayTeamId'> & ScrapedTrace & {
  homeTeamRef: string;
  awayTeamRef: string;
  roundRef?: string;
};

export type ScrapedStanding = Omit<Standing, 'id' | 'seasonId' | 'teamId'> & ScrapedTrace & {
  teamRef: string;
  logoUrl?: string;
};

// ============================================================
// Resultados de ejecucion de scrapers
// ============================================================

export interface ScrapeResult<T> {
  success: boolean;
  data: T[];
  errors: ScrapeError[];
  durationMs: number;
  scraperKey: string;
  entityType: string;
}

export interface ScrapeError {
  message: string;
  url?: string;
  entityRef?: string;
  stack?: string;
}

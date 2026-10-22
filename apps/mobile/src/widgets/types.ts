export type WidgetMatchStatus = 'live' | 'finished' | 'scheduled';

export interface WidgetMatchData {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: WidgetMatchStatus;
  minute: string | null;
  competition: string;
  deepLinkUrl: string;
  homeFouls?: number | null;
  awayFouls?: number | null;
  isHalftime?: boolean;
}

export interface WidgetState {
  hasMatches: boolean;
  featuredMatch: WidgetMatchData | null;
  liveCount: number;
  lastUpdated: string;
}

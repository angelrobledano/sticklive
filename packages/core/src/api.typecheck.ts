import type { Match, MatchSummary, FavoritesResponse } from './api';

// Un Match normalizado es asignable a MatchSummary (la forma cruda es más laxa).
const s: MatchSummary = {} as Match;
// Al revés no: la forma cruda no trae homeTeamId, awayTeamId, finishedAt ni sourceRef.
// @ts-expect-error MatchSummary no es asignable a Match
const m: Match = {} as MatchSummary;
type _HasFavs = FavoritesResponse extends object ? true : never;
const _ok: _HasFavs = true;
export { m, s, _ok };

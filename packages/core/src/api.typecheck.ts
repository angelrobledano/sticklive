import type { Match, MatchSummary, MatchDetail, MatchDetailRaw, FavoritesResponse } from './api';

// Un Match normalizado es asignable a MatchSummary (la forma cruda es más laxa).
const s: MatchSummary = {} as Match;
// Al revés no: la forma cruda no trae homeTeamId, awayTeamId, finishedAt ni sourceRef.
// @ts-expect-error MatchSummary no es asignable a Match
const m: Match = {} as MatchSummary;
const dr: MatchDetailRaw = {} as MatchDetail;
// @ts-expect-error MatchDetailRaw no es asignable a MatchDetail
const d: MatchDetail = {} as MatchDetailRaw;
type _HasFavs = FavoritesResponse extends object ? true : never;
const _ok: _HasFavs = true;
export { m, s, d, dr, _ok };

import type { Match, MatchSummary, FavoritesResponse } from './api';

const m: Match = {} as MatchSummary;
const s: MatchSummary = {} as Match;
type _HasFavs = FavoritesResponse extends object ? true : never;
const _ok: _HasFavs = true;
export { m, s, _ok };

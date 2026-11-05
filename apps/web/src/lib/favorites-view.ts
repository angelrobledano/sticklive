/**
 * Favoritos como pantalla de consumo (05/11/2026). Patrón de FotMob
 * («Following») y Flashscore («Favoritos»): lo que sigues, con lo que importa
 * de cada uno a la vista (directo, próximo partido, último resultado). La
 * gestión (buscar, seguir y dejar de seguir) pasa a un modo «Editar».
 * Función pura: la página solo pinta.
 */

export interface CardTeamRef { id: string; name: string }

export interface CardMatch {
  id: string;
  status: string;
  scheduledAt: string | null;
  homeTeam: CardTeamRef;
  awayTeam: CardTeamRef;
  score: { home: number | null; away: number | null };
}

export interface FavoriteTeamCard<M extends CardMatch> {
  id: string;
  name: string;
  live: M | null;
  next: M | null;
  last: M | null;
}

const time = (m: CardMatch) => {
  const t = Date.parse(m.scheduledAt ?? '');
  return Number.isFinite(t) ? t : 0;
};

export function favoriteTeamCards<M extends CardMatch>(
  teamIds: readonly string[],
  matches: readonly M[],
  now: number,
  catalogNames: Readonly<Record<string, string>> = {},
): FavoriteTeamCard<M>[] {
  const cards = teamIds.map((id) => {
    const own = matches.filter((m) => m.homeTeam.id === id || m.awayTeam.id === id);
    const live = own.find((m) => m.status === 'live') ?? null;
    const next = own
      .filter((m) => m.status === 'scheduled' && time(m) >= now)
      .sort((a, b) => time(a) - time(b))[0] ?? null;
    const last = own
      .filter((m) => m.status === 'finished')
      .sort((a, b) => time(b) - time(a))[0] ?? null;
    const sample = own[0];
    const name = sample
      ? (sample.homeTeam.id === id ? sample.homeTeam.name : sample.awayTeam.name)
      : (catalogNames[id] ?? '');
    return { id, name, live, next, last };
  });
  const rank = (c: FavoriteTeamCard<M>) => (c.live ? 0 : c.next ? 1 : 2);
  return cards.sort((a, b) =>
    rank(a) - rank(b)
    || (a.next && b.next ? time(a.next) - time(b.next) : 0)
    || a.name.localeCompare(b.name, 'es'));
}

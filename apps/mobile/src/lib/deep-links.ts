/**
 * Traduce una ruta o URL de sticklive.eu (o del esquema propio) a una ruta de
 * expo-router. Lo usan +native-intent (enlaces de sistema) y el tap de push.
 * Lo que la app no sabe abrir va a la portada, nunca a una pantalla rota.
 */
const LOCALES = new Set(['es', 'ca', 'en', 'pt', 'fr', 'it']);

const DETAIL: Record<string, string> = {
  matches: 'match',
  match: 'match',
  teams: 'team',
  team: 'team',
  players: 'player',
  player: 'player',
  competitions: 'competition',
  competition: 'competition',
};

function withQuery(path: string, query: URLSearchParams, keep: string[] | 'all'): string {
  const out = new URLSearchParams();
  for (const [k, v] of query) {
    if (keep === 'all' || keep.includes(k)) out.append(k, v);
  }
  const qs = out.toString();
  return qs ? `${path}?${qs}` : path;
}

export function webPathToAppPath(input: string): string {
  let raw = (input ?? '').trim();
  // Esquema y host: https://host/…, sticklive://ruta o sticklive:///ruta
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i);
  if (scheme) {
    const [, proto, host, rest] = scheme;
    raw = /^https?$/i.test(proto!) ? rest! : `/${host}${rest}`;
  }
  const hashAt = raw.indexOf('#');
  if (hashAt >= 0) raw = raw.slice(0, hashAt);
  const qAt = raw.indexOf('?');
  const pathPart = qAt >= 0 ? raw.slice(0, qAt) : raw;
  const query = new URLSearchParams(qAt >= 0 ? raw.slice(qAt + 1) : '');

  let segs = pathPart.split('/').filter(Boolean);
  // Grupos de expo-router como (tabs) no forman parte de la URL
  segs = segs.filter((s) => !/^\(.*\)$/.test(s));
  if (segs[0] && LOCALES.has(segs[0].toLowerCase())) segs = segs.slice(1);
  if (segs.length === 0) return '/';

  const [head, second, third] = segs;
  const key = head!.toLowerCase();

  if (DETAIL[key]) {
    const target = DETAIL[key];
    if (target === 'competition') {
      if (!second || second === 'country' || second === 'federation') return '/competitions';
      if (segs.length > 2) return '/';
      return withQuery(`/competition/${second}`, query, ['season', 'seasonId']);
    }
    if (!second || segs.length > 2) return '/';
    return `/${target}/${second}`;
  }

  switch (key) {
    case 'favorites':
      return '/favorites';
    case 'search':
      return withQuery('/search', query, ['q']);
    case 'settings':
      if (!second) return '/settings';
      if (second === 'notifications') return '/settings/notifications';
      if ((second === 'premium' || second === 'ads-privacy') && !third) return `/settings/${second}`;
      return '/settings';
    case 'login':
      return withQuery('/login', query, 'all');
    case 'auth':
      return second === 'callback' ? withQuery('/auth/callback', query, 'all') : '/';
    default:
      return '/';
  }
}

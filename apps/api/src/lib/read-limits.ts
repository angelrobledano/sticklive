/**
 * Rutas con rate-limit de lectura (I1) en un único sitio, para poder testearlas.
 *
 * #333: `/matches/current` y `/matches/live` se registraban ADEMÁS con
 * `app.use('/matches/:id', …)`, que en Hono también casa esas dos rutas. Cada
 * petición contaba dos veces y el tope real era 60/min aunque docs/api.md
 * documenta 120/min. Con `/matches/:id` una sola vez, el contrato (120) se
 * cumple para match-detail, live y current.
 *
 * La lógica pura (límite, ventana y patrones) vive aquí para que un test
 * detecte si alguien vuelve a duplicar una ruta.
 */
export const READ_LIMIT_MAX = 120;
export const READ_LIMIT_WINDOW_MS = 60_000;

/**
 * Patrones pasados a `app.use`. NO incluir `/matches/live` ni `/matches/current`:
 * ya quedan cubiertos por `/matches/:id` y duplicarlos restaría la mitad del tope.
 */
export const READ_LIMIT_PATHS: readonly string[] = [
  '/competitions',
  '/competitions/:id/seasons',
  '/seasons/:id/overview',
  '/seasons/:id/stats',
  '/seasons/:id/insights',
  '/teams/:id',
  '/teams/:id/recent',
  '/players/:id',
  '/players/:id/insights',
  '/search',
  '/seasons/:id/matches',
  '/seasons/:id/standings',
  '/matches/:id', // cubre /matches/:id, /matches/live y /matches/current
  '/meta/sitemap',
];

/**
 * Topes MÁS ESTRICTOS para los endpoints que un scraper usa para volcar el
 * catálogo de golpe. Se suman al tope general de 120/min: el efectivo es el
 * menor de los dos. Son lecturas que la web hace una vez por página/jornada,
 * no en bucle, así que 30/min sigue sobrando para uso humano.
 */
export interface HeavyReadLimit {
  path: string;
  max: number;
  windowMs: number;
}

export const HEAVY_READ_LIMITS: readonly HeavyReadLimit[] = [
  { path: '/seasons/:id/matches',   max: 60, windowMs: 60_000 },
  { path: '/seasons/:id/overview',  max: 60, windowMs: 60_000 },
  { path: '/meta/sitemap',          max: 30, windowMs: 60_000 },
];

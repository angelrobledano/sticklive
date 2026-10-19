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
  '/seasons/:id/overview',
  '/seasons/:id/stats',
  '/seasons/:id/insights',
  '/teams/:id',
  '/players/:id',
  '/competitions',
  '/search',
  '/seasons/:id/matches',
  '/seasons/:id/standings',
  '/matches/:id', // cubre /matches/:id, /matches/live y /matches/current
  '/meta/sitemap',
];

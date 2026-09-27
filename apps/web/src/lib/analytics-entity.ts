/**
 * Vistas de entidad para el plan de tracking (#171).
 *
 * El `$pageview` normaliza los UUID a `:id`, así que no permite saber QUÉ
 * competición o equipo se consultó. Estos eventos, en cambio, llevan el id real
 * (misma lógica de detección que `normalizeRoute`, sin depender de posthog).
 */

const LOCALE_RE = /^\/(es|en|pt|fr|it)(?=\/|$)/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EntityView {
  event: 'competition_view' | 'team_view';
  id: string;
}

/** `/es/competitions/<uuid>` → competición; `/es/teams/<uuid>` → equipo. */
export function entityViewFromPath(pathname: string): EntityView | null {
  const path = pathname.replace(LOCALE_RE, '');
  const match = path.match(/^\/(competitions|teams)\/([^/?#]+)/);
  if (!match) return null;
  const [, kind, id] = match;
  if (!UUID_RE.test(id!)) return null;
  return { event: kind === 'competitions' ? 'competition_view' : 'team_view', id: id! };
}

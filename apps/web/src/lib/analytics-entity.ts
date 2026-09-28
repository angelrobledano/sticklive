/**
 * Helpers puros de instrumentación (#171, #242).
 *
 * El `$pageview` normaliza los UUID a `:id`, así que no permite saber QUÉ
 * competición, equipo o jugador se consultó. Estas vistas, en cambio, llevan el
 * id real (misma lógica de detección que `normalizeRoute`, sin depender de posthog).
 */

const LOCALE_RE = /^\/(es|en|pt|fr|it)(?=\/|$)/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_RE = /^\/(competitions|teams|players)\/([^/?#]+)/;

export type EntityViewEvent = 'competition_view' | 'team_view' | 'player_view';

export interface EntityView {
  event: EntityViewEvent;
  id: string;
}

/** Sección de ruta → evento de vista de entidad. */
const EVENT_BY_KIND: Record<string, EntityViewEvent> = {
  competitions: 'competition_view',
  teams: 'team_view',
  players: 'player_view',
};

/** Evento de vista → propiedad que transporta el id real. */
const ID_PROP_BY_EVENT: Record<EntityViewEvent, 'competition_id' | 'team_id' | 'player_id'> = {
  competition_view: 'competition_id',
  team_view: 'team_id',
  player_view: 'player_id',
};

/** Nombre de la propiedad de id que acompaña a cada vista de entidad. */
export function entityIdProp(event: EntityViewEvent): 'competition_id' | 'team_id' | 'player_id' {
  return ID_PROP_BY_EVENT[event];
}

/**
 * `/es/competitions/<uuid>` → competición; `/es/teams/<uuid>` → equipo;
 * `/es/players/<uuid>` → jugador (#242).
 */
export function entityViewFromPath(pathname: string): EntityView | null {
  const path = pathname.replace(LOCALE_RE, '');
  const match = path.match(ENTITY_RE);
  if (!match) return null;
  const [, kind, id] = match;
  if (!UUID_RE.test(id!)) return null;
  return { event: EVENT_BY_KIND[kind!]!, id: id! };
}

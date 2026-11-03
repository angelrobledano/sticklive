/**
 * Helpers puros de instrumentación (#171, #242).
 *
 * El `$pageview` normaliza los ids a `:id`, así que no permite saber QUÉ
 * competición, equipo, jugador o club se consultó. Estas vistas, en cambio,
 * llevan el id real o, en las URL legibles, el slug (misma lógica de detección
 * que `normalizeRoute`, sin depender de posthog).
 *
 * Revisión del plan 03/11/2026: las competiciones se sirven por slug
 * (`/competitions/ok-liga-masculina`) y antes NO emitían `competition_view`.
 * Se añaden `club_view` y el catalán.
 */
import { SUPPORTED_LOCALES } from '@/lib/locales';

const LOCALE_RE = new RegExp(`^/(${SUPPORTED_LOCALES.join('|')})(?=/|$)`);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTITY_RE = /^\/(competitions|teams|players|clubs)\/([^/?#]+)\/?$/;

export type EntityViewEvent = 'competition_view' | 'team_view' | 'player_view' | 'club_view';

export interface EntityView {
  event: EntityViewEvent;
  /** UUID cuando la URL lo lleva. */
  id: string | null;
  /** Slug cuando la URL es legible (competiciones y clubes). */
  slug: string | null;
}

const EVENT_BY_KIND: Record<string, EntityViewEvent> = {
  competitions: 'competition_view',
  teams: 'team_view',
  players: 'player_view',
  clubs: 'club_view',
};

/** Secciones que también se sirven por slug. */
const SLUG_KINDS = new Set(['competitions', 'clubs']);

const ID_PROP_BY_EVENT: Record<EntityViewEvent, 'competition_id' | 'team_id' | 'player_id' | 'club_id'> = {
  competition_view: 'competition_id',
  team_view: 'team_id',
  player_view: 'player_id',
  club_view: 'club_id',
};

const SLUG_PROP_BY_EVENT: Partial<Record<EntityViewEvent, 'competition_slug' | 'club_slug'>> = {
  competition_view: 'competition_slug',
  club_view: 'club_slug',
};

/** Nombre de la propiedad de id que acompaña a cada vista de entidad. */
export function entityIdProp(event: EntityViewEvent): 'competition_id' | 'team_id' | 'player_id' | 'club_id' {
  return ID_PROP_BY_EVENT[event];
}

/** Props del evento de vista: el id si lo hay y, si no, el slug. */
export function entityViewProps(view: EntityView): Record<string, string> {
  const props: Record<string, string> = {};
  if (view.id) props[ID_PROP_BY_EVENT[view.event]] = view.id;
  const slugProp = SLUG_PROP_BY_EVENT[view.event];
  if (view.slug && slugProp) props[slugProp] = view.slug;
  return props;
}

/**
 * `/es/competitions/<uuid|slug>` → competición; `/es/teams/<uuid>` → equipo;
 * `/es/players/<uuid>` → jugador; `/es/clubs/<uuid|slug>` → club.
 * Los hubs (`/competitions/federation/x`, `/competitions/country/ES`) no son entidad.
 */
export function entityViewFromPath(pathname: string): EntityView | null {
  const path = pathname.replace(LOCALE_RE, '');
  const match = path.match(ENTITY_RE);
  if (!match) return null;
  const [, kind, key] = match;
  if (UUID_RE.test(key!)) return { event: EVENT_BY_KIND[kind!]!, id: key!, slug: null };
  if (SLUG_KINDS.has(kind!) && SLUG_RE.test(key!)) return { event: EVENT_BY_KIND[kind!]!, id: null, slug: key! };
  return null;
}

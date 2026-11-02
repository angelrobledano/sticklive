/**
 * Pabellones (migración 104), desde `pistas` de la API de sidgad.
 *
 * El cruce con `matches.venue_name` va por una clave normalizada: mayúsculas,
 * sin tildes y con todo lo que no es letra o número reducido a un espacio
 * («PALAU D'ESPORTS DE REUS» → «PALAU D ESPORTS DE REUS»). La misma
 * normalización existe en SQL (`venueKeySql`) para el JOIN de la API.
 */
import type pg from 'pg';
import { db } from '../client.js';

export function venueKey(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** La misma clave en SQL, sobre una expresión de texto. */
export function venueKeySql(expr: string): string {
  return `btrim(regexp_replace(translate(upper(${expr}), 'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN'), '[^A-Z0-9]+', ' ', 'g'))`;
}

export interface VenueInput {
  sourceRef: string;
  name: string;
  street?: string | null;
  postalCode?: string | null;
  capacity?: number | null;
  surface?: string | null;
}

/** Alta o actualización por `source_ref`. Devuelve cuántos se escribieron. */
export async function upsertVenues(venues: VenueInput[], client: pg.PoolClient | typeof db = db): Promise<number> {
  let n = 0;
  for (const v of venues) {
    await client.query(
      `INSERT INTO venues (source_ref, name, name_key, street, postal_code, capacity, surface, scraped_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (source_ref) DO UPDATE SET
         name = EXCLUDED.name, name_key = EXCLUDED.name_key,
         street = COALESCE(EXCLUDED.street, venues.street),
         postal_code = COALESCE(EXCLUDED.postal_code, venues.postal_code),
         capacity = COALESCE(EXCLUDED.capacity, venues.capacity),
         surface = COALESCE(EXCLUDED.surface, venues.surface),
         scraped_at = NOW(), updated_at = NOW()`,
      [v.sourceRef, v.name, venueKey(v.name), v.street ?? null, v.postalCode ?? null, v.capacity ?? null, v.surface ?? null],
    );
    n++;
  }
  return n;
}

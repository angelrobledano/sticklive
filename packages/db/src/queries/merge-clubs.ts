import type pg from 'pg';
import { db, withTransaction } from '../client.js';

/**
 * Fusión de dos fichas del mismo club (Plan B1). El club `fromId` desaparece y
 * todo lo suyo pasa a `intoId`: equipos, nombres comerciales, refs de fuente y
 * slugs. Su slug (y los slugs antiguos que ya redirigían a él) quedan en
 * `club_slug_redirects` apuntando al superviviente, así que /clubs/<slug viejo>
 * responde 308 a la ficha que se queda. El superviviente conserva su nombre y
 * slug; si no tenía ciudad o escudo, hereda los del absorbido.
 */
export interface MergeClubsResult {
  intoId: string;
  intoSlug: string;
  fromSlug: string;
  teamsMoved: number;
}

export class MergeClubsError extends Error {
  constructor(message: string, readonly code: 'same' | 'not_found' | 'sport_mismatch') {
    super(message);
    this.name = 'MergeClubsError';
  }
}

type Ejecutor = Pick<pg.PoolClient, 'query'>;

export async function mergeClubsInTx(client: Ejecutor, fromId: string, intoId: string): Promise<MergeClubsResult> {
  if (fromId === intoId) throw new MergeClubsError('no se puede fusionar un club consigo mismo', 'same');

  const { rows } = await client.query<{ id: string; slug: string; sport_id: string }>(
    'SELECT id, slug, sport_id FROM clubs WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [[fromId, intoId]],
  );
  const from = rows.find((r) => r.id === fromId);
  const into = rows.find((r) => r.id === intoId);
  if (!from || !into) throw new MergeClubsError('club inexistente', 'not_found');
  if (from.sport_id !== into.sport_id) throw new MergeClubsError('los clubes son de deportes distintos', 'sport_mismatch');

  const moved = await client.query(
    'UPDATE teams SET club_id = $1, updated_at = NOW() WHERE club_id = $2', [intoId, fromId],
  );
  await client.query(
    `INSERT INTO club_names (club_id, commercial_name, sponsor_id, valid_from, valid_to)
     SELECT $1, commercial_name, sponsor_id, valid_from, valid_to FROM club_names WHERE club_id = $2
     ON CONFLICT (club_id, commercial_name, valid_from) DO NOTHING`,
    [intoId, fromId],
  );
  await client.query('UPDATE source_entity_map SET club_id = $1 WHERE club_id = $2', [intoId, fromId]);
  await client.query(
    `UPDATE clubs t
        SET city = COALESCE(t.city, f.city),
            crest_url = COALESCE(t.crest_url, f.crest_url),
            updated_at = NOW()
       FROM clubs f
      WHERE t.id = $1 AND f.id = $2`,
    [intoId, fromId],
  );
  // Redirecciones: las del absorbido pasan al superviviente y se añade su slug.
  await client.query('UPDATE club_slug_redirects SET club_id = $1 WHERE club_id = $2', [intoId, fromId]);
  await client.query(
    `INSERT INTO club_slug_redirects (old_slug, club_id) VALUES ($1, $2)
     ON CONFLICT (old_slug) DO UPDATE SET club_id = EXCLUDED.club_id`,
    [from.slug, intoId],
  );
  await client.query('DELETE FROM club_names WHERE club_id = $1', [fromId]);
  await client.query('DELETE FROM clubs WHERE id = $1', [fromId]);

  return { intoId, intoSlug: into.slug, fromSlug: from.slug, teamsMoved: moved.rowCount ?? 0 };
}

export async function mergeClubs(fromId: string, intoId: string): Promise<MergeClubsResult> {
  return withTransaction((client) => mergeClubsInTx(client, fromId, intoId));
}

/** Resuelve un club por slug vigente o antiguo (redirigido). */
export async function findClubIdBySlug(slug: string, client: Ejecutor = db): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM clubs WHERE slug = $1
     UNION ALL
     SELECT club_id FROM club_slug_redirects WHERE old_slug = $1
     LIMIT 1`,
    [slug],
  );
  return rows[0]?.id ?? null;
}

export class RenameClubError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'slug_taken') {
    super(message);
    this.name = 'RenameClubError';
  }
}

/**
 * Cambia nombre y/o slug de un club. El slug anterior queda redirigiendo al
 * club (308). Slug ocupado por otro club (vigente o antiguo) → error.
 */
export async function renameClubInTx(
  client: Ejecutor,
  id: string,
  patch: { canonicalName?: string; slug?: string },
): Promise<{ slug: string; canonicalName: string }> {
  const current = (await client.query<{ slug: string; sport_id: string }>(
    'SELECT slug, sport_id FROM clubs WHERE id = $1 FOR UPDATE', [id],
  )).rows[0];
  if (!current) throw new RenameClubError('club inexistente', 'not_found');

  if (patch.slug && patch.slug !== current.slug) {
    const taken = await client.query(
      `SELECT 1 FROM clubs WHERE sport_id = $1 AND slug = $2 AND id <> $3
       UNION ALL
       SELECT 1 FROM club_slug_redirects WHERE old_slug = $2 AND club_id <> $3`,
      [current.sport_id, patch.slug, id],
    );
    if ((taken.rowCount ?? 0) > 0) throw new RenameClubError(`slug "${patch.slug}" ocupado por otro club`, 'slug_taken');
    await client.query('DELETE FROM club_slug_redirects WHERE old_slug = $1', [patch.slug]);
    await client.query(
      `INSERT INTO club_slug_redirects (old_slug, club_id) VALUES ($1, $2)
       ON CONFLICT (old_slug) DO UPDATE SET club_id = EXCLUDED.club_id`,
      [current.slug, id],
    );
  }
  const row = (await client.query<{ slug: string; canonical_name: string }>(
    `UPDATE clubs SET canonical_name = COALESCE($2, canonical_name), slug = COALESCE($3, slug), updated_at = NOW()
      WHERE id = $1 RETURNING slug, canonical_name`,
    [id, patch.canonicalName ?? null, patch.slug ?? null],
  )).rows[0]!;
  return { slug: row.slug, canonicalName: row.canonical_name };
}

import { db } from '../client.js';

export interface DbSport {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
}

export interface DbDataSource {
  id: string;
  name: string;
  base_url: string;
  scraper_key: string;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function findSportBySlug(slug: string): Promise<DbSport | null> {
  const result = await db.query<DbSport>(
    'SELECT * FROM sports WHERE slug = $1',
    [slug]
  );
  return result.rows[0] ?? null;
}

export async function findDataSourceByKey(scraperKey: string): Promise<DbDataSource | null> {
  const result = await db.query<DbDataSource>(
    'SELECT * FROM data_sources WHERE scraper_key = $1 AND is_active = TRUE',
    [scraperKey]
  );
  return result.rows[0] ?? null;
}

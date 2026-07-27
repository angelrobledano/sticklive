/**
 * Migración 038 — `competitions.name_i18n`.
 *
 * Lo que hay que garantizar: que la columna existe como jsonb, que el backfill
 * deja `{es: name}` en lo preexistente, que una fila nueva puede llevar varias
 * traducciones. La selección del idioma la hace la web (helper
 * `competitionName`), pero la BD tiene que entregar el jsonb tal cual.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { crearDeporte } from './support/factorias.js';

let sportId: string;

beforeAll(async () => {
  sportId = await crearDeporte();
});

afterAll(async () => {
  await closeDb();
});

async function crearCompeticion(name: string, nameI18n: object | null): Promise<string> {
  const slug = `comp-${Math.random().toString(36).slice(2)}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO competitions (sport_id, name, slug, name_i18n)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [sportId, name, slug, nameI18n]
  );
  return rows[0]!.id;
}

describe('migración 038 — competition name_i18n', () => {
  it('la columna existe y es jsonb', async () => {
    const { rows } = await db.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'competitions' AND column_name = 'name_i18n'`
    );
    expect(rows[0]?.data_type).toBe('jsonb');
  });

  it('el backfill deja {es: name} en las filas sin traducción', async () => {
    // Simula una fila preexistente (name_i18n NULL) y aplica el backfill de la 038.
    const id = await crearCompeticion('OK Liga', null);
    await db.query(
      `UPDATE competitions SET name_i18n = jsonb_build_object('es', name) WHERE name_i18n IS NULL`
    );
    const { rows } = await db.query<{ name_i18n: Record<string, string> }>(
      `SELECT name_i18n FROM competitions WHERE id = $1`, [id]
    );
    expect(rows[0]?.name_i18n).toEqual({ es: 'OK Liga' });
  });

  it('guarda y devuelve varias traducciones tal cual', async () => {
    const id = await crearCompeticion('Campeonato de Europa Sub-17', {
      es: 'Campeonato de Europa Sub-17',
      en: 'U17 European Championship',
      it: 'Campionato Europeo Under 17',
    });
    const { rows } = await db.query<{ name_i18n: Record<string, string> }>(
      `SELECT name_i18n FROM competitions WHERE id = $1`, [id]
    );
    expect(rows[0]?.name_i18n.en).toBe('U17 European Championship');
    expect(rows[0]?.name_i18n.it).toBe('Campionato Europeo Under 17');
  });

  it('name_i18n admite NULL (los loaders siguen escribiendo sólo name)', async () => {
    const id = await crearCompeticion('Copa sin traducir', null);
    const { rows } = await db.query<{ name: string; name_i18n: unknown }>(
      `SELECT name, name_i18n FROM competitions WHERE id = $1`, [id]
    );
    expect(rows[0]?.name).toBe('Copa sin traducir');
    expect(rows[0]?.name_i18n).toBeNull();
  });
});

/**
 * `partition-guard` — la guarda diaria del particionado de match_events (047).
 *
 * Cubre las dos cosas que hace: asegurar (idempotente) las particiones de las
 * próximas temporadas, y contar la partición centinela `match_events_undated`
 * para avisar de partidos sin fecha.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';
import { seasonYear, ensurePartitions, checkUndated } from '../../apps/etl/src/partition-guard.js';

beforeEach(async () => {
  await limpiar();
});

afterAll(async () => {
  await closeDb();
});

describe('partition-guard', () => {
  it('seasonYear: la temporada de hockey arranca el 1 de agosto', () => {
    expect(seasonYear(new Date('2026-09-15T00:00:00Z'))).toBe(2026);
    expect(seasonYear(new Date('2026-08-01T00:00:00Z'))).toBe(2026);
    expect(seasonYear(new Date('2026-07-31T00:00:00Z'))).toBe(2025);
    expect(seasonYear(new Date('2026-03-15T00:00:00Z'))).toBe(2025);
  });

  it('ensurePartitions crea las particiones futuras y es idempotente', async () => {
    // Temporada lejana que ningún otro test usa (la 047 llega hasta 2035/36).
    const base = 2040;
    const primera = await ensurePartitions(base, 2);
    expect(primera).toEqual([
      'match_events_s2040',
      'match_events_s2041',
      'match_events_s2042',
    ]);

    // Existen de verdad como particiones (tablas ordinarias).
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class
        WHERE relname IN ('match_events_s2040', 'match_events_s2041', 'match_events_s2042')
          AND relkind = 'r'`,
    );
    expect(Number(rows[0]!.n)).toBe(3);

    // Segunda pasada: no lanza (CREATE TABLE IF NOT EXISTS).
    await expect(ensurePartitions(base, 2)).resolves.not.toThrow();

    // Limpieza: se dropean las particiones lejanas para no dejarlas sueltas en
    // la BD compartida entre tests (el TRUNCATE del padre no las quita).
    await db.query('DROP TABLE match_events_s2040, match_events_s2041, match_events_s2042');
  });

  it('checkUndated cuenta los eventos de partidos sin fecha (centinela)', async () => {
    expect(await checkUndated()).toBe(0);

    const esc = await crearPartido({ status: 'scheduled' });
    // Partido sin fecha: su evento cae en match_events_undated (COALESCE a 1900).
    await db.query(
      'UPDATE matches SET scheduled_at = NULL, finished_at = NULL WHERE id = $1',
      [esc.matchId],
    );
    await db.query(
      `INSERT INTO match_events (match_id, event_type, source_ref, match_date)
       VALUES ($1, 'goal', 'x',
               (SELECT COALESCE(scheduled_at::date, finished_at::date, DATE '1900-01-01') FROM matches WHERE id = $1))`,
      [esc.matchId],
    );

    expect(await checkUndated()).toBe(1);

    // Sanidad: el evento está en la partición centinela.
    const { rows } = await db.query<{ p: string }>(
      `SELECT tableoid::regclass::text AS p FROM match_events WHERE match_id = $1`,
      [esc.matchId],
    );
    expect(rows[0]!.p).toBe('match_events_undated');
  });
});

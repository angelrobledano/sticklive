/**
 * Fase 0.2 — backfill del modelo de clubes (Entity Resolution).
 *
 * Cubre los 7 invariantes bloqueantes del spec (docs/SPEC_FASE0_MODELO_CLUBS.md
 * §6). Postgres real, migraciones reales: el backfill se ejecuta exactamente
 * igual que en producción (mismo pool, misma transacción).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearFuente, crearEquipo, crearPartido } from './support/factorias.js';
import {
  backfillClubs,
  revertBackfillClubs,
  TEMPORADA_ACTUAL_INICIO,
} from '../../apps/etl/src/backfill-clubs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRACION_044 = join(HERE, '../../packages/db/migrations/044_clubs_model.sql');

let sportId: string;
let fepSourceId: string;
let seq = 0;

/** Team con trazabilidad de fuente (lo que el backfill mapea a source_entity_map). */
async function crearEquipoConFuente(opts: {
  sourceId: string;
  sourceRef: string;
  altSourceRefs?: string[];
}): Promise<string> {
  seq += 1;
  const slug = `equipo-fuente-${seq}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, city, country, logo_url,
                        source_id, source_ref, alt_source_refs)
     VALUES ($1, $2, $3, 'Sevilla', 'ES', 'https://ejemplo.invalido/logo.png',
             $4, $5, $6)
     RETURNING id`,
    [sportId, slug, slug, opts.sourceId, opts.sourceRef, opts.altSourceRefs ?? []],
  );
  return rows[0]!.id;
}

async function contar(tabla: string, where = ''): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM ${tabla} ${where}`,
  );
  return Number(rows[0]!.n);
}

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
  fepSourceId = await crearFuente('fep_hockey');
});

afterAll(async () => {
  await closeDb();
});

describe('Fase 0.2 — backfill de clubes', () => {
  it('1) la migración 044 dejó el esquema esperado y re-aplicarla es idempotente', async () => {
    const { rows: tablas } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('clubs', 'sponsors', 'club_names', 'source_entity_map')`,
    );
    expect(tablas.map((r) => r.table_name).sort()).toEqual([
      'club_names', 'clubs', 'source_entity_map', 'sponsors',
    ]);

    const { rows: cols } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'teams' AND column_name IN ('club_id', 'squad_level')`,
    );
    expect(cols.map((r) => r.column_name).sort()).toEqual(['club_id', 'squad_level']);

    // El CHECK de "exactamente una entidad" existe.
    const { rows: chk } = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'source_entity_map' AND c.contype = 'c'`,
    );
    expect(chk.some((r) => r.def.includes('num_nonnulls'))).toBe(true);

    // Re-aplicar la migración completa no falla (todo IF NOT EXISTS / idempotente).
    const sql = readFileSync(MIGRACION_044, 'utf-8');
    await expect(db.query(sql)).resolves.toBeDefined();
  });

  it('2) tras el backfill ningún team queda sin club (cobertura total)', async () => {
    await crearEquipo(sportId);
    await crearEquipoConFuente({ sourceId: fepSourceId, sourceRef: 'fep_team_1' });
    await crearEquipoConFuente({
      sourceId: fepSourceId, sourceRef: 'fep_team_2', altSourceRefs: ['fep_club_71'],
    });

    await backfillClubs();

    expect(await contar('teams', 'WHERE club_id IS NULL')).toBe(0);
  });

  it('3) 1:1 sin cruce: nº clubs = nº teams y cada team apunta a su propio club', async () => {
    await crearEquipo(sportId);
    await crearEquipo(sportId);
    await crearEquipoConFuente({ sourceId: fepSourceId, sourceRef: 'fep_team_3' });

    await backfillClubs();

    expect(await contar('clubs')).toBe(await contar('teams'));

    // Ningún team enlaza el club de otro (slug de team == slug de su club).
    expect(
      await contar('teams t JOIN clubs c ON c.id = t.club_id', 'WHERE c.slug <> t.slug'),
    ).toBe(0);

    // Ningún club es compartido por más de un team.
    const { rows: compartidos } = await db.query<{ club_id: string }>(
      `SELECT club_id FROM teams GROUP BY club_id HAVING COUNT(*) > 1`,
    );
    expect(compartidos).toHaveLength(0);
  });

  it('4) source_entity_map refleja source_ref y cada alt_source_ref sin violar el CHECK', async () => {
    const teamId = await crearEquipoConFuente({
      sourceId: fepSourceId,
      sourceRef: 'fep_team_9',
      altSourceRefs: ['fep_club_71', 'fep_club_72'],
    });

    await backfillClubs();

    const { rows } = await db.query<{ source_ref: string; team_id: string | null; club_id: string | null }>(
      `SELECT source_ref, team_id, club_id FROM source_entity_map
        WHERE source_id = $1 ORDER BY source_ref`,
      [fepSourceId],
    );
    expect(rows.map((r) => r.source_ref)).toEqual(['fep_club_71', 'fep_club_72', 'fep_team_9']);
    // Todas apuntan al team correcto, con club_id NULL (CHECK: exactamente una entidad).
    for (const r of rows) {
      expect(r.team_id).toBe(teamId);
      expect(r.club_id).toBeNull();
    }
  });

  it('5) el backfill es idempotente: re-ejecutar no duplica', async () => {
    await crearEquipo(sportId);
    await crearEquipoConFuente({
      sourceId: fepSourceId, sourceRef: 'fep_team_5', altSourceRefs: ['fep_club_5'],
    });

    const primera = await backfillClubs();
    const clubsTrasPrimera = await contar('clubs');
    const mapTrasPrimera = await contar('source_entity_map');

    const segunda = await backfillClubs();

    expect(segunda.clubsCreados).toBe(0);
    expect(segunda.mapeosCreados).toBe(0);
    expect(segunda.clubNamesCreados).toBe(0);
    expect(await contar('clubs')).toBe(clubsTrasPrimera);
    expect(await contar('source_entity_map')).toBe(mapTrasPrimera);
    expect(primera.clubsCreados).toBe(await contar('teams'));
  });

  it('6) la Fase 0 no altera la relación del directo (home/away team_id intactos)', async () => {
    const p = await crearPartido();

    const antes = await db.query<{ home_team_id: string; away_team_id: string }>(
      `SELECT home_team_id, away_team_id FROM matches WHERE id = $1`,
      [p.matchId],
    );

    await backfillClubs();

    const despues = await db.query<{ home_team_id: string; away_team_id: string }>(
      `SELECT home_team_id, away_team_id FROM matches WHERE id = $1`,
      [p.matchId],
    );
    expect(despues.rows[0]).toEqual(antes.rows[0]);
    // Y ambos teams del partido quedaron enlazados a su club.
    expect(await contar('teams', `WHERE id IN ('${p.homeTeamId}', '${p.awayTeamId}') AND club_id IS NULL`)).toBe(0);
  });

  it('7) reversibilidad: el revert deja teams idéntico y vacía las tablas nuevas', async () => {
    await crearEquipo(sportId);
    await crearEquipoConFuente({
      sourceId: fepSourceId, sourceRef: 'fep_team_7', altSourceRefs: ['fep_club_7'],
    });

    const snapshot = async () => (
      await db.query(
        `SELECT id, club_id, squad_level, name, slug, source_ref
           FROM teams ORDER BY id`,
      )
    ).rows;

    const antes = await snapshot();
    expect(antes.every((t: any) => t.club_id === null)).toBe(true);

    await backfillClubs();
    await revertBackfillClubs();

    expect(await snapshot()).toEqual(antes);
    expect(await contar('clubs')).toBe(0);
    expect(await contar('club_names')).toBe(0);
    expect(await contar('source_entity_map')).toBe(0);
  });

  it('usa el inicio de temporada configurado para el club_name inicial', async () => {
    await crearEquipo(sportId);
    await backfillClubs();
    const { rows } = await db.query<{ valid_from: string }>(
      `SELECT valid_from::text FROM club_names LIMIT 1`,
    );
    expect(rows[0]!.valid_from).toBe(TEMPORADA_ACTUAL_INICIO);
  });
});

/**
 * Fase 3 — auto-confirmación con señales de dominio (escalón 3).
 *
 * La máquina resuelve sola SÓLO con similitud ≥0.95 Y señales consistentes
 * (género + categoría) Y candidato inequívoco. Sin señales, o con duda, se
 * encola. Verificado contra Postgres real.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb,
  autoConfirmTeam,
  getSeasonSignals,
  upsertTeamAlias,
} from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearFuente } from './support/factorias.js';
import { RefResolver } from '../../apps/etl/src/loaders/ref-resolver.js';

let sportId: string;
let sourceId: string;
let seq = 0;

async function crearEquipoConSenales(
  nombre: string, gender: string, ageCategory: string,
): Promise<string> {
  seq += 1;
  const slug = `ac-team-${seq}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, gender, age_category)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sportId, nombre, slug, gender, ageCategory],
  );
  return rows[0]!.id;
}

async function contarCola(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM resolution_queue`);
  return Number(rows[0]!.n);
}

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
  sourceId = await crearFuente('fep_hockey');
});

afterAll(async () => {
  await closeDb();
});

describe('Fase 3 — auto-confirmación con señales', () => {
  it('autoConfirmTeam devuelve el team con similitud ≥0.95 y señales consistentes', async () => {
    const teamId = await crearEquipoConSenales('Club Patin Voltrega', 'male', 'senior');
    await upsertTeamAlias({
      teamId, rawText: 'Club Patin Voltrega', normalized: 'club patin voltrega', createdBy: 'deterministic',
    });

    const auto = await autoConfirmTeam('club patin voltrega', sportId, 'male', 'senior');
    expect(auto?.teamId).toBe(teamId);
    expect(auto!.score).toBeGreaterThanOrEqual(0.95);
  });

  it('no auto-confirma si el género no coincide (señal inconsistente)', async () => {
    const teamId = await crearEquipoConSenales('Club Patin Voltrega', 'male', 'senior');
    await upsertTeamAlias({ teamId, rawText: 'x', normalized: 'club patin voltrega', createdBy: 'deterministic' });

    expect(await autoConfirmTeam('club patin voltrega', sportId, 'female', 'senior')).toBeNull();
  });

  it('no auto-confirma por debajo del umbral (similitud baja)', async () => {
    const teamId = await crearEquipoConSenales('Club Patin Voltrega', 'male', 'senior');
    await upsertTeamAlias({ teamId, rawText: 'x', normalized: 'club patin voltrega', createdBy: 'deterministic' });

    expect(await autoConfirmTeam('reus deportiu', sportId, 'male', 'senior')).toBeNull();
  });

  it('no auto-confirma si hay empate entre candidatos (ambiguo)', async () => {
    const t1 = await crearEquipoConSenales('Uno', 'male', 'senior');
    const t2 = await crearEquipoConSenales('Dos', 'male', 'senior');
    // Dos teams con el MISMO nombre normalizado y señales → empate → no se decide.
    await upsertTeamAlias({ teamId: t1, rawText: 'a', normalized: 'club patin voltrega', sourceId, createdBy: 'deterministic' });
    await upsertTeamAlias({ teamId: t2, rawText: 'b', normalized: 'club patin voltrega', createdBy: 'deterministic' });

    expect(await autoConfirmTeam('club patin voltrega', sportId, 'male', 'senior')).toBeNull();
  });

  it('getSeasonSignals lee género/categoría de la competición', async () => {
    const { rows: comp } = await db.query<{ id: string }>(
      `INSERT INTO competitions (sport_id, name, slug, source_ref, gender, age_category)
       VALUES ($1, 'OK Liga', 'okl', 'fep_c_1', 'male', 'senior') RETURNING id`,
      [sportId],
    );
    const { rows: se } = await db.query<{ id: string }>(
      `INSERT INTO seasons (competition_id, name, slug, is_current) VALUES ($1, '25-26', '2526', true) RETURNING id`,
      [comp[0]!.id],
    );
    expect(await getSeasonSignals(se[0]!.id)).toEqual({ gender: 'male', ageCategory: 'senior' });
  });

  it('el resolver NO auto-confirma con señales pero baja similitud: encola', async () => {
    const teamId = await crearEquipoConSenales('Club Patin Voltrega', 'male', 'senior');
    await upsertTeamAlias({ teamId, rawText: 'x', normalized: 'club patin voltrega', createdBy: 'deterministic' });

    const resolver = new RefResolver(sportId);
    await expect(
      resolver.resolveTeam('Reus Deportiu', sourceId, { gender: 'male', ageCategory: 'senior' }),
    ).rejects.toThrow(/No se encontró equipo/);
    expect(await contarCola()).toBe(1); // encolado, no auto-confirmado
  });

  it('el resolver no auto-confirma sin señales', async () => {
    const teamId = await crearEquipoConSenales('Club Patin Voltrega', 'male', 'senior');
    await upsertTeamAlias({ teamId, rawText: 'x', normalized: 'club patin voltrega', createdBy: 'deterministic' });

    const resolver = new RefResolver(sportId);
    await expect(resolver.resolveTeam('Reus Deportiu', sourceId)).rejects.toThrow(/No se encontró equipo/);
    expect(await contarCola()).toBe(1);
  });
});

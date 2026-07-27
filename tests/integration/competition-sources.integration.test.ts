/**
 * Migración 040 + helper de competition_sources (punto 10, Fase 1).
 *
 * La tabla guarda la configuración de scraping por competición. Nada la lee aún
 * en runtime (eso es la Fase 2), pero el helper y el esquema tienen que estar
 * bien: es la base sobre la que se construye el resto del punto 10.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb,
  upsertCompetitionSource,
  getActiveCompetitionSources,
  getActiveCompetitionSourcesByScraper,
  getActiveScrapePlan,
} from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearFuente, crearCompeticion, crearTemporada } from './support/factorias.js';

let sportId: string;
let fepSourceId: string;
let wseSourceId: string;

beforeAll(async () => {
  await limpiar();
  sportId = await crearDeporte();
});

beforeEach(async () => {
  await db.query('DELETE FROM competition_sources');
  fepSourceId = await crearFuente('fep_hockey');
  wseSourceId = await crearFuente('worldskate_hockey');
});

afterAll(async () => {
  await closeDb();
});

describe('migración 040 — competition_sources', () => {
  it('la tabla existe con las columnas esperadas', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'competition_sources'`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining([
      'competition_id', 'source_id', 'external_ids', 'poll_policy', 'is_active',
    ]));
  });

  it('una competición no puede tener dos configuraciones (UNIQUE)', async () => {
    const compId = await crearCompeticion(sportId, 'fep_competition_3150');
    await upsertCompetitionSource({ competitionId: compId, sourceId: fepSourceId, externalIds: { idc: '3150' } });
    // El segundo upsert NO crea otra fila: actualiza la existente.
    await upsertCompetitionSource({ competitionId: compId, sourceId: fepSourceId, externalIds: { idc: '3150', playoff_idcs: ['3481'] } });
    const { rows } = await db.query('SELECT id FROM competition_sources WHERE competition_id = $1', [compId]);
    expect(rows).toHaveLength(1);
  });
});

describe('helper de competition_sources', () => {
  it('guarda y devuelve external_ids con secundarios', async () => {
    const compId = await crearCompeticion(sportId, 'fep_competition_3150');
    await upsertCompetitionSource({
      competitionId: compId, sourceId: fepSourceId,
      externalIds: { idc: '3150', playoff_idcs: ['3481'], cup_idcs: [] },
      pollPolicy: { liveIntervalS: 45, windowHours: 2 },
    });

    const [cs] = await getActiveCompetitionSources();
    expect(cs!.externalIds.idc).toBe('3150');
    expect(cs!.externalIds.playoff_idcs).toEqual(['3481']);
    expect(cs!.pollPolicy).toEqual({ liveIntervalS: 45, windowHours: 2 });
    expect(cs!.scraperKey).toBe('fep_hockey');
  });

  it('poll_policy admite NULL (usar defaults de cron-live)', async () => {
    const compId = await crearCompeticion(sportId, 'fep_competition_3150');
    await upsertCompetitionSource({ competitionId: compId, sourceId: fepSourceId, externalIds: { idc: '3150' } });
    const [cs] = await getActiveCompetitionSources();
    expect(cs!.pollPolicy).toBeNull();
  });

  it('filtra por scraper', async () => {
    const fepComp = await crearCompeticion(sportId, 'fep_competition_3150');
    const wseComp = await crearCompeticion(sportId, 'wse_competition_320');
    await upsertCompetitionSource({ competitionId: fepComp, sourceId: fepSourceId, externalIds: { idc: '3150' } });
    await upsertCompetitionSource({ competitionId: wseComp, sourceId: wseSourceId, externalIds: { idc: '320' } });

    const fep = await getActiveCompetitionSourcesByScraper('fep_hockey');
    const wse = await getActiveCompetitionSourcesByScraper('worldskate_hockey');
    expect(fep.map((c) => c.externalIds.idc)).toEqual(['3150']);
    expect(wse.map((c) => c.externalIds.idc)).toEqual(['320']);
  });

  it('is_active=false queda fuera de las consultas de activas', async () => {
    const compId = await crearCompeticion(sportId, 'fep_competition_3150');
    await upsertCompetitionSource({ competitionId: compId, sourceId: fepSourceId, externalIds: { idc: '3150' }, isActive: false });
    expect(await getActiveCompetitionSources()).toHaveLength(0);
  });
});

describe('getActiveScrapePlan — plan del modo multi (Fase 2)', () => {
  it('resuelve la temporada vigente y los idc (primario + playoff)', async () => {
    const compId = await crearCompeticion(sportId, 'fep_competition_3150');
    const seasonId = await crearTemporada(compId, { esActual: true });
    await upsertCompetitionSource({
      competitionId: compId, sourceId: fepSourceId,
      externalIds: { idc: '3150', playoff_idcs: ['3481'] },
    });

    const plan = await getActiveScrapePlan('fep_hockey');
    expect(plan).toHaveLength(1);
    expect(plan[0]!.seasonId).toBe(seasonId);
    expect(plan[0]!.primaryIdc).toBe('3150');
    expect(plan[0]!.playoffIdcs).toEqual(['3481']);
  });

  it('sin secundarios, playoffIdcs es un array vacío', async () => {
    const compId = await crearCompeticion(sportId, 'fep_competition_3258');
    await crearTemporada(compId, { esActual: true });
    await upsertCompetitionSource({ competitionId: compId, sourceId: fepSourceId, externalIds: { idc: '3258' } });

    const [item] = await getActiveScrapePlan('fep_hockey');
    expect(item!.primaryIdc).toBe('3258');
    expect(item!.playoffIdcs).toEqual([]);
  });

  it('una competición activa SIN temporada is_current sale con seasonId null (el runner la omite)', async () => {
    const compId = await crearCompeticion(sportId, 'fep_competition_3150');
    // Temporada existente pero NO vigente.
    await crearTemporada(compId, { esActual: false });
    await upsertCompetitionSource({ competitionId: compId, sourceId: fepSourceId, externalIds: { idc: '3150' } });

    const [item] = await getActiveScrapePlan('fep_hockey');
    expect(item!.seasonId).toBeNull();
  });

  it('is_active=false no entra en el plan', async () => {
    const compId = await crearCompeticion(sportId, 'fep_competition_3150');
    await crearTemporada(compId, { esActual: true });
    await upsertCompetitionSource({ competitionId: compId, sourceId: fepSourceId, externalIds: { idc: '3150' }, isActive: false });

    expect(await getActiveScrapePlan('fep_hockey')).toHaveLength(0);
  });

  it('sólo devuelve las del scraper pedido', async () => {
    const fepComp = await crearCompeticion(sportId, 'fep_competition_3150');
    const wseComp = await crearCompeticion(sportId, 'wse_competition_320');
    await crearTemporada(fepComp, { esActual: true });
    await crearTemporada(wseComp, { esActual: true });
    await upsertCompetitionSource({ competitionId: fepComp, sourceId: fepSourceId, externalIds: { idc: '3150' } });
    await upsertCompetitionSource({ competitionId: wseComp, sourceId: wseSourceId, externalIds: { idc: '320' } });

    const fep = await getActiveScrapePlan('fep_hockey');
    expect(fep.map((p) => p.primaryIdc)).toEqual(['3150']);
  });
});

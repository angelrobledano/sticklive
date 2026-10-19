/**
 * Reparación one-off: separar fichas de equipo que mezclan secciones M/F.
 *
 * Causa: el resolver aceptaba un nombre/alias sin comprobar el género de la
 * competición. Un equipo femenino podía quedarse con la clasificación (y los
 * partidos) de la liga masculina homónima, y al revés. La ficha resultante
 * abría en la liga equivocada (caso CH MATARÓ → OK Liga Plata Sur).
 *
 * Este script, por cada caso del MAPPING:
 *   · localiza la ficha femenina y la masculina (o crea la masculina),
 *   · mueve los datos de cada sección a su ficha (partidos, clasificación,
 *     season_teams, plantilla, eventos y alineaciones),
 *   · fija género/categoría y los mapeos de las refs actuales,
 *   · deja la ficha femenina con la ref femenina y la masculina con la suya.
 *
 * Dry-run por defecto (ejecuta todo dentro de una transacción y hace ROLLBACK).
 * `--write` aplica. Idempotente: una segunda pasada no mueve nada.
 *
 *   npx tsx --env-file=.env apps/etl/src/repair-section-teams.ts
 *   npx tsx --env-file=.env apps/etl/src/repair-section-teams.ts --write
 *
 * En producción (runtime compilado):
 *   node dist/apps/etl/src/repair-section-teams.js
 *   node dist/apps/etl/src/repair-section-teams.js --write
 */
import { db, closeDb } from '@sports/db';
import type { PoolClient } from 'pg';

const argv = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }),
) as Record<string, string>;
const WRITE = argv['write'] === 'true' || argv['write'] === '1';

type Cliente = PoolClient;

interface Caso {
  label: string;
  /** Slug estable de la ficha que debe quedar como FEMENINA. */
  femaleSlug: string;
  /** Slug estable de la ficha que debe quedar como MASCULINA. */
  maleSlug: string;
  /** Ref de la fuente de la temporada actual (se mapea a cada ficha). */
  femaleCurrentRef?: string;
  maleCurrentRef?: string;
  /** Competición actual donde cada ficha debe tener plaza (season_teams). */
  femaleCurrentComp?: string;
  maleCurrentComp?: string;
  /** Si la ficha masculina no existe, se crea con esta ref. */
  createMale?: boolean;
  /** Ref antigua del equipo masculino que vive en la ficha femenina. */
  oldMaleRef?: string;
}

const MAPPING: Caso[] = [
  {
    label: 'CH MATARÓ',
    femaleSlug: 'ch-mataro',
    maleSlug: 'ch-mataro-m',
    femaleCurrentRef: '3726',
    maleCurrentRef: '3725',
    femaleCurrentComp: 'ok-liga-femenina',
    maleCurrentComp: 'ok-liga-plata-sur',
    createMale: true,
    oldMaleRef: '3402',
  },
  {
    label: 'CLUB PATÍN ALCORCÓN',
    femaleSlug: 'club-patin-alcorcon',
    maleSlug: 'club-patin-alcorcon-m',
    femaleCurrentRef: '3751',
    maleCurrentRef: '3750',
    femaleCurrentComp: 'ok-liga-plata-femenina',
    maleCurrentComp: 'ok-liga-bronce-masculina-sur',
    createMale: true,
    oldMaleRef: '3398',
  },
  {
    label: "CERDANYOLA CLUB D'HOQUEI",
    femaleSlug: 'cerdanyola-club-d-hoquei',
    maleSlug: 'cerdanyola-club-dhoquei',
    femaleCurrentRef: '3745',
    maleCurrentRef: '3746',
    femaleCurrentComp: 'ok-liga-femenina',
    maleCurrentComp: 'ok-liga-plata-sur',
  },
  {
    label: 'MARTINELIA MANLLEU',
    femaleSlug: 'martinelia-manlleu',
    maleSlug: 'martinelia-manlleu-m',
    femaleCurrentRef: '3758',
    maleCurrentRef: '3759',
    femaleCurrentComp: 'ok-liga-femenina',
    maleCurrentComp: 'ok-liga-plata-sur',
  },
  {
    label: 'CLUB PATIN LAS ROZAS',
    femaleSlug: 'club-patin-las-rozas',
    maleSlug: 'club-patin-las-rozas-m',
    femaleCurrentRef: '3693',
    maleCurrentRef: '3694',
    femaleCurrentComp: 'ok-liga-plata-femenina',
    maleCurrentComp: 'ok-liga-bronce-masculina-sur',
  },
  {
    label: 'CLUB PROMOCIÓN PATÍN RASPEIG',
    femaleSlug: 'club-promocion-patin-raspeig',
    maleSlug: 'club-promocion-patin-raspeig-m',
    femaleCurrentRef: '3701',
    maleCurrentRef: '3700',
    femaleCurrentComp: 'ok-liga-plata-femenina',
    maleCurrentComp: 'ok-liga-bronce-masculina-sur',
  },
  {
    label: 'TELECABLE HOCKEY CLUB',
    femaleSlug: 'telecable-hockey-club',
    maleSlug: 'telecable-hockey-club-m',
    femaleCurrentRef: '3720',
    maleCurrentRef: '3719',
    femaleCurrentComp: 'ok-liga-femenina',
    maleCurrentComp: 'ok-liga-bronce-masculina-norte',
  },
  {
    label: 'TRAVIESAS HOCKEY CLUB',
    femaleSlug: 'traviesas-hockey-club',
    maleSlug: 'traviesas-hockey-club-m',
    femaleCurrentRef: '3681',
    maleCurrentRef: '3679',
    femaleCurrentComp: 'ok-liga-plata-femenina',
    maleCurrentComp: 'ok-liga-bronce-masculina-norte',
  },
  {
    label: 'OXIGEN PHC SANT CUGAT',
    femaleSlug: 'oxigen-phc-sant-cugat',
    maleSlug: 'oxigen-phc-sant-cugat-m',
    femaleCurrentRef: '3732',
    maleCurrentRef: '3733',
    femaleCurrentComp: 'ok-liga-femenina',
    maleCurrentComp: 'ok-liga-plata-norte',
  },
  {
    label: 'OVIEDO ROLLER HC',
    femaleSlug: 'oviedo-roller-hc',
    maleSlug: 'oviedo-roller-hc-m',
    femaleCurrentRef: '3677',
    maleCurrentRef: '3676',
    femaleCurrentComp: 'ok-liga-plata-femenina',
    maleCurrentComp: 'ok-liga-plata-norte',
  },
  {
    // Solo aparece en la eliminatoria masculina (1 partido); no tiene ref de
    // liga actual. Se crea la ficha masculina y se mueve allí el partido.
    label: 'IMÁN SERROUKH COSLADA RH',
    femaleSlug: 'iman-serroukh-coslada-rh',
    maleSlug: 'iman-serroukh-coslada-rh-m',
    femaleCurrentComp: 'ok-liga-plata-femenina',
    maleCurrentComp: 'ok-liga-plata-masculina-eliminatoria',
    createMale: true,
  },
];

/**
 * Equipos que no mezclan secciones, pero cuya ref actual quedó sin mapear tras
 * una resolución humana (`source_entity_map` no se escribía). Sin el mapa, el
 * calendario no puede cargar sus partidos y la liga queda incompleta. Solo
 * rellena el mapa y la plaza de temporada; no mueve datos.
 */
interface MapaSuelto {
  label: string;
  /** Ref antigua que identifica la ficha del equipo. */
  teamRef: string;
  /** Ref de la fuente en la temporada actual. */
  currentRef: string;
  compSlug: string;
}

const MAP_ONLY: MapaSuelto[] = [
  { label: 'SD ESPANYOL', teamRef: '3352', currentRef: '3699', compSlug: 'ok-liga-plata-sur' },
  { label: 'SPORTING ALCOI ERUM', teamRef: '3351', currentRef: '3683', compSlug: 'ok-liga-plata-sur' },
];

interface TeamRow {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  gender: string | null;
  age_category: string | null;
  country: string;
  sport_id: string;
  source_id: string | null;
  source_ref: string | null;
  club_id: string | null;
}

interface Moves {
  matches: number;
  standings: number;
  seasonTeams: number;
  teamPlayers: number;
  events: number;
  lineups: number;
}

interface CasoReport {
  label: string;
  female: string;
  male: string;
  created: boolean;
  maleMoves: Moves;
  femaleMoves: Moves;
}

const ZERO: Moves = { matches: 0, standings: 0, seasonTeams: 0, teamPlayers: 0, events: 0, lineups: 0 };

async function findTeam(tx: Cliente, slug: string): Promise<TeamRow | null> {
  const { rows } = await tx.query<TeamRow>(
    `SELECT id, name, short_name, slug, gender, age_category, country, sport_id,
            source_id, source_ref, club_id
       FROM teams WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

async function findTeamByRef(tx: Cliente, ref: string): Promise<TeamRow | null> {
  const { rows } = await tx.query<TeamRow>(
    `SELECT id, name, short_name, slug, gender, age_category, country, sport_id,
            source_id, source_ref, club_id
       FROM teams
      WHERE source_ref = $1 OR $1 = ANY(alt_source_refs)
      ORDER BY (source_ref = $1) DESC
      LIMIT 1`,
    [ref],
  );
  return rows[0] ?? null;
}

async function createMaleTeam(tx: Cliente, c: Caso, female: TeamRow): Promise<TeamRow> {
  const { rows } = await tx.query<TeamRow>(
    `INSERT INTO teams
       (sport_id, name, short_name, slug, gender, age_category, squad_level,
        country, source_id, source_ref, club_id, alt_source_refs, scraped_at)
     VALUES ($1,$2,$3,$4,'male','senior',1,$5,$6,$7,$8,$9,NOW())
     RETURNING id, name, short_name, slug, gender, age_category, country, sport_id,
               source_id, source_ref, club_id`,
    [
      female.sport_id,
      female.name,
      female.short_name,
      c.maleSlug,
      female.country,
      female.source_id,
      c.maleCurrentRef ?? c.oldMaleRef ?? null,
      female.club_id,
      c.oldMaleRef ? [c.oldMaleRef] : [],
    ],
  );
  return rows[0]!;
}

async function countSection(tx: Cliente, teamId: string, gender: 'male' | 'female'): Promise<Moves> {
  const { rows } = await tx.query<Moves>(
    `SELECT
       (SELECT count(*)::int FROM matches m
          JOIN seasons se ON se.id = m.season_id
          JOIN competitions c ON c.id = se.competition_id
         WHERE (m.home_team_id = $1 OR m.away_team_id = $1) AND c.gender = $2) AS matches,
       (SELECT count(*)::int FROM standings st
          JOIN seasons se ON se.id = st.season_id
          JOIN competitions c ON c.id = se.competition_id
         WHERE st.team_id = $1 AND c.gender = $2) AS standings,
       (SELECT count(*)::int FROM season_teams st
          JOIN seasons se ON se.id = st.season_id
          JOIN competitions c ON c.id = se.competition_id
         WHERE st.team_id = $1 AND c.gender = $2) AS "seasonTeams",
       (SELECT count(*)::int FROM team_players tp
          JOIN seasons se ON se.id = tp.season_id
          JOIN competitions c ON c.id = se.competition_id
         WHERE tp.team_id = $1 AND c.gender = $2) AS "teamPlayers",
       (SELECT count(*)::int FROM match_events e
          JOIN matches m ON m.id = e.match_id
          JOIN seasons se ON se.id = m.season_id
          JOIN competitions c ON c.id = se.competition_id
         WHERE e.team_id = $1 AND c.gender = $2) AS events,
       (SELECT count(*)::int FROM match_lineups l
          JOIN matches m ON m.id = l.match_id
          JOIN seasons se ON se.id = m.season_id
          JOIN competitions c ON c.id = se.competition_id
         WHERE l.team_id = $1 AND c.gender = $2) AS lineups`,
    [teamId, gender],
  );
  return rows[0] ?? ZERO;
}

/**
 * Mueve a `toId` todo lo que cuelga de `fromId` en competiciones del género
 * indicado. Si el destino ya tiene una fila equivalente (clasificación o
 * plantilla), se descarta la del origen para no violar los UNIQUE.
 */
async function moveSection(tx: Cliente, fromId: string, toId: string, gender: 'male' | 'female'): Promise<void> {
  // Partidos (local y visitante).
  await tx.query(
    `UPDATE matches m SET home_team_id = $2
       FROM seasons se JOIN competitions c ON c.id = se.competition_id
      WHERE m.season_id = se.id AND c.gender = $3 AND m.home_team_id = $1`,
    [fromId, toId, gender],
  );
  await tx.query(
    `UPDATE matches m SET away_team_id = $2
       FROM seasons se JOIN competitions c ON c.id = se.competition_id
      WHERE m.season_id = se.id AND c.gender = $3 AND m.away_team_id = $1`,
    [fromId, toId, gender],
  );
  // Ganador derivado (prórroga/penaltis): también es una FK a teams.
  await tx.query(
    `UPDATE matches m SET winner_team_id = $2
       FROM seasons se JOIN competitions c ON c.id = se.competition_id
      WHERE m.season_id = se.id AND c.gender = $3 AND m.winner_team_id = $1`,
    [fromId, toId, gender],
  );

  // Clasificación: si el destino ya tiene (temporada, grupo), la fila del
  // origen es un duplicado y se borra.
  await tx.query(
    `DELETE FROM standings s
      USING standings t, seasons se, competitions c
      WHERE s.team_id = $1 AND t.team_id = $2
        AND s.season_id = t.season_id
        AND COALESCE(s.group_name, '') = COALESCE(t.group_name, '')
        AND s.season_id = se.id AND se.competition_id = c.id AND c.gender = $3`,
    [fromId, toId, gender],
  );
  await tx.query(
    `UPDATE standings s SET team_id = $2
       FROM seasons se JOIN competitions c ON c.id = se.competition_id
      WHERE s.season_id = se.id AND c.gender = $3 AND s.team_id = $1`,
    [fromId, toId, gender],
  );

  // Plazas de temporada.
  await tx.query(
    `INSERT INTO season_teams (season_id, team_id)
     SELECT st.season_id, $2
       FROM season_teams st
       JOIN seasons se ON se.id = st.season_id
       JOIN competitions c ON c.id = se.competition_id
      WHERE st.team_id = $1 AND c.gender = $3
     ON CONFLICT (season_id, team_id) DO NOTHING`,
    [fromId, toId, gender],
  );
  await tx.query(
    `DELETE FROM season_teams st
      USING seasons se, competitions c
      WHERE st.season_id = se.id AND se.competition_id = c.id
        AND c.gender = $2 AND st.team_id = $1`,
    [fromId, gender],
  );

  // Plantilla: duplicados fuera y luego el resto al destino.
  await tx.query(
    `DELETE FROM team_players tp
      USING team_players t2, seasons se, competitions c
      WHERE tp.team_id = $1 AND t2.team_id = $2
        AND tp.season_id = t2.season_id AND tp.player_id = t2.player_id
        AND tp.season_id = se.id AND se.competition_id = c.id AND c.gender = $3`,
    [fromId, toId, gender],
  );
  await tx.query(
    `UPDATE team_players tp SET team_id = $2
       FROM seasons se JOIN competitions c ON c.id = se.competition_id
      WHERE tp.season_id = se.id AND c.gender = $3 AND tp.team_id = $1`,
    [fromId, toId, gender],
  );

  // Eventos y alineaciones del partido.
  await tx.query(
    `UPDATE match_events e SET team_id = $2
       FROM matches m
       JOIN seasons se ON se.id = m.season_id
       JOIN competitions c ON c.id = se.competition_id
      WHERE e.match_id = m.id AND c.gender = $3 AND e.team_id = $1`,
    [fromId, toId, gender],
  );
  await tx.query(
    `UPDATE match_lineups l SET team_id = $2
       FROM matches m
       JOIN seasons se ON se.id = m.season_id
       JOIN competitions c ON c.id = se.competition_id
      WHERE l.match_id = m.id AND c.gender = $3 AND l.team_id = $1`,
    [fromId, toId, gender],
  );
}

async function ensureSeasonTeam(tx: Cliente, teamId: string, compSlug: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `INSERT INTO season_teams (season_id, team_id)
     SELECT se.id, $2
       FROM seasons se JOIN competitions c ON c.id = se.competition_id
      WHERE c.slug = $1 AND se.is_current
     ON CONFLICT (season_id, team_id) DO NOTHING`,
    [compSlug, teamId],
  );
  return (rowCount ?? 0) > 0;
}

async function mapRef(tx: Cliente, sourceId: string, ref: string, teamId: string): Promise<void> {
  await tx.query(
    `INSERT INTO source_entity_map (source_id, source_ref, team_id, confidence, status)
          VALUES ($1, $2, $3, 1.0, 'confirmed')
     ON CONFLICT (source_id, source_ref) DO UPDATE
       SET club_id = NULL, team_id = EXCLUDED.team_id,
           confidence = 1.0, status = 'confirmed'`,
    [sourceId, ref, teamId],
  );
}

/** Mueve un mapeo que apuntaba a `fromId` para que apunte a `toId`. */
async function moveMap(tx: Cliente, sourceId: string, ref: string, fromId: string, toId: string): Promise<void> {
  await tx.query(
    `UPDATE source_entity_map SET team_id = $4
      WHERE source_id = $1 AND source_ref = $2 AND team_id = $3`,
    [sourceId, ref, fromId, toId],
  );
}

async function repairCase(tx: Cliente, c: Caso): Promise<CasoReport | null> {
  const female = await findTeam(tx, c.femaleSlug);
  if (!female) {
    console.log(`… ${c.label}: no existe la ficha femenina (${c.femaleSlug}), se salta`);
    return null;
  }

  let male = await findTeam(tx, c.maleSlug);
  let created = false;
  if (!male && c.createMale) {
    male = await createMaleTeam(tx, c, female);
    created = true;
  }
  if (!male) {
    console.log(`… ${c.label}: no existe la ficha masculina (${c.maleSlug}), se salta`);
    return null;
  }

  const femaleOldSourceRef = female.source_ref;

  // Mover cada sección a su ficha. El orden importa: primero lo masculino que
  // vive en la femenina; después lo femenino que vive en la masculina.
  const maleMoves = await countSection(tx, female.id, 'male');
  const femaleMoves = await countSection(tx, male.id, 'female');
  await moveSection(tx, female.id, male.id, 'male');
  await moveSection(tx, male.id, female.id, 'female');

  await tx.query(
    `UPDATE teams SET gender = 'female', age_category = COALESCE(age_category, 'senior'), updated_at = NOW()
      WHERE id = $1`,
    [female.id],
  );
  await tx.query(
    `UPDATE teams SET gender = 'male', age_category = COALESCE(age_category, 'senior'), updated_at = NOW()
      WHERE id = $1`,
    [male.id],
  );

  if (c.femaleCurrentComp) await ensureSeasonTeam(tx, female.id, c.femaleCurrentComp);
  if (c.maleCurrentComp) await ensureSeasonTeam(tx, male.id, c.maleCurrentComp);

  // Refs: la pareja actual manda; las antiguas se reasignan a su sección.
  const sourceId = male.source_id ?? female.source_id;
  if (sourceId) {
    if (c.femaleCurrentRef) await mapRef(tx, sourceId, c.femaleCurrentRef, female.id);
    if (c.maleCurrentRef) await mapRef(tx, sourceId, c.maleCurrentRef, male.id);
    if (c.oldMaleRef) await moveMap(tx, sourceId, c.oldMaleRef, female.id, male.id);
    if (!c.createMale && femaleOldSourceRef && femaleOldSourceRef !== c.maleCurrentRef) {
      await moveMap(tx, sourceId, femaleOldSourceRef, male.id, female.id);
    }
  }

  // En los casos con ficha masculina nueva, la ref antigua del masculino deja
  // de ser la principal de la femenina.
  if (c.createMale && c.femaleCurrentRef && femaleOldSourceRef !== c.femaleCurrentRef) {
    await tx.query(`UPDATE teams SET source_ref = $2, updated_at = NOW() WHERE id = $1`, [female.id, c.femaleCurrentRef]);
  }
  if (c.oldMaleRef) {
    await tx.query(
      `UPDATE teams SET alt_source_refs = array_append(alt_source_refs, $2), updated_at = NOW()
        WHERE id = $1 AND NOT ($2 = ANY(alt_source_refs))`,
      [male.id, c.oldMaleRef],
    );
  }

  return { label: c.label, female: female.name, male: male.name, created, maleMoves, femaleMoves };
}

/** Rellena el mapa de una ref actual que quedó huérfana (sin tocar datos). */
async function applyMapOnly(tx: Cliente, m: MapaSuelto): Promise<boolean> {
  const team = await findTeamByRef(tx, m.teamRef);
  if (!team) {
    console.log(`… ${m.label}: no existe la ficha (ref ${m.teamRef}), se salta`);
    return false;
  }
  if (!team.source_id) {
    console.log(`… ${m.label}: la ficha no tiene source_id, se salta`);
    return false;
  }
  await mapRef(tx, team.source_id, m.currentRef, team.id);
  await ensureSeasonTeam(tx, team.id, m.compSlug);
  console.log(`→ ${m.label}: ref ${m.currentRef} → ${team.slug} (` + `${m.compSlug})`);
  return true;
}

function printReport(r: CasoReport): void {
  const fmt = (m: Moves) =>
    `partidos=${m.matches} clasificación=${m.standings} plazas=${m.seasonTeams} ` +
    `plantilla=${m.teamPlayers} eventos=${m.events} alineaciones=${m.lineups}`;
  console.log(
    `→ ${r.label}${r.created ? ' (ficha masculina creada)' : ''}\n` +
    `   femenina: ${r.female}\n` +
    `   masculina: ${r.male}\n` +
    `   a masculina: ${fmt(r.maleMoves)}\n` +
    `   a femenina:  ${fmt(r.femaleMoves)}`,
  );
}

async function main(): Promise<void> {
  console.log(`── repair-section-teams (${WRITE ? 'ESCRIBE' : 'dry-run'}) ──`);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const reports: CasoReport[] = [];
    for (const c of MAPPING) {
      const r = await repairCase(client, c);
      if (r) reports.push(r);
    }
    reports.forEach(printReport);
    for (const m of MAP_ONLY) await applyMapOnly(client, m);
    if (WRITE) {
      await client.query('COMMIT');
      console.log(`\n✓ ${reports.length} casos aplicados.`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\n(dry-run) ${reports.length} casos calculados; ROLLBACK, no se ha escrito nada.`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('Error en repair-section-teams:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

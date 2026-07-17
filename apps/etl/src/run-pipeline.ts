/**
 * Runner end-to-end: scraper → ETL en un solo proceso.
 * Conecta la salida del scraper con el pipeline ETL sin archivos intermedios.
 *
 * Uso:
 *   npx ts-node --esm apps/etl/src/run-pipeline.ts --entity=calendar  --season-id=<uuid>
 *   npx ts-node --esm apps/etl/src/run-pipeline.ts --entity=standings --season-id=<uuid>
 *   npx ts-node --esm apps/etl/src/run-pipeline.ts --entity=matches   --season-id=<uuid>
 *   npx ts-node --esm apps/etl/src/run-pipeline.ts --entity=all       --season-id=<uuid>
 *
 * Por defecto scrapea la OK Liga regular (idc=3150). Para otra competición
 * (p. ej. el playoff, idc=3481) pasa --idc:
 *   npx tsx --env-file=.env apps/etl/src/run-pipeline.ts --entity=calendar --idc=3481 --season-id=<PLAYOFF_SEASON_ID>
 *
 * También acepta --dry-run para validar transformaciones sin persistir.
 */
import './instrument.js'; // Sentry.init — el PRIMERO de todo
import * as Sentry from '@sentry/node';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@sports/logger';
import { db, closeDb } from '@sports/db';
import { EtlPipeline } from './pipeline.js';

// Los scrapers viven en apps/scraper — importamos via ruta relativa (ts-node lo resuelve)
import { FepCalendarScraper } from '../../scraper/src/scrapers/fep/fep-calendar.scraper.js';
import { FepStandingsScraper } from '../../scraper/src/scrapers/fep/fep-standings.scraper.js';
import { FepMatchesScraper } from '../../scraper/src/scrapers/fep/fep-matches.scraper.js';
import { FepFichaScraper } from '../../scraper/src/scrapers/fep/fep-ficha.scraper.js';

const log = createLogger({ service: 'run-pipeline' });

const IDC_OK_LIGA = '3150';
const SPORT_SLUG = 'hockey-patines';

// Nombres conocidos por idc (solo para logging)
const IDC_NAMES: Record<string, string> = {
  '3150': 'OK LIGA MASCULINA',
  '3481': 'PLAY OFFS OK LIGA',
};
// idcs que son fase de playoff (sus partidos van a la ronda de fase de su liga):
//   3481 = playoff OK Liga (masc) · 3484 = playoff OK Liga Iberdrola (fem)
const PLAYOFF_IDCS_PIPELINE = ['3481', '3484'];

// idcs de copas/supercopas (formato eliminatoria): sus rondas se crean a partir
// del nombre de la fuente (Octavos/Cuartos/Semis/Final) con round_type='playoff',
// para que la web las pinte como bracket. No tocan la OK Liga ni el loader.
const CUP_IDCS = new Set(['3258', '3259', '3177', '3178', '3301', '3302', '3260', '3261']);

/** Número de orden de una ronda de copa por su fase (para ordenar el bracket). */
function cupRoundNumber(name: string): number {
  const n = name.toLowerCase();
  if (/octavos|1\/8/.test(n)) return 1;
  if (/cuartos|1\/4/.test(n)) return 2;
  if (/semi/.test(n))         return 3;
  if (/final/.test(n))        return 4;
  if (/tercer|bronce|consol/.test(n)) return 5;
  return 9;
}

/** Get-or-create de una ronda por (temporada, nombre); busca número libre. */
async function getOrCreateRound(seasonId: string, name: string, number: number, type: string): Promise<string> {
  const found = await db.query<{ id: string }>(
    `SELECT id FROM rounds WHERE season_id = $1 AND round_type = $2 AND LOWER(name) = LOWER($3) LIMIT 1`,
    [seasonId, type, name]
  );
  if (found.rows[0]) return found.rows[0].id;
  let num = number;
  for (let guard = 0; guard < 50; guard++) { // evita choque con UNIQUE(season,number,type)
    const clash = await db.query(`SELECT 1 FROM rounds WHERE season_id = $1 AND number = $2 AND round_type = $3`, [seasonId, num, type]);
    if (clash.rows.length === 0) break;
    num++;
  }
  const ins = await db.query<{ id: string }>(
    `INSERT INTO rounds (season_id, number, name, round_type) VALUES ($1, $2, $3, $4) RETURNING id`,
    [seasonId, num, name, type]
  );
  return ins.rows[0]!.id;
}

/**
 * Elimina placeholders sintéticos que ya tienen partido real (mismo cruce y
 * fecha) o cuya fecha pasó hace >6h sin convertirse en partido real.
 * Misma lógica que cleanup-synthetic-dupes.ts, integrada en el pipeline.
 */
async function reconcileSyntheticMatches(): Promise<number> {
  const dupes = await db.query(
    `DELETE FROM matches s
     USING matches r
     WHERE s.source_ref LIKE 'synthetic:%'
       AND r.source_ref NOT LIKE 'synthetic:%'
       AND r.season_id    = s.season_id
       AND r.home_team_id = s.home_team_id
       AND r.away_team_id = s.away_team_id
       -- Comparar el DÍA en hora española: un placeholder a las 00:00 (Madrid)
       -- y el partido real a las 20:30 caen en días UTC distintos y no casaban.
       AND (r.scheduled_at AT TIME ZONE 'Europe/Madrid')::date
         = (s.scheduled_at AT TIME ZONE 'Europe/Madrid')::date
     RETURNING s.id`
  );
  const stale = await db.query(
    `DELETE FROM matches
     WHERE source_ref LIKE 'synthetic:%'
       AND status = 'scheduled'
       AND scheduled_at < NOW() - INTERVAL '6 hours'
     RETURNING id`
  );
  return (dupes.rowCount ?? 0) + (stale.rowCount ?? 0);
}

function parseArgs() {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, '').split('=');
    if (k) args[k] = v ?? 'true';
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const entity = args['entity'] ?? 'all';
  const seasonId = args['season-id'] ?? process.env['SEASON_ID'];
  const dryRun = args['dry-run'] === 'true' || process.env['ETL_DRY_RUN'] === 'true';
  // Acepta varios idc separados por coma (liga regular + playoff de la
  // misma temporada): --idc=3150,3481
  const idcs = (args['idc'] ?? process.env['IDC'] ?? IDC_OK_LIGA).split(',').map((s) => s.trim()).filter(Boolean);
  const idc = idcs[0]!; // compat: entidades de un solo idc (ficha)
  const competitionName = IDC_NAMES[idc] ?? `idc ${idc}`;

  if (!seasonId && entity !== 'download-logos' && entity !== 'ficha') {
    console.error('\n❌ SEASON_ID requerido.');
    console.error('   Obtén el UUID ejecutando primero:');
    console.error('   npx ts-node --esm apps/etl/src/seed-ok-liga.ts\n');
    process.exit(1);
  }

  log.info({ entity, seasonId, idc, dryRun }, '🚀 Iniciando pipeline');

  const pipeline = new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId, dryRun });

  // ── Calendario ───────────────────────────────────────────────
  if (entity === 'calendar' || entity === 'all') {
    for (const calIdc of idcs) {
      const calName = IDC_NAMES[calIdc] ?? `idc ${calIdc}`;
      log.info({ idc: calIdc, competitionName: calName }, '→ Scrapeando calendario...');

      // Los partidos del playoff (idc 3481) van a la MISMA temporada que la
      // liga, marcados con la ronda de fase playoff (modelo de fases).
      let roundId: string | undefined;
      if (PLAYOFF_IDCS_PIPELINE.includes(calIdc) && seasonId) {
        const r = await db.query<{ id: string }>(
          `SELECT id FROM rounds WHERE season_id = $1 AND round_type = 'playoff' AND number = 100`,
          [seasonId]
        );
        roundId = r.rows[0]?.id;
        if (!roundId) {
          const ins = await db.query<{ id: string }>(
            `INSERT INTO rounds (season_id, number, name, round_type)
             VALUES ($1, 100, 'Playoff por el título', 'playoff') RETURNING id`,
            [seasonId]
          );
          roundId = ins.rows[0]!.id;
        }
      }

      const scraper = new FepCalendarScraper({
        idc: calIdc,
        seasonId: seasonId!, // garantizado por el guard de SEASON_ID al inicio
        competitionName: calName,
        roundId,
      });
      const result = await scraper.run();
      log.info({ idc: calIdc, found: result.data.length, errors: result.errors.length }, 'Calendario scrapeado');

      // Copas: crear rondas por nombre (Octavos/Cuartos/Semis/Final) como
      // 'playoff' y asignarlas a cada partido → la web las pinta como bracket.
      if (CUP_IDCS.has(calIdc) && seasonId) {
        const cache = new Map<string, string>();
        for (const m of result.data) {
          const rname = m.roundRef?.trim();
          if (!rname) continue;
          let rid = cache.get(rname.toLowerCase());
          if (!rid) {
            rid = await getOrCreateRound(seasonId, rname, cupRoundNumber(rname), 'playoff');
            cache.set(rname.toLowerCase(), rid);
          }
          m.roundId = rid;
        }
      }

      if (result.data.length > 0) {
        const etl = await pipeline.runMatches(result);
        log.info(etl, '✅ Partidos cargados');
      }
    }
    // Reconciliación automática: si un placeholder sintético ya tiene su
    // partido real (con idp), eliminarlo para no duplicar en la web.
    const reconciled = await reconcileSyntheticMatches();
    if (reconciled > 0) log.info({ reconciled }, '🧹 Placeholders sintéticos reconciliados');
  }

  // ── Clasificación ────────────────────────────────────────────
  if (entity === 'standings' || entity === 'all') {
    // El playoff (3481) no tiene clasificación (hide_clasif:1 en sidgad) — skip
    if (idc === '3481') {
      log.info('→ Playoff sin clasificación (eliminatorias) — skip standings');
    } else {
      log.info({ idc, competitionName }, '→ Scrapeando clasificación...');
      const scraper = new FepStandingsScraper({
        idc,
        competitionName,
      });
      const result = await scraper.run();
      log.info({ found: result.data.length, errors: result.errors.length }, 'Clasificación scrapeada');
      if (result.data.length > 0) {
        const etl = await pipeline.runStandings(result);
        log.info(etl, '✅ Clasificación cargada');
      }
    }
  }

  // ── Marcadores en vivo ───────────────────────────────────────
  if (entity === 'matches' || entity === 'all') {
    log.info('→ Scrapeando marcadores rfep_mc_1.php...');
    const scraper = new FepMatchesScraper({ seasonId: seasonId! });
    const result = await scraper.run();
    log.info({ found: result.data.length, errors: result.errors.length }, 'Marcadores scrapeados');
    if (result.data.length > 0) {
      const etl = await pipeline.runMatches(result);
      log.info(etl, '✅ Marcadores cargados');
    }
  }

  // ── Fichas pendientes en bloque (o TODAS con --entity=refichas) ──────
  // fichas-pendientes: solo partidos sin eventos cargados.
  // refichas: re-procesa todas las actas de la temporada (idempotente) —
  // útil tras mejorar el parser (penaltis, staff, lanzadores...).
  if (entity === 'fichas-pendientes' || entity === 'refichas') {
    const { rows: pending } = await db.query<{
      id: string;
      source_ref: string;
      home_team_name: string | null;
      comp_ref: string | null;
    }>(
      `SELECT m.id, m.source_ref, ht.name AS home_team_name,
              comp.source_ref AS comp_ref
       FROM matches m
       LEFT JOIN teams ht ON ht.id = m.home_team_id
       JOIN seasons s ON s.id = m.season_id
       JOIN competitions comp ON comp.id = s.competition_id
       WHERE m.season_id = $1
         AND m.status IN ('finished', 'live')
         AND m.source_ref LIKE 'fep_match_%'
         AND ($2 OR NOT EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id))
       ORDER BY m.scheduled_at ASC`,
      [seasonId, entity === 'refichas']
    );

    log.info({ pending: pending.length }, '→ Fichas pendientes encontradas');
    let ok = 0, fail = 0;

    for (const m of pending) {
      const matchIdp = m.source_ref.replace(/^fep_match_/, '');
      const matchIdc = (m.comp_ref ?? idc).replace(/^fep_competition_/, '');
      try {
        const scraper = new FepFichaScraper({
          idp: matchIdp,
          idc: matchIdc,
          homeTeamName: m.home_team_name ?? undefined,
          matchId: m.id,
        });
        const result = await scraper.run();
        log.info({ idp: matchIdp, events: result.data.length }, '✅ Ficha procesada');
        ok++;
      } catch (err) {
        log.error({ idp: matchIdp, err }, '❌ Error en ficha — continuando con la siguiente');
        fail++;
      }
      // Pausa de cortesía con la fuente
      await new Promise((r) => setTimeout(r, 1500));
    }

    log.info({ ok, fail, total: pending.length }, '🏁 Fichas pendientes completadas');
  }

  // ── Ficha resumen (eventos de partido) ─────────────────────
  if (entity === 'ficha') {
    const sourceRefArg = args['source-ref'];
    if (!sourceRefArg) {
      log.error('--source-ref=fep_match_{idp} requerido para entity=ficha');
      process.exit(1);
    }

    // Extraer idp numerico del source_ref (e.g. "fep_match_34267" -> "34267")
    const idp = sourceRefArg.replace(/^fep_match_/, '');

    // Buscar el partido en DB por source_ref para obtener su UUID y equipo local
    const { rows: matchRows } = await db.query<{
      id: string;
      source_ref: string;
      home_team_name: string | null;
      idc: string | null;
    }>(
      `SELECT m.id, m.source_ref, ht.name AS home_team_name,
              comp.source_ref AS idc
       FROM matches m
       LEFT JOIN teams      ht   ON ht.id   = m.home_team_id
       LEFT JOIN seasons    s    ON s.id    = m.season_id
       LEFT JOIN competitions comp ON comp.id = s.competition_id
       WHERE m.source_ref = $1`,
      [sourceRefArg]
    );

    if (matchRows.length === 0) {
      log.error({ sourceRef: sourceRefArg }, 'Partido no encontrado en DB');
      process.exit(1);
    }
    const match = matchRows[0]!;
    log.info({ matchId: match.id, sourceRef: match.source_ref, homeTeam: match.home_team_name }, 'Scrapeando ficha');

    // idc: el source_ref de la competicion (e.g. "3150" para OK Liga)
    // Nota: el playoff guarda source_ref "fep_competition_3481" — extraemos el numero
    const rawIdc = match.idc ?? idc;
    const fichaIdc = rawIdc.replace(/^fep_competition_/, '') || idc;
    log.info({ idp, idc: fichaIdc }, 'IDs para endpoint rfep_acta_idc_{IDC}_1.php');

    // Pasar matchId al scraper para que inyecte directamente en match_events
    // en cuanto encuentre el endpoint activo (evita un segundo paso ETL)
    const scraper = new FepFichaScraper({
      idp,
      idc: fichaIdc,
      homeTeamName: match.home_team_name ?? undefined,
      matchId: match.id,
    });
    const result = await scraper.run();
    log.info({ found: result.data.length, errors: result.errors.length }, 'Ficha scrapeada');

    if (result.errors.length > 0) {
      log.warn({ errors: result.errors }, 'Errores durante scraping de ficha');
    }

    // La inyeccion en match_events ya fue realizada por el scraper internamente
    // (via FepFichaScraper.injectEvents) en cuanto encontro el endpoint activo.
    // Solo logueamos el recuento final aqui.
    log.info({ matchId: match.id, eventsFound: result.data.length }, '✅ Ficha de partido procesada');
  }

  // ── Descarga de logos ───────────────────────────────────────
  if (entity === 'download-logos') {
    // Ruta resuelta desde la ubicación de ESTE módulo (apps/etl/src), NO desde
    // process.cwd(): así da igual desde dónde se lance el comando. Antes, al
    // ejecutarlo desde /app/apps/etl, los escudos caían en
    // /app/apps/etl/apps/web/public/escudos y nunca llegaban al volumen de web.
    // Override opcional con ESCUDOS_DIR.
    const outDir =
      process.env['ESCUDOS_DIR'] ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/escudos');
    fs.mkdirSync(outDir, { recursive: true });

    // Mapa descubierto via fep-competition-inspector.ts:
    // teams_array de competicion_header_creator.php
    // clave: source_ref del equipo (ID sidgad), valor: filename en sidgad.cloud
    const LOGO_CDN = 'https://sidgad.cloud/rfep/images/logos_clubes';
    const LOGO_MAP: Record<string, string> = {
      '3373': '44_3.png',          // HOCKEY CLUB LICEO
      '3358': 'fcbarcelona.png',   // BARCA
      '3408': '69_1.png',          // IGUALADA RIGAT HC
      '3359': 'calafell.png',      // CALAFELL LA MENORQUINA
      '3332': 'reusdep.png',       // REUS DEPORTIU BRASILIA
      '3412': '78_2.png',          // CP VOLTREGA MOVENTO STERN
      '3387': '71.png',            // CE NOIA FREIXENET
      '3411': 'lleida.png',        // PONS LLEIDA
      '3363': '66_1.png',          // AITEX PAS ALCOI
      '3374': '109.png',           // ADISS HOCKEY RIVAS
      '3336': 'shum.png',          // SHUM FRIT RAVICH
      '3337': 'caldes.png',        // CH CALDES RECAM LASER
      '3350': '460_4.png',         // INNOAESTHETICS HC SANT JUST
      '3361': '98_1.png',          // CERDANYOLA CLUB D HOQUEI
    };

    const { rows } = await db.query<{ id: string; name: string; source_ref: string | null }>(
      'SELECT id, name, source_ref FROM teams ORDER BY name'
    );
    log.info({ total: rows.length, outDir }, 'Descargando logos de equipos desde sidgad.cloud');
    let ok = 0, skip = 0, fail = 0;

    for (const team of rows) {
      const dest = path.join(outDir, team.id + '.png');
      if (fs.existsSync(dest)) { log.info({ name: team.name }, 'SKIP'); skip++; continue; }

      const filename = team.source_ref ? LOGO_MAP[team.source_ref] : undefined;
      if (!filename) {
        log.warn({ name: team.name, sourceRef: team.source_ref }, 'Sin mapeo de logo -- anadelo a LOGO_MAP');
        fail++;
        continue;
      }

      const logoUrl = `${LOGO_CDN}/${filename}`;
      try {
        const res = await fetch(logoUrl, {
          headers: { 'Referer': 'https://www.hockeypatines.fep.es/', 'User-Agent': 'SportsBot/1.0' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 500) throw new Error('respuesta demasiado pequenya');
        fs.writeFileSync(dest, buf);
        // Actualizar logo_url en DB con la URL correcta de sidgad.cloud
        await db.query('UPDATE teams SET logo_url = $2 WHERE id = $1', [team.id, logoUrl]);
        log.info({ name: team.name, bytes: buf.length }, 'OK');
        ok++;
      } catch (e) {
        log.error({ name: team.name, url: logoUrl, err: String(e) }, 'FAIL');
        fail++;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    log.info({ ok, skip, fail }, 'Logos completado');
    if (ok > 0) {
      log.warn(
        '⚠️  Next fotografía public/ al arrancar: reinicia el contenedor web ' +
          'para que sirva los escudos nuevos →  docker compose ... restart web'
      );
    }
  }

  log.info('🏁 Pipeline completado');
}

main()
  .catch((err) => { log.error({ err }, 'Error fatal'); Sentry.captureException(err); process.exitCode = 1; })
  .finally(async () => { await Sentry.flush(2000); await closeDb(); });

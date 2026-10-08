/**
 * Scraper de Ficha Resumen -- acta_1_{IDP}.php
 *
 * Este endpoint es la "Ficha Resumen" de la FEP/sidgad: contiene el
 * listado cronologico de eventos del partido (goles, tarjetas azules/rojas,
 * tiempos muertos, fin de periodo) en tiempo real durante el encuentro
 * y completo una vez finalizado.
 *
 * Uso (via run-pipeline.ts):
 *   npx tsx --env-file .env apps/etl/src/run-pipeline.ts \
 *     --entity=ficha --source-ref=fep_match_34267
 *
 * El IDP (ID del partido FEP) se extrae del source_ref del partido en DB.
 * Los team_ids y player_ids se resuelven por nombre/ref contra la DB.
 */
// cheerio y domhandler ya no hacen falta aquí: el HTML lo interpreta
// fep-ficha.parser.ts. Este módulo sólo hace E/S (red y base de datos).
import { FepBaseScraper } from './fep-base-scraper.js';
import { requireFepSourceId } from '../../core/fep-source.js';
import { SidgadClient, SIDGAD_LANG } from './sidgad-client.js';
import { sourceByKey, eventPrefix, type SourceDef } from '../../core/sources.js';
import { db, replaceMatchEvents, replaceMatchLineups, withTransaction } from '@sports/db';
// Los parsers viven en fep-ficha.parser.ts (puros, sin E/S) para poder testearlos
// con HTML congelado sin necesidad de entorno ni base de datos.
import {
  parseFicha, parseLiveHeader, parseLineups, parseTeamFouls, parseShootout,
  normalizeName, slugifyPlayerName,
  type ScrapedMatchEvent, type FepEventType,
} from './fep-ficha.parser.js';

// Re-export para no romper a quien ya importaba estos tipos desde el scraper.
export type { ScrapedMatchEvent, FepEventType };

const SOURCE_ID = requireFepSourceId();

/** IDCs de competiciones que usan rutas de Playoff/Eliminatorias en sidgad */
const PLAYOFF_IDCS = ['3481', '3484'];


export interface FichaScraperConfig {
  /** ID del partido FEP (el numero de "idp", p.ej. "34267") */
  idp: string;
  /** ID de competicion sidgad (el "idc", p.ej. "3150" para OK Liga, "3481" para Playoffs) */
  idc: string;
  /** Nombre equipo local (para determinar isHome cuando solo hay nombre de equipo) */
  homeTeamName?: string;
  /**
   * UUID del partido en DB. Si se proporciona, los eventos se inyectan directamente en
   * match_events en cuanto se encuentra el endpoint activo (sin esperar al ETL).
   */
  matchId?: string;
  /**
   * Fuente del partido. Por defecto la FEP, que es de donde viene la inmensa
   * mayoría. World Skate y las que vengan usan el mismo formato de acta pero
   * otro portal de sidgad: basta con pasar su SourceDef y el cliente reescribe
   * los endpoints `rfep_*` → `{portal}_*`.
   */
  source?: SourceDef;
}

export class FepFichaScraper extends FepBaseScraper<ScrapedMatchEvent> {
  // Config propia de la ficha. ANTES se llamaba `config` y SOBREESCRIBÍA el
  // `config` de BaseScraper (que lleva scraperKey/entityType/sourceId) → de ahí
  // el "[undefined/undefined]" en los logs. Se renombra a `cfg` (auditoría Q2/B-).
  private readonly cfg: FichaScraperConfig;
  /** Fuente del partido (FEP si no se indica otra). */
  private readonly source: SourceDef;
  /** Cliente HTTP del portal de esa fuente: reescribe `rfep_*` → `{portal}_*`. */
  private readonly client: SidgadClient;
  /**
   * Cabecera de directo del último acta leída (null si no tenía). El
   * orquestador del directo usa `ended` como señal explícita de final.
   */
  public liveHeader: ReturnType<typeof parseLiveHeader> = null;

  constructor(config: FichaScraperConfig) {
    const source = config.source ?? sourceByKey('fep');
    super({
      scraperKey: source.key === 'fep' ? 'fep_hockey' : `${source.key}_hockey`,
      entityType: 'match_event',
      sourceId: SOURCE_ID,
    });
    this.cfg = config;
    this.source = source;
    this.client = new SidgadClient(source.client);
  }

  protected async scrape(): Promise<ScrapedMatchEvent[]> {
    const { idp, idc } = this.cfg;

    // La FEP usa dos patrones de URL dependiendo del tipo de competicion:
    //   1. Liga regular / fase de grupos: rfep_acta_idc_{IDC}_1.php
    //      POST body: idp={IDP}&idc={IDC}&site_lang=es
    //   2. Playoffs / eliminatorias:      rfep_acta_eli_idc_{IDC}_1.php
    //      POST body: id_partido={IDP}&idc={IDC}&site_lang=es
    // Se prueba el patron 1 primero; si devuelve 404 o respuesta vacía se intenta el 2.
    // Candidatos base: patrones comunes a todas las competiciones
    const ENDPOINT_CANDIDATES: { path: string; body: Record<string, string> }[] = [
      // Ficha de partido (descubierto con fep-acta-probe.ts, 2026-06-09):
      // el filename lleva el idp y el body pide la pestaña de resumen.
      // Funciona para el playoff (idc 3481) y previsiblemente para todas.
      { path: `rfep_gr_${idp}_1.php`, body: { idm: '1', idc, idp, tab: 'tab_ficha_resumen' } },
      // Liga regular / fase de grupos — idp en body
      { path: `rfep_acta_idc_${idc}_1.php`,     body: { idp,             idc, site_lang: SIDGAD_LANG } },
      // Eliminatorias con idc en filename — id_partido en body
      { path: `rfep_acta_eli_idc_${idc}_1.php`, body: { id_partido: idp, idc, site_lang: SIDGAD_LANG } },
    ];

    // Candidatos adicionales para Playoffs (idc 3481): la FEP usa nombres de
    // archivo distintos para las fases finales — sin idc en el filename
    if (PLAYOFF_IDCS.includes(idc)) {
      ENDPOINT_CANDIDATES.push(
        // Patron "eli" sin idc — variante mas comun en sidgad para eliminatorias
        { path: 'rfep_acta_eli_1.php',     body: { id_partido: idp, idc, site_lang: SIDGAD_LANG } },
        { path: 'rfep_acta_eli_1.php',     body: { idp,             idc, site_lang: SIDGAD_LANG } },
        // Patron "playoff" explicito
        { path: 'rfep_acta_playoff_1.php', body: { id_partido: idp, idc, site_lang: SIDGAD_LANG } },
        { path: 'rfep_acta_playoff_1.php', body: { idp,             idc, site_lang: SIDGAD_LANG } },
        // Fallback: el script de acta de la competición madre (OK Liga, 3150).
        // sidgad a veces sirve las actas de todas las fases desde el mismo
        // PHP de la liga regular, identificando el partido solo por idp.
        { path: 'rfep_acta_idc_3150_1.php', body: { idp, idc: '3150', site_lang: SIDGAD_LANG } },
        { path: 'rfep_acta_idc_3150_1.php', body: { idp, idc,         site_lang: SIDGAD_LANG } },
      );
    }

    let html = '';
    for (const candidate of ENDPOINT_CANDIDATES) {
      this.log.info({ idp, idc, endpoint: candidate.path }, 'Intentando endpoint ficha resumen');
      try {
        const result = await this.client.post(candidate.path, candidate.body);
        // Respuesta válida: tamaño mínimo y sin indicadores de error HTTP
        const snippet = result.slice(0, 1000).toLowerCase();
        const looksEmpty = result.length < 200;
        const looksLike404 = snippet.includes('404') || snippet.includes('not found') || snippet.includes('no encontrado');
        if (!looksEmpty && !looksLike404) {
          html = result;
          this.log.info(
            { idp, idc, endpoint: candidate.path, size: result.length },
            'Endpoint ficha activo encontrado'
          );

          // Inyeccion inmediata: si el caller proporciono matchId, parsear e insertar
          // en match_events sin esperar al loop ETL externo
          if (this.cfg.matchId) {
            const events = parseFicha(html, idp, {
              ...(this.cfg.homeTeamName ? { homeTeamName: this.cfg.homeTeamName } : {}),
              log: this.log,
              eventPrefix: eventPrefix(this.source),
            });
            // Jugadores: upsert en players/team_players desde los links de la
            // ficha (id_player). Devuelve mapa nombre→UUID para vincular
            // eventos y alineaciones.
            const playerMap = await this.upsertPlayers(events, this.cfg.matchId);
            await this.injectEvents(events, this.cfg.matchId, playerMap);
            // Faltas de equipo: cabecera de la ficha (.report_faltas: local, visitante)
            const fouls = parseTeamFouls(html);
            if (fouls) {
              await db.query(
                `UPDATE matches SET home_fouls = $2, away_fouls = $3, updated_at = NOW() WHERE id = $1`,
                [this.cfg.matchId, fouls.home, fouls.away]
              );
              this.log.info({ matchId: this.cfg.matchId, ...fouls }, 'Faltas de equipo actualizadas');
            }
            // Estado en vivo: fase (periodo/descanso) y crono en marcha de la cabecera.
            // Se persiste el RESTANTE + el instante de captura para que el cliente lo
            // haga correr localmente y resincronice en cada poll.
            const live = parseLiveHeader(html);
            this.liveHeader = live;
            if (live && !live.ended) {
              await db.query(
                `UPDATE matches
                   SET live_period = $2, live_clock_seconds = $3,
                       live_clock_at = NOW(), live_is_halftime = $4, updated_at = NOW()
                 WHERE id = $1`,
                [this.cfg.matchId, live.period, live.clockSeconds, live.isHalftime]
              );
              this.log.info({ matchId: this.cfg.matchId, ...live }, 'Estado en vivo (fase/crono) actualizado');
            }
            // Tanda de penaltis: marcador de la tanda + ganador explícito. La
            // izquierda del acta es el local; el ganador es quien más marca.
            const pens = parseShootout(html);
            if (pens) {
              await db.query(
                `UPDATE matches SET
                   home_pen = $2::int, away_pen = $3::int,
                   penalty_shootout = $4::jsonb,
                   win_type = 'penalties',
                   winner_team_id = CASE
                     WHEN $2::int > $3::int THEN home_team_id
                     WHEN $3::int > $2::int THEN away_team_id
                     ELSE winner_team_id END,
                   updated_at = NOW()
                 WHERE id = $1::uuid`,
                [this.cfg.matchId, pens.home, pens.away, JSON.stringify(pens.detail)]
              );
              this.log.info({ matchId: this.cfg.matchId, ...pens }, '🥅 Tanda de penaltis actualizada');
            }
            // Alineaciones: vienen en el mismo HTML (tablas competiciones_tabla_basic)
            const lineups = parseLineups(html, idp);
            // Vinculación (#219): REF del acta primero (exacta — la tabla de
            // alineación SÍ trae id_player), luego mapa nombre (fallback), y
            // para jugadores de alineación SIN evento: alta por ref (un
            // suplente que no anotó existe igualmente). El cuerpo técnico no se
            // vincula a players (es staff, no jugador).
            for (const l of lineups) {
              if (l.role) continue;
              l.playerId = (l.playerSourceRef ? playerMap.get(`r:${l.playerSourceRef}`) : undefined)
                ?? playerMap.get(`n:${normalizeName(l.playerName)}`)
                ?? undefined;
            }
            // Jugadores de alineación cuya ref no está en el mapa (no salió en
            // los eventos): alta por ref — así su player_id queda vinculado
            // EXACTAMENTE en esta misma pasada.
            const sinEvento = lineups.filter((l) => !l.role && !l.playerId && l.playerSourceRef);
            for (const l of sinEvento) {
              const pid = await this.upsertPlayerByRef(l.playerSourceRef!, l.playerName, undefined, this.cfg.matchId!);
              if (pid) {
                l.playerId = pid;
                playerMap.set(`r:${l.playerSourceRef}`, pid);
                playerMap.set(`n:${normalizeName(l.playerName)}`, pid);
              }
            }
            // Último recurso: jugadores sin ref y sin evento en ESTE partido
            // pero ya creados por fichas anteriores — enlace por slug canónico.
            const unresolved = lineups.filter((l) => !l.role && !l.playerId);
            if (unresolved.length > 0) {
              const slugs = [...new Set(unresolved.map((l) => slugifyPlayerName(l.playerName)))];
              const found = await db.query<{ id: string; slug: string }>(
                `SELECT id, slug FROM players WHERE slug = ANY($1)`,
                [slugs]
              );
              const bySlug = new Map(found.rows.map((r) => [r.slug, r.id]));
              for (const l of unresolved) {
                l.playerId = bySlug.get(slugifyPlayerName(l.playerName)) ?? undefined;
              }
            }
            if (lineups.length > 0) {
              await withTransaction(async (client) => {
                await replaceMatchLineups(this.cfg.matchId!, lineups, client);
              });
              this.log.info(
                { matchId: this.cfg.matchId, players: lineups.length },
                'Alineaciones inyectadas en match_lineups'
              );
              // ROSTER desde alineaciones (#216): team_players solo se llenaba
              // desde eventos con playerTeamRef — los jugadores SIN evento en el
              // acta no entraban nunca en la plantilla (roster crónicamente
              // incompleto, matching fallido en silencio). La primera acta
              // completa debe poblar la plantilla de cada lado del cruce.
              const roster = await db.query(
                `INSERT INTO team_players (season_id, team_id, player_id)
                 SELECT DISTINCT m.season_id,
                        CASE WHEN ml.is_home THEN m.home_team_id ELSE m.away_team_id END,
                        ml.player_id
                   FROM match_lineups ml
                   JOIN matches m ON m.id = ml.match_id
                  WHERE ml.match_id = $1 AND ml.player_id IS NOT NULL
                 ON CONFLICT (season_id, team_id, player_id) DO NOTHING`,
                [this.cfg.matchId]
              );
              if ((roster.rowCount ?? 0) > 0) {
                this.log.info(
                  { matchId: this.cfg.matchId, altas: roster.rowCount },
                  'team_players poblado desde alineaciones (#216)'
                );
              }
              // Dorsales: el acta es la fuente — actualizar team_players
              await db.query(
                `UPDATE team_players tp
                 SET jersey_number = ml.jersey_number, updated_at = NOW()
                 FROM match_lineups ml
                 JOIN matches m ON m.id = ml.match_id
                 WHERE ml.match_id = $1
                   AND ml.player_id = tp.player_id
                   AND ml.jersey_number IS NOT NULL
                   AND tp.season_id = m.season_id
                   AND tp.team_id = CASE WHEN ml.is_home THEN m.home_team_id ELSE m.away_team_id END`,
                [this.cfg.matchId]
              );
            }
            return events;
          }
          break;
        }
        this.log.warn(
          { idp, idc, endpoint: candidate.path, size: result.length, looksEmpty, looksLike404 },
          'Respuesta vacía o error — probando siguiente patrón URL'
        );
      } catch (err) {
        this.log.warn(
          { idp, idc, endpoint: candidate.path, err },
          'Error HTTP en endpoint — probando siguiente patrón URL'
        );
      }
    }

    if (!html) {
      this.log.error(
        { idp, idc, candidatesTried: ENDPOINT_CANDIDATES.map((c) => c.path) },
        'Todos los patrones de URL fallaron para la ficha resumen — revisa idc/idp o si la competicion usa un endpoint distinto'
      );
      return [];
    }

    return parseFicha(html, idp, {
      ...(this.cfg.homeTeamName ? { homeTeamName: this.cfg.homeTeamName } : {}),
      log: this.log,
      eventPrefix: eventPrefix(this.source),
    });
  }


  /**
   * Contexto del partido (temporada y sport), cacheado por ejecución del
   * scrape: lo necesitan el alta de jugadores por eventos y la de los
   * jugadores de alineación sin evento (#219).
   */
  private ctxCache: { season_id: string; sport_id: string } | null = null;
  private async matchContext(matchId: string): Promise<{ season_id: string; sport_id: string } | null> {
    if (this.ctxCache) return this.ctxCache;
    const ctxRes = await db.query<{ season_id: string; sport_id: string }>(
      `SELECT m.season_id, c.sport_id
       FROM matches m
       JOIN seasons s ON s.id = m.season_id
       JOIN competitions c ON c.id = s.competition_id
       WHERE m.id = $1`,
      [matchId]
    );
    this.ctxCache = ctxRes.rows[0] ?? null;
    return this.ctxCache;
  }

  /**
   * Alta/actualización de UN jugador por su ref de acta + pertenencia a
   * equipo/temporada (mismas guardas #176/#216/#325). Devuelve el UUID o null.
   * Extraído para poder dar de alta también a los jugadores de ALINEACIÓN sin
   * evento (#219): un suplente que no anotó existe igualmente.
   */
  private async upsertPlayerByRef(
    playerSourceRef: string,
    name: string,
    playerTeamRef: string | undefined,
    matchId: string
  ): Promise<string | null> {
    const ctx = await this.matchContext(matchId);
    if (!ctx) return null;

    // "FONT SÁNCHEZ FERRAN" → apellidos + nombre (última palabra)
    const parts = name.split(/\s+/);
    const firstName = parts.length > 1 ? parts[parts.length - 1]! : name;
    const lastName  = parts.length > 1 ? parts.slice(0, -1).join(' ') : name;
    const slug = slugifyPlayerName(name);

    // Id de fuente (para desambiguar el slug de homónimos). La FOTO no se
    // inventa aquí: `photo_url` lo fija el verificador `update-player-photos`
    // (comprueba qué patrón existe de verdad en el CDN; ver player-photo-url.ts).
    const idNum = playerSourceRef.replace('fep_player_', '');

    // Upsert por source_ref; si no existe, insert con slug único por sport.
    // HOMÓNIMOS (#176): el viejo ON CONFLICT (sport_id, slug) DO UPDATE SET
    // source_ref = EXCLUDED.source_ref ROBABA la identidad — dos jugadores
    // distintos con el mismo nombre (equipos distintos) colisionaban por slug
    // y el segundo PISABA el source_ref del primero, fusionando sus carreras.
    // Si el slug existe con OTRA ref, se desambigua el slug con el id de
    // fuente (slug-idFuente) y queda el aviso para revisión.
    const found = await db.query<{ id: string }>(
      `SELECT id FROM players WHERE source_ref = $1`, [playerSourceRef]
    );
    let playerId = found.rows[0]?.id;
    if (!playerId) {
      const clash = await db.query<{ id: string; source_ref: string | null }>(
        `SELECT id, source_ref FROM players WHERE sport_id = $1 AND slug = $2`,
        [ctx.sport_id, slug]
      );
      let finalSlug = slug;
      if (clash.rows.length > 0 && clash.rows[0]!.source_ref !== playerSourceRef) {
        finalSlug = `${slug}-${idNum}`;
        this.log.warn(
          { nombre: name, slug, slugDesambiguado: finalSlug, refNueva: playerSourceRef, refExistente: clash.rows[0]!.source_ref },
          'Homónimo detectado: mismo nombre, distinta ref de fuente — se crea jugador con slug desambiguado (#176)'
        );
      }
      // Sin `photo_url`: la fija el verificador `update-player-photos`. Inventarla
      // a ciegas dejaba URLs muertas para ~39 % de los jugadores (auditoría 2026-10).
      const ins = await db.query<{ id: string }>(
        `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref, scraped_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (sport_id, slug) DO UPDATE SET
           source_ref = EXCLUDED.source_ref,
           updated_at = NOW()
         RETURNING id`,
        [ctx.sport_id, firstName, lastName, finalSlug, playerSourceRef]
      );
      playerId = ins.rows[0]!.id;
    }

    // Pertenencia equipo/temporada (si conocemos el equipo sidgad).
    // GUARDA (#216/#325): la ref de equipo del acta puede ser del PRIMER
    // equipo del club en fichas de filiales — la pertenencia fabricada
    // ensuciaba la plantilla. Solo se acepta si el equipo es uno de los dos
    // del cruce; y si el INSERT no afecta a ninguna fila, queda el aviso
    // (antes era un fallo silencioso: roster incompleto sin señal).
    if (playerTeamRef) {
      const ins = await db.query(
        `INSERT INTO team_players (season_id, team_id, player_id)
         SELECT $1, t.id, $2
           FROM teams t
          WHERE t.source_ref = $3
            AND t.id IN (SELECT m.home_team_id FROM matches m WHERE m.id = $4
                         UNION SELECT m.away_team_id FROM matches m WHERE m.id = $4)
         ON CONFLICT (season_id, team_id, player_id) DO NOTHING`,
        [ctx.season_id, playerId, playerTeamRef, matchId]
      );
      if ((ins.rowCount ?? 0) === 0) {
        this.log.warn(
          { matchId, playerRef: playerSourceRef, teamRef: playerTeamRef },
          'team_players: pertenencia NO insertada — ref de equipo inexistente o fuera del cruce (#216)'
        );
      }
    }

    return playerId;
  }

  /**
   * Crea/actualiza los jugadores que aparecen en los EVENTOS de la ficha y su
   * pertenencia a equipo/temporada (team_players). Devuelve el mapa de
   * vinculación del propio scrape con claves `r:{ref}` y `n:{nombre}` (#219):
   * la vinculación por REF es exacta y la de nombre queda como fallback.
   */
  private async upsertPlayers(
    events: ScrapedMatchEvent[],
    matchId: string
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    const withPlayer = events.filter((e) => e.playerSourceRef && e.playerName);
    if (withPlayer.length === 0) return map;

    // Dedupe por playerSourceRef
    const unique = new Map<string, ScrapedMatchEvent>();
    for (const ev of withPlayer) {
      if (!unique.has(ev.playerSourceRef!)) unique.set(ev.playerSourceRef!, ev);
    }

    // HOMÓNIMOS EN EL MISMO ACTA (#219): la fuente distingue por id_player,
    // pero el mapa por nombre los colapsaría. Con claves de ref no colisionan;
    // el aviso queda como señal para la cola de ER de jugadores.
    const nameToRef = new Map<string, string>();

    for (const ev of unique.values()) {
      const name = ev.playerName!;
      const playerId = await this.upsertPlayerByRef(ev.playerSourceRef!, name, ev.playerTeamRef, matchId);
      if (!playerId) continue;

      const normalizedName = normalizeName(name);
      const prevRef = nameToRef.get(normalizedName);
      if (prevRef && prevRef !== ev.playerSourceRef) {
        this.log.warn(
          { matchId, nombre: name, refs: [prevRef, ev.playerSourceRef] },
          'Dos id_player distintos con el mismo nombre en el mismo acta (#219) — posible homónimo: revisar identidad en la cola de ER'
        );
      }
      nameToRef.set(normalizedName, ev.playerSourceRef!);

      map.set(`r:${ev.playerSourceRef}`, playerId);
      map.set(`n:${normalizedName}`, playerId);
    }

    this.log.info({ matchId, players: map.size / 2 }, 'Jugadores upsertados desde la ficha');
    return map;
  }

  /**
   * Persiste los eventos ya parseados via replaceMatchEvents (upsert por
   * source_ref desde la migración 034). Llamado desde scrape() cuando
   * config.matchId está disponible.
   */
  private async injectEvents(
    events: ScrapedMatchEvent[],
    matchId: string,
    playerMap: Map<string, string> = new Map()
  ): Promise<void> {
    // Resolver team_id de local y visitante: la API determina el lado de cada
    // evento comparando team_id, así que sin esto todo aparece como visitante.
    const teamsRes = await db.query<{ home_team_id: string | null; away_team_id: string | null }>(
      'SELECT home_team_id, away_team_id FROM matches WHERE id = $1',
      [matchId]
    );
    const homeTeamId = teamsRes.rows[0]?.home_team_id ?? null;
    const awayTeamId = teamsRes.rows[0]?.away_team_id ?? null;

    const input = events.map((ev) => ({
      eventType: ev.eventType,
      minute:    ev.minute,
      period:    ev.period,
      clock:     ev.clock ?? null,
      teamId:    ev.isHome === true ? homeTeamId : ev.isHome === false ? awayTeamId : null,
      // Vinculación ref-first (#219): la ref del acta es exacta; el nombre es
      // el fallback para eventos sin id_player.
      playerId:  (ev.playerSourceRef ? playerMap.get(`r:${ev.playerSourceRef}`) : undefined)
        ?? (ev.playerName ? playerMap.get(`n:${normalizeName(ev.playerName)}`) : undefined)
        ?? null,
      detail:    ev.detail,
      sourceRef: ev.sourceRef,
      scrapedAt: new Date(),
    }));
    await withTransaction(async (client) => {
      await replaceMatchEvents(matchId, input, client);
      // COBERTURA (#201): la ficha trajo acta → hay timeline. Antes la bandera
      // event_coverage='none' (import histórico sin acta) no se promocionaba al
      // recuperar el acta y 364 partidos mantenían el timeline oculto con los
      // eventos YA en la base. Mismo guardado anti-acta-vacía de #149: si la
      // ficha vino vacía no hay eventos y no se toca la bandera.
      if (input.length > 0) {
        await client.query(
          `UPDATE matches SET event_coverage = 'full', updated_at = NOW()
            WHERE id = $1 AND event_coverage IS DISTINCT FROM 'full'`,
          [matchId]
        );
      }
    });
    this.log.info(
      { matchId, inserted: input.length, types: [...new Set(events.map(e => e.eventType))] },
      'Eventos inyectados directamente en match_events'
    );
  }
}

// ── Helpers de la estructura rfep_gr ─────────────────────────────────────────

/** Slug canónico de jugador — misma regla en alta (eventos) y enlace (alineaciones) */

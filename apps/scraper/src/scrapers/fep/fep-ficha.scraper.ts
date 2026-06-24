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
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../core/base-scraper.js';
import { requireFepSourceId } from '../../core/fep-source.js';
import { sidgadPost, SIDGAD_LANG } from './sidgad-client.js';
import { db, replaceMatchEvents, replaceMatchLineups, withTransaction } from '@sports/db';
import type { UpsertMatchLineupInput } from '@sports/db';

const BASE_URL = 'https://www.server2.sidgad.es/rfep';
const SOURCE_ID = requireFepSourceId();

/** IDCs de competiciones que usan rutas de Playoff/Eliminatorias en sidgad */
const PLAYOFF_IDCS = ['3481', '3484'];

export type FepEventType = 'goal' | 'penalty' | 'blue_card' | 'red_card' | 'timeout' | 'period_end' | 'foul' | 'direct_foul';

export interface ScrapedMatchEvent {
  /** Tipo de evento normalizado */
  eventType: FepEventType;
  /** Minuto del evento (puede ser null si no figura) */
  minute: number | null;
  /** Periodo / cuarto (1..4) */
  period: number | null;
  /** Tiempo RESTANTE del crono "MM:SS" (el marcador cuenta atrás desde 25:00) */
  clock?: string;
  /** Indicacion de si el evento es del equipo local (true) o visitante (false) */
  isHome: boolean | null;
  /** Nombre del jugador tal como aparece en el HTML (para resolver en ETL) */
  playerName: string | null;
  /** Dorsal del jugador si aparece */
  jerseyNumber: number | null;
  /** Texto libre con detalle adicional (p.ej. "1-0", "GOL PENALTI") */
  detail: string | null;
  /** Ref unico para idempotencia: fep_event_{idp}_{rowIdx} */
  sourceRef: string;
  /** Ref del jugador en sidgad: fep_player_{id_player} (si id_player > 0) */
  playerSourceRef?: string;
  /** Ref sidgad del equipo del jugador (atributo team_id del link, p.ej. "3358") */
  playerTeamRef?: string;
}

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
}

export class FepFichaScraper extends BaseScraper<ScrapedMatchEvent> {
  // Config propia de la ficha. ANTES se llamaba `config` y SOBREESCRIBÍA el
  // `config` de BaseScraper (que lleva scraperKey/entityType/sourceId) → de ahí
  // el "[undefined/undefined]" en los logs. Se renombra a `cfg` (auditoría Q2/B-).
  private readonly cfg: FichaScraperConfig;

  constructor(config: FichaScraperConfig) {
    super({
      scraperKey: 'fep_hockey',
      entityType: 'match_event',
      sourceId: SOURCE_ID,
    });
    this.cfg = config;
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
        // Log de diagnostico: muestra la URL exacta que se intenta raspar
        const debugUrl = `https://www.server2.sidgad.es/rfep/${candidate.path}`;
        console.log('[SCRAPER URL]', debugUrl, '| body:', JSON.stringify(candidate.body));
        const result = await sidgadPost(candidate.path, candidate.body);
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
          console.log('[SCRAPER URL] GANADOR:', debugUrl, '| body:', JSON.stringify(candidate.body));

          // Inyeccion inmediata: si el caller proporciono matchId, parsear e insertar
          // en match_events sin esperar al loop ETL externo
          if (this.cfg.matchId) {
            const events = this.parseFicha(html, idp);
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
            if (live) {
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
                   home_pen = $2, away_pen = $3,
                   win_type = 'penalties',
                   winner_team_id = CASE
                     WHEN $2 > $3 THEN home_team_id
                     WHEN $3 > $2 THEN away_team_id
                     ELSE winner_team_id END,
                   updated_at = NOW()
                 WHERE id = $1`,
                [this.cfg.matchId, pens.home, pens.away]
              );
              this.log.info({ matchId: this.cfg.matchId, ...pens }, '🥅 Tanda de penaltis actualizada');
            }
            // Alineaciones: vienen en el mismo HTML (tablas competiciones_tabla_basic)
            const lineups = parseLineups(html, idp);
            // Vincular jugador por nombre (la tabla de alineación no trae id_player)
            for (const l of lineups) {
              l.playerId = playerMap.get(normalizeName(l.playerName)) ?? undefined;
            }
            // Fallback: jugadores sin evento en ESTE partido pero ya creados
            // por fichas anteriores — enlace por slug canónico en DB.
            const unresolved = lineups.filter((l) => !l.playerId);
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

    return this.parseFicha(html, idp);
  }

  private parseFicha(html: string, idp: string): ScrapedMatchEvent[] {
    const $ = cheerio.load(html);
    const events: ScrapedMatchEvent[] = [];

    // Log del HTML en debug para diagnostico en primer run real
    this.log.debug(
      { idp, htmlLength: html.length, htmlPreview: html.slice(0, 800) },
      'HTML de ficha recibido'
    );

    // ── Estrategia 0: estructura real de rfep_gr_{idp}_1.php ────────────
    // (verificada contra logs/ficha-34277.html, 2026-06-09)
    // Cada incidencia es un <tr> con:
    //   .game_view_indcidencias_period  → "P1" / "P2"   (sic, typo de la fuente)
    //   .game_view_incidencias_time     → "MM:SS" dentro del periodo
    //   td.stats_table .texto_gris_11   → abreviatura del equipo (BAR / IHC)
    //   div.evento_*  > span.lang_es    → tipo: GOL, TARJETA AZUL, TARJETA ROJA,
    //                                     TIEMPO MUERTO, FALTA, AMONESTACIÓN...
    //   a.nombre_ficha_jugador_plus     → jugador; .game_view_incidencias_dorsal → dorsal
    const incidRows = $('tr').filter((_, tr) => $(tr).find('.game_view_indcidencias_period').length > 0);
    if (incidRows.length > 0) {
      // Nombre del equipo local desde la cabecera (.nombre1) para asignar lado
      const homeHeader = normalizeName($('.nombre1').first().text());
      let rowIdx = 0;
      // Instante exacto (crono fuente) por evento — solo para cruzar FD↔gol
      const rawInstant = new Map<string, string>();

      incidRows.each((_, tr) => {
        const $tr = $(tr);
        const idx = rowIdx++;

        const periodText = $tr.find('.game_view_indcidencias_period').first().text().trim(); // "P2"
        const timeText   = $tr.find('.game_view_incidencias_time').first().text().trim();    // "03:42"
        const teamAbbr   = $tr.find('td.stats_table .texto_gris_11').first().text().trim();  // "BAR"

        // Tipo desde el texto en español del div de evento
        const labelEs = $tr
          .find('div.evento_destacado, div.evento_negativo, div.evento_neutro, div.evento_positivo')
          .first()
          .find('span.lang_es')
          .first()
          .text()
          .trim()
          .toUpperCase();
        if (!labelEs) return;

        const eventType = mapIncidenciaType(labelEs);
        // AMONESTACIÓN VERBAL y similares: sin equivalente en el esquema
        if (!eventType) return;

        // Lado: nombre del equipo al final del div de evento, contrastado con cabecera
        const eventDiv = $tr
          .find('div.evento_destacado, div.evento_negativo, div.evento_neutro, div.evento_positivo')
          .first();
        const teamInEvent = normalizeName(eventDiv.clone().children().remove().end().text());
        const isHome = homeHeader.length > 0 && teamInEvent.length > 0
          ? homeHeader.includes(teamInEvent) || teamInEvent.includes(homeHeader)
          : undefined;

        // Jugador y dorsal
        const $playerLink = $tr.find('a.nombre_ficha_jugador_plus').first();
        const playerName = $playerLink.text().replace(/\s+/g, ' ').trim() || undefined;
        const idPlayerAttr = $playerLink.attr('id_player');
        const playerSourceRef = idPlayerAttr && idPlayerAttr !== '0' ? `fep_player_${idPlayerAttr}` : undefined;
        const playerTeamRef = $playerLink.attr('team_id') || undefined;
        const dorsalText = $tr.find('.game_view_incidencias_dorsal').first().text().trim();
        const jerseyNumber = dorsalText ? parseInt(dorsalText, 10) : undefined;

        const period = periodText ? parseInt(periodText.replace(/\D/g, ''), 10) || undefined : undefined;
        // El crono de la ficha es TIEMPO RESTANTE (cuenta atrás desde 25:00).
        // Convertimos a minuto transcurrido para que la cronología ordene y
        // se lea con la convención habitual ("01:06" restante en P1 → 24').
        const minute = remainingToElapsedMinute(timeText, period);

        const sourceRef = `fep_event_${idp}_${idx}`;
        rawInstant.set(sourceRef, `${isHome}|${periodText} ${timeText}`);

        // Crono restante normalizado "MM:SS" (el marcador cuenta atrás)
        const clockMatch = timeText?.match(/(\d{1,2})[:.'](\d{2})/);
        const clock = clockMatch
          ? `${clockMatch[1]!.padStart(2, '0')}:${clockMatch[2]}`
          : undefined;

        events.push({
          eventType,
          minute: Number.isNaN(minute) ? undefined : minute,
          period,
          clock,
          isHome,
          playerName,
          jerseyNumber: Number.isNaN(jerseyNumber) ? undefined : jerseyNumber,
          detail: null,
          sourceRef,
          playerSourceRef,
          playerTeamRef,
        } as ScrapedMatchEvent);
      });

      // Post-proceso: resultado de las faltas directas. La ficha no lo dice
      // explícitamente, pero si hay un GOL del mismo equipo en el mismo
      // instante exacto del crono, la FD se marcó; si no, se falló.
      const goalsByInstant = new Map<string, ScrapedMatchEvent>();
      for (const e of events) {
        if (e.eventType === 'goal') {
          goalsByInstant.set(rawInstant.get(e.sourceRef ?? '') ?? '', e);
        }
      }
      for (const ev of events) {
        if (ev.eventType !== 'direct_foul' && ev.eventType !== 'penalty') continue;
        const goal = goalsByInstant.get(rawInstant.get(ev.sourceRef ?? '') ?? '');
        // FD: marcada/fallada · Penalti: marcado/fallado (la API y las stats
        // detectan el acierto buscando 'marc' en detail)
        ev.detail = ev.eventType === 'penalty'
          ? (goal ? 'marcado' : 'fallado')
          : (goal ? 'marcada' : 'fallada');
        // La fuente no informa el lanzador (id_player=0 en FD/penalti), pero
        // si acabó en gol, el goleador del mismo instante es el lanzador.
        if (goal && !ev.playerName) {
          ev.playerName = goal.playerName;
          ev.playerSourceRef = goal.playerSourceRef;
          ev.playerTeamRef = goal.playerTeamRef;
        }
      }

      this.log.info(
        { idp, eventsFound: events.length, types: [...new Set(events.map(e => e.eventType))] },
        'Ficha parseada (estructura rfep_gr)'
      );
      return events;
    }

    // ── Estrategia 1: tabla con clase acta / ficha / eventos ────────────
    const ACTA_TABLE_SELECTORS = [
      'table.tabla_acta',
      'table.tabla_ficha',
      'table.tabla_eventos',
      'table.acta_table',
      '#tabla_acta',
      '.div_acta table',
      '.ficha_resumen table',
    ];

    let $table: cheerio.Cheerio<Element> | null = null;
    for (const sel of ACTA_TABLE_SELECTORS) {
      const found = $(sel);
      if (found.length > 0) {
        // .first() devuelve Cheerio<AnyNode>; aquí es una <table>, acotamos.
        $table = found.first() as cheerio.Cheerio<Element>;
        this.log.info({ selector: sel }, 'Tabla de eventos encontrada');
        break;
      }
    }

    if (!$table) {
      // Log todas las tablas disponibles para debugging
      const tables: string[] = [];
      $('table').each((_, t) => {
        const cls = $(t).attr('class') ?? '';
        const id  = $(t).attr('id')    ?? '';
        const rows = $(t).find('tr').length;
        tables.push(`[class="${cls}" id="${id}" rows=${rows}]`);
      });
      this.log.warn(
        { idp, tablesFound: tables, divClasses: $('div[class]').map((_, d) => $(d).attr('class')).get().slice(0, 20) },
        'No se encontro tabla de eventos conocida -- revisar HTML'
      );

      // Fallback: intentar parsear filas de cualquier tabla con >= 3 columnas
      $('table').each((tableIdx, table) => {
        const rows = $(table).find('tr');
        if (rows.length < 2) return;
        rows.each((rowIdx, row) => {
          const cells = $(row).find('td');
          if (cells.length < 2) return;
          const ev = this.tryParseRow($, cells, idp, rowIdx + tableIdx * 1000);
          if (ev) events.push(ev);
        });
      });

      return events;
    }

    // Parsear filas de la tabla encontrada
    $table.find('tbody tr, tr').each((rowIdx, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 2) return;
      const ev = this.tryParseRow($, cells, idp, rowIdx);
      if (ev) events.push(ev);
    });

    this.log.info(
      { idp, eventsFound: events.length, types: [...new Set(events.map(e => e.eventType))] },
      'Ficha parseada'
    );

    return events;
  }

  /**
   * Intenta extraer un evento de una fila de tabla.
   * Estrategias de deteccion de tipo de evento:
   *   1. Clase CSS del <img> o <td> (sidgad suele usar clases como "tipo_gol", "tipo_azul")
   *   2. Texto de celda (GOL, G, T.AZUL, TA, FALTA, TIMEOUT, etc.)
   *   3. Alt text de <img>
   */
  private tryParseRow(
    $: cheerio.CheerioAPI,
    cells: cheerio.Cheerio<Element>,
    idp: string,
    rowIdx: number
  ): ScrapedMatchEvent | null {
    const sourceRef = `fep_event_${idp}_${rowIdx}`;

    // Concatenar todo el texto de la fila para inspeccion
    const rowText = cells.map((_, c) => $(c).text().trim()).get().join(' | ');
    const rowHtml = cells.map((_, c) => $(c).html() ?? '').get().join(' | ');

    // Detectar tipo de evento
    const eventType = this.detectEventType($, cells, rowText, rowHtml);
    if (!eventType) {
      this.log.debug({ rowText: rowText.slice(0, 100), rowIdx }, 'Fila ignorada (sin tipo de evento)');
      return null;
    }

    // Detectar periodo / cuarto
    const period = this.detectPeriod(rowText);

    // Detectar minuto
    const minute = this.detectMinute(rowText);

    // Detectar lado (local/visitante)
    const isHome = this.detectSide($, cells, rowText);

    // Detectar jugador
    const { playerName, jerseyNumber } = this.detectPlayer($, cells, rowText);

    // Detail
    const detail = this.buildDetail(eventType, rowText, rowHtml);

    this.log.debug(
      { rowIdx, eventType, minute, period, isHome, playerName, detail },
      'Evento parseado'
    );

    return { eventType, minute, period, isHome, playerName, jerseyNumber, detail, sourceRef };
  }

  private detectEventType(
    $: cheerio.CheerioAPI,
    cells: cheerio.Cheerio<Element>,
    rowText: string,
    rowHtml: string
  ): FepEventType | null {
    const text = rowText.toUpperCase();
    const html = rowHtml.toLowerCase();

    // Por clase CSS o alt de imagen
    const classes = [
      ...cells.map((_, c) => $(c).attr('class') ?? '').get(),
      ...cells.find('img').map((_, img) => ($(img).attr('alt') ?? '') + ' ' + ($(img).attr('class') ?? '')).get(),
    ].join(' ').toLowerCase();

    // GOL
    if (/gol|goal|tipo_gol|clase_gol/.test(classes) || /\bGOL\b|\bG\b|MARCA/.test(text)) return 'goal';
    if (html.includes('gol') && !html.includes('penalti')) return 'goal';

    // PENALTI
    if (/penalt|penalty|tipo_pen/.test(classes) || /PENAL|PEN\b/.test(text)) return 'penalty';
    if (html.includes('penalt')) return 'penalty';

    // TARJETA AZUL (falta)
    if (/azul|blue|t_azul|tipo_azul|falta/.test(classes) || /T\.AZUL|TA\b|AZUL|BLUE|FALTA/.test(text)) return 'blue_card';

    // TARJETA ROJA
    if (/roja|red|t_roja|tipo_roja/.test(classes) || /T\.ROJA|TR\b|ROJA|RED/.test(text)) return 'red_card';

    // TIMEOUT
    if (/timeout|tiempo|t\.muerto|pausa/.test(classes) || /TIMEOUT|T\.MUERTO|TIEMPO MUERTO/.test(text)) return 'timeout';

    // FIN DE PERIODO
    if (/fin.*periodo|fin.*cuarto|period_end|cuarto_fin/.test(classes) || /FIN.*CUARTO|FIN.*PERIODO|DESCANSO|PRORROGA/.test(text)) return 'period_end';

    return null;
  }

  private detectPeriod(rowText: string): number | null {
    const m = rowText.match(/(\d)[°ºoer]*\s*(?:cuarto|periodo|C\b|Q\b)/i)
           ?? rowText.match(/(?:cuarto|periodo|C|Q)\s*(\d)/i);
    if (m?.[1]) return parseInt(m[1], 10);
    return null;
  }

  private detectMinute(rowText: string): number | null {
    const m = rowText.match(/(\d{1,3})[''´]?\s*(?:min|'|m\b)/i)
           ?? rowText.match(/\b(\d{1,3})\b.*(?:min|')/i);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      return n >= 0 && n <= 120 ? n : null;
    }
    return null;
  }

  private detectSide(
    $: cheerio.CheerioAPI,
    cells: cheerio.Cheerio<Element>,
    rowText: string
  ): boolean | null {
    // sidgad suele poner la info del local en columna izquierda (0..n/2)
    // y visitante en la derecha. Buscamos clases como "local", "visitante", "home", "away"
    const allClasses = cells.map((_, c) => $(c).attr('class') ?? '').get().join(' ').toLowerCase();
    if (/\blocal\b|\bhome\b/.test(allClasses)) return true;
    if (/\bvisitante\b|\baway\b/.test(allClasses)) return false;

    if (this.cfg.homeTeamName) {
      const home = this.cfg.homeTeamName.toUpperCase().slice(0, 6);
      if (rowText.toUpperCase().includes(home)) return true;
    }

    return null;
  }

  private detectPlayer(
    $: cheerio.CheerioAPI,
    cells: cheerio.Cheerio<Element>,
    rowText: string
  ): { playerName: string | null; jerseyNumber: number | null } {
    // Buscar celda con clase jugador / player / nombre
    let playerCell: cheerio.Cheerio<Element> | null = null;
    cells.each((_, c) => {
      const cls = ($(c).attr('class') ?? '').toLowerCase();
      if (/jugador|player|nombre/.test(cls)) playerCell = $(c);
    });
    const raw = playerCell ? $(playerCell).text().trim() : '';

    // Si no hay celda dedicada, buscar patron "Nro. Apellido Nombre" en rowText
    const jerseyMatch = raw.match(/^(\d{1,2})\s+(.+)/) ?? rowText.match(/\b(\d{1,2})\s+([A-Z][A-Z ,]+)/);
    if (jerseyMatch) {
      return {
        jerseyNumber: parseInt(jerseyMatch[1]!, 10),
        playerName: jerseyMatch[2]!.trim().slice(0, 80),
      };
    }

    return { playerName: raw.slice(0, 80) || null, jerseyNumber: null };
  }

  private buildDetail(type: FepEventType, rowText: string, _rowHtml: string): string | null {
    if (type === 'goal') {
      const scoreMatch = rowText.match(/(\d+)\s*[-:]\s*(\d+)/);
      return scoreMatch ? `${scoreMatch[1]}-${scoreMatch[2]}` : null;
    }
    if (type === 'penalty') {
      const upper = rowText.toUpperCase();
      if (/GOL|MARC/.test(upper)) return 'marcado';
      if (/PAR|FAL|ERR/.test(upper)) return 'parado';
    }
    return null;
  }

  /**
   * Inyecta eventos ya parseados en match_events via replaceMatchEvents (DELETE + INSERT).
   * Llamado desde scrape() cuando config.matchId esta disponible.
   */
  /**
   * Crea/actualiza los jugadores que aparecen en la ficha y su pertenencia
   * a equipo/temporada (team_players). Devuelve mapa nombre normalizado → UUID.
   */
  private async upsertPlayers(
    events: ScrapedMatchEvent[],
    matchId: string
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    const withPlayer = events.filter((e) => e.playerSourceRef && e.playerName);
    if (withPlayer.length === 0) return map;

    // Contexto del partido: temporada y sport
    const ctxRes = await db.query<{ season_id: string; sport_id: string }>(
      `SELECT m.season_id, c.sport_id
       FROM matches m
       JOIN seasons s ON s.id = m.season_id
       JOIN competitions c ON c.id = s.competition_id
       WHERE m.id = $1`,
      [matchId]
    );
    const ctx = ctxRes.rows[0];
    if (!ctx) return map;

    // Dedupe por playerSourceRef
    const unique = new Map<string, ScrapedMatchEvent>();
    for (const ev of withPlayer) {
      if (!unique.has(ev.playerSourceRef!)) unique.set(ev.playerSourceRef!, ev);
    }

    for (const ev of unique.values()) {
      const name = ev.playerName!;
      // "FONT SÁNCHEZ FERRAN" → apellidos + nombre (última palabra)
      const parts = name.split(/\s+/);
      const firstName = parts.length > 1 ? parts[parts.length - 1]! : name;
      const lastName  = parts.length > 1 ? parts.slice(0, -1).join(' ') : name;
      const slug = slugifyPlayerName(name);

      // Foto: patrón sidgad descubierto con fep-player-photo-probe.ts
      const idNum = ev.playerSourceRef!.replace('fep_player_', '');
      const photoUrl = `https://sidgad.cloud/rfep/images/fichas/${idNum}_1.jpg`;

      // Upsert por source_ref; si no existe, insert con slug único por sport
      const found = await db.query<{ id: string }>(
        `SELECT id FROM players WHERE source_ref = $1`, [ev.playerSourceRef]
      );
      let playerId = found.rows[0]?.id;
      if (playerId) {
        await db.query(
          `UPDATE players SET photo_url = COALESCE(photo_url, $2), updated_at = NOW() WHERE id = $1`,
          [playerId, photoUrl]
        );
      } else {
        const ins = await db.query<{ id: string }>(
          `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref, photo_url, scraped_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (sport_id, slug) DO UPDATE SET
             source_ref = EXCLUDED.source_ref,
             photo_url  = COALESCE(players.photo_url, EXCLUDED.photo_url),
             updated_at = NOW()
           RETURNING id`,
          [ctx.sport_id, firstName, lastName, slug, ev.playerSourceRef, photoUrl]
        );
        playerId = ins.rows[0]!.id;
      }

      // Pertenencia equipo/temporada (si conocemos el equipo sidgad)
      if (ev.playerTeamRef) {
        await db.query(
          `INSERT INTO team_players (season_id, team_id, player_id)
           SELECT $1, t.id, $2 FROM teams t WHERE t.source_ref = $3
           ON CONFLICT (season_id, team_id, player_id) DO NOTHING`,
          [ctx.season_id, playerId, ev.playerTeamRef]
        );
      }

      map.set(normalizeName(name), playerId);
    }

    this.log.info({ matchId, players: map.size }, 'Jugadores upsertados desde la ficha');
    return map;
  }

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
      playerId:  (ev.playerName ? playerMap.get(normalizeName(ev.playerName)) : null) ?? null,
      detail:    ev.detail,
      sourceRef: ev.sourceRef,
      scrapedAt: new Date(),
    }));
    await withTransaction(async (client) => {
      await replaceMatchEvents(matchId, input, client);
    });
    this.log.info(
      { matchId, inserted: input.length, types: [...new Set(events.map(e => e.eventType))] },
      'Eventos inyectados directamente en match_events'
    );
  }

  private get parseErrors(): Array<{ message: string; entityRef?: string }> {
    return [];
  }
}

// ── Helpers de la estructura rfep_gr ─────────────────────────────────────────

/** Slug canónico de jugador — misma regla en alta (eventos) y enlace (alineaciones) */
function slugifyPlayerName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Normaliza nombres de equipo para comparar (mayúsculas, sin acentos ni símbolos) */
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Estado en vivo de la cabecera de la ficha (rfep_gr):
 *   #game_period (.periodo_activo) → fase ("PERIODO 1/2" | "DESCANSO" | "FINAL")
 *   #game_time                     → MM:SS RESTANTE del periodo en curso (cuenta atrás).
 * Devuelve null si no hay cabecera de directo (ficha antigua/sin marcador en vivo).
 */
export interface LiveHeader {
  period: number | null;
  clockSeconds: number | null; // restante en el periodo en curso
  isHalftime: boolean;
}
export function parseLiveHeader(html: string): LiveHeader | null {
  const $ = cheerio.load(html);
  const phase = $('#game_period, .periodo_activo').first().text().trim().toUpperCase();
  const time  = $('#game_time').first().text().trim();
  if (!phase && !time) return null;
  const isHalftime = /(DESCANS|MEDIO|INTER)/.test(phase);
  const pm = phase.match(/(\d+)/);
  const period = pm ? parseInt(pm[1]!, 10) : null;
  const tm = time.match(/(\d{1,2}):(\d{2})/);
  const clockSeconds = tm ? parseInt(tm[1]!, 10) * 60 + parseInt(tm[2]!, 10) : null;
  return { period, clockSeconds, isHalftime };
}

/**
 * Mapea el texto en español de la incidencia a nuestro tipo de evento.
 * Devuelve null para incidencias sin equivalente en el esquema
 * (FALTA, FALTA DIRECTA, AMONESTACIÓN VERBAL...) — las faltas de equipo
 * van agregadas en la cabecera (report_faltas), no como eventos.
 */
/**
 * Extrae las alineaciones de las tablas competiciones_tabla_basic de la ficha.
 * Estructura por fila (verificada en logs/ficha-34277.html):
 *   td0: dorsal · td1: "P" si portero · col "5i" con "5" si cinco inicial
 *   td nombre: "OKM - APELLIDOS NOMBRE (C)" — prefijo de licencia, (C) capitán
 *   col G: goles del jugador en el partido
 * La primera tabla es el equipo local (coincide con .nombre1), la segunda el visitante.
 */
function parseLineups(html: string, idp: string): UpsertMatchLineupInput[] {
  const $ = cheerio.load(html);
  const lineups: UpsertMatchLineupInput[] = [];
  const scrapedAt = new Date();

  const homeHeader = $('.nombre1').first().text().replace(/\s+/g, ' ').trim().toUpperCase();

  $('table.competiciones_tabla_basic').each((tableIdx, table) => {
    const $table = $(table);
    const teamName = $table.find('tr').first().text().replace(/\s+/g, ' ').trim().toUpperCase();
    // Lado: por nombre de cabecera; fallback al orden de las tablas (0=local)
    const isHome = homeHeader
      ? teamName.includes(homeHeader) || homeHeader.includes(teamName)
      : tableIdx === 0;

    $table.find('tr').slice(2).each((rowIdx, row) => {
      const cells = $(row).find('td');
      if (cells.length < 4) return;

      const dorsalText = cells.eq(0).text().trim();
      const jerseyNumber = /^\d+$/.test(dorsalText) ? parseInt(dorsalText, 10) : undefined;

      // Cuerpo técnico: sin dorsal, con código de rol en la 2ª celda
      // (E1/E2 = entrenadores, A = auxiliar, D = delegado)
      const roleCode = cells.eq(1).text().trim().toUpperCase();
      if (!dorsalText && /^(E\d?|A|D)$/.test(roleCode)) {
        let staffName = '';
        cells.each((_, c) => {
          const t = $(c).text().replace(/\s+/g, ' ').trim();
          if (t !== roleCode && t.length > staffName.length) staffName = t;
        });
        if (staffName) {
          lineups.push({
            isHome,
            playerName: staffName,
            role: roleCode,
            sourceRef: `fep_lineup_${idp}_${tableIdx}_${rowIdx}`,
            scrapedAt,
          });
        }
        return;
      }

      if (cells.length < 6) return;

      // Nombre: la celda con el patrón "XXX - NOMBRE" (prefijo de licencia)
      let rawName = '';
      let nameIdx = -1;
      cells.each((i, c) => {
        const t = $(c).text().replace(/\s+/g, ' ').trim();
        if (!rawName && / - /.test(t)) { rawName = t; nameIdx = i; }
      });
      if (!rawName) return;

      const isCaptain = /\(C\)/i.test(rawName);
      const playerName = rawName
        .replace(/^[A-Z]{2,4}\s*-\s*/, '')   // prefijo de licencia "OKM - "
        .replace(/\(C\)/gi, '')
        .replace(/\s*\.\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!playerName) return;

      const isGoalkeeper = cells.eq(1).text().trim().toUpperCase() === 'P';
      // "5" en alguna de las columnas 2-4 = cinco inicial
      const isStarter = [2, 3, 4].some((i) => cells.eq(i).text().trim() === '5');
      // Goles: la columna G es la celda inmediatamente posterior al nombre.
      // (No buscar "primer número tras el nombre": si G está vacía se
      // colaría el valor de columnas posteriores como las faltas.)
      const goalsText = nameIdx >= 0 ? cells.eq(nameIdx + 1).text().trim() : '';
      const goals = /^\d+$/.test(goalsText) ? parseInt(goalsText, 10) : 0;
      // Asistencias: columna "As", justo después de G
      const assistsText = nameIdx >= 0 ? cells.eq(nameIdx + 2).text().trim() : '';
      const assists = /^\d+$/.test(assistsText) ? parseInt(assistsText, 10) : 0;

      lineups.push({
        isHome,
        jerseyNumber,
        playerName,
        isGoalkeeper,
        isStarter,
        isCaptain,
        goals,
        assists,
        sourceRef: `fep_lineup_${idp}_${tableIdx}_${rowIdx}`,
        scrapedAt,
      });
    });
  });

  return lineups;
}

/**
 * Convierte el crono de la ficha (tiempo RESTANTE, cuenta atrás) en minuto
 * transcurrido del periodo. Partes reglamentarias de 25 min (tpo_reg:25 en
 * sidgad); prórrogas (periodos 3+) de 5 min.
 * "24:54" restante → minuto 1 · "01:06" restante → minuto 24.
 */
function remainingToElapsedMinute(timeText: string, period?: number): number | undefined {
  const m = timeText.match(/(\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  const remainingSec = parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
  const periodLengthSec = (period !== undefined && period >= 3 ? 5 : 25) * 60;
  const elapsedSec = Math.max(0, periodLengthSec - remainingSec);
  // Convención deportiva: el primer minuto es el 1'
  return Math.min(Math.ceil(elapsedSec / 60) || 1, periodLengthSec / 60);
}

/**
 * Faltas de equipo desde la cabecera de la ficha.
 * Dos divs .report_faltas: el primero es el equipo local, el segundo el visitante.
 */
function parseTeamFouls(html: string): { home: number; away: number } | null {
  const $ = cheerio.load(html);
  const vals = $('.report_faltas')
    .map((_, d) => parseInt($(d).text().trim(), 10))
    .get();
  if (vals.length < 2 || vals.some((v) => Number.isNaN(v))) return null;
  return { home: vals[0]!, away: vals[1]! };
}

/**
 * Tanda de penaltis ("LANZAMIENTOS DE PENALTIS" en el acta). La tabla tiene dos
 * columnas (local izquierda, visitante derecha) con un lanzador por fila y un
 * punto de color por resultado: verde = marcado, rojo = fallado, gris (#CCC) =
 * no lanzó. Contamos los verdes de cada lado. Devuelve null si no hubo tanda.
 */
function parseShootout(html: string): { home: number; away: number } | null {
  const $ = cheerio.load(html);
  // Tabla cuya cabecera dice "LANZAMIENTOS DE PENALTIS" (o "SHOOTOUT").
  const table = $('table').filter((_, t) => {
    const head = $(t).find('thead').text().toUpperCase();
    return head.includes('LANZAMIENTOS DE PENALTIS') || head.includes('SHOOTOUT');
  }).first();
  if (table.length === 0) return null;

  // Las dos columnas al 50% (local izquierda, visitante derecha).
  const sides = table.find('td[width="50%"]');
  if (sides.length < 2) return null;

  const countGreen = (idx: number): number =>
    sides.eq(idx).find('div').toArray()
      .filter((d) => (($(d).attr('style') ?? '').toLowerCase()).includes('background-color: green'))
      .length;

  return { home: countGreen(0), away: countGreen(1) };
}

function mapIncidenciaType(labelEs: string): FepEventType | null {
  if (labelEs.startsWith('GOL')) return 'goal';
  if (labelEs.includes('PENAL')) return 'penalty';
  if (labelEs.includes('TARJETA AZUL')) return 'blue_card';
  if (labelEs.includes('TARJETA ROJA')) return 'red_card';
  if (labelEs.includes('TIEMPO MUERTO')) return 'timeout';
  if (labelEs.includes('FIN') && labelEs.includes('PERIODO')) return 'period_end';
  if (labelEs.includes('FALTA DIRECTA')) return 'direct_foul'; // antes que FALTA genérica
  if (labelEs.includes('FALTA')) return 'foul';
  // AMONESTACIÓN VERBAL y similares: sin equivalente
  return null;
}
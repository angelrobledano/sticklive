/**
 * Parser puro de la ficha de partido de la FPP.
 *
 *   · /jogo/{id} (liga) y /jogoTaca/{id} (copas): misma página. Trae marcador,
 *     faltas de equipo, árbitros, alineaciones con foto y técnicos, y los
 *     parámetros (con token) de la petición AJAX del timeline.
 *   · /Views/ajax_jogo.php?…: timeline, de MÁS NUEVO a más viejo, por partes
 *     (`h3` "2ª Parte", "1ª Parte" y, si hay prórroga, "Prolongamento" delante).
 *
 * Identidad del jugador: el id federativo de su foto (FED_85963.jpg →
 * `fpp_player_85963`). Es el mismo en la alineación y en el timeline, así que
 * los eventos se vinculan por ref exacta, nunca por nombre.
 *
 * Lado del evento: los del visitante se alinean a la derecha
 * (`justify-content-end`). El `alt` de la foto ("Jogador Equipa 1") NO es
 * fiable: lo trae mal en las tarjetas a técnicos.
 *
 * Crono: tiempo RESTANTE de la parte (cuenta atrás desde 25:00, o 5:00 en la
 * prórroga), igual que el acta de la FEP.
 */
import * as cheerio from 'cheerio';
import type { UpsertMatchLineupInput } from '@sports/db';
import {
  eventSourceRef, disambiguateEventRefs, remainingToElapsedMinute,
  type ScrapedMatchEvent, type FepEventType,
} from '../fep/fep-ficha.parser.js';
import { cleanName } from './fpp.parser.js';

export const FPP_EVENT_PREFIX = 'fpp_event_';
export const FPP_PLAYER_PREFIX = 'fpp_player_';

/** FED_85963.jpg → '85963'. */
export function fedIdOf(src: string | undefined | null): string | null {
  return /FED_(\d+)\.[a-z]+$/i.exec(src ?? '')?.[1] ?? null;
}

/**
 * "F. Navarro" → F. / Navarro · "Xano Edo" → Xano / Edo · "Platero" → '' / Platero.
 * La FPP escribe "Nombre Apellido(s)" (al revés que el acta FEP).
 */
export function splitPtName(name: string): { firstName: string; lastName: string } {
  const parts = name.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length === 1) return { firstName: '', lastName: parts[0]! };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

export interface FppLineupEntry {
  isHome: boolean;
  jerseyNumber: number | null;
  name: string;
  fedId: string | null;
  photoUrl: string | null;
  isStarter: boolean;
  /** Técnico: 'E1' entrenador, 'E2' adjunto, 'D' delegado, 'A' otro. Null = jugador. */
  role: string | null;
}

export interface FppJogo {
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  homeFouls: number | null;
  awayFouls: number | null;
  referees: string | null;
  /** Query string de ajax_jogo.php (con token), o null si no hay timeline. */
  timelineQuery: string | null;
  lineup: FppLineupEntry[];
}

const STAFF_ROLE: Record<string, string> = {
  'TREINADOR': 'E1',
  'TREINADOR ADJUNTO': 'E2',
  'TREINADOR-ADJUNTO': 'E2',
  'DELEGADO': 'D',
};

function staffRole(label: string): string {
  return STAFF_ROLE[label.toUpperCase()] ?? 'A';
}

/**
 * La FPP a veces lista dos veces al mismo jugador (mismo FED, otro dorsal) y
 * solo una de las dos lleva "(5i)" o "(J)": esa es la buena. Sin esto, la copia
 * sin marca pisaba al titular y la alineación salía con 2 de 5 (Carvalhos "B",
 * 2/11/2026).
 */
export function dedupeLineup(lineup: FppLineupEntry[], marked: Set<FppLineupEntry>): FppLineupEntry[] {
  const keep = new Map<string, FppLineupEntry>();
  const out: FppLineupEntry[] = [];
  for (const l of lineup) {
    if (l.role !== null || !l.fedId) { out.push(l); continue; }
    const k = `${l.isHome}|${l.fedId}`;
    const prev = keep.get(k);
    if (!prev) { keep.set(k, l); out.push(l); continue; }
    if (marked.has(l) && !marked.has(prev)) { out[out.indexOf(prev)] = l; keep.set(k, l); }
  }
  return out;
}

export function parseFppJogo(html: string): FppJogo {
  const $ = cheerio.load(html);

  const names = $('p.team-name').map((_, el) => cleanName($(el).text())).get();
  const score = /(\d+)\s*-\s*(\d+)/.exec($('p.score').first().text());
  const fouls = /(\d+)\s*-\s*(\d+)/.exec($('.num-faltas').first().text());
  const refs = /Árbitros:\s*(.+)/i.exec($('p').filter((_, el) => /Árbitros:/i.test($(el).text())).first().text());

  // El timeline se pide por AJAX con los mismos parámetros que usa la página.
  // Se quita el enlace de TV (lleva '&' sin escapar y no hace falta).
  let timelineQuery: string | null = null;
  const m = /url:\s*"\/Views\/ajax_jogo\.php",\s*data:\s*'([^']+)'/.exec(html);
  if (m) {
    timelineQuery = m[1]!
      .replace(/&amp;/g, '&')
      .replace(/linkTV=.*?(?=&clubeVisitado=)/, '')
      .replace(/&&+/g, '&')
      .replace(/^&/, '');
  }

  const lineup: FppLineupEntry[] = [];
  const marked = new Set<FppLineupEntry>();
  $('#Equipas .team').each((teamIdx, team) => {
    const isHome = teamIdx === 0;
    $(team).find('.player').each((_, el) => {
      const text = cleanName($(el).find('p').text());
      const pm = /^N\.º\s*(\d+)?\s*-\s*(.+?)(?:\s*\(([^)]*)\))?$/.exec(text);
      if (!pm) return;
      const src = $(el).find('img').attr('src') || null;
      const entry: FppLineupEntry = {
        isHome,
        jerseyNumber: pm[1] ? Number(pm[1]) : null,
        name: cleanName(pm[2]!),
        fedId: fedIdOf(src),
        photoUrl: src,
        isStarter: (pm[3] ?? '').toLowerCase() === '5i',
        role: null,
      };
      if (pm[3]) marked.add(entry);
      lineup.push(entry);
    });
    $(team).find('.staff-member').each((_, el) => {
      const text = cleanName($(el).find('p').text());
      const sm = /^(.+?)\s+-\s+(.+)$/.exec(text);
      if (!sm) return;
      const src = $(el).find('img').attr('src') || null;
      lineup.push({
        isHome, jerseyNumber: null, name: cleanName(sm[2]!), fedId: fedIdOf(src), photoUrl: src,
        isStarter: false, role: staffRole(sm[1]!),
      });
    });
  });

  return {
    lineup: dedupeLineup(lineup, marked),
    homeName: names[0] ?? '',
    awayName: names[1] ?? '',
    homeScore: score ? Number(score[1]) : null,
    awayScore: score ? Number(score[2]) : null,
    homeFouls: fouls ? Number(fouls[1]) : null,
    awayFouls: fouls ? Number(fouls[2]) : null,
    referees: refs ? cleanName(refs[1]!) || null : null,
    timelineQuery,
  };
}

/** Etiqueta del timeline → eventos (un "Golo Penalti" es gol + penalti marcado). */
function mapLabel(label: string): Array<{ type: FepEventType; detail: string | null }> {
  const u = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (/^AUTO ?GOLO/.test(u)) return [{ type: 'goal', detail: 'autogolo' }];
  if (/^GOLO PENALTI/.test(u)) return [{ type: 'goal', detail: null }, { type: 'penalty', detail: 'marcado' }];
  if (/^GOLO LIVRE DIRETO/.test(u)) return [{ type: 'goal', detail: null }, { type: 'direct_foul', detail: 'marcada' }];
  if (/^GOLO/.test(u)) return [{ type: 'goal', detail: null }];
  if (/^PENALTI FALHADO/.test(u)) return [{ type: 'penalty', detail: 'fallado' }];
  if (/^LIVRE DIRETO FALHADO/.test(u)) return [{ type: 'direct_foul', detail: 'fallada' }];
  if (/^CARTAO AZUL/.test(u)) return [{ type: 'blue_card', detail: null }];
  if (/^CARTAO VERMELHO/.test(u)) return [{ type: 'red_card', detail: null }];
  if (/^DESCONTO DE TEMPO/.test(u)) return [{ type: 'timeout', detail: null }];
  if (/^FALTA\b/.test(u)) return [{ type: 'foul', detail: null }];
  // Cartão Amarelo / Advertência Verbal: sin equivalente (igual que la FEP).
  return [];
}

/** "15:20" / "(1:45)" → "15:20" con dos dígitos de minuto. */
function clockOf(text: string): string | undefined {
  const m = /(\d{1,2}):(\d{2})/.exec(text);
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : undefined;
}

/**
 * Timeline AJAX → eventos en el formato del acta FEP (mismo loader).
 *
 * @param jogoKey  identificador del partido para las refs (`508_1555`).
 * @param players  fedId → true si es JUGADOR de la alineación: solo a ellos se
 *                 les pone ref de jugador (un técnico amonestado no es jugador).
 */
export function parseFppTimeline(
  html: string,
  jogoKey: string,
  players: ReadonlySet<string> = new Set(),
): ScrapedMatchEvent[] {
  const $ = cheerio.load(html);
  type Raw = { ev: ScrapedMatchEvent; order: number };
  const raws: Raw[] = [];

  // Partes de más nueva a más vieja. Tras "Prolongamento", las partes son de la
  // prórroga hasta que la numeración deja de bajar (2ª→1ª) y vuelve a empezar.
  let inOvertime = false;
  let lastPart = Infinity;
  let period: number | undefined;
  let order = 0;

  const nodes = $('h3, div.time').toArray();
  for (const node of nodes) {
    const $n = $(node);
    if (node.tagName === 'h3') {
      const t = cleanName($n.text()).toUpperCase();
      if (/PROLONGAMENTO/.test(t)) { inOvertime = true; lastPart = Infinity; continue; }
      const part = /(\d)\s*ª\s*PARTE/.exec(t);
      if (!part) continue;
      const n = Number(part[1]);
      if (inOvertime && n >= lastPart) inOvertime = false;
      lastPart = n;
      period = inOvertime ? n + 2 : n;
      continue;
    }

    const isHome = !/\bjustify-content-end\b/.test($n.attr('class') ?? '');
    const strong = cleanName($n.find('strong').first().text());
    const paragraphs = $n.find('p').map((_, p) => cleanName($(p).text())).get();
    const label = (strong || paragraphs[0] || '').replace(/\(?\d{1,2}:\d{2}\)?/g, '').trim();
    const clock = clockOf($n.text());
    const mapped = mapLabel(label);
    if (mapped.length === 0) continue;

    // Jugador: segunda línea ("16:32 F. Navarro" o "F. Navarro"), sin el crono.
    const who = paragraphs.length > 1 ? cleanName(paragraphs[paragraphs.length - 1]!.replace(/^\d{1,2}:\d{2}\s*/, '')) : '';
    const fedId = fedIdOf($n.find('img').attr('src'));
    const isPlayer = !!fedId && players.has(fedId);
    const isTeamEvent = mapped[0]!.type === 'foul' || mapped[0]!.type === 'timeout';

    for (const { type, detail } of mapped) {
      const minute = clock ? remainingToElapsedMinute(clock, period) ?? null : null;
      const ev: ScrapedMatchEvent = {
        eventType: type,
        minute,
        period: period ?? null,
        ...(clock ? { clock } : {}),
        isHome,
        playerName: isTeamEvent ? null : (who || null),
        jerseyNumber: null,
        detail: type === 'foul' ? (/(\d+)/.exec(label)?.[1] ?? null) : detail,
        sourceRef: eventSourceRef({
          idp: jogoKey, period, clock, eventType: type, isHome,
          fallbackIdx: order, minute, prefix: FPP_EVENT_PREFIX,
        }),
        ...(isPlayer && !isTeamEvent ? { playerSourceRef: `${FPP_PLAYER_PREFIX}${fedId}` } : {}),
      };
      raws.push({ ev, order: order++ });
    }
  }

  // La FPP a veces registra el MISMO evento dos veces (mismo tipo, parte,
  // segundo, lado y jugador: caso real de un gol duplicado en el acta 17386).
  // Dos goles del mismo jugador en el mismo segundo no existen: se quita la copia.
  const seen = new Set<string>();
  for (let i = raws.length - 1; i >= 0; i--) {
    const e = raws[i]!.ev;
    if (e.eventType === 'foul' || e.eventType === 'timeout') continue;
    const key = [e.eventType, e.period, e.clock, e.isHome, e.playerName, e.detail].join('|');
    if (seen.has(key)) raws.splice(i, 1); else seen.add(key);
  }

  // Orden cronológico (parte ↑, restante ↓) para el marcador acumulado del gol.
  const secs = (c?: string) => (c ? Number(c.slice(0, 2)) * 60 + Number(c.slice(3)) : 0);
  const chrono = [...raws].sort((a, b) =>
    (a.ev.period ?? 0) - (b.ev.period ?? 0) || secs(b.ev.clock) - secs(a.ev.clock) || b.order - a.order);
  let h = 0, a = 0;
  for (const { ev } of chrono) {
    if (ev.eventType !== 'goal') continue;
    if (ev.isHome) h++; else a++;
    ev.detail = ev.detail === 'autogolo' ? `${h}-${a} (autogolo)` : `${h}-${a}`;
  }

  const events = chrono.map((r) => r.ev);
  disambiguateEventRefs(events);
  return events;
}

/** Goles de cada jugador (por ref FPP) según los eventos del timeline. */
export function fppGoalsByPlayer(events: ReadonlyArray<{ eventType: string; playerSourceRef?: string | null }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.eventType !== 'goal' || !e.playerSourceRef) continue;
    out.set(e.playerSourceRef, (out.get(e.playerSourceRef) ?? 0) + 1);
  }
  return out;
}

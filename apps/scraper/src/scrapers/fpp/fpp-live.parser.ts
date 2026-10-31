/**
 * Parser puro de https://hp.fpp.pt/Direto ("Jogos do Dia"), el feed en vivo de
 * la FPP: una lista `ul.lista-jogos` de `li.jogo-item`, agrupada por
 * competición (`.titulo-competicao`), que la propia web recarga cada 15 s.
 *
 * ⚠️ Escrito SIN una captura con partidos en juego (el 23/10/2026 no había
 * ninguno). La estructura sale del CSS de la página (`.jogo-item`,
 * `.team-visitada`/`.team-visitante`, `.resultado`, `.data-hora`,
 * `.estado-jogo`, `.fa-circle` parpadeante = en directo). Por eso:
 *   · el parser es tolerante (busca por clase, no por posición exacta),
 *   · el estado solo se declara con señal EXPLÍCITA (texto de estado o el
 *     punto rojo); lo que no reconoce queda `unknown` y se reporta con su texto
 *     literal (Sentry), para ajustar el vocabulario con el primer directo real.
 * Nunca se declara un partido en juego por reloj.
 */
import * as cheerio from 'cheerio';
import { cleanName } from './fpp.parser.js';

export type FppLiveState = 'live' | 'halftime' | 'finished' | 'scheduled' | 'unknown';

export interface FppLiveItem {
  competition: string | null;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  state: FppLiveState;
  /** Texto de estado tal cual (para el diagnóstico de estados nuevos). */
  stateText: string;
  /** Hay punto rojo parpadeante (`fa-circle`): la web lo marca en directo. */
  blinking: boolean;
  /** Ruta de la ficha si el item la enlaza (`/jogo/…`, `/jogoTaca/…`). */
  jogoPath: string | null;
  /** HTML del item (recortado) para diagnosticar marcadores raros. */
  raw: string;
}

/**
 * Marcador «N - N» del bloque de resultado. Sin que el número pegue con una
 * hora o un minuto («7 - 22:10» no es 7-22): ese texto no da marcador.
 */
export function parseScore(text: string): [number, number] | null {
  const m = /(?<![\d:])(\d{1,2})\s*-\s*(\d{1,2})(?![\d:'’hH])/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Texto de estado → estado. Vocabulario portugués conocido; el resto, unknown. */
export function classifyState(text: string, blinking: boolean): FppLiveState {
  const u = norm(text);
  if (/INTERVALO/.test(u)) return 'halftime';
  if (/\b(FINAL|TERMINAD[OA]|ENCERRAD[OA]|FIM|CONCLUID[OA])\b/.test(u) && !/1\/[248] FINAL|MEIAS?.FINA/.test(u)) return 'finished';
  if (/DECORRER|DIRETO|DIRECTO|AO VIVO|\bPARTE\b|PROLONGAMENTO|PENALIDADES|DESEMPATE|EM JOGO/.test(u)) return 'live';
  if (/AGENDAD|POR (?:INICIAR|COMECAR)|ADIAD|A INICIAR/.test(u)) return 'scheduled';
  if (!u) return blinking ? 'live' : 'scheduled';
  // Una hora sola ("18:00") es la hora de inicio de un partido sin empezar.
  if (/^\d{1,2}[:H]\d{2}$/.test(u)) return blinking ? 'live' : 'scheduled';
  return blinking ? 'live' : 'unknown';
}

export function parseFppDireto(html: string): FppLiveItem[] {
  const $ = cheerio.load(html);
  const out: FppLiveItem[] = [];
  let competition: string | null = null;

  $('.lista-jogos').find('.titulo-competicao, .jogo-item').each((_, el) => {
    const $el = $(el);
    if ($el.hasClass('titulo-competicao')) {
      competition = cleanName($el.text()) || null;
      return;
    }
    const names = $el.find('.team-name').map((__, n) => cleanName($(n).text())).get().filter(Boolean);
    // Móvil y escritorio duplican nombres (.mobile/.desktop): local, visitante.
    const homeName = cleanName($el.find('.team-visitada .team-name').first().text()) || names[0] || '';
    const awayName = cleanName($el.find('.team-visitante .team-name').first().text()) || names[names.length - 1] || '';
    if (!homeName || !awayName) return;

    // El marcador va en su propio span («<span class='provisorio sc'>7-2</span>
    // <br><span class='estado-jogo sc'>2ª P - 4:02</span>»). Leer el texto del
    // bloque entero los pegaba («7-22ª P») y salía 7-22 (Elite Cup 30-31/10).
    const scoreText = $el.find('.provisorio').first().text()
      || $el.find('.resultado').first().clone().find('.estado-jogo').remove().end().text();
    const score = parseScore(scoreText);
    const stateText = cleanName($el.find('.estado-jogo').first().text());
    const blinking = $el.find('.fa-circle').length > 0;
    // La web enlaza en relativo («jogo/18553», sin barra): se normaliza a «/jogo/18553».
    const jogo = $el.find('a[href*="jogo"]').map((__, a) => $(a).attr('href') ?? '').get()
      .map((h) => /(?:^|\/)(jogo(?:Taca)?\/\d+)/i.exec(h)?.[1]).find(Boolean) ?? null;

    out.push({
      competition, homeName, awayName,
      homeScore: score ? score[0] : null,
      awayScore: score ? score[1] : null,
      // Con marcador, sin estado y sin el punto rojo: partido acabado (la web
      // deja el resultado «provisorio» y quita el directo). Sin esto se quedaba
      // en juego hasta que lo cerraba otro proceso horas después.
      state: !stateText && !blinking && score ? 'finished' : classifyState(stateText, blinking),
      stateText, blinking, jogoPath: jogo ? `/${jogo}` : null,
      raw: ($.html(el) ?? '').replace(/\s+/g, ' ').slice(0, 2000),
    });
  });
  return out;
}

/** Clave de cruce por nombres (sin acentos, signos ni mayúsculas). */
export function pairKey(home: string, away: string): string {
  const k = (s: string) => norm(s).replace(/[^A-Z0-9]+/g, '');
  return `${k(home)}|${k(away)}`;
}

/** Partido FPP en ventana de directo (lo que casa con un item del feed). */
export interface LiveCandidate {
  id: string;
  season_id: string;
  sport_id: string;
  source_ref: string;
  source_url: string | null;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
  home_score?: number | null;
  away_score?: number | null;
  started_at?: Date | string | null;
}

/** Casa los items del feed con los candidatos: ficha enlazada primero, nombres después. */
export function matchItems<C extends LiveCandidate>(items: FppLiveItem[], cands: C[]): Array<{ item: FppLiveItem; cand: C }> {
  const byPath = new Map<string, C>();
  const byPair = new Map<string, C>();
  for (const c of cands) {
    const p = /\/jogo(?:Taca)?\/\d+$/i.exec(c.source_url ?? '')?.[0];
    if (p) byPath.set(p.toLowerCase(), c);
    byPair.set(pairKey(c.home_name, c.away_name), c);
  }
  const out: Array<{ item: FppLiveItem; cand: C }> = [];
  for (const item of items) {
    const cand = (item.jogoPath && byPath.get(item.jogoPath.toLowerCase())) || byPair.get(pairKey(item.homeName, item.awayName));
    if (cand) out.push({ item, cand });
  }
  return out;
}


/** Goles que puede sumar un marcador entre dos ciclos (~45 s) sin ser un error de lectura. */
export const MAX_GOALS_PER_CYCLE = 4;

/** ¿El marcador nuevo es un salto imposible respecto al guardado? (7-3 → 7-22). */
export function implausibleJump(prev: { home: number | null; away: number | null }, next: { home: number | null; away: number | null }): boolean {
  const d = (a: number | null, b: number | null) => (a == null || b == null ? 0 : b - a);
  return d(prev.home, next.home) > MAX_GOALS_PER_CYCLE || d(prev.away, next.away) > MAX_GOALS_PER_CYCLE;
}

/** Horas en juego tras las que un partido que ya no sale en /Direto se da por terminado. */
export const GONE_AFTER_HOURS = 2.5;

/**
 * Partidos que tenemos en juego pero que el feed ya no lista (/Direto es «jogos
 * do dia»: tras medianoche, los de ayer desaparecen sin pasar por «Final») y
 * llevan más de dos horas y media empezados. Solo con un feed con partidos: un feed
 * vacío puede ser un fallo de la web.
 */
export function goneLive<C extends LiveCandidate>(items: FppLiveItem[], cands: C[], matched: Set<string>, now: Date = new Date()): C[] {
  if (items.length === 0) return [];
  return cands.filter((c) => {
    if (c.status !== 'live' || matched.has(c.id) || !c.started_at) return false;
    return now.getTime() - new Date(c.started_at).getTime() > GONE_AFTER_HOURS * 3_600_000;
  });
}

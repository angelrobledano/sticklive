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

    const score = /(\d+)\s*-\s*(\d+)/.exec($el.find('.resultado').first().text());
    const stateText = cleanName($el.find('.estado-jogo').first().text());
    const blinking = $el.find('.fa-circle').length > 0;
    const jogo = $el.find('a[href*="/jogo"]').map((__, a) => $(a).attr('href') ?? '').get()
      .map((h) => /\/jogo(?:Taca)?\/\d+/i.exec(h)?.[0]).find(Boolean) ?? null;

    out.push({
      competition, homeName, awayName,
      homeScore: score ? Number(score[1]) : null,
      awayScore: score ? Number(score[2]) : null,
      state: classifyState(stateText, blinking),
      stateText, blinking, jogoPath: jogo,
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


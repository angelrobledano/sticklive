/**
 * Índice idp del match center de worldskate (`worldskate_mc_1.php`).
 *
 * El calendario (`worldskate_cal_idc_{IDC}_1.php`) no siempre trae el `idp`
 * del partido: sidgad lo publica tarde (este 7/10 el Colombia-India sub-19
 * estaba EN DIRECTO y su fila seguía sin idp), así que el partido nacía con
 * `source_ref` sintético y cron-live no podía pedir su acta — sin cronología
 * en directo.
 *
 * El match center, en cambio, publica el `idp` CON ANTELACIÓN (el 3259 ya
 * estaba en el feed la noche anterior al partido). Cada bloque
 * `<a class="... scorer_game ... club_X club_Y" idp="N">` trae los dos logos
 * de club y la fecha/hora local de la sede:
 *
 *   <a href="#" class="id_fede_1 scorer_game scorer_game_final ... club_19 club_33"
 *      idp="3259" ...>
 *     <div class="scorer_liga">WORLD U19 MEN</div>
 *     <img src="https://sidgad.cloud/worldskate/images/logos_clubes/19_1.png" ...>
 *     ...
 *     <div class="scorer_bot_left">07/10 09:15</div>
 *     <div class="scorer_bot_center">COMPLETED|LIVE|...</div>
 *
 * Clave de resolución: (par de logos ordenado, fecha DD/MM [, hora HH:MM]).
 * Los logos identifican al PAÍS (compartidos entre categorías: Colombia es
 * `19_1` tanto en absoluta como sub-19), así que la fecha desambigua casi
 * siempre y la hora el resto (el 7/10 hay Colombia-India en AMBAS
 * categorías: 09:15 sub-19 y 15:30 absoluta). Claves ambiguas se descartan:
 * el partido sigue sintético y se recupera por la vía de siempre (adopción
 * cuando el calendario publique el idp).
 *
 * Funciones puras y testeadas; la red vive en el scraper.
 */

export interface McIdpIndex {
  /** Clave `logos|DD/MM HH:MM` (logos ordenados) → idp. Solo claves inequívocas. */
  readonly byDateTime: ReadonlyMap<string, string>;
  /** Fallback `logos|DD/MM` → idp (solo si única para esa fecha). */
  readonly byDate: ReadonlyMap<string, string>;
  /**
   * Fallback `logos|DD/MM` SOLO de bloques sin hora. Una fila CON hora no puede
   * casar con un bloque de otra hora: los logos son del país, compartidos entre
   * categorías (bug real: el ITA-COL femenino de las 17:45 se llevó el idp del
   * cuarto de final sub-19 COL-ITA de las 12:30, mismo día).
   */
  readonly byDateNoTime: ReadonlyMap<string, string>;
}

/** `19_1`, `33_1` → `19_1|33_1` (ordenado, sin duplicados ni extensión). */
export function mcLogoKey(logos: string[]): string {
  return [...new Set(logos.map((l) => l.trim().replace(/\.png$/i, '')))].sort().join('|');
}

/** `20261007` → `07/10` (fecha local de la sede, el formato del mc). */
export function gamedateToFechaDM(gamedate: string | undefined): string | null {
  if (!gamedate || !/^\d{8}$/.test(gamedate)) return null;
  return `${gamedate.slice(6, 8)}/${gamedate.slice(4, 6)}`;
}

/** Bloque de partido del mc: un <a class="... scorer_game ..." idp="N">...</a>. */
interface McBlock {
  idp: string;
  logos: string[];
  /** Fecha local "DD/MM" (de `scorer_bot_left`). */
  fechaDM: string | null;
  /** Hora local "HH:MM" si el bloque la trae. */
  hora: string | null;
}

function parseMcBlocks(html: string): McBlock[] {
  const blocks: McBlock[] = [];
  const re = /<a\s[^>]*class="[^"]*scorer_game[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const bloque = m[0];
    const idp = bloque.match(/idp="?(\d{3,5})"?/)?.[1];
    if (!idp) continue;
    const logos = [...bloque.matchAll(/logos_clubes\/([^/'"?]+)\.png/g)].map((x) => x[1]!);
    if (logos.length < 2) continue;
    const fecha = bloque.match(/scorer_bot_left['"]>\s*(\d{2}\/\d{2})(?:\s+(\d{1,2}:\d{2}))?\s*</);
    blocks.push({
      idp,
      logos,
      fechaDM: fecha?.[1] ?? null,
      hora: fecha?.[2] ?? null,
    });
  }
  return blocks;
}

/**
 * Construye el índice descartando claves ambiguas: dos partidos distintos con
 * la misma clave (mismos países el mismo día, p. ej. Colombia-India en
 * sub-19 y absoluta el mismo 7/10) no resuelven — el llamante deja esos
 * sintéticos y se recuperan por la adopción del calendario.
 */
export function parseMcIdpIndex(html: string): McIdpIndex {
  const conHora = new Map<string, Set<string>>();
  const soloFecha = new Map<string, Set<string>>();
  const soloFechaSinHora = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, idp: string) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(idp);
  };

  for (const b of parseMcBlocks(html)) {
    if (!b.fechaDM) continue;
    const logoKey = mcLogoKey(b.logos);
    add(conHora, `${logoKey}|${b.fechaDM}${b.hora ? ` ${b.hora}` : ''}`, b.idp);
    add(soloFecha, `${logoKey}|${b.fechaDM}`, b.idp);
    if (!b.hora) add(soloFechaSinHora, `${logoKey}|${b.fechaDM}`, b.idp);
  }

  const unicas = (m: Map<string, Set<string>>) =>
    new Map([...m].filter(([, s]) => s.size === 1).map(([k, s]) => [k, [...s][0]!]));

  return { byDateTime: unicas(conHora), byDate: unicas(soloFecha), byDateNoTime: unicas(soloFechaSinHora) };
}

/** Índice vacío (fallos de red → degradación al comportamiento de siempre). */
export function emptyMcIdpIndex(): McIdpIndex {
  return { byDateTime: new Map(), byDate: new Map(), byDateNoTime: new Map() };
}

/**
 * Busca el `idp` de un partido del calendario por (par de logos, fecha[, hora]).
 * Preferencia: clave con hora (más específica) → clave solo fecha.
 */
export function mcLookupIdp(
  index: McIdpIndex,
  logos: string[],
  fechaDM: string | null,
  hora: string | null,
): string | undefined {
  if (logos.length < 2 || !fechaDM) return undefined;
  const logoKey = mcLogoKey(logos);
  if (hora) {
    // Con hora: solo su clave exacta o un bloque que NO publique hora.
    return index.byDateTime.get(`${logoKey}|${fechaDM} ${hora}`)
      ?? index.byDateNoTime.get(`${logoKey}|${fechaDM}`);
  }
  return index.byDate.get(`${logoKey}|${fechaDM}`);
}

/** Estado EXPLÍCITO de un partido en el match center. */
export interface McState {
  status: 'live' | 'finished' | 'scheduled';
  /** Marcador del bloque (izquierda = local según la fuente). */
  homeScore: number | undefined;
  awayScore: number | undefined;
  /** Logo de cada lado, para verificar la orientación local/visitante. */
  leftLogo: string | null;
  rightLogo: string | null;
}

/**
 * Estado de cada partido del match center por idp: `scorer_game_playing` →
 * live, `scorer_game_final` → finished, `scorer_game_pending` → scheduled, más
 * el marcador en vivo. Es la señal explícita del directo de World Skate (el
 * calendario no lo dice: muestra "-" al empezar y, desde el descanso, el
 * marcador PARCIAL, que no es un final). Pura.
 */
export function parseMcStates(html: string): Map<string, McState> {
  const out = new Map<string, McState>();
  const re = /<(a|div)\s([^>]*class="[^"]*scorer_game[^"]*"[^>]*)>([\s\S]*?)(?=<(?:a|div)\s[^>]*class="[^"]*scorer_game[\s"]|$)/g;
  for (const m of html.matchAll(re)) {
    const attrs = m[2]!;
    const body = m[3]!;
    const idp = attrs.match(/idp=["']?(\d{2,6})/)?.[1];
    if (!idp) continue;
    const cls = attrs.match(/class="([^"]*)"/)?.[1] ?? '';
    const status = /\bscorer_game_final\b/.test(cls) ? 'finished'
      : /\bscorer_game_(?:playing|live)\b/.test(cls) ? 'live'
      : /\bscorer_game_pending\b/.test(cls) ? 'scheduled'
      : null;
    if (!status) continue;
    const score = body.match(/scorer_score['"][^>]*>\s*(\d{1,3})\s*[:-]\s*(\d{1,3})\s*</);
    const logo = (side: 'left' | 'right') =>
      body.match(new RegExp(`scorer_logo_${side}['"][^>]*>\\s*<img[^>]*logos_clubes/([^/'"?]+?)\\.png`))?.[1] ?? null;
    out.set(idp, {
      status,
      homeScore: score ? Number(score[1]) : undefined,
      awayScore: score ? Number(score[2]) : undefined,
      leftLogo: logo('left'),
      rightLogo: logo('right'),
    });
  }
  return out;
}

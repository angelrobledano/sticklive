/**
 * live-probe.ts — Sonda de depuración de directo (SOLO LECTURA, no toca la BD).
 *
 * Reutiliza el scraper real (FepMatchesScraper) y el cliente sidgad (sesión/
 * cookies/referer correctos) para vigilar UN partido concreto mientras se juega,
 * comparar contra la retransmisión oficial y registrar incidencias con timestamp.
 *
 * Qué hace cada ciclo (por defecto cada 30 s):
 *   1. POST rfep_mc_1.php (vía FepMatchesScraper) y localiza el partido objetivo.
 *   2. Imprime una línea limpia: hora real | estado | marcador | hora prevista.
 *   3. Si está live/finished, descarga la ficha (acta) probando los endpoints
 *      reales y vuelca el HTML a logs/ para inspeccionar cambios de estructura.
 *   4. Diff contra el ciclo anterior: detecta GOL (cambio de marcador) y cambios
 *      de estado, con la hora exacta de detección (para medir latencia vs TV).
 *   5. Todo lo relevante se anexa a logs/live-incidents-YYYYMMDD.log.
 *
 * Uso (en el PC de Ángel o en el VPS — donde sí se alcanza sidgad):
 *   npx tsx --env-file .env apps/scraper/src/scrapers/fep/live-probe.ts
 *
 * Variables opcionales:
 *   PROBE_HOME=IGU PROBE_AWAY=LIC   — abreviaturas/nombres a casar (por defecto Igualada/Liceo)
 *   PROBE_HOME_REF=3408 PROBE_AWAY_REF=3373  — club refs sidgad (más fiable que la abreviatura)
 *   PROBE_IDP=34267                 — fija el idp directamente y salta la búsqueda
 *   PROBE_IDC=3481                  — idc para la ficha (3481 playoff OK Liga, 3150 liga)
 *   PROBE_INTERVAL_S=30             — segundos entre ciclos
 *   FEP_SOURCE_ID=...               — requerido por los scrapers (ya está en .env)
 */
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { FepMatchesScraper } from './fep-matches.scraper.js';
import { FepFichaScraper } from './fep-ficha.scraper.js';
import { sidgadPost, SIDGAD_LANG } from './sidgad-client.js';
import type { ScrapedMatch } from '@sports/shared-types';

// ── Config del partido objetivo ──────────────────────────────────────────────
const HOME_HINTS = (process.env['PROBE_HOME'] ?? 'IGU,IGUALADA,IHC').toUpperCase().split(',');
const AWAY_HINTS = (process.env['PROBE_AWAY'] ?? 'LIC,LICEO,HCL').toUpperCase().split(',');
// OJO: los club_XX del HTML son ids de CLUB (IHC=69, HCL=44), no los refs del seed.
const HOME_REF   = process.env['PROBE_HOME_REF'] ?? '69'; // Igualada (IHC)
const AWAY_REF   = process.env['PROBE_AWAY_REF'] ?? '44'; // Liceo (HCL)
// Confirmado en el HTML en directo (21/06): idp=34259, PLAY OFF OK LIGA → idc 3481.
const FIXED_IDP  = process.env['PROBE_IDP'] ?? '34259';
const FIXED_IDC  = process.env['PROBE_IDC'] ?? '3481';      // playoff OK Liga por defecto
const INTERVAL   = Number(process.env['PROBE_INTERVAL_S'] ?? 30) * 1000;
const SEASON_ID  = process.env['SEASON_ID'] ?? process.env['DEFAULT_SEASON_ID'] ?? 'probe';

const LOG_DIR = path.join(process.cwd(), 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const INCIDENTS = path.join(LOG_DIR, `live-incidents-${stamp().slice(0, 8)}.log`);

function stamp(): string {
  // YYYYMMDD-HHMMSS en hora local
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function now(): string { return new Date().toISOString(); }

function incident(tag: string, msg: string): void {
  const line = `${now()} [${tag}] ${msg}`;
  console.log(`  ⚠ ${line}`);
  try { fs.appendFileSync(INCIDENTS, line + '\n'); } catch { /* no bloquear */ }
}
function note(tag: string, msg: string): void {
  const line = `${now()} [${tag}] ${msg}`;
  try { fs.appendFileSync(INCIDENTS, line + '\n'); } catch { /* no bloquear */ }
}

// ── Localizar el partido objetivo entre todos los marcadores ──────────────────
function findTarget(matches: ScrapedMatch[]): ScrapedMatch | undefined {
  const hit = (ref: string, hints: string[], clubRef: string) =>
    ref.includes(clubRef) || hints.some((h) => h && ref.toUpperCase().includes(h));

  // Casar en cualquier orden (local/visitante puede venir invertido en la fuente)
  return matches.find((m) => {
    const h = m.homeTeamRef ?? '';
    const a = m.awayTeamRef ?? '';
    const direct  = hit(h, HOME_HINTS, HOME_REF) && hit(a, AWAY_HINTS, AWAY_REF);
    const swapped = hit(h, AWAY_HINTS, AWAY_REF) && hit(a, HOME_HINTS, HOME_REF);
    return direct || swapped;
  });
}

// ── Descargar la ficha (acta) y volcar HTML para inspección ───────────────────
const ACTA_CANDIDATES = (idp: string, idc: string) => [
  { path: `rfep_gr_${idp}_1.php`,           body: { idm: '1', idc, idp, tab: 'tab_ficha_resumen' } },
  { path: `rfep_acta_idc_${idc}_1.php`,     body: { idp, idc, site_lang: SIDGAD_LANG } },
  { path: `rfep_acta_eli_idc_${idc}_1.php`, body: { id_partido: idp, idc, site_lang: SIDGAD_LANG } },
  { path: 'rfep_acta_eli_1.php',            body: { id_partido: idp, idc, site_lang: SIDGAD_LANG } },
  { path: 'rfep_acta_idc_3150_1.php',       body: { idp, idc: '3150', site_lang: SIDGAD_LANG } },
];

async function probeActa(idp: string, idc: string): Promise<void> {
  // 1) Volcado crudo del HTML (para diff de estructura) por el primer endpoint que responda
  let dumped = false;
  for (const c of ACTA_CANDIDATES(idp, idc)) {
    try {
      const html = await sidgadPost(c.path, c.body);
      if (!html || html.length < 200) continue;
      const $ = cheerio.load(html);
      const text = $('body').text();
      const clocks = (text.match(/\b\d{1,2}:\d{2}\b/g) ?? []).length;
      const goals  = (text.match(/gol/gi) ?? []).length;
      const file = path.join(LOG_DIR, `acta_${idp}_${stamp()}.html`);
      fs.writeFileSync(file, html, 'utf-8');
      console.log(`  ✔ acta vía ${c.path} → ${html.length}b · ~${clocks} cronos · ~${goals} "gol" · ${path.basename(file)}`);
      note('ACTA', `idp=${idp} endpoint=${c.path} bytes=${html.length} clocks=${clocks} goals=${goals}`);
      dumped = true;
      break;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (!m.includes('404')) note('ACTA_ERR', `idp=${idp} ${c.path}: ${m}`);
    }
  }
  if (!dumped) {
    incident('ACTA', `Ningún endpoint de acta respondió para idp=${idp} idc=${idc}`);
    return;
  }

  // 2) PARSER REAL: corre FepFichaScraper SIN matchId (solo lectura, no toca la BD)
  //    para comprobar si el parseo de eventos es correcto frente a lo que vemos en TV.
  try {
    const ficha = new FepFichaScraper({ idp, idc });
    const res = await ficha.run();
    const evs = res.data;
    const byType = evs.reduce<Record<string, number>>((acc, e) => {
      acc[e.eventType] = (acc[e.eventType] ?? 0) + 1; return acc;
    }, {});
    console.log(`  ▸ parser ficha → ${evs.length} eventos · ${JSON.stringify(byType)}`);
    note('PARSER', `idp=${idp} eventos=${evs.length} tipos=${JSON.stringify(byType)} ok=${res.success}`);
    if (!res.success) incident('PARSER', `run() con errores: ${JSON.stringify(res.errors).slice(0, 300)}`);
    if (evs.length === 0) {
      incident('PARSER', `0 eventos parseados pese a acta con datos → revisar selectores de fep-ficha.scraper.ts`);
    }
    // Los 6 eventos más recientes (la ficha los lista del más nuevo al más viejo).
    // .reverse() para leerlos de arriba=más antiguo a abajo=más reciente.
    for (const e of evs.slice(0, 6).reverse()) {
      const who = e.isHome === true ? 'LOCAL' : e.isHome === false ? 'VISIT' : '???';
      console.log(`     · [P${e.period ?? '?'} ${e.clock ?? e.minute ?? '?'}] ${e.eventType} ${who} ${e.playerName ?? ''} ${e.detail ?? ''}`.trimEnd());
    }
  } catch (err) {
    incident('PARSER', `FepFichaScraper falló: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Bucle principal ───────────────────────────────────────────────────────────
let prevScore = '';
let prevStatus = '';
let finishedStreak = 0;
let cycle = 0;

async function tick(): Promise<boolean> {
  cycle++;
  const t = now();
  let matches: ScrapedMatch[] = [];
  try {
    const scraper = new FepMatchesScraper({ seasonId: SEASON_ID });
    const res = await scraper.run();
    matches = res.data;
    if (!res.success) incident('SCRAPER', `run() con errores: ${JSON.stringify(res.errors).slice(0, 300)}`);
  } catch (err) {
    incident('SCRAPER', `Fallo total al scrapear marcadores: ${err instanceof Error ? err.message : String(err)}`);
    return true; // seguir intentando
  }

  let target = FIXED_IDP
    ? matches.find((m) => m.sourceRef === `fep_match_${FIXED_IDP}`)
    : findTarget(matches);

  if (!target) {
    incident('NO_MATCH', `Partido objetivo NO aparece en rfep_mc_1.php (ciclo ${cycle}, ${matches.length} partidos visibles). ` +
      `Pistas home=[${HOME_HINTS}/${HOME_REF}] away=[${AWAY_HINTS}/${AWAY_REF}]`);
    // Ayuda de diagnóstico: lista lo que sí hay
    const sample = matches.slice(0, 12).map((m) => `${m.homeTeamRef}>${m.awayTeamRef}(${m.status})`).join(', ');
    console.log(`    visibles: ${sample}${matches.length > 12 ? ' …' : ''}`);
    return true;
  }

  const idp = (target.sourceRef ?? '').replace('fep_match_', '');
  const score = (target.homeScore != null && target.awayScore != null)
    ? `${target.homeScore}-${target.awayScore}` : '—';
  const status = target.status ?? '?';

  console.log(`[${t}] ciclo ${cycle} · idp ${idp} · ${target.homeTeamRef} vs ${target.awayTeamRef} · ${status} · ${score} · prog ${target.scheduledAt ?? '?'}`);

  // Diffs (latencia: comparar esta hora con la de la jugada en TV)
  if (prevScore && score !== prevScore && score !== '—') {
    incident('GOL', `Marcador ${prevScore} → ${score} (idp ${idp}). Apunta la hora de la jugada en TV para medir latencia.`);
  }
  if (prevStatus && status !== prevStatus) {
    incident('ESTADO', `Cambio de estado ${prevStatus} → ${status} (idp ${idp})`);
  }
  prevScore = score; prevStatus = status;

  // Ficha (eventos/goleadores/cronos) cuando hay actividad
  if (status === 'live' || status === 'finished') {
    await probeActa(idp, FIXED_IDC);
  }

  if (status === 'finished') { finishedStreak++; } else { finishedStreak = 0; }
  // Parar tras 4 ciclos seguidos en 'finished' (asegura captar la acta final)
  return finishedStreak < 4;
}

async function main(): Promise<void> {
  console.log(`▶ live-probe arrancada · objetivo home=[${HOME_HINTS}/${HOME_REF}] away=[${AWAY_HINTS}/${AWAY_REF}] · intervalo ${INTERVAL / 1000}s`);
  console.log(`  incidencias → ${INCIDENTS}`);
  console.log(`  actas/HTML  → ${LOG_DIR}`);
  note('START', `probe iniciada (cada ${INTERVAL / 1000}s)`);
  // Ctrl-C limpio
  process.on('SIGINT', () => { note('STOP', `detenida por usuario en ciclo ${cycle}`); console.log('\n⏹ detenida.'); process.exit(0); });

  while (await tick()) {
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
  note('END', `partido finalizado tras ${cycle} ciclos`);
  console.log('✅ Partido finalizado. Revisa el log de incidencias y las actas volcadas.');
}

main().catch((err) => { console.error('Error fatal en live-probe:', err); process.exit(1); });

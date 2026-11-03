/**
 * Importa el volcado de la RFEP (extracción de Ángel, 2/11/2026) SIN hacer
 * ninguna petición: lee los NDJSON.gz que genera scripts/sidgad-dump-bundle.py.
 *
 *   --players=<players.ndjson.gz>   foto, nacionalidad y nacimiento de los
 *                                   jugadores fep_player_{id} (solo rellena
 *                                   huecos, y solo si el apellido coincide)
 *   --matches=<matches.ndjson.gz>   pabellón y árbitros de los fep_match_{idp}
 *                                   que no los tengan, y validación contra BD
 *   --report=<fichero.md>           informe de validación (por defecto stdout)
 *   --dry-run                       sin escribir
 *
 * La fecha de nacimiento se guarda y NO se publica.
 *
 *   $DC exec etl node dist/apps/etl/src/import-sidgad-dump.js \
 *     --players=/data/players.ndjson.gz --matches=/data/matches.ndjson.gz --report=/data/informe.md
 */
import './instrument.js';
import { createReadStream, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';
import { sameSurname } from '../../scraper/src/sidgad-api/client.js';

const log = createLogger({ service: 'import-sidgad-dump' });

export interface DumpPlayer {
  id: string; firstName: string | null; lastName: string | null;
  birthDate: string | null; nationality: string | null; photoUrl: string | null; goalie?: boolean;
}
export interface DumpMatch {
  idp: string; idc: string; date: string | null; home: string | null; away: string | null;
  result: string | null; venue: string | null; acta?: boolean; completed?: boolean;
  homeScore?: string | null; awayScore?: string | null; referees?: string[]; goalEvents?: number;
}

export async function* readNdjson<T>(path: string): AsyncGenerator<T> {
  const stream = createReadStream(path);
  const input = path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim()) yield JSON.parse(line) as T;
  }
}

/** "ESPAÑOLA" → "Española". La fuente lo da en mayúsculas. */
export function niceNationality(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim().toLocaleLowerCase('es');
  return s ? s.charAt(0).toLocaleUpperCase('es') + s.slice(1) : null;
}

export interface PlayerStats { inDump: number; matched: number; updated: number; surnameMismatch: number;
  filled: { birthDate: number; nationality: number; photoUrl: number } }

export async function importPlayers(players: Iterable<DumpPlayer> | AsyncIterable<DumpPlayer>, dryRun: boolean): Promise<PlayerStats> {
  const ours = new Map<string, { id: string; last_name: string; birth_date: string | null; nationality: string | null; photo_url: string | null }>();
  const { rows } = await db.query<{ id: string; source_ref: string; last_name: string; birth_date: string | null; nationality: string | null; photo_url: string | null }>(
    `SELECT id, source_ref, last_name, birth_date::text, nationality, photo_url
       FROM players WHERE source_ref ~ '^fep_player_[0-9]+$'`,
  );
  for (const r of rows) ours.set(r.source_ref.slice('fep_player_'.length), r);

  const st: PlayerStats = { inDump: 0, matched: 0, updated: 0, surnameMismatch: 0, filled: { birthDate: 0, nationality: 0, photoUrl: 0 } };
  for await (const p of players) {
    st.inDump++;
    const o = ours.get(p.id);
    if (!o) continue;
    st.matched++;
    if (!sameSurname(o.last_name, p.lastName)) { st.surnameMismatch++; continue; }
    const nat = niceNationality(p.nationality);
    const fill = {
      birthDate: !o.birth_date && p.birthDate ? p.birthDate : null,
      nationality: !o.nationality && nat ? nat : null,
      photoUrl: !o.photo_url && p.photoUrl ? p.photoUrl : null,
    };
    if (!fill.birthDate && !fill.nationality && !fill.photoUrl) continue;
    if (fill.birthDate) st.filled.birthDate++;
    if (fill.nationality) st.filled.nationality++;
    if (fill.photoUrl) st.filled.photoUrl++;
    st.updated++;
    if (dryRun) continue;
    await db.query(
      `UPDATE players SET
         birth_date  = COALESCE(birth_date, $2::date),
         nationality = COALESCE(nationality, $3),
         photo_url   = COALESCE(photo_url, $4),
         profile_checked_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [o.id, fill.birthDate, fill.nationality, fill.photoUrl],
    );
  }
  return st;
}

export interface MatchStats {
  inDump: number; inDb: number; idCollision: number; venueFilled: number; refereeFilled: number;
  notInDb: Map<string, number>;          // idc → partidos jugados (con acta) que no tenemos
  notFinished: string[]; scoreDiff: string[]; goalsDiff: string[];
}

const GENERIC = new Set(['CLUB', 'HOCKEY', 'PATI', 'PATIN', 'PATINES', 'PATINATGE', 'HOQUEI', 'DEPORTIVO', 'DEPORTIU',
  'ESPORTIU', 'SPORT', 'ASSOCIACIO', 'ASOCIACION', 'FUNDACION', 'ESCOLA', 'ESCUELA', 'LIGA', 'UNION', 'SOCIEDAD']);
function teamWords(v: string): string[] {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ')
    .split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w));
}
/** Algún término distintivo en común ("REUS DEPORTIU" ~ "Reus Deportiu Brasilia"). */
export function sameTeams(ours: string, theirs: string | null): boolean {
  if (!theirs) return false;
  const a = new Set(teamWords(ours));
  return teamWords(theirs).some((w) => a.has(w));
}

function toInt(v: string | null | undefined): number | null {
  return v != null && /^\d+$/.test(v) ? Number(v) : null;
}

export async function importMatches(matches: Iterable<DumpMatch> | AsyncIterable<DumpMatch>, dryRun: boolean): Promise<MatchStats> {
  const { rows } = await db.query<{ id: string; source_ref: string; status: string; home_score: number | null; away_score: number | null;
    venue_name: string | null; referee: string | null; goals: number; home_name: string; away_name: string }>(
    `SELECT m.id, m.source_ref, m.status, m.home_score, m.away_score, m.venue_name, m.referee,
            ht.name AS home_name, at.name AS away_name,
            (SELECT COUNT(*)::int FROM match_events e WHERE e.match_id = m.id AND e.event_type = 'goal') AS goals
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
      WHERE m.source_ref ~ '^fep_match_[0-9]+$'`,
  );
  const ours = new Map(rows.map((r) => [r.source_ref.slice('fep_match_'.length), r]));
  const st: MatchStats = { inDump: 0, inDb: 0, idCollision: 0, venueFilled: 0, refereeFilled: 0, notInDb: new Map(), notFinished: [], scoreDiff: [], goalsDiff: [] };

  for await (const d of matches) {
    st.inDump++;
    const o = ours.get(d.idp);
    const hs = toInt(d.homeScore); const as = toInt(d.awayScore);
    const played = d.completed === true && hs != null && as != null;
    if (!o) {
      if (played) st.notInDb.set(d.idc, (st.notInDb.get(d.idc) ?? 0) + 1);
      continue;
    }
    // El mismo número de partido existe en otros portales de sidgad (el
    // histórico importado de otras fuentes reutiliza `fep_match_{idp}`): sin
    // equipos que coincidan no es el mismo partido y no se toca.
    if (!sameTeams(o.home_name, d.home) || !sameTeams(o.away_name, d.away)) { st.idCollision++; continue; }
    st.inDb++;
    const label = `${d.idp} ${d.home ?? '?'} – ${d.away ?? '?'} (${d.date ?? 's/f'})`;
    if (played) {
      if (o.status !== 'finished') st.notFinished.push(`${label}: fuente ${hs}-${as} terminado, nosotros ${o.status}`);
      else if (o.home_score !== hs || o.away_score !== as) st.scoreDiff.push(`${label}: fuente ${hs}-${as}, nosotros ${o.home_score}-${o.away_score}`);
      // Goles con evento: solo avisamos si tenemos menos que el acta (actas viejas sin eventos no cuentan).
      if (d.goalEvents && o.goals < d.goalEvents) st.goalsDiff.push(`${label}: acta ${d.goalEvents} goles con autor, nosotros ${o.goals}`);
    }
    const venue = !o.venue_name && d.venue ? d.venue : null;
    const referee = !o.referee && d.referees?.length ? d.referees.join(' / ') : null;
    if (venue) st.venueFilled++;
    if (referee) st.refereeFilled++;
    if ((venue || referee) && !dryRun) {
      await db.query(
        `UPDATE matches SET venue_name = COALESCE(venue_name, $2), referee = COALESCE(referee, $3), updated_at = NOW() WHERE id = $1`,
        [o.id, venue, referee],
      );
    }
  }
  return st;
}

export function renderReport(p: PlayerStats | null, m: MatchStats | null, dryRun: boolean): string {
  const out: string[] = [`# Importación del volcado RFEP${dryRun ? ' (simulación)' : ''}`, ''];
  if (p) {
    out.push('## Jugadores', '',
      `En el volcado ${p.inDump}, casados con los nuestros ${p.matched}, actualizados ${p.updated}.`,
      `Huecos rellenados: nacimiento ${p.filled.birthDate}, nacionalidad ${p.filled.nationality}, foto ${p.filled.photoUrl}.`,
      `Descartados por apellido distinto: ${p.surnameMismatch}.`, '');
  }
  if (m) {
    const list = (title: string, xs: string[]) => {
      out.push(`### ${title} (${xs.length})`, '');
      for (const x of xs.slice(0, 200)) out.push(`- ${x}`);
      if (xs.length > 200) out.push(`- … y ${xs.length - 200} más`);
      out.push('');
    };
    out.push('## Partidos', '',
      `En el volcado ${m.inDump}, en nuestra BD ${m.inDb}, mismo número pero otros equipos (descartados) ${m.idCollision}. Pabellón rellenado en ${m.venueFilled}, árbitros en ${m.refereeFilled}.`, '');
    const missing = [...m.notInDb.entries()].sort((a, b) => b[1] - a[1]);
    out.push(`### Jugados en la fuente que no tenemos (${missing.reduce((s, [, n]) => s + n, 0)}), por competición (idc)`, '');
    for (const [idc, n] of missing) out.push(`- idc ${idc}: ${n}`);
    out.push('');
    list('Terminados en la fuente y no en Stick Live', m.notFinished);
    list('Marcador distinto', m.scoreDiff);
    list('Faltan goles con autor', m.goalsDiff);
  }
  return out.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
  const dryRun = args.includes('--dry-run');
  const playersPath = arg('players'); const matchesPath = arg('matches');
  try {
    const p = playersPath ? await importPlayers(readNdjson<DumpPlayer>(playersPath), dryRun) : null;
    const m = matchesPath ? await importMatches(readNdjson<DumpMatch>(matchesPath), dryRun) : null;
    const md = renderReport(p, m, dryRun);
    const reportPath = arg('report');
    if (reportPath) writeFileSync(reportPath, md); else console.log(md);
    log.info({ players: p && { ...p }, matches: m && { inDump: m.inDump, inDb: m.inDb, collision: m.idCollision, venue: m.venueFilled, referee: m.refereeFilled } }, 'Volcado importado');
  } finally {
    await closeDb();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => { log.error({ err }, 'import-sidgad-dump falló'); process.exit(1); });
}

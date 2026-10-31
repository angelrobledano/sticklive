/**
 * Vigilancia del directo SIN acceso al servidor (31/10/2026).
 *
 * Compara lo que publica sticklive.eu (API pública /matches/current) con los
 * feeds oficiales en ese mismo instante: match center sidgad (RFEP y
 * autonómicas) y /Direto de la FPP. Saca un informe en Markdown con lo que no
 * cuadra. Solo lectura: no toca la base de datos ni el servidor.
 *
 *   npx tsx src/tools/monitor-directo.ts            # informe a stdout
 *   npx tsx src/tools/monitor-directo.ts --json     # además, JSON al final
 *
 * Qué detecta:
 *   · no_entra_directo   la fuente lo da en juego y nosotros programado
 *   · no_se_cierra       la fuente lo da terminado y nosotros en juego/programado
 *   · marcador_distinto  marcadores distintos con el partido en juego o acabado
 *   · directo_colgado    en juego hace más de 2,5 h
 *   · marcador_imposible más de 20 goles de un equipo
 *   · sin_casar          la fuente tiene el partido en juego y no lo encontramos
 */
process.env['FEP_SOURCE_ID'] ??= '00000000-0000-4000-8000-000000000000';

const API = process.env['MONITOR_API'] ?? 'https://sticklive.eu/api';
const SIDGAD_KEYS = ['fep', 'fecapa', 'fmp', 'fap', 'fpcv', 'fnp', 'fpcyl', 'fgp', 'fisr'];
const LIVE_MAX_H = 2.5;
const GRACE_MIN = 15;

interface Ours {
  id: string;
  status: string;
  scheduledAt: string | null;
  startedAt?: string | null;
  competitionName?: string | null;
  competitionSlug?: string | null;
  homeTeam: { name: string; shortName?: string | null };
  awayTeam: { name: string; shortName?: string | null };
  score: { home: number | null; away: number | null };
}

interface Src {
  fuente: string;
  competition: string;
  home: string;
  away: string;
  status: 'live' | 'finished' | 'scheduled' | string;
  homeScore: number | null;
  awayScore: number | null;
  scheduledAt: string | null;
}

interface Issue { tipo: string; partido: string; detalle: string; url?: string }

const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');

async function ours(): Promise<Ours[]> {
  const day = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = iso(new Date(day.getTime() - 86_400_000));
  const res = await fetch(`${API}/matches/current?from=${from}&to=${iso(day)}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return ((await res.json()) as { matches: Ours[] }).matches;
}

async function sidgad(): Promise<Src[]> {
  const { SOURCES } = await import('../core/sources.js');
  const { SidgadClient } = await import('../scrapers/fep/sidgad-client.js');
  const { FepMatchesScraper } = await import('../scrapers/fep/fep-matches.scraper.js');
  const out: Src[] = [];
  for (const key of SIDGAD_KEYS) {
    const source = SOURCES.find((s) => s.key === key);
    if (!source) continue;
    try {
      const html = await new SidgadClient(source.client).post('rfep_mc_1.php', {});
      const items = new FepMatchesScraper({ seasonId: 'monitor', source }).parseMatches(html);
      for (const m of items) {
        out.push({
          fuente: key,
          competition: m.competitionName ?? '',
          home: m.homeTeamAbbr ?? m.homeTeamRef,
          away: m.awayTeamAbbr ?? m.awayTeamRef,
          status: m.status ?? 'scheduled',
          homeScore: m.homeScore ?? null,
          awayScore: m.awayScore ?? null,
          scheduledAt: m.scheduledAt ? new Date(m.scheduledAt).toISOString() : null,
        });
      }
    } catch (err) {
      out.push({ fuente: key, competition: '__error__', home: String(err).slice(0, 120), away: '', status: 'error', homeScore: null, awayScore: null, scheduledAt: null });
    }
  }
  return out;
}

async function fpp(): Promise<Src[]> {
  const { parseFppDireto } = await import('../scrapers/fpp/fpp-live.parser.js');
  const res = await fetch('https://hp.fpp.pt/Direto', { headers: { 'User-Agent': 'Mozilla/5.0 (StickLive monitor)' } });
  const items = parseFppDireto(await res.text());
  // Móvil y escritorio duplican cada partido: uno por pareja (el que trae marcador).
  const by = new Map<string, Src>();
  for (const i of items) {
    const k = `${norm(i.homeName)}|${norm(i.awayName)}`;
    const prev = by.get(k);
    if (prev && prev.homeScore != null) continue;
    by.set(k, {
      fuente: 'fpp', competition: i.competition ?? '', home: i.homeName, away: i.awayName,
      status: i.state === 'halftime' ? 'live' : i.state, homeScore: i.homeScore, awayScore: i.awayScore, scheduledAt: null,
    });
  }
  return [...by.values()];
}

/** Casa un item de la fuente con nuestro partido. */
function find(s: Src, list: Ours[]): Ours | null {
  if (s.fuente === 'fpp') {
    const h = norm(s.home); const a = norm(s.away);
    return list.find((m) => norm(m.homeTeam.name) === h && norm(m.awayTeam.name) === a)
      ?? list.find((m) => /portugal/.test(m.competitionSlug ?? '') && norm(m.homeTeam.name).startsWith(h.slice(0, 8)) && norm(m.awayTeam.name).startsWith(a.slice(0, 8)))
      ?? null;
  }
  if (!s.scheduledAt) return null;
  const same = list.filter((m) => m.scheduledAt && new Date(m.scheduledAt).getTime() === new Date(s.scheduledAt!).getTime()
    && norm(m.competitionName) === norm(s.competition));
  if (same.length === 1) return same[0]!;
  const abbr = (x: string | null | undefined) => norm(x).slice(0, 3);
  return same.find((m) => abbr(m.homeTeam.shortName ?? m.homeTeam.name) === abbr(s.home)) ?? null;
}

const label = (m: Ours) => `${m.homeTeam.name} – ${m.awayTeam.name} (${m.competitionName ?? '?'})`;
const sc = (h: number | null, a: number | null) => `${h ?? '–'}-${a ?? '–'}`;

export function compare(src: Src[], list: Ours[], now = new Date()): Issue[] {
  const issues: Issue[] = [];
  const url = (m: Ours) => `https://sticklive.eu/es/matches/${m.id}`;
  for (const s of src) {
    if (s.status === 'error') { issues.push({ tipo: 'fuente_caida', partido: s.fuente, detalle: s.home }); continue; }
    if (s.status === 'scheduled') continue;
    const m = find(s, list);
    if (!m) {
      if (s.status === 'live') issues.push({ tipo: 'sin_casar', partido: `${s.home} – ${s.away} (${s.competition}, ${s.fuente})`, detalle: `fuente en juego ${sc(s.homeScore, s.awayScore)}, no lo encontramos` });
      continue;
    }
    const startedMin = m.scheduledAt ? (now.getTime() - new Date(m.scheduledAt).getTime()) / 60_000 : 0;
    if (s.status === 'live' && m.status === 'scheduled') {
      issues.push({ tipo: 'no_entra_directo', partido: label(m), detalle: `fuente en juego ${sc(s.homeScore, s.awayScore)} (${s.fuente})`, url: url(m) });
    } else if (s.status === 'finished' && m.status !== 'finished' && startedMin > GRACE_MIN) {
      issues.push({ tipo: 'no_se_cierra', partido: label(m), detalle: `fuente terminado ${sc(s.homeScore, s.awayScore)}, nosotros ${m.status} ${sc(m.score.home, m.score.away)}`, url: url(m) });
    }
    if ((s.status === 'live' || s.status === 'finished') && m.status !== 'scheduled' && s.homeScore != null
      && (s.homeScore !== m.score.home || s.awayScore !== m.score.away)) {
      issues.push({ tipo: 'marcador_distinto', partido: label(m), detalle: `fuente ${sc(s.homeScore, s.awayScore)} · nosotros ${sc(m.score.home, m.score.away)} (${s.fuente})`, url: url(m) });
    }
  }
  for (const m of list) {
    if (m.status === 'live') {
      const since = m.startedAt ?? m.scheduledAt;
      const h = since ? (now.getTime() - new Date(since).getTime()) / 3_600_000 : 0;
      if (h > LIVE_MAX_H) issues.push({ tipo: 'directo_colgado', partido: label(m), detalle: `en juego desde hace ${h.toFixed(1)} h`, url: url(m) });
    }
    if ((m.score.home ?? 0) > 20 || (m.score.away ?? 0) > 20) {
      issues.push({ tipo: 'marcador_imposible', partido: label(m), detalle: sc(m.score.home, m.score.away), url: url(m) });
    }
  }
  return issues;
}

async function main() {
  const now = new Date();
  const [list, a, b] = await Promise.all([ours(), sidgad(), fpp().catch((e) => [{ fuente: 'fpp', competition: '__error__', home: String(e), away: '', status: 'error', homeScore: null, awayScore: null, scheduledAt: null } as Src])]);
  const src = [...a, ...b];
  const issues = compare(src, list, now);
  const hora = now.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const enJuegoFuente = src.filter((s) => s.status === 'live').length;
  const enJuegoNuestros = list.filter((m) => m.status === 'live').length;
  console.log(`### ${hora}`);
  console.log(`En juego: fuentes ${enJuegoFuente} · Stick Live ${enJuegoNuestros}. Incidencias: ${issues.length}.`);
  for (const i of issues) console.log(`- **${i.tipo}** · ${i.partido} · ${i.detalle}${i.url ? ` · ${i.url}` : ''}`);
  if (process.argv.includes('--json')) console.log('\n```json\n' + JSON.stringify(issues) + '\n```');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('Monitor falló:', err); process.exit(1); });
}

/**
 * Widget de equipo para webs de clubes (04/11/2026).
 *
 * HTML autocontenido que la ruta `/{locale}/embed/team/{id}` sirve dentro de un
 * iframe: próximo partido, últimos resultados y clasificación. Sin JS, sin
 * cookies y sin analítica (va en webs ajenas, sin consentimiento): se mide al
 * llegar a Stick Live por `utm_source=widget`. Función pura para testearla.
 */

export interface WidgetTeamRef { id: string; name: string; shortName?: string | null }

export interface WidgetMatch {
  id: string;
  status: string;
  scheduledAt: string | null;
  homeTeam: WidgetTeamRef;
  awayTeam: WidgetTeamRef;
  score: { home: number | null; away: number | null };
}

export interface WidgetStanding {
  teamId: string;
  teamName: string;
  position: number | null;
  played: number;
  points: number;
}

export interface TeamWidgetInput {
  locale: string;
  siteUrl: string;
  theme: 'light' | 'dark';
  timezone: string;
  now: Date;
  team: { id: string; name: string };
  competitionName: string | null;
  matches: WidgetMatch[];
  standings: WidgetStanding[] | null;
}

const COPY: Record<string, { next: string; last: string; table: string; cta: string; pts: string; pj: string; empty: string }> = {
  es: { next: 'Próximo partido', last: 'Últimos resultados', table: 'Clasificación', cta: 'Resultados en directo en Stick Live', pts: 'Pts', pj: 'PJ', empty: 'Sin partidos programados' },
  ca: { next: 'Proper partit', last: 'Últims resultats', table: 'Classificació', cta: 'Resultats en directe a Stick Live', pts: 'Pts', pj: 'PJ', empty: 'Sense partits programats' },
  en: { next: 'Next match', last: 'Latest results', table: 'Standings', cta: 'Live scores on Stick Live', pts: 'Pts', pj: 'P', empty: 'No upcoming matches' },
  fr: { next: 'Prochain match', last: 'Derniers résultats', table: 'Classement', cta: 'Résultats en direct sur Stick Live', pts: 'Pts', pj: 'J', empty: 'Aucun match prévu' },
  it: { next: 'Prossima partita', last: 'Ultimi risultati', table: 'Classifica', cta: 'Risultati in diretta su Stick Live', pts: 'Pt', pj: 'G', empty: 'Nessuna partita in programma' },
  pt: { next: 'Próximo jogo', last: 'Últimos resultados', table: 'Classificação', cta: 'Resultados em direto no Stick Live', pts: 'Pts', pj: 'J', empty: 'Sem jogos agendados' },
};

const LAST_RESULTS = 3;
const TABLE_MAX_ROWS = 16;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function time(iso: string | null): number {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : 0;
}

export function renderTeamWidget(input: TeamWidgetInput): string {
  const c = COPY[input.locale] ?? COPY['es']!;
  const e = escapeHtml;
  const utm = `utm_source=widget&utm_medium=embed&utm_campaign=${encodeURIComponent(input.team.id)}`;
  const link = (path: string) => e(`${input.siteUrl}/${input.locale}${path}?${utm}`);
  const fmt = new Intl.DateTimeFormat(input.locale, {
    timeZone: input.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const name = (t: WidgetTeamRef) => e(t.name);

  const upcoming = input.matches
    .filter((m) => m.status === 'scheduled' || m.status === 'live')
    .sort((a, b) => time(a.scheduledAt) - time(b.scheduledAt))
    .find((m) => m.status === 'live' || time(m.scheduledAt) >= input.now.getTime() - 3 * 3600_000);
  const finished = input.matches
    .filter((m) => m.status === 'finished')
    .sort((a, b) => time(b.scheduledAt) - time(a.scheduledAt))
    .slice(0, LAST_RESULTS);

  const nextBlock = upcoming
    ? `<a class="row next" href="${link(`/matches/${upcoming.id}`)}" target="_blank" rel="noopener">
        <span class="teams">${name(upcoming.homeTeam)} – ${name(upcoming.awayTeam)}</span>
        <span class="when">${upcoming.status === 'live' ? '● LIVE' : e(upcoming.scheduledAt ? fmt.format(new Date(upcoming.scheduledAt)) : '')}</span>
      </a>`
    : `<p class="muted">${e(c.empty)}</p>`;

  const lastBlock = finished.map((m) => `<a class="row" href="${link(`/matches/${m.id}`)}" target="_blank" rel="noopener">
        <span class="teams">${name(m.homeTeam)} – ${name(m.awayTeam)}</span>
        <span class="score">${m.score.home ?? '-'} - ${m.score.away ?? '-'}</span>
      </a>`).join('');

  const rows = (input.standings ?? []).slice(0, TABLE_MAX_ROWS);
  const tableBlock = rows.length
    ? `<table><thead><tr><th>#</th><th></th><th>${e(c.pj)}</th><th>${e(c.pts)}</th></tr></thead><tbody>${rows.map((r) =>
      `<tr${r.teamId === input.team.id ? ' class="me"' : ''}><td>${r.position ?? ''}</td><td class="t">${e(r.teamName)}</td><td>${r.played}</td><td><b>${r.points}</b></td></tr>`).join('')}</tbody></table>`
    : '';

  const dark = input.theme === 'dark';
  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${dark ? '#f8fafc' : '#0f172a'};background:${dark ? '#111a2e' : '#ffffff'};padding:12px}
    h1{font-size:15px;font-weight:700}
    .sub{font-size:11px;color:${dark ? '#94a3b8' : '#64748b'};margin-bottom:10px}
    h2{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${dark ? '#94a3b8' : '#64748b'};margin:12px 0 4px}
    a{color:inherit;text-decoration:none}
    .row{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid ${dark ? '#1e293b' : '#e2e8f0'}}
    .row:hover .teams{text-decoration:underline}
    .teams{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .score,.when{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}
    .next .when{color:${dark ? '#f87171' : '#9E1235'}}
    .muted{color:${dark ? '#94a3b8' : '#64748b'};padding:6px 0}
    table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
    th{font-size:11px;font-weight:600;text-align:right;color:${dark ? '#94a3b8' : '#64748b'};padding:3px 4px}
    td{text-align:right;padding:4px;border-bottom:1px solid ${dark ? '#1e293b' : '#e2e8f0'}}
    td:first-child,th:first-child{width:22px;text-align:left}
    td.t{text-align:left;max-width:0;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    tr.me td{font-weight:700;background:${dark ? 'rgba(248,113,113,.12)' : 'rgba(158,18,53,.07)'}}
    .cta{display:block;margin-top:12px;text-align:center;font-size:12px;font-weight:600;color:${dark ? '#f87171' : '#9E1235'}}`;

  return `<!doctype html><html lang="${e(input.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${e(input.team.name)} · Stick Live</title><style>${css}</style></head><body>
    <h1>${e(input.team.name)}</h1>
    ${input.competitionName ? `<p class="sub">${e(input.competitionName)}</p>` : ''}
    <h2>${e(c.next)}</h2>${nextBlock}
    ${lastBlock ? `<h2>${e(c.last)}</h2>${lastBlock}` : ''}
    ${tableBlock ? `<h2>${e(c.table)}</h2>${tableBlock}` : ''}
    <a class="cta" href="${link(`/teams/${input.team.id}`)}" target="_blank" rel="noopener">${e(c.cta)} →</a>
  </body></html>`;
}

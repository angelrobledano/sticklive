import { getSeasonOverview, getTeamDetail } from '@/lib/api/client';
import { renderTeamWidget, escapeHtml, type WidgetStanding } from '@/lib/embed/team-widget';
import { isSupportedLocale } from '@/lib/locales';
import { SITE_URL } from '@/lib/seo';
import { clubName } from '@/lib/names';

// Widget incrustable para webs de clubes (04/11/2026):
//   <iframe src="https://sticklive.eu/es/embed/team/{id}" ...>
// HTML autocontenido, sin JS ni analítica. Caddy permite incrustar solo
// `/*/embed/*` (resto del sitio: SAMEORIGIN). `?theme=dark` para webs oscuras.

export const runtime = 'nodejs';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  'X-Robots-Tag': 'noindex',
};

export async function GET(req: Request, props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await props.params;
  const locale = isSupportedLocale(raw) ? raw : 'es';
  const theme = new URL(req.url).searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  try {
    const team = await getTeamDetail(id);
    let standings: WidgetStanding[] | null = null;
    if (team.selectedSeasonId) {
      try {
        const overview = await getSeasonOverview(team.selectedSeasonId);
        // Ligas con grupos (Norte/Sur): solo el grupo del equipo.
        const group = overview.standings.find((r) => r.teamId === id)?.groupName ?? null;
        standings = overview.standings
          .filter((r) => group === null || r.groupName === group)
          .map((r) => ({ teamId: r.teamId, teamName: clubName(r.teamName), position: r.position, played: r.played, points: r.points }));
      } catch { /* sin tabla: el widget sigue con los partidos */ }
    }
    const html = renderTeamWidget({
      locale,
      siteUrl: SITE_URL,
      theme,
      timezone: team.matches.find((m) => m.competitionTimezone)?.competitionTimezone ?? 'Europe/Madrid',
      now: new Date(),
      team: { id: team.team.id, name: clubName(team.team.name) },
      competitionName: team.season?.competitionName ?? team.standing?.competitionName ?? null,
      matches: team.matches.map((m) => ({
        ...m,
        homeTeam: { ...m.homeTeam, name: clubName(m.homeTeam.name) },
        awayTeam: { ...m.awayTeam, name: clubName(m.awayTeam.name) },
      })),
      standings,
    });
    return new Response(html, { headers: HEADERS });
  } catch {
    const html = `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><p style="font:13px system-ui;padding:12px"><a href="${escapeHtml(`${SITE_URL}/${locale}`)}" target="_blank" rel="noopener">Stick Live</a></p>`;
    return new Response(html, { status: 200, headers: { ...HEADERS, 'Cache-Control': 'public, s-maxage=60' } });
  }
}

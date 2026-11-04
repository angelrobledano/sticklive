import { describe, it, expect } from 'vitest';
import { renderTeamWidget, type TeamWidgetInput } from './team-widget';

/** Widget para webs de clubes (04/11/2026): HTML autocontenido, sin JS. */
const team = (id: string, name: string) => ({ id, name, shortName: null, logoUrl: null });
const input = (o: Partial<TeamWidgetInput> = {}): TeamWidgetInput => ({
  locale: 'es',
  siteUrl: 'https://sticklive.eu',
  theme: 'light',
  timezone: 'Europe/Madrid',
  now: new Date('2026-11-04T12:00:00Z'),
  team: { id: 'reus', name: 'Reus Deportiu <Brasilia>' },
  competitionName: 'OK Liga Masculina',
  matches: [
    { id: 'm1', status: 'finished', scheduledAt: '2026-10-25T17:00:00Z', homeTeam: team('reus', 'Reus'), awayTeam: team('noia', 'Noia'), score: { home: 4, away: 2 } },
    { id: 'm2', status: 'finished', scheduledAt: '2026-10-31T17:00:00Z', homeTeam: team('reus', 'Reus'), awayTeam: team('cal', 'Calafell'), score: { home: 2, away: 2 } },
    { id: 'm3', status: 'scheduled', scheduledAt: '2026-11-07T18:00:00Z', homeTeam: team('riv', 'Rivas'), awayTeam: team('reus', 'Reus'), score: { home: null, away: null } },
  ],
  standings: [
    { teamId: 'liceo', teamName: 'Liceo', position: 1, played: 2, points: 6 },
    { teamId: 'reus', teamName: 'Reus Deportiu <Brasilia>', position: 7, played: 2, points: 4 },
  ],
  ...o,
});

describe('renderTeamWidget', () => {
  const html = renderTeamWidget(input());
  it('escapa el HTML de los nombres', () => {
    expect(html).toContain('Reus Deportiu &lt;Brasilia&gt;');
    expect(html).not.toContain('<Brasilia>');
  });
  it('sin scripts', () => {
    expect(html).not.toMatch(/<script/i);
  });
  it('próximo partido con hora local de la competición', () => {
    expect(html).toContain('Rivas');
    expect(html).toContain('19:00');
  });
  it('últimos resultados, el más reciente primero', () => {
    expect(html.indexOf('2 - 2')).toBeLessThan(html.indexOf('4 - 2'));
  });
  it('clasificación con la fila del equipo resaltada', () => {
    expect(html).toMatch(/class="me"[^>]*>[\s\S]*Reus Deportiu &lt;Brasilia&gt;/);
  });
  it('enlaces a Stick Live en pestaña nueva y con UTM del widget', () => {
    expect(html).toContain('href="https://sticklive.eu/es/matches/m3?utm_source=widget&amp;utm_medium=embed&amp;utm_campaign=reus"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
  });
  it('sin partidos ni tabla sigue siendo válido', () => {
    const empty = renderTeamWidget(input({ matches: [], standings: null }));
    expect(empty).toContain('Stick Live');
    expect(empty).toContain('<!doctype html>');
  });
});

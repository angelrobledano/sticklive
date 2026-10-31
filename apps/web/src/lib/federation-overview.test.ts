import { describe, it, expect } from 'vitest';
import type { CompetitionSummary, Match } from '@/lib/api/client';
import { buildFederationOverview, federationIntro } from './federation-overview';

const comp = (id: string, season: Partial<NonNullable<CompetitionSummary['season']>> = {}) => ({
  id, name: `Liga ${id}`, season: { id: `s${id}`, name: '2026/27', isCurrent: true, teamCount: 8, matchCount: 56, ...season },
}) as unknown as CompetitionSummary;

const match = (id: string, comp: string, status: string, at: string) =>
  ({ id, competitionId: comp, status, scheduledAt: at }) as unknown as Match;

const now = new Date('2026-10-31T10:00:00Z');

describe('buildFederationOverview', () => {
  it('solo partidos de sus competiciones: próximos por fecha y resultados del más reciente', () => {
    const o = buildFederationOverview([comp('a'), comp('b')], [
      match('1', 'a', 'finished', '2026-10-25T16:00:00Z'),
      match('2', 'b', 'finished', '2026-10-30T16:00:00Z'),
      match('3', 'a', 'scheduled', '2026-11-07T16:00:00Z'),
      match('4', 'b', 'scheduled', '2026-11-01T16:00:00Z'),
      match('5', 'x', 'scheduled', '2026-11-01T10:00:00Z'),
      match('6', 'a', 'live', '2026-10-31T09:30:00Z'),
    ], now);
    expect(o.results.map((m) => m.id)).toEqual(['2', '1']);
    expect(o.upcoming.map((m) => m.id)).toEqual(['4', '3']);
    expect(o.live.map((m) => m.id)).toEqual(['6']);
    expect(o.matches).toBe(112);
  });

  it('texto con datos reales de la temporada y campeones', () => {
    const o = buildFederationOverview([
      comp('a', { nextMatchAt: '2026-11-07T16:00:00Z' }),
      comp('b', { champion: { teamId: 't', name: 'CP Sevilla', shortName: null, logoUrl: null } }),
    ], [], now);
    expect(federationIntro(o, 'Federación Andaluza de Patinaje', 'es')).toBe(
      'La Federación Andaluza de Patinaje organiza 2 competiciones de hockey patines en la temporada 2026/27, con 112 partidos en el calendario. '
      + 'En Stick Live tienes sus resultados en directo, calendarios, clasificaciones y estadísticas de jugadores. '
      + 'Próximo partido: sábado, 7 de noviembre. Campeones de la temporada: CP Sevilla (Liga b).');
  });
});

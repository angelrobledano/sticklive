'use client';

import type { Match } from '@/lib/api/client';
import { MatchRow } from '@/components/home/MatchRow';
import { MatchGroupCard } from '@/components/home/MatchGroupCard';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';

/** En juego, próximos partidos y últimos resultados de una federación. */
export function FederationMatches({ live, upcoming, results }: { live: Match[]; upcoming: Match[]; results: Match[] }) {
  const { t } = useT();
  const blocks: [string, Match[]][] = [
    [tt(t, 'competitions.fed_live', 'En directo'), live],
    [tt(t, 'competitions.fed_upcoming', 'Próximos partidos'), upcoming],
    [tt(t, 'competitions.fed_results', 'Últimos resultados'), results],
  ];
  return (
    <div className="mb-4 space-y-3">
      {blocks.filter(([, ms]) => ms.length > 0).map(([title, ms]) => (
        <MatchGroupCard key={title} title={title} icon={null} count={ms.length} collapsible={false}>
          {ms.map((m) => <MatchRow key={m.id} match={m} showDate caption={m.competitionName ?? null} />)}
        </MatchGroupCard>
      ))}
    </div>
  );
}

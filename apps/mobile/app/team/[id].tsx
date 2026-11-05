import { useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTeam } from '@/src/hooks/queries';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { TeamDetailSkeleton } from '@/src/components/shared/Skeleton';
import { ShareHeaderButton } from '@/src/components/shared/ShareHeaderButton';
import { ShareImageModal } from '@/src/components/shared/ShareImageModal';
import { clubName } from '@sports/core/names';
import { TeamHeader } from '@/src/components/team/TeamHeader';
import { OtherClubTeams } from '@/src/components/team/OtherClubTeams';
import { TeamCenterClient } from '@/src/components/team/TeamCenterClient';

/**
 * Ficha de equipo móvil — Paridad completa con la web:
 * - Cabecera con escudo, sección, racha de últimos resultados, favorito, compartir
 * - Selector interactivo de temporada (OK Liga, Supercopa, Copa del Rey, históricos...)
 * - Otras secciones del club
 * - 4 pestañas: Resumen (clasificación/eliminatoria, próximo partido, último resultado),
 *   Calendario (agrupado por mes con resultado/horario), Plantilla (porteros, jugadores de campo, cuerpo técnico),
 *   Estadísticas (balance, disciplina, faltas directas y penaltis).
 */
export default function TeamScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; season?: string }>();
  const teamId = Array.isArray(params.id) ? params.id[0] : params.id;
  const initialSeason = Array.isArray(params.season) ? params.season[0] : params.season;

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | undefined>(initialSeason);
  const [shareImageModalOpen, setShareImageModalOpen] = useState(false);

  const query = useTeam(teamId ?? '', selectedSeasonId);

  const rawTeam = query.data?.team;
  const displayName = rawTeam ? clubName(rawTeam.name) || rawTeam.shortName || rawTeam.name : '';

  const handleShare = () => {
    if (!rawTeam) return;
    setShareImageModalOpen(true);
  };

  const headerElement = (
    <Stack.Screen
      options={{
        title: displayName,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: displayName.length > 24 ? 15 : 17,
        },
        headerRight: () =>
          displayName ? (
            <ShareHeaderButton
              onPress={handleShare}
              accessibilityLabel="Compartir equipo"
            />
          ) : null,
      }}
    />
  );

  if (!query.data) {
    return (
      <>
        {headerElement}
        {query.isError ? (
          <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
            <ErrorState onRetry={() => void query.refetch()} />
          </View>
        ) : (
          <TeamDetailSkeleton />
        )}
      </>
    );
  }

  return (
    <>
      {headerElement}
      <ScrollView
        className="flex-1 bg-rink-floor dark:bg-rink-floor-dark"
        contentContainerStyle={{ paddingBottom: Math.max(32, insets.bottom + 24) }}
      >
        <TeamHeader
          data={query.data}
          selectedSeasonId={selectedSeasonId}
          onSelectSeason={(sid) => setSelectedSeasonId(sid)}
        />

        <OtherClubTeams clubTeams={query.data.clubTeams} />

        <TeamCenterClient data={query.data} />
      </ScrollView>

      {rawTeam ? (
        <ShareImageModal
          visible={shareImageModalOpen}
          onClose={() => setShareImageModalOpen(false)}
          imagePath={`/teams/${rawTeam.id}/share-image`}
          name={displayName}
          kind="team"
        />
      ) : null}
    </>
  );
}

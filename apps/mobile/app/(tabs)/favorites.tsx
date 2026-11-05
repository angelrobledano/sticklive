import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useCompetitions, useFollowingMatches } from '@/src/hooks/queries';
import { useFavoriteName, useFavorites, useLocalFavorites, type FavoriteKind } from '@/src/hooks/favorites';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { BrandLoader } from '@/src/components/shared/BrandLoader';
import { Avatar, playerPhotoUri, teamLogoUri } from '@/src/components/shared/Avatar';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { MiGrada } from '@/src/components/home/MiGrada';
import { authErrorKey } from '@/src/lib/auth-errors';
import { clubName } from '@sports/core/names';

/**
 * Tab de favoritos (Task 3.3). Con sesión la fuente es `GET /auth/favorites`;
 * anónimo, el estado local (AsyncStorage) con CTA de login encima: el merge
 * anónimo→cuenta lo hace el propio login (mergeLocalOnLogin en AuthContext),
 * así que entrar desde esta pantalla ya sincroniza.
 *
 * Limitación v1 del plan: el nombre se resuelve desde la caché de queries ya
 * visitadas (ver src/lib/favorite-names.ts); si no está, placeholder genérico.
 * NO hay endpoint de bulk (se evaluará en M5 si la UX lo pide). Ligas → tab de
 * clasificación a secas: no se puede preseleccionar la competición (estado
 * local del tab), igual que hace search.
 */

/** CTA de login anónimo: mismo flujo que settings.tsx (errores visibles igual). */
function LoginCard() {
  const { t } = useLocale();
  const router = useRouter();
  const { lastAuthError, signInWithGoogle } = useSession();
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = () => {
    setSigningIn(true);
    // signInWithGoogle captura sus fallos en lastAuthError (no lanza); el
    // finally garantiza reactivar el botón pase lo que pase.
    void signInWithGoogle().finally(() => setSigningIn(false));
  };

  return (
    <View className="mx-4 mt-4 rounded-xl bg-white p-4 dark:bg-slate-900">
      <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
        {t('auth.login_title')}
      </Text>
      <Text className="mt-0.5 text-sm text-slate-500">{t('auth.login_subtitle')}</Text>
      <View className="mt-3 flex-row flex-wrap gap-2">
        <Pressable
          onPress={handleSignIn}
          disabled={signingIn}
          className="rounded-lg bg-rink-passion px-4 py-2 active:opacity-80 disabled:opacity-50"
        >
          <Text className="font-semibold text-white">
            {signingIn ? t('auth.opening_account') : t('auth.google')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/login')}
          className="rounded-lg border border-slate-300 px-4 py-2 active:opacity-80 dark:border-slate-700"
        >
          <Text className="font-semibold text-slate-700 dark:text-slate-300">
            {t('auth.upsell_email')}
          </Text>
        </Pressable>
      </View>
      {lastAuthError ? (
        <Text className="mt-2 text-sm text-red-600 dark:text-red-400" accessibilityLiveRegion="polite">
          {t(authErrorKey(lastAuthError))}
        </Text>
      ) : null}
    </View>
  );
}

/** Fila de favorito: tocar la fila abre la ficha; la estrella da de baja. */
function FavoriteRow({
  kind,
  refId,
  onPress,
}: {
  kind: FavoriteKind;
  refId: string;
  onPress: () => void;
}) {
  const { name, isResolved } = useFavoriteName(kind, refId);

  return (
    <View className="flex-row items-center border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <Pressable onPress={onPress} className="min-h-[44px] flex-1 flex-row items-center px-4 py-2 active:opacity-70">
        {kind === 'team' ? <Avatar uri={teamLogoUri(refId, 64)} name={name} size={28} /> : null}
        {kind === 'player' ? <Avatar uri={playerPhotoUri(refId, 64)} name={name} size={28} variant="player" /> : null}
        {kind === 'league' ? <Avatar uri={null} name={name} size={28} variant="competition" /> : null}
        <Text
          numberOfLines={1}
          className={`ml-3 flex-1 text-base font-medium ${
            isResolved ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          {kind === 'player' ? name : clubName(name) || name}
        </Text>
      </Pressable>
      <FollowButton kind={kind} refId={refId} name={isResolved ? name : undefined} />
    </View>
  );
}

export default function FavoritesScreen() {
  const { t } = useLocale();
  const { session, ready } = useSession();
  const token = session?.token;
  const router = useRouter();
  // Precarga de competiciones para resolver nombres de ligas favoritas de inmediato
  useCompetitions();
  // Ambos hooks montados siempre (regla de hooks): el `enabled` de cada uno
  // hace el gating (servidor sólo con token; AsyncStorage sólo anónimo).
  const server = useFavorites(token);
  const local = useLocalFavorites(!token);
  // Mi grada: solo lo seguido (scope=following), no todo el catálogo.
  const followed = token ? server.data : local.data;
  const followTeams = useMemo(() => followed?.teams ?? [], [followed?.teams]);
  const followLeagues = useMemo(() => followed?.leagues ?? [], [followed?.leagues]);
  const currentMatchesQuery = useFollowingMatches({ teams: followTeams, leagues: followLeagues });

  if (!ready) {
    // Evita el flash del CTA de login mientras se resuelve la sesión guardada.
    return (
      <View className="flex-1 items-center justify-center bg-rink-floor dark:bg-rink-floor-dark">
        <BrandLoader />
      </View>
    );
  }

  const favs = token ? server.data : local.data;
  const isPending = token ? server.isPending : local.isPending;
  const isError = token ? server.isError : local.isError;
  const retry = token ? () => void server.refetch() : () => void local.refetch();

  const openFavorite = (kind: FavoriteKind, id: string) => {
    if (kind === 'team') router.push(`/team/${id}`);
    else if (kind === 'player') router.push(`/player/${id}`);
    else router.push(`/competition/${id}`);
  };

  const sections: { kind: FavoriteKind; title: string; ids: string[] }[] = [
    { kind: 'team', title: t('favorites.teams'), ids: favs?.teams ?? [] },
    { kind: 'league', title: t('favorites.leagues'), ids: favs?.leagues ?? [] },
    { kind: 'player', title: t('search.section_players'), ids: favs?.players ?? [] },
  ];
  const total = sections.reduce((n, s) => n + s.ids.length, 0);

  return (
    <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {!token ? <LoginCard /> : null}

        {isPending && !favs ? (
          <View className="flex-1" />
        ) : isError && !favs ? (
          <ErrorState onRetry={retry} />
        ) : total === 0 ? (
          <EmptyState title={t('favorites.onboarding_title')} hint={t('favorites.onboarding_body')} />
        ) : (
          <>
            {favs && (favs.teams.length > 0 || favs.leagues.length > 0) && currentMatchesQuery.data ? (
              <View className="px-4 mt-4">
                <MiGrada
                  matches={currentMatchesQuery.data}
                  teamIds={favs.teams}
                  leagueIds={favs.leagues}
                />
              </View>
            ) : null}

            {sections
              .filter((s) => s.ids.length > 0)
              .map((s) => (
                <View key={s.kind}>
                  <Text className="px-4 pb-1 pt-4 text-xs font-bold uppercase text-slate-500">{s.title}</Text>
                  {s.ids.map((id) => (
                    <FavoriteRow
                      key={id}
                      kind={s.kind}
                      refId={id}
                      onPress={() => openFavorite(s.kind, id)}
                    />
                  ))}
                </View>
              ))}
          </>
        )}

        {/* Pie del contenido: banner (el gating premium/consentimiento vive en AdBanner). */}
        <AdBanner variant="list" />
      </ScrollView>
    </View>
  );
}

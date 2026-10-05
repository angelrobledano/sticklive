import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useFavorites, useLocalFavorites, type FavoriteKind } from '@/src/hooks/favorites';
import { qk } from '@/src/hooks/queries';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { Avatar, playerPhotoUri, teamLogoUri } from '@/src/components/shared/Avatar';
import { authErrorKey } from '@/src/lib/auth-errors';
import type {
  CompetitionsResponse,
  PlayerDetail,
  SearchResults,
  StandingsResponse,
  TeamDetail,
} from '@/src/lib/api/types';

/**
 * Tab de favoritos (Task 3.3). Con sesión la fuente es `GET /auth/favorites`;
 * anónimo, el estado local (AsyncStorage) con CTA de login encima: el merge
 * anónimo→cuenta lo hace el propio login (mergeLocalOnLogin en AuthContext),
 * así que entrar desde esta pantalla ya sincroniza.
 *
 * Limitación v1 del plan: el nombre se resuelve desde la caché de queries ya
 * visitadas (fichas team/player, standings, competitions, search); si no está,
 * placeholder genérico. NO hay endpoint de bulk (se evaluará en M5 si la UX lo
 * pide). Ligas → tab de clasificación a secas: no se puede preseleccionar la
 * competición (estado local del tab), igual que hace search.
 */

/** Placeholders en duro en español por ahora: el plan los migra a t() en M5
 * (mismo caso que EmptyState; no hay claves singulares en los locales). */
const PLACEHOLDER: Record<FavoriteKind, string> = { team: 'Equipo', league: 'Liga', player: 'Jugador' };

/** Nombre desde caché de queries ya visitadas (sin inventar endpoints). */
function resolveFavoriteName(qc: QueryClient, kind: FavoriteKind, id: string): string | null {
  if (kind === 'team') {
    const detail = qc.getQueryData<TeamDetail>(qk.team(id));
    if (detail) return detail.team.name;
    for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
      const hit = (q.state.data as SearchResults | undefined)?.teams.find((x) => x.id === id);
      if (hit) return hit.name;
    }
    for (const q of qc.getQueryCache().findAll({ queryKey: ['standings'] })) {
      const row = (q.state.data as StandingsResponse | undefined)?.standings.find((r) => r.team_id === id);
      if (row) return row.team_short_name ?? row.team_name;
    }
    return null;
  }
  if (kind === 'player') {
    const detail = qc.getQueryData<PlayerDetail>(qk.player(id));
    if (detail) return `${detail.player.firstName} ${detail.player.lastName}`;
    for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
      const hit = (q.state.data as SearchResults | undefined)?.players.find((x) => x.id === id);
      if (hit) return `${hit.firstName} ${hit.lastName}`;
    }
    return null;
  }
  // kind 'league': el refId es id de COMPETICIÓN (nomenclatura del API).
  const comps = qc.getQueryData<CompetitionsResponse>(qk.competitions);
  const comp = comps?.competitions.find((c) => c.id === id);
  if (comp) return comp.name;
  for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
    const hit = (q.state.data as SearchResults | undefined)?.competitions.find((x) => x.id === id);
    if (hit) return hit.name;
  }
  return null;
}

/** CTA de login anónimo: mismo flujo que settings.tsx (errores visibles igual). */
function LoginCard() {
  const { t } = useLocale();
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
      <Pressable
        onPress={handleSignIn}
        disabled={signingIn}
        className="mt-3 self-start rounded-lg bg-rink-passion px-4 py-2 active:opacity-80 disabled:opacity-50"
      >
        <Text className="font-semibold text-white">
          {signingIn ? t('auth.opening_account') : t('auth.google')}
        </Text>
      </Pressable>
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
  name,
  onPress,
}: {
  kind: FavoriteKind;
  refId: string;
  name: string;
  onPress: () => void;
}) {
  return (
    <View className="flex-row items-center border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <Pressable onPress={onPress} className="min-h-[44px] flex-1 flex-row items-center px-4 py-2 active:opacity-70">
        {kind === 'team' ? <Avatar uri={teamLogoUri(refId)} name={name} size={28} /> : null}
        {kind === 'player' ? <Avatar uri={playerPhotoUri(refId)} name={name} size={28} /> : null}
        <Text
          numberOfLines={1}
          className={`${kind === 'league' ? '' : 'ml-3 '}flex-1 text-base font-medium`}
        >
          {name}
        </Text>
      </Pressable>
      <FollowButton kind={kind} refId={refId} />
    </View>
  );
}

export default function FavoritesScreen() {
  const { t } = useLocale();
  const { session, ready } = useSession();
  const token = session?.token;
  const router = useRouter();
  const qc = useQueryClient();

  // Ambos hooks montados siempre (regla de hooks): el `enabled` de cada uno
  // hace el gating (servidor sólo con token; AsyncStorage sólo anónimo).
  const server = useFavorites(token);
  const local = useLocalFavorites(!token);

  if (!ready) {
    // Evita el flash del CTA de login mientras se resuelve la sesión guardada.
    return <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark" />;
  }

  const favs = token ? server.data : local.data;
  const isPending = token ? server.isPending : local.isPending;
  const isError = token ? server.isError : local.isError;
  const retry = token ? () => void server.refetch() : () => void local.refetch();

  const openFavorite = (kind: FavoriteKind, id: string) => {
    if (kind === 'team') router.push(`/team/${id}`);
    else if (kind === 'player') router.push(`/player/${id}`);
    else router.push('/standings');
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
          sections
            .filter((s) => s.ids.length > 0)
            .map((s) => (
              <View key={s.kind}>
                <Text className="px-4 pb-1 pt-4 text-xs font-bold uppercase text-slate-500">{s.title}</Text>
                {s.ids.map((id) => (
                  <FavoriteRow
                    key={id}
                    kind={s.kind}
                    refId={id}
                    name={resolveFavoriteName(qc, s.kind, id) ?? PLACEHOLDER[s.kind]}
                    onPress={() => openFavorite(s.kind, id)}
                  />
                ))}
              </View>
            ))
        )}
      </ScrollView>
    </View>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { BRAND } from '@sports/brand';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import {
  PLURAL,
  useAddFavorite,
  useFavorites,
  useLocalFavorites,
  useRemoveFavorite,
  type FavoriteKind,
} from '@/src/hooks/favorites';

/** Mismos hex que el resto de la app (tab activo en (tabs)/_layout.tsx). */
const RINK_PASSION = BRAND.granate;
const SLATE_500 = '#64748b';

/**
 * Estrella seguir/dejar de seguir (Task 3.3). Con sesión la fuente es el
 * servidor (`useFavorites`, gating por token) y las mutaciones van al API;
 * anónimo la fuente es el estado local (AsyncStorage vía `useLocalFavorites`)
 * y las mutaciones persisten allí. El merge anónimo→cuenta lo hace
 * `mergeLocalOnLogin` en el login (AuthContext).
 */
export function FollowButton({ kind, refId }: { kind: FavoriteKind; refId: string }) {
  const { session } = useSession();
  const token = session?.token;
  const { t } = useLocale();
  const add = useAddFavorite(token);
  const remove = useRemoveFavorite(token);

  // FavoritesResponse y LocalFavorites comparten shape {teams, leagues, players}.
  // Ambos hooks se montan SIEMPRE (regla de hooks); el `enabled` de cada uno
  // hace el gating: sólo consulta el servidor con token, sólo AsyncStorage anónimo.
  const server = useFavorites(token);
  const local = useLocalFavorites(!token);
  const favs = token ? server.data : local.data;
  const isFav = favs ? favs[PLURAL[kind]].includes(refId) : false;

  // Deshabilitada mientras vuela la mutación: sin dobles toques ni toggles
  // races; el estado visual lo confirma la invalidación de la query.
  const pending = add.isPending || remove.isPending;

  const toggle = () => {
    // Fallo explícito, no silencioso (regla del repo): consola del dispositivo
    // (Sentry la capturará en 5.1); el estado visual no cambia porque sólo se
    // actualiza con la invalidación tras éxito.
    void (isFav ? remove : add)
      .mutateAsync({ kind, refId })
      .catch((err: unknown) => console.error('[favorites] no se pudo actualizar el favorito', err));
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isFav ? t('a11y.remove_favorite') : t('a11y.add_favorite')}
      accessibilityState={{ disabled: pending }}
      disabled={pending}
      onPress={toggle}
      // Touch target ≥44 (patrón de search.tsx).
      className="min-h-[44px] min-w-[44px] items-center justify-center rounded-full active:opacity-70"
    >
      <Ionicons name={isFav ? 'star' : 'star-outline'} size={24} color={isFav ? RINK_PASSION : SLATE_500} />
    </Pressable>
  );
}

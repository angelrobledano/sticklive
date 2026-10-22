import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useColorScheme } from 'nativewind';
import { BRAND } from '@sports/brand';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import { saveFavoriteName } from '@/src/lib/favorite-names';
import {
  PLURAL,
  useAddFavorite,
  useFavorites,
  useLocalFavorites,
  useRemoveFavorite,
  type FavoriteKind,
} from '@/src/hooks/favorites';

/**
 * Estrella seguir/dejar de seguir (Task 3.3). Con sesión la fuente es el
 * servidor (`useFavorites`, gating por token) y las mutaciones van al API;
 * anónimo la fuente es el estado local (AsyncStorage vía `useLocalFavorites`)
 * y las mutaciones persisten allí. El merge anónimo→cuenta lo hace
 * `mergeLocalOnLogin` en el login (AuthContext).
 *
 * En modo oscuro se usa `rink-accent` (#f87171) para superar el ratio de contraste
 * 3:1 WCAG AA sobre el fondo azul-noche (#0B1220), cumpliendo DESIGN.md.
 */
export function FollowButton({
  kind,
  refId,
  name,
}: {
  kind: FavoriteKind;
  refId: string;
  name?: string;
}) {
  const { session } = useSession();
  const token = session?.token;
  const { t } = useLocale();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

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
    // Si conocemos el nombre, lo persistimos localmente para evitar placeholders en frío
    if (name) saveFavoriteName(refId, name);

    void (isFav ? remove : add)
      .mutateAsync({ kind, refId })
      .catch((err: unknown) => console.error('[favorites] no se pudo actualizar el favorito', err));
  };

  // En modo oscuro: rink-accent (#f87171) supera 3:1 de contraste frente a #0B1220
  const activeColor = isDark ? '#f87171' : BRAND.granate;
  const inactiveColor = isDark ? '#94a3b8' : '#64748b';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isFav ? t('a11y.remove_favorite') : t('a11y.add_favorite')}
      accessibilityState={{ disabled: pending, selected: isFav }}
      disabled={pending}
      onPress={toggle}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      className="min-h-[48px] min-w-[48px] items-center justify-center rounded-full active:opacity-70"
    >
      <Ionicons
        name={isFav ? 'star' : 'star-outline'}
        size={24}
        color={isFav ? activeColor : inactiveColor}
      />
    </Pressable>
  );
}

import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { API_URL } from '@/src/lib/api/client';

/**
 * Escudo del equipo servido por el API (proxy que normaliza y sirve con
 * Referer; el CDN original bloquea el hotlink — apps/api/src/routes/
 * team-logo.ts). El `logo_url` crudo del listado NO se usa para pintar.
 */
export const teamLogoUri = (teamId: string, width = 64) =>
  `${API_URL}/teams/${teamId}/logo?w=${width}`;

/** Foto del jugador vía proxy del API (apps/api/src/routes/player-photo.ts). */
export const playerPhotoUri = (playerId: string, width = 64) =>
  `${API_URL}/players/${playerId}/photo?w=${width}`;

export const initials = (name?: string | null): string => {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
};

/**
 * Imagen remota de escudo/foto con dimensiones FIJAS y fallback a iniciales si
 * el API responde 404 (equipo/jugador sin imagen) o falla la carga.
 */
export function Avatar({
  uri,
  name,
  size = 28,
}: {
  uri: string | null | undefined;
  name?: string | null;
  size?: number;
}) {
  // Estado derivado, no boolean: al cambiar la uri el componente reintenta solo
  // (listas recicladas de FlatList incluidas) sin useEffect + setState, que el
  // lint prohíbe (react-hooks/set-state-in-effect).
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const broken = uri == null || failedUri === uri;

  if (broken) {
    return (
      <View
        style={{ width: size, height: size, borderRadius: size / 5 }}
        className="items-center justify-center bg-slate-200 dark:bg-slate-700"
      >
        <Text style={{ fontSize: Math.max(10, size * 0.3) }} className="font-bold text-slate-600 dark:text-slate-200">
          {initials(name)}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size / 5 }}
      resizeMode="contain"
      onError={() => setFailedUri(uri)}
    />
  );
}

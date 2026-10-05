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

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

/**
 * Imagen remota de escudo/foto con dimensiones FIJAS y fallback a iniciales si
 * el API responde 404 (equipo/jugador sin imagen) o falla la carga.
 */
export function Avatar({ uri, name, size = 28 }: { uri: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
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
      onError={() => setFailed(true)}
    />
  );
}

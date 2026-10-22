import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '@/src/lib/api/client';

/**
 * Escudo del equipo servido por el API (proxy que normaliza y sirve con
 * Referer; el CDN original bloquea el hotlink — apps/api/src/routes/
 * team-logo.ts).
 *
 * Forzamos `&format=png` para máxima compatibilidad con el motor de renderizado
 * nativo de Android e iOS (evita fallos de decodificación WebP en Fresco).
 */
export const teamLogoUri = (teamId: string, width = 64) =>
  `${API_URL}/teams/${teamId}/logo?w=${width}&format=png`;

/** Foto del jugador vía proxy del API (apps/api/src/routes/player-photo.ts). */
export const playerPhotoUri = (playerId: string, width = 64) =>
  `${API_URL}/players/${playerId}/photo?w=${width}&format=png`;

export const initials = (name?: string | null): string => {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
};

export type AvatarVariant = 'team' | 'player' | 'competition';

export interface AvatarProps {
  uri?: string | null;
  fallbackUri?: string | null;
  name?: string | null;
  size?: number;
  variant?: AvatarVariant;
}

/**
 * Imagen remota de escudo, foto de jugador o logo de competición con fallback
 * automático a múltiples niveles (URL proxy API -> fallbackUri -> placeholder estilizado).
 */
export function Avatar({
  uri,
  fallbackUri,
  name,
  size = 28,
  variant = 'team',
}: AvatarProps) {
  // Manejo de fallos derivados sin useEffect (compatible con reciclado de FlatList)
  const [failedUriSet, setFailedUriSet] = useState<Record<string, true>>({});

  let activeUri: string | null = null;
  if (uri && !failedUriSet[uri]) {
    activeUri = uri;
  } else if (fallbackUri && !failedUriSet[fallbackUri]) {
    activeUri = fallbackUri;
  }

  const handleError = () => {
    if (activeUri) {
      setFailedUriSet((prev) => ({ ...prev, [activeUri!]: true }));
    }
  };

  if (!activeUri) {
    if (variant === 'player') {
      return (
        <View
          style={{ width: size, height: size, borderRadius: size / 2 }}
          className="items-center justify-center bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden"
        >
          <Ionicons
            name="person"
            size={Math.max(12, Math.round(size * 0.55))}
            color="#94a3b8"
          />
        </View>
      );
    }

    if (variant === 'competition') {
      return (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: Math.max(4, Math.round(size / 4)),
          }}
          className="items-center justify-center bg-rose-50 dark:bg-slate-800 border border-rose-100 dark:border-slate-700"
        >
          <Ionicons
            name="trophy"
            size={Math.max(10, Math.round(size * 0.5))}
            color="#e11d48"
          />
        </View>
      );
    }

    // Default: 'team'
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: Math.max(4, Math.round(size / 4)),
        }}
        className="items-center justify-center bg-slate-200 dark:bg-slate-700"
      >
        <Text
          style={{ fontSize: Math.max(9, Math.round(size * 0.35)) }}
          className="font-bold text-slate-600 dark:text-slate-200"
        >
          {initials(name)}
        </Text>
      </View>
    );
  }

  if (variant === 'player') {
    return (
      <View
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className="items-center justify-center bg-slate-100 dark:bg-slate-800 overflow-hidden border border-slate-200/60 dark:border-slate-700"
      >
        <Image
          source={{ uri: activeUri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          onError={handleError}
        />
      </View>
    );
  }

  if (variant === 'competition') {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: Math.max(4, Math.round(size / 4)),
        }}
        className="items-center justify-center bg-white border border-slate-200 dark:border-slate-700 p-0.5 overflow-hidden"
      >
        <Image
          source={{ uri: activeUri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
          onError={handleError}
        />
      </View>
    );
  }

  // variant === 'team'
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size / 4)),
      }}
      className="items-center justify-center bg-white p-0.5 overflow-hidden border border-slate-100 dark:border-slate-800"
    >
      <Image
        source={{ uri: activeUri }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
        onError={handleError}
      />
    </View>
  );
}

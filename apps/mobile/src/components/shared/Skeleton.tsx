import { useEffect, useState } from 'react';
import { Animated, Easing, View, type ViewStyle } from 'react-native';

interface SkeletonProps {
  className?: string;
  style?: ViewStyle;
}

/**
 * Bloque base con efecto de pulso / brillo (shimmer) acelerado por hardware (useNativeDriver: true).
 * Se adapta automáticamente al modo claro y oscuro.
 */
export function Skeleton({ className = 'h-4 w-full rounded-md', style }: SkeletonProps) {
  const [pulse] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.85,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[{ opacity: pulse }, style]}
      className={`bg-slate-200 dark:bg-slate-800 ${className}`}
    />
  );
}

/**
 * Círculo con efecto skeleton para avatares, escudos e iconos.
 */
export function SkeletonCircle({ size = 48, className = '' }: { size?: number; className?: string }) {
  return (
    <Skeleton
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className={className}
    />
  );
}

/**
 * Tarjeta contenedora para agrupar elementos skeleton.
 */
export function SkeletonCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View
      className={`rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {children}
    </View>
  );
}

/**
 * Skeleton completo para la pantalla de detalle de partido (MatchDetail).
 * Mantiene la estructura de la cabecera, marcador, pestañas y timeline.
 */
export function MatchDetailSkeleton() {
  return (
    <View className="flex-1 bg-rink-floor px-3 pt-2 dark:bg-rink-floor-dark">
      {/* Cabecera del partido skeleton */}
      <SkeletonCard className="mb-3">
        {/* Competición y estado */}
        <View className="items-center pb-2">
          <Skeleton className="h-3 w-40 rounded-full mb-1.5" />
          <Skeleton className="h-2.5 w-24 rounded-full" />
        </View>

        {/* Marcador central y escudos */}
        <View className="flex-row items-center justify-between py-3">
          {/* Equipo Local */}
          <View className="flex-1 items-center gap-2">
            <SkeletonCircle size={56} />
            <Skeleton className="h-3.5 w-20 rounded-md" />
          </View>

          {/* Marcador */}
          <View className="items-center px-4">
            <Skeleton className="h-8 w-16 rounded-xl" />
          </View>

          {/* Equipo Visitante */}
          <View className="flex-1 items-center gap-2">
            <SkeletonCircle size={56} />
            <Skeleton className="h-3.5 w-20 rounded-md" />
          </View>
        </View>

        {/* Resumen de incidencias */}
        <View className="mt-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <View className="flex-row justify-between mb-2">
            <Skeleton className="h-3 w-28 rounded-md" />
            <Skeleton className="h-3 w-28 rounded-md" />
          </View>
          <View className="flex-row justify-between">
            <Skeleton className="h-3 w-20 rounded-md" />
            <Skeleton className="h-3 w-24 rounded-md" />
          </View>
        </View>

        {/* Barra de faltas */}
        <View className="mt-3 flex-row items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
          <Skeleton className="h-3 w-16 rounded-md" />
          <Skeleton className="h-3 w-28 rounded-md" />
          <Skeleton className="h-3 w-16 rounded-md" />
        </View>
      </SkeletonCard>

      {/* Pestañas skeleton */}
      <View className="mb-3 flex-row rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
        <View className="flex-1 items-center py-2">
          <Skeleton className="h-4 w-16 rounded-md" />
        </View>
        <View className="flex-1 items-center py-2">
          <Skeleton className="h-4 w-20 rounded-md" />
        </View>
        <View className="flex-1 items-center py-2">
          <Skeleton className="h-4 w-20 rounded-md" />
        </View>
      </View>

      {/* Timeline skeleton */}
      <SkeletonCard className="relative overflow-hidden">
        {/* Divisor 1ª Parte */}
        <View className="flex-row items-center gap-3 py-2 mb-2">
          <View className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <View className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </View>

        {/* Eje central */}
        <View
          style={{ left: '50%', transform: [{ translateX: -0.5 }] }}
          className="absolute top-12 bottom-4 w-px bg-slate-100 dark:bg-slate-800"
        />

        {/* Filas simuladas */}
        {[
          { isHome: false, width: 'w-24' },
          { isHome: true, width: 'w-20' },
          { isHome: true, width: 'w-32' },
          { isHome: false, width: 'w-28' },
          { isHome: true, width: 'w-24' },
          { isHome: false, width: 'w-36' },
        ].map((item, idx) => (
          <View key={idx} className="my-2 flex-row items-center">
            {/* Columna Izquierda */}
            <View className="flex-1 items-end pr-2">
              {item.isHome ? (
                <View className="flex-row items-center gap-2">
                  <Skeleton className={`h-3.5 ${item.width} rounded-md`} />
                  <SkeletonCircle size={18} />
                </View>
              ) : null}
            </View>

            {/* Nodo Central */}
            <View className="w-[50px] items-center justify-center z-10">
              <Skeleton className="h-3 w-8 rounded" />
            </View>

            {/* Columna Derecha */}
            <View className="flex-1 items-start pl-2">
              {!item.isHome ? (
                <View className="flex-row items-center gap-2">
                  <SkeletonCircle size={18} />
                  <Skeleton className={`h-3.5 ${item.width} rounded-md`} />
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </SkeletonCard>
    </View>
  );
}

/**
 * Skeleton para la pantalla de ficha de jugador (PlayerDetail).
 */
export function PlayerDetailSkeleton() {
  return (
    <View className="flex-1 bg-rink-floor px-3 pt-2 dark:bg-rink-floor-dark">
      {/* Cabecera con avatar grande y nombre */}
      <SkeletonCard className="items-center mb-3">
        <SkeletonCircle size={80} className="mb-3" />
        <Skeleton className="h-5 w-44 rounded-md mb-2" />
        <Skeleton className="h-3.5 w-28 rounded-md mb-3" />
        <View className="flex-row gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </View>
      </SkeletonCard>

      {/* Grid de estadísticas rápidas */}
      <View className="flex-row gap-2 mb-3">
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            className="flex-1 items-center rounded-xl bg-white p-3 shadow-sm dark:bg-slate-900 border border-slate-100 dark:border-slate-800"
          >
            <Skeleton className="h-3 w-12 rounded-md mb-2" />
            <Skeleton className="h-6 w-8 rounded-md" />
          </View>
        ))}
      </View>

      {/* Historial o partidos recientes */}
      <SkeletonCard>
        <Skeleton className="h-4 w-36 rounded-md mb-3" />
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            className="flex-row items-center justify-between py-2.5 border-b border-slate-100 dark:border-slate-800"
          >
            <Skeleton className="h-3.5 w-32 rounded-md" />
            <Skeleton className="h-4 w-12 rounded-md" />
            <Skeleton className="h-3.5 w-20 rounded-md" />
          </View>
        ))}
      </SkeletonCard>
    </View>
  );
}

/**
 * Skeleton para la pantalla de ficha de equipo (TeamDetail).
 */
export function TeamDetailSkeleton() {
  return (
    <View className="flex-1 bg-rink-floor px-3 pt-2 dark:bg-rink-floor-dark">
      <SkeletonCard className="items-center mb-3">
        <SkeletonCircle size={76} className="mb-3" />
        <Skeleton className="h-5 w-48 rounded-md mb-2" />
        <Skeleton className="h-3.5 w-32 rounded-md" />
      </SkeletonCard>

      {/* Tarjetas de plantilla o partidos */}
      <SkeletonCard>
        <Skeleton className="h-4 w-32 rounded-md mb-3" />
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            className="flex-row items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-800"
          >
            <SkeletonCircle size={36} />
            <View className="flex-1 gap-1">
              <Skeleton className="h-3.5 w-36 rounded-md" />
              <Skeleton className="h-3 w-20 rounded-md" />
            </View>
            <Skeleton className="h-4 w-8 rounded-md" />
          </View>
        ))}
      </SkeletonCard>
    </View>
  );
}

/**
 * Skeleton para la pantalla de competición (CompetitionDetail).
 */
export function CompetitionDetailSkeleton() {
  return (
    <View className="flex-1 bg-rink-floor px-3 pt-2 dark:bg-rink-floor-dark">
      <SkeletonCard className="items-center mb-3">
        <SkeletonCircle size={60} className="mb-2" />
        <Skeleton className="h-5 w-48 rounded-md mb-1.5" />
        <Skeleton className="h-3 w-28 rounded-md" />
      </SkeletonCard>

      {/* Pestañas de competición */}
      <View className="mb-3 flex-row rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
        <View className="flex-1 items-center py-2">
          <Skeleton className="h-4 w-24 rounded-md" />
        </View>
        <View className="flex-1 items-center py-2">
          <Skeleton className="h-4 w-24 rounded-md" />
        </View>
      </View>

      {/* Tabla skeleton */}
      <SkeletonCard>
        <View className="flex-row justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
          <Skeleton className="h-3 w-20 rounded-md" />
          <Skeleton className="h-3 w-16 rounded-md" />
        </View>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <View
            key={i}
            className="flex-row items-center justify-between py-2.5 border-b border-slate-100 dark:border-slate-800"
          >
            <View className="flex-row items-center gap-2">
              <Skeleton className="h-3 w-4 rounded-md" />
              <SkeletonCircle size={22} />
              <Skeleton className="h-3.5 w-32 rounded-md" />
            </View>
            <Skeleton className="h-4 w-8 rounded-md" />
          </View>
        ))}
      </SkeletonCard>
    </View>
  );
}

/**
 * Skeleton para la pantalla de clasificación por ligas (Standings).
 */
export function StandingsSkeleton() {
  return (
    <View className="flex-1 bg-rink-floor px-3 pt-2 dark:bg-rink-floor-dark">
      {/* Tira horizontal de ligas */}
      <View className="flex-row gap-2 py-2 mb-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </View>

      {/* Tabla de clasificación */}
      <SkeletonCard>
        <View className="flex-row items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
          <Skeleton className="h-3 w-28 rounded-md" />
          <View className="flex-row gap-3">
            <Skeleton className="h-3 w-6 rounded-md" />
            <Skeleton className="h-3 w-6 rounded-md" />
          </View>
        </View>

        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <View
            key={i}
            className="flex-row items-center justify-between py-2.5 border-b border-slate-50 last:border-b-0 dark:border-slate-800/60"
          >
            <View className="flex-row items-center gap-2.5">
              <Skeleton className="h-3.5 w-4 rounded" />
              <SkeletonCircle size={24} />
              <Skeleton className="h-3.5 w-32 rounded-md" />
            </View>
            <View className="flex-row gap-3">
              <Skeleton className="h-3.5 w-6 rounded" />
              <Skeleton className="h-4 w-7 rounded font-bold" />
            </View>
          </View>
        ))}
      </SkeletonCard>
    </View>
  );
}

/**
 * Skeleton para los resultados de búsqueda mientras se resuelven las coincidencias.
 */
export function SearchSkeleton() {
  return (
    <View className="flex-1 bg-rink-floor px-4 pt-2 dark:bg-rink-floor-dark">
      <Skeleton className="h-3.5 w-24 rounded mb-3" />
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <View
          key={i}
          className="flex-row items-center border-b border-slate-100 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900"
        >
          <SkeletonCircle size={32} />
          <View className="ml-3 flex-1 gap-1.5">
            <Skeleton className="h-4 w-40 rounded" />
            <Skeleton className="h-3 w-20 rounded" />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Skeleton para la pantalla principal de partidos (Feed / Home).
 */
export function FeedSkeleton() {
  return (
    <View className="flex-1 bg-rink-floor px-3 pt-2 dark:bg-rink-floor-dark">
      {/* Tira horizontal de fechas skeleton */}
      <View className="flex-row justify-between py-2 mb-3">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <View key={i} className="items-center px-1">
            <Skeleton className="h-2.5 w-7 rounded mb-1" />
            <Skeleton className="h-6 w-9 rounded-xl" />
          </View>
        ))}
      </View>

      {/* Dos grupos de competiciones con tarjetas de partido */}
      {[1, 2].map((group) => (
        <SkeletonCard key={group} className="mb-3">
          {/* Cabecera del grupo / competición */}
          <View className="flex-row items-center justify-between pb-3 mb-2 border-b border-slate-100 dark:border-slate-800">
            <View className="flex-row items-center gap-2">
              <SkeletonCircle size={20} />
              <Skeleton className="h-4 w-36 rounded-md" />
            </View>
            <Skeleton className="h-3.5 w-6 rounded-md" />
          </View>

          {/* Partidos simulados */}
          {[1, 2].map((match) => (
            <View
              key={match}
              className="py-2.5 border-b border-slate-50 last:border-b-0 dark:border-slate-800/60"
            >
              <View className="flex-row items-center justify-between mb-1.5">
                <View className="flex-row items-center gap-2">
                  <SkeletonCircle size={18} />
                  <Skeleton className="h-3.5 w-32 rounded-md" />
                </View>
                <Skeleton className="h-4 w-6 rounded-md" />
              </View>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <SkeletonCircle size={18} />
                  <Skeleton className="h-3.5 w-28 rounded-md" />
                </View>
                <Skeleton className="h-4 w-6 rounded-md" />
              </View>
            </View>
          ))}
        </SkeletonCard>
      ))}
    </View>
  );
}

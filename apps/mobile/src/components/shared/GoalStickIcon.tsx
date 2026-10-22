import { View } from 'react-native';
import { useColorScheme } from 'nativewind';

interface GoalStickIconProps {
  size?: number;
  variant?: 'badge' | 'inline';
}

/**
 * Icono de Stick de hockey sobre patines + bola (identidad oficial de Stick Live).
 * Dibuja el stick diagonal con pala curva y bola de corcho, sustituyendo los
 * emojis de hockey sobre hierba (🏑) por el stick genuino de patines.
 */
export function GoalStickIcon({ size, variant = 'badge' }: GoalStickIconProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (variant === 'inline') {
    const s = size ?? 14;
    const stickBg = isDark ? '#f8fafc' : '#0f172a';
    return (
      <View
        style={{ width: s, height: s }}
        className="relative shrink-0 items-center justify-center"
      >
        {/* Mango del stick */}
        <View
          style={{
            position: 'absolute',
            left: s * 0.16,
            top: s * 0.07,
            width: s * 0.13,
            height: s * 0.72,
            transform: [{ rotate: '-32deg' }],
            borderRadius: 0.8,
            backgroundColor: stickBg,
          }}
        />
        {/* Pala curva del stick */}
        <View
          style={{
            position: 'absolute',
            left: s * 0.38,
            top: s * 0.65,
            width: s * 0.36,
            height: s * 0.15,
            borderRadius: 0.8,
            backgroundColor: stickBg,
          }}
        />
        {/* Bola de corcho */}
        <View
          style={{
            position: 'absolute',
            right: s * 0.05,
            top: s * 0.58,
            width: s * 0.24,
            height: s * 0.24,
            borderRadius: s * 0.12,
            backgroundColor: stickBg,
          }}
        />
      </View>
    );
  }

  // variant === 'badge': circulo exterior con sombra para timeline / eventos
  const outerSize = size ?? 28;
  return (
    <View
      style={{ width: outerSize, height: outerSize }}
      className="shrink-0 items-center justify-center rounded-full bg-slate-900 shadow-sm dark:bg-white"
    >
      <View className="relative h-4 w-4 items-center justify-center">
        {/* Mango del stick */}
        <View
          style={{
            position: 'absolute',
            left: 2.5,
            top: 1,
            width: 2,
            height: 11,
            transform: [{ rotate: '-32deg' }],
            borderRadius: 1,
          }}
          className="bg-white dark:bg-slate-900"
        />
        {/* Pala curva del stick */}
        <View
          style={{
            position: 'absolute',
            left: 6,
            top: 10,
            width: 5.5,
            height: 2.2,
            borderRadius: 1.1,
          }}
          className="bg-white dark:bg-slate-900"
        />
        {/* Bola */}
        <View
          style={{
            position: 'absolute',
            right: 0.5,
            top: 9,
            width: 3.5,
            height: 3.5,
            borderRadius: 2,
          }}
          className="bg-white dark:bg-slate-900"
        />
      </View>
    </View>
  );
}

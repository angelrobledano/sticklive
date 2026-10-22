import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from 'nativewind';
import { getShareIconName } from '@/src/lib/header-helpers';

interface ShareHeaderButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
}

/**
 * Botón de cabecera para compartir con icono adaptado a la plataforma:
 * - En Android: icono de 3 nodos ('share-social').
 * - En iOS: icono de caja con flecha hacia arriba ('share-outline').
 */
export function ShareHeaderButton({ onPress, accessibilityLabel }: ShareHeaderButtonProps) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      className="p-1 active:opacity-60"
    >
      <Ionicons
        name={getShareIconName()}
        size={20}
        color={colorScheme === 'dark' ? '#f8fafc' : '#0f172a'}
      />
    </Pressable>
  );
}

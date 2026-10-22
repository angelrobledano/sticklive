import { Image, View } from 'react-native';

interface CountryFlagProps {
  /** Código ISO 3166-1 alpha-2 ("ES", "PT"…) */
  code: string | null | undefined;
  /** Ancho en píxeles. Altura calculada con proporción estándar 4:3. Default: 20 */
  size?: number;
  className?: string;
}

export function CountryFlag({ code, size = 20, className }: CountryFlagProps) {
  if (!code || code.length !== 2) return null;
  const cc = code.toLowerCase();
  const height = Math.round((size * 3) / 4);

  return (
    <View
      style={{ width: size, height }}
      className={`overflow-hidden rounded-[3px] bg-slate-100 dark:bg-slate-800 ${className ?? ''}`}
    >
      <Image
        source={{ uri: `https://flagcdn.com/w80/${cc}.png` }}
        style={{ width: size, height }}
        resizeMode="cover"
      />
    </View>
  );
}

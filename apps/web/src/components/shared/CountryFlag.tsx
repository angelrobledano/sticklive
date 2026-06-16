/**
 * Bandera de país como IMAGEN (no emoji).
 *
 * Los emojis de bandera (🇪🇸) no se renderizan en navegadores de Windows
 * (muestran las letras del código), aunque sí en Android/iOS/macOS. Para que se
 * vea igual en todas las plataformas usamos los SVG de flagcdn.com.
 */
interface CountryFlagProps {
  /** Código ISO 3166-1 alpha-2 ("ES", "PT"…) */
  code: string | null;
  /** Clases para la <img> (tamaño/recorte). Default: ancho 20px. */
  className?: string;
  alt?: string;
}

export function CountryFlag({ code, className, alt }: CountryFlagProps) {
  if (!code || code.length !== 2) return null;
  const cc = code.toLowerCase();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/${cc}.svg`}
      alt={alt ?? code.toUpperCase()}
      loading="lazy"
      decoding="async"
      className={className ?? 'w-5 h-auto rounded-[2px]'}
    />
  );
}

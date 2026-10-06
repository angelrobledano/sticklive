import { clubName } from '@/lib/names';

/**
 * Nombre de equipo adaptativo — sistema global de la app:
 *  · Escritorio (>768px): nombre oficial completo en Sentence case.
 *  · Móvil: nombre corto/siglas según densidad del contenedor.
 *
 * `mobile="short"` usa el shortName tal cual (listas con margen medio);
 * `mobile="abbr"` lo recorta a 3-4 caracteres (densidad crítica: brackets,
 * marcadores, modales).
 */
export function TeamName({ name, shortName, mobile = 'short', suffix, className = '' }: {
  name: string;
  shortName: string | null;
  mobile?: 'short' | 'abbr';
  /** #196: sufijo de sección ('F', 'B', 'F · B') para desambiguar equipos del mismo club. */
  suffix?: string | null;
  className?: string;
}) {
  const compact = shortName ?? clubName(name);
  const mobileText = mobile === 'abbr' ? compact.slice(0, 4).toUpperCase() : compact;

  return (
    <span className={className}>
      <span className="hidden md:inline">{clubName(name)}</span>
      <span className="md:hidden">{mobileText}</span>
      {suffix ? (
        <span className="ml-1 text-[11px] font-normal text-slate-500 dark:text-slate-400">{suffix}</span>
      ) : null}
    </span>
  );
}

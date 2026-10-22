/**
 * Clave de CLUB de sidgad a partir del escudo (A4).
 *
 * Sidgad tiene tres niveles de id: club (estable), inscripción de equipo
 * (`teamId`, cambia por temporada y competición) y jugador. El id de club no
 * viene en el calendario, pero sí el escudo, cuyo nombre de fichero ES ese id:
 * `logos_clubes/322.png` (FECAPA), `logos_clubes/calafell.png` (RFEP). Las
 * variantes `_n` (`252_1.png`) son versiones del mismo escudo.
 */
const GENERIC = /^(0|no_?logo|sin_?logo|default|escudo_defecto|logo)$/i;

export function clubKeyFromLogo(logo: string | null | undefined): string | null {
  if (!logo) return null;
  const isBareFile = !logo.includes('/');
  if (!isBareFile && !/\/logos_clubes\//.test(logo)) return null;
  const file = logo.split('/').pop() ?? '';
  const m = /^([A-Za-z0-9-]+?)(?:_\d+)?\.(?:png|jpe?g|gif|webp|svg)$/i.exec(file);
  if (!m || GENERIC.test(m[1]!)) return null;
  return m[1]!.toLowerCase();
}

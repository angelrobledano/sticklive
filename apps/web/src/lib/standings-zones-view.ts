/**
 * Zonas de la clasificación en la web (B2).
 *
 * La API devuelve `zone` por fila desde `standings_zones` (reglamento como
 * datos, con fuente normativa). Si la temporada no tiene ninguna zona
 * declarada se conserva el comportamiento anterior (8 primeros play-off, 2
 * últimos descenso) en ligas de más de 8 equipos, hasta que se carguen zonas.
 */
export type ZoneKind =
  | 'champion' | 'promotion' | 'promotion_playoff' | 'final_phase'
  | 'placement' | 'playout' | 'relegation';

export interface RowZone { kind: ZoneKind; target: string | null }
export interface ZoneRow { position: number | null; zone?: RowZone | null }

const LEGACY_PLAYOFF = 8;
const LEGACY_RELEGATION = 2;

export function rowZones(rows: readonly ZoneRow[], opts: { legacyFallback: boolean }): (RowZone | null)[] {
  if (rows.some((r) => r.zone)) return rows.map((r) => r.zone ?? null);
  if (!opts.legacyFallback || rows.length <= LEGACY_PLAYOFF) return rows.map(() => null);
  return rows.map((r, i) => {
    const pos = r.position ?? i + 1;
    if (pos <= LEGACY_PLAYOFF) return { kind: 'promotion_playoff', target: null };
    if (pos > rows.length - LEGACY_RELEGATION) return { kind: 'relegation', target: null };
    return null;
  });
}

const same = (a: RowZone | null, b: RowZone | null) => a?.kind === b?.kind && a?.target === b?.target;

/** true en la fila tras la cual cambia la zona (línea de corte). Nunca en la última. */
export function zoneChangesAfter(zones: readonly (RowZone | null)[]): boolean[] {
  return zones.map((z, i) => i < zones.length - 1 && !same(z, zones[i + 1] ?? null) && (z !== null || zones[i + 1] !== null));
}

/** Entradas de la leyenda: una por zona y destino, en el orden de la tabla. */
export function zoneLegend(zones: readonly (RowZone | null)[]): RowZone[] {
  const out: RowZone[] = [];
  for (const z of zones) if (z && !out.some((o) => same(o, z))) out.push(z);
  return out;
}

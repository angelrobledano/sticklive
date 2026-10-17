/**
 * year-typo.ts — corrige erratas de AÑO en las fechas de un calendario.
 *
 * La fuente de World Skate publicó la final del Mundial WSG Asunción con
 * gamedate="20271018" (18/10/2027) en un torneo del 12 al 18/10/2026. El loader
 * rechaza con razón un partido nuevo fuera de la ventana de su temporada
 * (#229), así que la final no llegaba a la base de datos.
 *
 * Regla conservadora: una fecha a más de `outlierDays` de la mediana del
 * calendario se corrige SOLO si desplazándola ±1 año cae dentro del rango del
 * resto de partidos (con `marginDays` de holgura). Si no encaja, se deja tal
 * cual: el loader la rechazará y avisará. Función pura.
 */

const DAY = 86_400_000;

export interface YearTypoFix {
  index: number;
  from: string;
  to: string;
}

function shiftYear(iso: string, delta: number): string {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + delta);
  return d.toISOString();
}

export function fixYearTypos(
  dates: ReadonlyArray<string | null | undefined>,
  { outlierDays = 180, marginDays = 7 }: { outlierDays?: number; marginDays?: number } = {},
): { dates: Array<string | null | undefined>; corrected: YearTypoFix[] } {
  const out = [...dates];
  const corrected: YearTypoFix[] = [];
  const valid = dates
    .map((d, i) => ({ i, t: d ? Date.parse(d) : NaN }))
    .filter((x) => Number.isFinite(x.t));
  if (valid.length < 3) return { dates: out, corrected };

  const sorted = valid.map((x) => x.t).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;

  for (const { i, t } of valid) {
    if (Math.abs(t - median) <= outlierDays * DAY) continue;
    // Rango del resto de partidos (sin la fecha sospechosa).
    const others = valid.filter((x) => x.i !== i && Math.abs(x.t - median) <= outlierDays * DAY).map((x) => x.t);
    if (others.length < 2) continue;
    const lo = Math.min(...others) - marginDays * DAY;
    const hi = Math.max(...others) + marginDays * DAY;
    for (const delta of [-1, 1]) {
      const candidate = shiftYear(dates[i]!, delta);
      const ct = Date.parse(candidate);
      if (ct >= lo && ct <= hi) {
        out[i] = candidate;
        corrected.push({ index: i, from: dates[i]!, to: candidate });
        break;
      }
    }
  }
  return { dates: out, corrected };
}
